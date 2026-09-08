import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { LocalAgentDriver } from '../../src/agent/local-driver.js';
import {
  requestApproval,
  resolveApproval,
  seedApprovalDecision,
  resetApprovals,
} from '../../src/agent/governance/pending-approvals.js';

const SESSION = 'approval-test';

async function run(message: string, history: ChatMessage[] = []): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of new LocalAgentDriver().run({ sessionId: SESSION, message, history })) {
    events.push(event);
  }
  return events;
}

function event<T extends AgentEvent['type']>(events: AgentEvent[], type: T) {
  return events.find((e) => e.type === type) as Extract<AgentEvent, { type: T }> | undefined;
}

function toolResult(events: AgentEvent[], name: string) {
  return events.find((e) => e.type === 'tool_result' && e.name === name) as
    | Extract<AgentEvent, { type: 'tool_result' }>
    | undefined;
}

const bookingHistory: ChatMessage[] = [
  {
    role: 'user',
    content: 'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.',
    ts: '2026-08-14T00:00:00Z',
  },
  { role: 'assistant', content: 'Here are flights and hotels for Lisbon.', ts: '2026-08-14T00:00:01Z' },
];

beforeEach(() => resetApprovals());

/** ADR-013 — runtime authority governance (REQUIRE_APPROVAL / human-in-the-loop). */
describe('pending-approvals store', () => {
  it('resolves the awaited promise with the human decision', async () => {
    const rec = requestApproval({ sessionId: 's1', tool: 'booking-simulator', itineraryId: 'itin-x' });
    const settled = rec.promise;
    expect(resolveApproval(rec.approvalId, 'approved')).toBe(true);
    await expect(settled).resolves.toBe('approved');
  });

  it('returns false for an unknown approval id', () => {
    expect(resolveApproval('appr-does-not-exist', 'approved')).toBe(false);
  });
});

describe('booking HITL — require_approval (ADR-013)', () => {
  it('pauses for approval and completes the simulated booking when approved', async () => {
    // Default test decision is "approved" — the booking proceeds.
    const events = await run('Book the first flight and the first hotel.', bookingHistory);

    const requestEvt = event(events, 'approval_request');
    expect(requestEvt?.tool).toBe('booking-simulator');
    expect(requestEvt?.itineraryId).toMatch(/^itin-/);

    const resolvedEvt = event(events, 'approval_resolved');
    expect(resolvedEvt?.decision).toBe('approved');

    // The approval precedes the booking (pause happens first).
    const reqIdx = events.findIndex((e) => e.type === 'approval_request');
    const bookIdx = events.findIndex((e) => e.type === 'tool_result' && e.name === 'booking-simulator');
    expect(reqIdx).toBeGreaterThanOrEqual(0);
    expect(bookIdx).toBeGreaterThan(reqIdx);
    expect(toolResult(events, 'booking-simulator')?.ok).toBe(true);
  });

  it('blocks the booking when the traveller denies approval', async () => {
    seedApprovalDecision(SESSION, 'denied');
    const events = await run('Book the first flight and the first hotel.', bookingHistory);

    expect(event(events, 'approval_request')).toBeDefined();
    expect(event(events, 'approval_resolved')?.decision).toBe('denied');
    // No simulated booking is produced.
    expect(toolResult(events, 'booking-simulator')).toBeUndefined();
    // The stream still completes cleanly with a safe message.
    expect(event(events, 'done')).toBeDefined();
    const text = events
      .filter((e) => e.type === 'token')
      .map((e) => (e as { value: string }).value)
      .join('');
    expect(text.toLowerCase()).toContain('won’t book');
  });
});
