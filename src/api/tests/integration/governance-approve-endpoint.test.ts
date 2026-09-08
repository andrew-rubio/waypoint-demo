import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { requestApproval } from '../../src/agent/governance/pending-approvals.js';

/** ADR-013 — POST /api/chat/approve resolves a pending human approval. */
describe('POST /api/chat/approve (ADR-013 HITL)', () => {
  const app = createApp();

  it('rejects a malformed decision with 400', async () => {
    const res = await request(app).post('/api/chat/approve').send({ sessionId: 's1', approvalId: 'a1', decision: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the approval id is unknown', async () => {
    const res = await request(app).post('/api/chat/approve').send({ sessionId: 's1', approvalId: 'appr-nope', decision: 'approve' });
    expect(res.status).toBe(404);
  });

  it('resolves a pending approval and settles its promise', async () => {
    const rec = requestApproval({ sessionId: 'endpoint-1', tool: 'booking-simulator', itineraryId: 'itin-LIS' });
    const res = await request(app).post('/api/chat/approve').send({ sessionId: 'endpoint-1', approvalId: rec.approvalId, decision: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, approvalId: rec.approvalId, decision: 'approved' });
    await expect(rec.promise).resolves.toBe('approved');
  });
});
