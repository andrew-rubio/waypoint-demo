import { describe, it, expect } from 'vitest';
import { runAgent } from '../../src/agent/runtime.js';
import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';

async function collect(message: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ sessionId: 's1', message, history: [] })) {
    events.push(e);
  }
  return events;
}

function toolResult(events: AgentEvent[], name: string) {
  return events.find((e) => e.type === 'tool_result' && e.name === name) as
    | Extract<AgentEvent, { type: 'tool_result' }>
    | undefined;
}

/**
 * ADR-013 — runtime authority governance (DENY outcome).
 * "Approved connectivity ≠ unrestricted authority": a refund is outside
 * Waypoint's approved authority, so the AGT policy engine blocks issueRefund
 * before it can execute (fail-closed).
 */
describe('runtime authority — DENY (ADR-013)', () => {
  it('blocks an out-of-scope refund and never executes issueRefund', async () => {
    const events = await collect('Please issue me a refund for my booking');

    // The attempt is surfaced, then blocked.
    const blocked = events.find(
      (e) => e.type === 'decision' && /Blocked issueRefund/i.test((e as { summary: string }).summary),
    );
    expect(blocked).toBeDefined();

    // The tool result records a failed (denied) call — the action did not run.
    const refund = toolResult(events, 'issueRefund');
    expect(refund?.ok).toBe(false);
    expect(String(refund?.result)).toMatch(/scope|authority|deny|denied/i);
  });

  it('keeps the service responsive and explains the block to the traveller', async () => {
    const events = await collect('I want a chargeback on that trip');

    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.some((e) => e.type === 'done')).toBe(true);

    const text = events
      .filter((e) => e.type === 'token')
      .map((e) => (e as { value: string }).value)
      .join('');
    expect(text.toLowerCase()).toContain('approved authority');
  });
});
