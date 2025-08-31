import { Router } from 'express';
import { z } from 'zod';

export const tokenRouter = Router();

// Request/response schemas for clarity
const TokenRequest = z
  .object({
    // placeholder for future options like model, voice, etc
    model: z.string().optional(),
  })
  .optional();

tokenRouter.post('/token', async (req, res) => {
  const parsed = TokenRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY not configured',
    });
  }

  // NOTE: This is a scaffold. Replace with a call to OpenAI to
  // create a short-lived client token for Realtime. Do NOT return
  // your API key to the client.
  return res.status(501).json({
    error: 'Not implemented',
    message:
      'Implement call to OpenAI Realtime session/token endpoint here. Return a short-lived client token only.',
  });
});

