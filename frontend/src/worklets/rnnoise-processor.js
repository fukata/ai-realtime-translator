// AudioWorkletProcessor that denoises mono 48kHz audio using RNNoise WASM.
// Expects 480-sample frames at 48kHz; buffers render quanta (128) and processes in 480-chunks.
// If sampleRate != 48000 or RNNoise not ready, passes through.
class RnnoiseProcessor extends AudioWorkletProcessor {
    ready = false;
    bypass = false;
    denoiser = null;
    // Buffers in 48kHz domain
    in48 = new Float32Array(0);
    out48 = new Float32Array(0);
    // Resampler state: source (context rate) -> 48k
    rsSrc = new Float32Array(0);
    rsPos = 0; // fractional index in rsSrc
    rsEnabled = false;
    rsStepUp = 1; // src per one 48k output sample (in samples)
    // Downsampler state: 48k -> context rate
    dsPos = 0; // fractional index in out48
    dsStepDown = 1; // 48k samples per one context output sample
    constructor() {
        super();
        // Resampler setup if context sample rate != 48k
        if (sampleRate !== 48000) {
            this.rsEnabled = true;
            this.rsStepUp = sampleRate / 48000; // advance in source per one 48k sample
            this.dsStepDown = 48000 / sampleRate; // advance in 48k per one dest sample
            try {
                this.port.postMessage({ type: 'rnnoise.status', status: 'resampling' });
            }
            catch { }
        }
        else {
            this.rsEnabled = false;
            this.rsStepUp = 1;
            this.dsStepDown = 1;
        }
        // Load RNNoise asynchronously (from public/vendor/rnnoise.js)
        (async () => {
            try {
                const rnUrl = new URL('../../vendor/rnnoise.js', import.meta.url).href;
                const mod = await import(/* @vite-ignore */ rnUrl);
                const rn = await mod.Rnnoise.load();
                if (this.bypass)
                    return;
                this.denoiser = rn.createDenoiseState();
                this.ready = true;
                try {
                    this.port.postMessage({ type: 'rnnoise.status', status: this.rsEnabled ? 'resampling' : 'ready' });
                }
                catch { }
            }
            catch (e) {
                this.bypass = true;
                try {
                    this.port.postMessage({ type: 'rnnoise.status', status: 'bypass', reason: 'init_error' });
                }
                catch { }
            }
        })();
        // handle messages (optional) for future controls
        this.port.onmessage = (ev) => {
            if (ev.data === 'bypass:on')
                this.bypass = true;
            if (ev.data === 'bypass:off')
                this.bypass = false;
        };
    }
    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length === 0 || !output || output.length === 0)
            return true;
        const inCh = input[0];
        const outCh = output[0];
        const n = outCh.length;
        if (this.bypass || !this.denoiser) {
            // passthrough
            for (let i = 0; i < n; i++)
                outCh[i] = inCh ? inCh[i] : 0;
            return true;
        }
        // Step 1: source -> 48k buffer
        if (inCh) {
            if (this.rsEnabled) {
                // append to rsSrc
                const tmp = new Float32Array(this.rsSrc.length + inCh.length);
                tmp.set(this.rsSrc, 0);
                tmp.set(inCh, this.rsSrc.length);
                this.rsSrc = tmp;
                // generate as many 48k samples as possible
                const produced = [];
                const outArr = [];
                let pos = this.rsPos;
                while (Math.floor(pos) + 1 < this.rsSrc.length) {
                    const i0 = Math.floor(pos);
                    const i1 = i0 + 1;
                    const frac = pos - i0;
                    const y = this.rsSrc[i0] * (1 - frac) + this.rsSrc[i1] * frac;
                    outArr.push(y);
                    pos += this.rsStepUp;
                }
                this.rsPos = pos;
                // trim consumed src keeping one sample overlap
                const drop = Math.max(0, Math.floor(pos) - 1);
                this.rsSrc = this.rsSrc.subarray(drop);
                this.rsPos -= drop;
                if (outArr.length > 0) {
                    const append48 = new Float32Array(outArr);
                    const merged = new Float32Array(this.in48.length + append48.length);
                    merged.set(this.in48, 0);
                    merged.set(append48, this.in48.length);
                    this.in48 = merged;
                }
            }
            else {
                // no resample, just append to 48k buffer directly
                const merged = new Float32Array(this.in48.length + inCh.length);
                merged.set(this.in48, 0);
                merged.set(inCh, this.in48.length);
                this.in48 = merged;
            }
        }
        // Step 2: process in 480-sample frames at 48k
        const FRAME = 480;
        while (this.in48.length >= FRAME) {
            const frame = this.in48.subarray(0, FRAME);
            const frameCopy = new Float32Array(frame);
            this.denoiser.processFrame(frameCopy);
            const outMerged = new Float32Array(this.out48.length + FRAME);
            outMerged.set(this.out48, 0);
            outMerged.set(frameCopy, this.out48.length);
            this.out48 = outMerged;
            this.in48 = this.in48.subarray(FRAME);
        }
        // Step 3: produce render quantum at context rate from out48
        if (this.rsEnabled) {
            const out = outCh;
            const needed = n;
            let produced = 0;
            let pos = this.dsPos;
            while (produced < needed && Math.floor(pos) + 1 < this.out48.length) {
                const i0 = Math.floor(pos);
                const i1 = i0 + 1;
                const frac = pos - i0;
                out[produced++] = this.out48[i0] * (1 - frac) + this.out48[i1] * frac;
                pos += this.dsStepDown;
            }
            this.dsPos = pos;
            const drop = Math.max(0, Math.floor(pos) - 1);
            this.out48 = this.out48.subarray(drop);
            this.dsPos -= drop;
            // If not enough processed samples, fill rest with input (passthrough) or zeros
            for (let i = produced; i < needed; i++)
                out[i] = inCh ? inCh[i] : 0;
        }
        else {
            if (this.out48.length >= n) {
                outCh.set(this.out48.subarray(0, n));
                this.out48 = this.out48.subarray(n);
            }
            else {
                const have = this.out48.length;
                if (have > 0)
                    outCh.set(this.out48.subarray(0, have), 0);
                for (let i = have; i < n; i++)
                    outCh[i] = inCh ? inCh[i] : 0;
                this.out48 = new Float32Array(0);
            }
        }
        return true;
    }
}
registerProcessor('rnnoise-processor', RnnoiseProcessor);
export {};
