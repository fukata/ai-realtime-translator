import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { tokenRouter } from './routes/token';

export function createApp() {
  const app = express();
  app.use(express.json());

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }
        return cb(new Error('CORS not allowed'), false);
      },
      credentials: true,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api', tokenRouter);
  return app;
}

export const app = createApp();

