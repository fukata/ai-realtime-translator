import { useEffect, useMemo, useRef, useState } from 'react';

type ClientToken = {
  id: string;
  model: string;
  client_secret: { value: string; expires_at: number };
};

const DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
const DEFAULT_VOICE = 'verse';

export function App() {
  const baseUrl = (import.meta as any).env?.VITE_SERVER_URL || '';

  const [model, setModel] = useState(DEFAULT_MODEL);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [sourceLang, setSourceLang] = useState('ja');
  const [targetLang, setTargetLang] = useState('en');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
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
    setTranscript('');
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

      // Data channel to send events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.addEventListener('message', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          // Minimal text accumulation for translation/debug
          if (msg?.type === 'response.output_text.delta' && typeof msg.delta === 'string') {
            setTranscript((t) => t + msg.delta);
          }
          if (msg?.type === 'response.output_text.done') {
            setLogs((ls) => [...ls, 'text_done']);
          }
          if (msg?.type === 'response.error') {
            setLogs((ls) => [...ls, `error: ${msg.error?.message || ''}`]);
          }
        } catch (_) {
          // ignore non-JSON events
        }
      });

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

      // When data channel opens, send initial instruction for translation
      dc.addEventListener('open', () => {
        const msg = {
          type: 'response.create',
          response: {
            instructions:
              `You are a real-time speech translator. Listen to the user's speech in ${sourceLang} and translate into ${targetLang}. Respond concisely in ${targetLang}.`,
            modalities: ['audio'],
            audio: { voice },
          },
        };
        dc.send(JSON.stringify(msg));
      });

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
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Voice</span>
          <input value={voice} onChange={(e) => setVoice(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Source</span>
          <input value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Target</span>
          <input value={targetLang} onChange={(e) => setTargetLang(e.target.value)} />
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

      <div style={{ marginTop: 16 }}>
        <h3 style={{ margin: '8px 0' }}>Transcript</h3>
        <div style={{ whiteSpace: 'pre-wrap', background: '#f6f8fa', padding: 12, minHeight: 80 }}>
          {transcript || '—'}
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
