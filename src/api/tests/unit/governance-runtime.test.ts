import { describe, it, expect } from 'vitest';
import { runAgent } from '../../src/agent/runtime.js';
import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import { isApprovedFor, type BookingApproval } from '../../../shared/types/booking-approval.js';

async function collect(fault: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of runAgent({ sessionId: 's1', message: 'Book the trip', history: [], fault })) {
    events.push(e);
  }
  return events;
}

function toolResult(events: AgentEvent[], name: string) {
  return events.find((e) => e.type === 'tool_result' && e.name === name) as
    | Extract<AgentEvent, { type: 'tool_result' }>
    | undefined;
}

/** FR-010-11 / RAI-HITL-001 / RAI-OUT-001 — itinerary-bound human approval. */
describe('booking-approval (governance behavioural test)', () => {
  it('blocks a booking with no itinerary-bound approval and emits approval_required', async () => {
    const events = await collect('booking-no-approval');
    const check = toolResult(events, 'booking-approval-check');
    expect(check?.ok).toBe(false);
    expect((check?.result as { status: string }).status).toBe('approval_required');
    // No completed simulated booking is present.
    expect(toolResult(events, 'booking-simulator')).toBeUndefined();
    // The reply never claims the booking is complete.
    const text = events.filter((e) => e.type === 'token').map((e) => (e as { value: string }).value).join('');
    expect(text.toLowerCase()).not.toContain('confirmed');
  });

  it('proceeds when an explicit approval is bound to the exact itinerary, surfacing the approval id', async () => {
    const events = await collect('booking-approved');
    const booking = toolResult(events, 'booking-simulator');
    expect(booking?.ok).toBe(true);
    expect((booking?.result as { approvalId: string; simulated: boolean }).approvalId).toBe('appr-demo-1');
    expect((booking?.result as { simulated: boolean }).simulated).toBe(true);
  });

  it('isApprovedFor rejects an approval for a different itinerary ("Book" text is not enough)', () => {
    const approval: BookingApproval = { approvalId: 'a1', itineraryId: 'itin-A', approvedBy: 'u', approvedAt: 'now', scope: 'simulated-booking' };
    expect(isApprovedFor('itin-A', approval)).toBe(true);
    expect(isApprovedFor('itin-B', approval)).toBe(false);
    expect(isApprovedFor('itin-A', undefined)).toBe(false);
  });
});

/** FR-010-12 / DATA-FRESH-001 — stale currency runtime containment. */
describe('currency-freshness (governance behavioural test)', () => {
  it('detects stale currency data deterministically and contains the booking', async () => {
    const events = await collect('stale-currency');
    const freshness = toolResult(events, 'currency-freshness');
    expect(freshness?.ok).toBe(false);
    const result = freshness?.result as { status: string; ageHours: number; thresholdHours: number };
    expect(result.status).toBe('stale');
    expect(result.ageHours).toBeGreaterThan(result.thresholdHours);
    // The service stays available (stream completes) and no booking is confirmed.
    expect(events.some((e) => e.type === 'done')).toBe(true);
    expect(toolResult(events, 'booking-simulator')).toBeUndefined();
  });

  it('keeps the service responsive and preserves the itinerary (safe message, no crash)', async () => {
    const events = await collect('stale-currency');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    const text = events.filter((e) => e.type === 'token').map((e) => (e as { value: string }).value).join('');
    expect(text.toLowerCase()).toContain('stale');
  });
});
