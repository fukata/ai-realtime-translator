import { Router } from 'express';
import { z } from 'zod';

export const tokenRouter = Router();

const TokenRequest = z
  .object({
    model: z.string().optional(),
    voice: z.string().optional(),
  })
  .optional();

tokenRouter.post('/token', async (req, res) => {
  const parsed = TokenRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  const DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';
  const model = parsed.data?.model || DEFAULT_MODEL;
  const voice = parsed.data?.voice || 'verse';

  try {
    const resp = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, voice }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(502).json({ error: 'openai_error', status: resp.status, details: data });
    }

    const payload = {
      id: (data as any)?.id,
      model: (data as any)?.model,
      client_secret: {
        value: (data as any)?.client_secret?.value,
        expires_at: (data as any)?.client_secret?.expires_at,
      },
    };
    return res.status(200).json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: 'upstream_error', message: String(err?.message || err) });
  }
});
