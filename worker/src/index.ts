export interface Env {
  OPENAI_API_KEY: string;
  ALLOWED_ORIGINS?: string;
  ALLOWED_EMAILS?: string;
  DEV_BYPASS_ACCESS?: string;
}

type Handler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> | Response;

const textJson = (obj: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(obj), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });

const parseCsv = (s?: string) =>
  (s || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const withCors = (req: Request, env: Env, res: Response): Response => {
  const origins = parseCsv(env.ALLOWED_ORIGINS);
  const origin = req.headers.get('Origin') || '';
  const allow = origins.length === 0 || origins.includes(origin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allow ? origin : origins[0] || '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, POST, GET',
  };
  const out = new Response(res.body, res);
  Object.entries(headers).forEach(([k, v]) => out.headers.set(k, v));
  return out;
};

const handleOptions: Handler = (req, env) => {
  if (req.method === 'OPTIONS') {
    return withCors(
      req,
      env,
      new Response(null, { status: 204 }),
    );
  }
  return new Response(null, { status: 405 });
};

const requireAccess: Handler = async (req, env) => {
  // Cloudflare Access が付与する認証済みメールヘッダ
  const email = req.headers.get('Cf-Access-Authenticated-User-Email');
  const allowed = new Set(parseCsv(env.ALLOWED_EMAILS));
  const devBypass = (env.DEV_BYPASS_ACCESS || '').toLowerCase() === 'true';

  if (devBypass) return new Response(null, { status: 204 });

  if (!email || (allowed.size > 0 && !allowed.has(email))) {
    return textJson({ error: 'forbidden' }, { status: 403 });
  }
  return new Response(null, { status: 204 });
};

const handleHealth: Handler = () => textJson({ status: 'ok', worker: true });

const handleToken: Handler = async (req, env) => {
  if (!env.OPENAI_API_KEY) {
    return textJson({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const DEFAULT_MODEL = 'gpt-realtime';
  let body: any = {};
  try {
    if (req.headers.get('content-type')?.includes('application/json')) {
      body = await req.json();
    }
  } catch {
    body = {};
  }
  const model = typeof body?.model === 'string' && body.model.length > 0 ? body.model : DEFAULT_MODEL;
  const voice = typeof body?.voice === 'string' && body.voice.length > 0 ? body.voice : 'verse';

  const resp = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, voice }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    return textJson({ error: 'openai_error', status: resp.status, details: data }, { status: 502 });
  }

  // 必要最小限だけ返す（APIキーは返さない）
  const payload = {
    id: data?.id,
    model: data?.model,
    client_secret: {
      value: data?.client_secret?.value,
      expires_at: data?.client_secret?.expires_at,
    },
  };
  return textJson(payload, { status: 200 });
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return withCors(request, env, await handleOptions(request, env, ctx));
    }

    // ヘルスチェック
    if (url.pathname === '/health') {
      return withCors(request, env, await handleHealth(request, env, ctx));
    }

    // Access チェック（/api/* のみ）
    if (url.pathname.startsWith('/api/')) {
      const res = await requireAccess(request, env, ctx);
      if (res.status !== 204) {
        return withCors(request, env, res);
      }
    }

    // トークン発行
    if (url.pathname === '/api/token' && request.method === 'POST') {
      const out = await handleToken(request, env, ctx);
      return withCors(request, env, out);
    }

    return withCors(request, env, new Response('Not Found', { status: 404 }));
  },
} satisfies ExportedHandler<Env>;
