import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateToolCall, resetGate } from '../../src/agent/governance/gate.js';

// ADR-013 runtime authority gate: the three-outcome model must hold deterministically
// against the real Agent Governance Toolkit PolicyEngine.
describe('runtime authority gate (AGT)', () => {
  beforeEach(() => resetGate());

  it('allows read-only travel search', () => {
    const r = evaluateToolCall('travel-search', 'tool');
    expect(r.decision).toBe('allow');
  });

  it('requires human approval for a consequential booking (RAI-HITL-001)', () => {
    const r = evaluateToolCall('booking-simulator', 'tool');
    expect(r.decision).toBe('require_approval');
    expect(r.approvers).toContain('waypoint-reviewer');
  });

  it('denies an out-of-scope refund before execution', () => {
    const r = evaluateToolCall('issueRefund', 'tool');
    expect(r.decision).toBe('deny');
  });

  it('allows unlisted approved tools via default action (does not break the app)', () => {
    for (const tool of ['destination-advisor', 'weather-window', 'trip-summariser', 'copilot.chat']) {
      expect(evaluateToolCall(tool).decision).toBe('allow');
    }
  });

  it('every decision carries a human-readable reason', () => {
    for (const tool of ['travel-search', 'booking-simulator', 'issueRefund']) {
      expect(evaluateToolCall(tool).reason.length).toBeGreaterThan(0);
    }
  });
});
