import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';

/**
 * D1 runtime-proof guardrail (FRD-010 / ADR-012): with no Foundry config (test mode),
 * the runtime badge MUST report the local deterministic driver and MUST NOT claim
 * Foundry-hosted execution. A local fallback can never masquerade as the hosted agent.
 */
describe('GET /runtime-info (D1 runtime proof)', () => {
  it('reports the local deterministic driver in fallback mode', async () => {
    const res = await request(createApp()).get('/runtime-info');
    expect(res.status).toBe(200);
    expect(res.body.runtimeMode).toBe('local-deterministic');
    expect(res.body.driverLabel).toBe('Local deterministic driver');
  });

  it('never labels the local fallback as the Foundry hosted agent', async () => {
    const res = await request(createApp()).get('/runtime-info');
    expect(res.body.driverLabel).not.toBe('Foundry hosted agent');
  });

  it('exposes only non-sensitive metadata (no secrets/tokens/connection strings)', async () => {
    const res = await request(createApp()).get('/runtime-info');
    const blob = JSON.stringify(res.body).toLowerCase();
    for (const forbidden of ['token', 'secret', 'apikey', 'connectionstring', 'password', 'bearer']) {
      expect(blob).not.toContain(forbidden);
    }
    expect(res.body).toHaveProperty('agentVersion');
    expect(res.body).toHaveProperty('artefactVersion');
  });
});
