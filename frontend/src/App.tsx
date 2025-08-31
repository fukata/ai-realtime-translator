import { useEffect, useMemo, useRef, useState } from 'react';

type ClientToken = {
  id: string;
  model: string;
  client_secret: { value: string; expires_at: number };
};

const DEFAULT_MODEL = 'gpt-realtime';
const DEFAULT_VOICE = 'alloy';
const VOICE_OPTIONS = ['verse', 'alloy', 'aria', 'breeze'];
const MODEL_OPTIONS = [
  'gpt-realtime',
  'gpt-4o-realtime-preview-2024-12-17',
];
const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: 'ja', label: '日本語 (ja)' },
  { code: 'en', label: 'English (en)' },
  { code: 'zh', label: 'Chinese (zh)' },
  { code: 'ko', label: 'Korean (ko)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'de', label: 'German (de)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'pt', label: 'Portuguese (pt)' },
  { code: 'hi', label: 'Hindi (hi)' },
  { code: 'vi', label: 'Vietnamese (vi)' },
  { code: 'th', label: 'Thai (th)' },
  { code: 'id', label: 'Indonesian (id)' },
];

export function App() {
  const baseUrl = (import.meta as any).env?.VITE_SERVER_URL || '';

  const [model, setModel] = useState(DEFAULT_MODEL);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [sourceLang, setSourceLang] = useState('ja');
  const [targetLang, setTargetLang] = useState('en');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [inputTranscript, setInputTranscript] = useState('');
  const [outputTranscript, setOutputTranscript] = useState('');
  const inputBufferRef = useRef('');
  const outputBufferRef = useRef('');
  type ChatItem = { id: string; role: 'input' | 'output'; text: string; at: number };
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>('');
  type NoiseProfile = 'default' | 'off' | 'rnnoise';
  const [noiseProfile, setNoiseProfile] = useState<NoiseProfile>('default');
  type AudioPlayback = 'on' | 'off';
  const [audioPlayback, setAudioPlayback] = useState<AudioPlayback>('on');
  const [rnnoiseState, setRnnoiseState] = useState<'idle' | 'loading' | 'ready' | 'resampling' | 'bypass'>('idle');
  const reconnectTimerRef = useRef<number | null>(null);
  const [showWaveform, setShowWaveform] = useState(true);
  const inputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserInRef = useRef<AnalyserNode | null>(null);
  const analyserOutRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  function pushChat(role: 'input' | 'output', text: string) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;
    setChat((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === trimmed) return prev;
      return [...prev, { id: `${Date.now()}-${role}`, role, text: trimmed, at: Date.now() }];
    });
    setLogs((ls) => [...ls, `chat_${role}:len=${trimmed.length}`]);
  }

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const sessionReadyRef = useRef<boolean>(false);

  const serverUrl = useMemo(() => (baseUrl ? baseUrl.replace(/\/$/, '') : ''), [baseUrl]);

  // localStorage keys
  const LS_KEYS = {
    model: 'prefs:model',
    voice: 'prefs:voice',
    source: 'prefs:sourceLang',
    target: 'prefs:targetLang',
    micId: 'prefs:micId',
    noise: 'prefs:noiseProfile',
    playback: 'prefs:audioPlayback',
  } as const;

  async function requestToken(): Promise<ClientToken> {
    const url = serverUrl ? `${serverUrl}/api/token` : '/api/token';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ model, voice }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Token error: ${res.status} ${t}`);
    }
    return res.json();
  }

  async function connectWebRTC() {
    setStatus('connecting');
    setError(null);
    setInputTranscript('');
    setOutputTranscript('');
    setLogs([]);
    try {
      const token = await requestToken();

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
      });

      pcRef.current = pc;

      // Remote audio playback
      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          // Autoplay control based on setting
          if (audioPlayback === 'on') {
            remoteAudioRef.current.muted = false;
            remoteAudioRef.current.play().catch(() => {});
          } else {
            remoteAudioRef.current.muted = true;
            try { remoteAudioRef.current.pause(); } catch {}
          }
        }
      };

      // Helper to bind handlers to any datachannel
      const bindChannel = (dc: RTCDataChannel) => {
        dcRef.current = dc;
        dc.binaryType = 'arraybuffer';
        dc.addEventListener('message', (ev) => {
          try {
            if (typeof ev.data !== 'string') return; // ignore binary for now
            const msg = JSON.parse(ev.data);
            if (msg?.type) setLogs((ls) => [...ls, String(msg.type)]);

            // Surface error details
            if (msg?.type === 'error') {
              const message = (msg.error?.message || msg.message || '') as string | undefined;
              if (message) setLogs((ls) => [...ls, `error: ${message}`]);
              setError(message || 'error');
              return;
            }

            // Primary: transcript from audio
            if (msg?.type === 'response.audio_transcript.delta' && typeof msg.delta === 'string') {
              outputBufferRef.current += msg.delta;
              setOutputTranscript((t) => t + msg.delta);
            }
            if (msg?.type === 'response.audio_transcript.done') {
              setLogs((ls) => [...ls, 'audio_transcript_done']);
              const text = (outputBufferRef.current || '').trim();
              pushChat('output', text);
              setOutputTranscript('');
              outputBufferRef.current = '';
            }

            // Fallback: legacy text delta
            if (msg?.type === 'response.output_text.delta' && typeof msg.delta === 'string') {
              outputBufferRef.current += msg.delta;
              setOutputTranscript((t) => t + msg.delta);
            }
            if (msg?.type === 'response.output_text.done') {
              setLogs((ls) => [...ls, 'text_done']);
              const text = (outputBufferRef.current || '').trim();
              pushChat('output', text);
              setOutputTranscript('');
              outputBufferRef.current = '';
            }

            // Input side transcription (best effort)
            if (msg?.type === 'input_audio_buffer.speech_started' || msg?.type === 'response.input_audio_transcription.started') {
              setInputTranscript('');
              inputBufferRef.current = '';
            }
            if (
              msg?.type === 'input_audio_transcription.delta' ||
              msg?.type === 'input_audio_transcript.delta' ||
              msg?.type === 'response.input_audio_transcription.delta' ||
              msg?.type === 'response.input_audio_transcript.delta'
            ) {
              const seg = (msg.delta ?? msg.text ?? msg.transcript) as string | undefined;
              if (typeof seg === 'string') {
                inputBufferRef.current += seg;
                setInputTranscript((t) => t + seg);
              }
            }
            if (
              msg?.type === 'input_audio_transcription.done' ||
              msg?.type === 'input_audio_transcription.completed' ||
              msg?.type === 'input_audio_transcript.done' ||
              msg?.type === 'response.input_audio_transcription.done' ||
              msg?.type === 'response.input_audio_transcription.completed' ||
              msg?.type === 'response.input_audio_transcript.done'
            ) {
              setLogs((ls) => [...ls, 'input_transcript_done']);
              const text = (inputBufferRef.current || '').trim();
              pushChat('input', text);
              setInputTranscript('');
              inputBufferRef.current = '';
            }
            // Realtime sometimes emits conversation-scoped input transcription events
            if (
              msg?.type === 'conversation.item.input_audio_transcription.delta' ||
              msg?.type === 'conversation.item.input_audio_transcript.delta'
            ) {
              const seg = (msg.delta ?? msg.text ?? msg.transcript) as string | undefined;
              if (typeof seg === 'string') {
                inputBufferRef.current += seg;
                setInputTranscript((t) => t + seg);
              }
            }
            if (
              msg?.type === 'conversation.item.input_audio_transcription.completed' ||
              msg?.type === 'conversation.item.input_audio_transcript.completed'
            ) {
              setLogs((ls) => [...ls, 'conv_input_transcript_done']);
              const text = (inputBufferRef.current || '').trim();
              pushChat('input', text);
              setInputTranscript('');
              inputBufferRef.current = '';
            }
            // Some builds emit input as response.input_text.*
            if (msg?.type === 'response.input_text.delta' && typeof msg.delta === 'string') {
              inputBufferRef.current += msg.delta;
              setInputTranscript((t) => t + msg.delta);
            }
            if (msg?.type === 'response.input_text.done') {
              setLogs((ls) => [...ls, 'input_text_done']);
              const text = (inputBufferRef.current || '').trim();
              pushChat('input', text);
              setInputTranscript('');
              inputBufferRef.current = '';
            }

            if (msg?.type === 'response.created') {
              setOutputTranscript('');
            }
            if (msg?.type === 'response.completed') {
              // keep transcript as-is
            }
            if (msg?.type === 'session.updated') {
              sessionReadyRef.current = true;
              // send first response.create only after session is ready
              try {
                dc.send(
                  JSON.stringify({
                    type: 'response.create',
                    response: {
                      instructions:
                        `Translate the user's speech from ${sourceLang} to ${targetLang}. Always answer only in ${targetLang}.`,
                      modalities: ['audio', 'text'],
                      voice: voice,
                      conversation: 'none',
                    },
                  }),
                );
              } catch {}
            }
            if (msg?.type === 'response.error') {
              setError(msg.error?.message || 'response error');
            }
          } catch (e) {
            // non-JSON payloads are ignored
          }
        });
        dc.addEventListener('open', () => {
          // Enable server-side VAD so the model responds after you finish speaking
          dc.send(
            JSON.stringify({
              type: 'session.update',
              session: {
                turn_detection: { type: 'server_vad' },
                // Ask server to provide input audio transcription
                input_audio_transcription: { model: 'gpt-4o-mini-transcribe', language: sourceLang },
                // Enforce translation behavior at session (system) level for consistency
                instructions:
                  `You are a real-time speech translator. Translate any spoken input into ${targetLang}. Always respond ONLY in ${targetLang} with concise, natural phrasing. Do not include the source text or any explanations.`,
              },
            }),
          );
          sessionReadyRef.current = false;
        });
      };

      // Create our control channel and also bind if remote creates one
      bindChannel(pc.createDataChannel('oai-events'));
      pc.ondatachannel = (e) => {
        if (e.channel?.label === 'oai-events') bindChannel(e.channel);
      };

      // Capture microphone with configurable noise processing
      const enableBrowserDsp = noiseProfile === 'default';
      const audioConstraints: MediaTrackConstraints = {
        noiseSuppression: enableBrowserDsp,
        echoCancellation: enableBrowserDsp,
        autoGainControl: enableBrowserDsp,
        channelCount: 1,
        sampleRate: 48000,
      } as any;
      if (micId) (audioConstraints as any).deviceId = { exact: micId };
      const local = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      localStreamRef.current = local;

      // If RNNoise wasm is selected, route through an AudioWorklet
      if (noiseProfile === 'rnnoise') {
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
          const workletUrl = new URL('./worklets/rnnoise-processor.js', import.meta.url);
          await audioContext.audioWorklet.addModule(workletUrl);

          const src = audioContext.createMediaStreamSource(local);
          const denoiseNode = new (window as any).AudioWorkletNode(audioContext, 'rnnoise-processor');
          try {
            setRnnoiseState('loading');
            denoiseNode.port.onmessage = (ev: MessageEvent) => {
              const d: any = ev.data;
              if (d?.type === 'rnnoise.status') {
                if (d.status === 'ready' || d.status === 'resampling') setRnnoiseState(d.status);
                else setRnnoiseState('bypass');
              }
            };
          } catch {}
          const dst = audioContext.createMediaStreamDestination();
          src.connect(denoiseNode as any);
          (denoiseNode as any).connect(dst);

          // Add processed track to PC
          dst.stream.getTracks().forEach((t) => pc.addTrack(t, dst.stream));

          // Keep references for cleanup
          (window as any).__rnnoise_audio_context = audioContext;
          (window as any).__rnnoise_nodes = { src, denoiseNode, dst };
          try {
            await audioContext.resume();
            setLogs((ls) => [...ls, `rnnoise_audio_context_state:${audioContext.state}`]);
          } catch {}
          // Waveform analysers (before/after)
          const anIn = audioContext.createAnalyser();
          anIn.fftSize = 2048; anIn.smoothingTimeConstant = 0.85;
          const anOut = audioContext.createAnalyser();
          anOut.fftSize = 2048; anOut.smoothingTimeConstant = 0.85;
          src.connect(anIn);
          (denoiseNode as any).connect(anOut);
          audioCtxRef.current = audioContext;
          analyserInRef.current = anIn;
          analyserOutRef.current = anOut;
        } catch (e) {
          // Fallback to direct tracks on failure
          local.getTracks().forEach((t) => pc.addTrack(t, local));
          setLogs((ls) => [...ls, `rnnoise_worklet_failed: ${String((e as any)?.message || e)}`]);
          setRnnoiseState('bypass');
        }
      } else {
        // direct: add original track(s)
        local.getTracks().forEach((t) => pc.addTrack(t, local));
        setRnnoiseState('idle');
        // Waveform analysers (mirror input as output)
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const src = audioContext.createMediaStreamSource(local);
          const anIn = audioContext.createAnalyser();
          anIn.fftSize = 2048; anIn.smoothingTimeConstant = 0.85;
          const anOut = audioContext.createAnalyser();
          anOut.fftSize = 2048; anOut.smoothingTimeConstant = 0.85;
          src.connect(anIn);
          src.connect(anOut);
          audioCtxRef.current = audioContext;
          analyserInRef.current = anIn;
          analyserOutRef.current = anOut;
          try { await audioContext.resume(); setLogs((ls) => [...ls, `viz_audio_context_state:${audioContext.state}`]); } catch {}
        } catch {}
      }

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.client_secret.value}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp || undefined,
      });
      if (!sdpResponse.ok) {
        const txt = await sdpResponse.text();
        throw new Error(`Realtime SDP error: ${sdpResponse.status} ${txt}`);
      }
      const answer = { type: 'answer' as const, sdp: await sdpResponse.text() };
      await pc.setRemoteDescription(answer);

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setStatus('connected');
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setStatus('error');
          setError(`Peer connection ${pc.connectionState}`);
        }
      };

      // Start waveform draw if enabled
      if (showWaveform) startWaveformDraw();

      setStatus('connected');
    } catch (e: any) {
      setStatus('error');
      setError(String(e?.message || e));
      await disconnect();
    }
  }

  async function disconnect() {
    try {
      dcRef.current?.close();
    } catch {}
    try {
      pcRef.current?.getSenders().forEach((s) => {
        try {
          s.track?.stop();
        } catch {}
      });
      pcRef.current?.close();
    } catch {}
    try {
      const ac: AudioContext | undefined = (window as any).__rnnoise_audio_context;
      if (ac) await ac.close();
      (window as any).__rnnoise_audio_context = undefined;
      (window as any).__rnnoise_nodes = undefined;
    } catch {}
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      analyserInRef.current = null;
      analyserOutRef.current = null;
      await audioCtxRef.current?.close();
    } catch {}
    audioCtxRef.current = null;
    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    pcRef.current = null;
    dcRef.current = null;
    localStreamRef.current = null;
    setStatus('idle');
    setRnnoiseState('idle');
    try {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.pause();
      }
    } catch {}
  }

  useEffect(() => {
    // List microphones for selection
    navigator.mediaDevices
      .enumerateDevices()
      .then((ds) => setMics(ds.filter((d) => d.kind === 'audioinput')))
      .catch(() => {});

    return () => {
      disconnect();
    };
  }, []);

  // Load saved preferences on mount
  useEffect(() => {
    try {
      const m = localStorage.getItem(LS_KEYS.model); if (m) setModel(m);
      const v = localStorage.getItem(LS_KEYS.voice); if (v) setVoice(v);
      const s = localStorage.getItem(LS_KEYS.source); if (s) setSourceLang(s);
      const t = localStorage.getItem(LS_KEYS.target); if (t) setTargetLang(t);
      const mic = localStorage.getItem(LS_KEYS.micId); if (mic) setMicId(mic);
      const nz = localStorage.getItem(LS_KEYS.noise) as NoiseProfile | null; if (nz === 'default' || nz === 'off' || nz === 'rnnoise') setNoiseProfile(nz);
      const pb = localStorage.getItem(LS_KEYS.playback) as AudioPlayback | null; if (pb === 'on' || pb === 'off') setAudioPlayback(pb);
    } catch {}
  }, []);

  // Persist preferences when changed
  useEffect(() => { try { localStorage.setItem(LS_KEYS.model, model); } catch {} }, [model]);
  useEffect(() => { try { localStorage.setItem(LS_KEYS.voice, voice); } catch {} }, [voice]);
  useEffect(() => { try { localStorage.setItem(LS_KEYS.source, sourceLang); } catch {} }, [sourceLang]);
  useEffect(() => { try { localStorage.setItem(LS_KEYS.target, targetLang); } catch {} }, [targetLang]);
  useEffect(() => { try { localStorage.setItem(LS_KEYS.micId, micId); } catch {} }, [micId]);
  useEffect(() => { try { localStorage.setItem(LS_KEYS.noise, noiseProfile); } catch {} }, [noiseProfile]);
  useEffect(() => { try { localStorage.setItem(LS_KEYS.playback, audioPlayback); } catch {} }, [audioPlayback]);

  // Reflect audio playback setting immediately
  useEffect(() => {
    const el = remoteAudioRef.current;
    if (!el) return;
    if (audioPlayback === 'on') {
      el.muted = false;
      el.play().catch(() => {});
    } else {
      el.muted = true;
      try { el.pause(); } catch {}
    }
  }, [audioPlayback]);

  function scheduleReconnect(reason: string) {
    if (status !== 'connected') return;
    setLogs((ls) => [...ls, `auto_reconnect: ${reason}`]);
    if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = window.setTimeout(async () => {
      reconnectTimerRef.current = null;
      try {
        await disconnect();
        await connectWebRTC();
      } catch (e) {
        setError(`auto reconnect failed: ${String((e as any)?.message || e)}`);
      }
    }, 300);
  }

  // Auto-reconnect when RNNoise option changes during an active session
  useEffect(() => {
    scheduleReconnect(`noiseProfile=${noiseProfile}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noiseProfile]);

  // Auto-reconnect for other key options
  useEffect(() => {
    scheduleReconnect(`model=${model}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);
  useEffect(() => {
    scheduleReconnect(`voice=${voice}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice]);
  useEffect(() => {
    scheduleReconnect(`micId=${micId || 'default'}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micId]);
  useEffect(() => {
    scheduleReconnect(`sourceLang=${sourceLang}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceLang]);
  useEffect(() => {
    scheduleReconnect(`targetLang=${targetLang}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLang]);

  function startWaveformDraw() {
    const draw = () => {
      const anIn = analyserInRef.current;
      const anOut = analyserOutRef.current;
      const inCv = inputCanvasRef.current;
      const outCv = outputCanvasRef.current;
      if (anIn && inCv) renderWave(anIn, inCv);
      if (anOut && outCv) renderWave(anOut, outCv);
      rafRef.current = requestAnimationFrame(draw);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }

  function renderWave(analyser: AnalyserNode, canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#0ea5e9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = data.length / w;
    for (let x = 0; x < w; x++) {
      const v = data[Math.floor(x * step)] / 128 - 1; // -1..1
      const y = h / 2 + v * (h * 0.4);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const busy = status === 'connecting';

  async function copyLogs() {
    const text = logs.join('\n');
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      setError(`Failed to copy logs: ${String((e as any)?.message || e)}`);
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-3 font-sans">
      <h1 className="text-2xl font-semibold">AI Realtime Translator</h1>

      <div className="mt-4 grid gap-3 grid-cols-2 lg:grid-cols-7">
        <label className="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2">
          <span className="text-slate-700">Model</span>
          <select
            className="rounded border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2">
          <span className="text-slate-700">Voice</span>
          <select
            className="rounded border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2">
          <span className="text-slate-700">Source</span>
          <select
            className="rounded border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2">
          <span className="text-slate-700">Target</span>
          <select
            className="rounded border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
          >
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2">
          <span className="text-slate-700">Mic</span>
          <select
            className="rounded border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
            value={micId}
            onChange={(e) => setMicId(e.target.value)}
          >
            <option value="">Default</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2">
          <span className="text-slate-700">ノイズ処理</span>
          <select
            className="rounded border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
            value={noiseProfile}
            onChange={(e) => setNoiseProfile(e.target.value as NoiseProfile)}
            title="getUserMedia constraints: noiseSuppression / echoCancellation / autoGainControl"
          >
            <option value="default">noiseSuppression, echoCancellation, autoGainControl</option>
            <option value="off">noiseSuppression=false, echoCancellation=false, autoGainControl=false</option>
            <option value="rnnoise">RNNoise (WASM, 48kHz/mono)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm border border-slate-200 rounded-md p-2">
          <span className="text-slate-700">音声再生</span>
          <select
            className="rounded border-slate-300 focus:border-indigo-500 focus:ring-indigo-500"
            value={audioPlayback}
            onChange={(e) => setAudioPlayback(e.target.value as AudioPlayback)}
            title="Remote audio playback (element mute/play)"
          >
            <option value="on">再生する</option>
            <option value="off">再生しない（ミュート）</option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          className="px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-50"
          onClick={connectWebRTC}
          disabled={busy || status === 'connected'}
        >
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        <button
          className="px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 disabled:opacity-50"
          onClick={disconnect}
          disabled={status !== 'connected' && status !== 'error'}
        >
          Disconnect
        </button>
        <button
          className="px-3 py-1.5 rounded bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
          onClick={() => {
            try {
              localStorage.removeItem(LS_KEYS.model);
              localStorage.removeItem(LS_KEYS.voice);
              localStorage.removeItem(LS_KEYS.source);
              localStorage.removeItem(LS_KEYS.target);
              localStorage.removeItem(LS_KEYS.micId);
              localStorage.removeItem(LS_KEYS.noise);
              localStorage.removeItem(LS_KEYS.playback);
            } catch {}
            // reset to defaults
            setModel(DEFAULT_MODEL);
            setVoice(DEFAULT_VOICE);
            setSourceLang('ja');
            setTargetLang('en');
            setMicId('');
            setNoiseProfile('default');
            setAudioPlayback('on');
            setLogs((ls) => [...ls, 'settings_reset']);
          }}
          title="保存済みの設定をデフォルトに戻します"
        >
          設定をリセット
        </button>
        <small className="text-slate-600">Server URL: {serverUrl || 'http://localhost:8787'}</small>
        <small className="text-slate-600">Status: {status}</small>
        {noiseProfile === 'rnnoise' && (
          <small className="text-slate-600 flex items-center gap-1">
            RNNoise:
            <span
              className={
                'inline-block w-2 h-2 rounded-full ' +
                (rnnoiseState === 'ready' || rnnoiseState === 'resampling'
                  ? 'bg-green-500'
                  : rnnoiseState === 'loading'
                  ? 'bg-slate-400'
                  : 'bg-amber-500')
              }
              title={`rnnoise: ${rnnoiseState}`}
            />
            <span>{rnnoiseState}</span>
          </small>
        )}
      </div>

      {error && (
        <div className="mt-3 text-red-700">Error: {error}</div>
      )}

      <div className="mt-4">
        <audio ref={remoteAudioRef} autoPlay playsInline />
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        {showWaveform && (
          <>
            <div>
              <h3 className="my-2 font-medium">マイク入力（処理前）</h3>
              <canvas ref={inputCanvasRef} width={560} height={100} className="w-full bg-slate-100 rounded border border-slate-200" />
            </div>
            <div>
              <div className="flex items-center gap-2 my-2">
                <h3 className="m-0 font-medium">ノイズ抑制後（処理後）</h3>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                  {noiseProfile === 'rnnoise' ? 'RNNoise' : noiseProfile === 'default' ? 'ブラウザDSP' : '未適用'}
                </span>
              </div>
              <canvas ref={outputCanvasRef} width={560} height={100} className="w-full bg-slate-100 rounded border border-slate-200" />
            </div>
          </>
        )}
        <div className="md:col-span-2">
          <div className="flex items-center justify-between my-2">
            <h3 className="m-0 font-medium">チャット（時系列）</h3>
            <div className="flex items-center gap-2">
              <div className="text-xs text-slate-600">{new Date().toLocaleTimeString()}</div>
              <button
                className="text-xs px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                onClick={() => { setChat([]); setInputTranscript(''); setOutputTranscript(''); }}
                title="チャットの履歴をクリアします"
              >
                クリア
              </button>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded p-3 max-h-80 overflow-auto space-y-2">
            {chat.length === 0 && (
              <div className="text-slate-500 text-sm">まだメッセージはありません</div>
            )}
            {chat.map((m) => (
              <div key={m.id} className={m.role === 'input' ? 'flex' : 'flex justify-end'}>
                <div className={(m.role === 'input' ? 'bg-slate-100 text-slate-800' : 'bg-indigo-600 text-white') + ' rounded px-3 py-2 max-w-[80%] whitespace-pre-wrap'}>
                  <div className="text-[10px] opacity-70 mb-1">
                    {m.role === 'input' ? `入力 (${sourceLang})` : `出力 (${targetLang})`}・{new Date(m.at).toLocaleTimeString()}
                  </div>
                  {m.text}
                </div>
              </div>
            ))}
            {(inputTranscript || outputTranscript) && (
              <div className="flex">
                <div className={'bg-slate-50 text-slate-700 rounded px-3 py-2 max-w-[80%] whitespace-pre-wrap italic'}>
                  {(inputTranscript || outputTranscript) + ' …'}
                </div>
              </div>
            )}
          </div>
        </div>
        {showWaveform && (
          <p className="col-span-1 md:col-span-2 text-xs text-slate-600">
            注: RNNoise 選択時のみ「処理後」波形はノイズ抑制後を表示します。その他の設定では可視化用途のため入力波形を複製表示しています。
          </p>
        )}
      </div>

      <div className="mt-4">
        <div className="flex items-center gap-3 my-2">
          <h3 className="m-0 font-medium">Logs</h3>
          <button
            className="px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300"
            onClick={() => setLogs([])}
            title="ログをクリアします"
          >
            クリア
          </button>
          <button
            className="px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 disabled:opacity-50"
            onClick={copyLogs}
            disabled={logs.length === 0}
            title="Copy logs to clipboard"
          >
            {copied ? 'Copied!' : 'Copy Logs'}
          </button>
        </div>
        <pre className="bg-slate-100 rounded p-3 max-h-40 overflow-auto">
          {logs.join('\n')}
        </pre>
      </div>
    </div>
  );
}
