import request from 'supertest';
import { app } from '../../src/app';

describe('/api/token', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('returns 500 when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await request(app).post('/api/token').send({});
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('OPENAI_API_KEY not configured');
  });

  it('proxies to OpenAI and returns a minimal payload', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';

    const mockAnswer = {
      id: 'sess_123',
      model: 'gpt-4o-realtime-preview-2024-12-17',
      client_secret: { value: 'client-token', expires_at: 1234567890 },
    };

    const fetchSpy = jest.spyOn(global, 'fetch' as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockAnswer,
    } as any);

    const res = await request(app).post('/api/token').send({ model: 'test', voice: 'verse' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: mockAnswer.id,
      model: mockAnswer.model,
      client_secret: {
        value: mockAnswer.client_secret.value,
        expires_at: mockAnswer.client_secret.expires_at,
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/realtime/sessions');
    expect((init as any).method).toBe('POST');
    fetchSpy.mockRestore();
  });
});

