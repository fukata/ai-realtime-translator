import { useEffect, useMemo, useRef, useState } from 'react';

type ClientToken = {
  id: string;
  model: string;
  client_secret: { value: string; expires_at: number };
};

const DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
const DEFAULT_VOICE = 'verse';
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
  const [logs, setLogs] = useState<string[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>('');

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const serverUrl = useMemo(() => (baseUrl ? baseUrl.replace(/\/$/, '') : ''), [baseUrl]);

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
          // Autoplay: ensure play is attempted
          remoteAudioRef.current.play().catch(() => {});
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

            // Primary: transcript from audio
            if (msg?.type === 'response.audio_transcript.delta' && typeof msg.delta === 'string') {
              setOutputTranscript((t) => t + msg.delta);
            }
            if (msg?.type === 'response.audio_transcript.done') {
              setLogs((ls) => [...ls, 'audio_transcript_done']);
            }

            // Fallback: legacy text delta
            if (msg?.type === 'response.output_text.delta' && typeof msg.delta === 'string') {
              setOutputTranscript((t) => t + msg.delta);
            }
            if (msg?.type === 'response.output_text.done') {
              setLogs((ls) => [...ls, 'text_done']);
            }

            // Input side transcription (best effort)
            if (msg?.type === 'input_audio_buffer.speech_started') {
              setInputTranscript('');
            }
            if (msg?.type === 'input_audio_transcription.delta') {
              const seg = (msg.delta ?? msg.text ?? msg.transcript) as string | undefined;
              if (typeof seg === 'string') setInputTranscript((t) => t + seg);
            }
            if (
              msg?.type === 'input_audio_transcription.done' ||
              msg?.type === 'input_audio_transcription.completed'
            ) {
              setLogs((ls) => [...ls, 'input_transcript_done']);
            }

            if (msg?.type === 'response.created') {
              setOutputTranscript('');
            }
            if (msg?.type === 'response.completed') {
              // keep transcript as-is
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

          const msg = {
            type: 'response.create',
            response: {
              modalities: ['audio', 'text'],
              audio: { voice },
            },
          } as const;
          dc.send(JSON.stringify(msg));
        });
      };

      // Create our control channel and also bind if remote creates one
      bindChannel(pc.createDataChannel('oai-events'));
      pc.ondatachannel = (e) => {
        if (e.channel?.label === 'oai-events') bindChannel(e.channel);
      };

      // Capture microphone
      const constraints: MediaStreamConstraints = micId
        ? { audio: { deviceId: { exact: micId } } as any }
        : { audio: true };
      const local = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = local;
      local.getTracks().forEach((t) => pc.addTrack(t, local));

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
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    pcRef.current = null;
    dcRef.current = null;
    localStreamRef.current = null;
    setStatus('idle');
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

  const busy = status === 'connecting';

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 720 }}>
      <h1>AI Realtime Translator</h1>
      <p style={{ color: '#555' }}>
        Cloudflare Access で保護された <code>/api/token</code> から短命トークンを取得し、WebRTC で OpenAI Realtime に接続します。
      </p>

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Voice</span>
          <select value={voice} onChange={(e) => setVoice(e.target.value)}>
            {VOICE_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Source</span>
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Target</span>
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
            {LANGUAGE_OPTIONS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <label>
          Mic:
          <select value={micId} onChange={(e) => setMicId(e.target.value)} style={{ marginLeft: 8 }}>
            <option value="">Default</option>
            {mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId}
              </option>
            ))}
          </select>
        </label>
        <button onClick={connectWebRTC} disabled={busy || status === 'connected'}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
        <button onClick={disconnect} disabled={status !== 'connected' && status !== 'error'}>
          Disconnect
        </button>
        <small>Server URL: {serverUrl || 'http://localhost:8787'}</small>
        <small>Status: {status}</small>
      </div>

      {error && (
        <div style={{ marginTop: 12, color: '#b00020' }}>Error: {error}</div>
      )}

      <div style={{ marginTop: 16 }}>
        <audio ref={remoteAudioRef} autoPlay playsInline />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
        <div>
          <h3 style={{ margin: '8px 0' }}>Input Transcript ({sourceLang})</h3>
          <div style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 12, minHeight: 80 }}>
            {inputTranscript || '—'}
          </div>
        </div>
        <div>
          <h3 style={{ margin: '8px 0' }}>Output Transcript ({targetLang})</h3>
          <div style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 12, minHeight: 80 }}>
            {outputTranscript || '—'}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3 style={{ margin: '8px 0' }}>Logs</h3>
        <pre style={{ background: '#f6f8fa', padding: 12, maxHeight: 160, overflow: 'auto' }}>
          {logs.join('\n')}
        </pre>
      </div>
    </div>
  );
}
