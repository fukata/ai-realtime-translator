// AudioWorkletProcessor that denoises mono 48kHz audio using RNNoise WASM.
// Expects 480-sample frames at 48kHz; buffers render quanta (128) and processes in 480-chunks.
// If sampleRate != 48000 or RNNoise not ready, passes through.

// Import ESM module inside worklet scope
import { Rnnoise } from '@shiguredo/rnnoise-wasm';

// Minimal ambient declarations to satisfy TypeScript in the worklet context
declare const sampleRate: number;
declare function registerProcessor(name: string, processorCtor: any): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: any);
}

class RnnoiseProcessor extends AudioWorkletProcessor {
  private ready = false;
  private bypass = false;
  private denoiser: any | null = null;
  private inBuf: Float32Array = new Float32Array(0);
  private outBuf: Float32Array = new Float32Array(0);

  constructor() {
    super();
    // Guard sample rate
    if (sampleRate !== 48000) {
      this.bypass = true;
    }
    // Load RNNoise asynchronously
    Rnnoise.load()
      .then((rn) => {
        if (this.bypass) return;
        this.denoiser = rn.createDenoiseState();
        this.ready = true;
      })
      .catch(() => {
        this.bypass = true;
      });
    // handle messages (optional) for future controls
    this.port.onmessage = (ev) => {
      if (ev.data === 'bypass:on') this.bypass = true;
      if (ev.data === 'bypass:off') this.bypass = false;
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const inCh = input[0];
    const outCh = output[0];
    const n = outCh.length;

    if (this.bypass || !this.ready || !this.denoiser) {
      // passthrough
      for (let i = 0; i < n; i++) outCh[i] = inCh ? inCh[i] : 0;
      return true;
    }

    // Append input to buffer (mono expected)
    const append = inCh || new Float32Array(n);
    const newIn = new Float32Array(this.inBuf.length + append.length);
    newIn.set(this.inBuf, 0);
    newIn.set(append, this.inBuf.length);
    this.inBuf = newIn;

    // While enough for a 480-sample frame, denoise and enqueue
    const FRAME = 480;
    while (this.inBuf.length >= FRAME) {
      const frame = this.inBuf.subarray(0, FRAME);
      const frameCopy = new Float32Array(frame); // rnnoise mutates the array
      this.denoiser.processFrame(frameCopy);
      const newOut = new Float32Array(this.outBuf.length + FRAME);
      newOut.set(this.outBuf, 0);
      newOut.set(frameCopy, this.outBuf.length);
      this.outBuf = newOut;
      // consume
      this.inBuf = this.inBuf.subarray(FRAME);
    }

    // Fill current render quantum from outBuf; if insufficient, fall back to input
    if (this.outBuf.length >= n) {
      outCh.set(this.outBuf.subarray(0, n));
      this.outBuf = this.outBuf.subarray(n);
    } else {
      // partial
      const have = this.outBuf.length;
      if (have > 0) outCh.set(this.outBuf.subarray(0, have), 0);
      for (let i = have; i < n; i++) outCh[i] = inCh ? inCh[i] : 0;
      this.outBuf = new Float32Array(0);
    }

    return true;
  }
}

registerProcessor('rnnoise-processor', RnnoiseProcessor);
