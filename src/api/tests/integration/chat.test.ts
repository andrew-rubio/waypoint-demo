import { describe, it, expect } from 'vitest';
import request from 'supertest';
// createApp does not exist yet — red baseline contract for INC-1.
import { createApp } from '../../src/app.js';

describe('POST /api/chat (FRD-001)', () => {
  const app = createApp();

  // AC-001-1 — streamed reply
  it('streams a reply as an event stream', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ sessionId: 'it-1', message: 'Hi, I want to plan a holiday' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"type":"done"');
  });

  // AC-001-4 — an observable decision precedes the first content token, no hidden reasoning
  it('emits a decision before the first token and no hidden reasoning', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ sessionId: 'it-2', message: 'Where should I go?' });

    const decisionAt = res.text.indexOf('"type":"decision"');
    const tokenAt = res.text.indexOf('"type":"token"');
    expect(decisionAt).toBeGreaterThanOrEqual(0);
    expect(tokenAt === -1 || decisionAt < tokenAt).toBe(true);
    expect(res.text.toLowerCase()).not.toContain('chain_of_thought');
  });

  // AC-001-2 — empty message rejected
  it('rejects an empty message with 400', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ sessionId: 'it-3', message: '   ' });
    expect(res.status).toBe(400);
  });

  it('rejects a request without a sessionId with 400', async () => {
    const res = await request(app).post('/api/chat').send({ message: 'Hello' });
    expect(res.status).toBe(400);
  });

  // FR-001-8 — unknown tools / oversized payloads rejected at the boundary
  it('rejects an oversized payload', async () => {
    const res = await request(app)
      .post('/api/chat')
      .send({ sessionId: 'it-4', message: 'x'.repeat(200_000) });
    expect([400, 413]).toContain(res.status);
  });
});
