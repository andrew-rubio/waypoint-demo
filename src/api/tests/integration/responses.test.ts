import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/** INC-9 / ADR-010 — the Foundry `responses` protocol surface. */
describe('POST /responses (INC-9, Foundry hosted-agent contract)', () => {
  const app = createApp();

  it('exposes a readiness probe', async () => {
    const res = await request(app).get('/readiness');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('returns a single Response object when stream is false', async () => {
    const res = await request(app)
      .post('/responses')
      .send({ input: 'Hi, I want to plan a holiday', stream: false });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.object).toBe('response');
    expect(res.body.status).toBe('completed');
    expect(typeof res.body.output_text).toBe('string');
  });

  it('streams the OpenAI Responses SSE lifecycle when stream is true', async () => {
    const res = await request(app)
      .post('/responses')
      .send({ input: 'Where should I go?', stream: true });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: response.created');
    expect(res.text).toContain('event: response.completed');
  });

  it('rejects an empty input with 400', async () => {
    const res = await request(app).post('/responses').send({ input: '   ' });
    expect(res.status).toBe(400);
  });
});
