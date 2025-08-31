import { useState } from 'react';

export function App() {
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const baseUrl = (import.meta as any).env?.VITE_SERVER_URL || '';

  const getToken = async () => {
    setLoading(true);
    setResult('');
    try {
      const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/api/token` : '/api/token';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      setResult(JSON.stringify(json, null, 2));
    } catch (err: any) {
      setResult(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>AI Realtime Translator</h1>
      <p>Monorepo scaffold. Token endpoint is not implemented yet.</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={getToken} disabled={loading}>
          {loading ? 'Requesting…' : 'Request Token'}
        </button>
        <small>Server URL: {baseUrl || 'http://localhost:8787'}</small>
      </div>
      {result && (
        <pre style={{ marginTop: 16, background: '#f6f8fa', padding: 12 }}>
          {result}
        </pre>
      )}
    </div>
  );
}
