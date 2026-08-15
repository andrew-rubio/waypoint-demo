import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { LocalAgentDriver } from '../../src/agent/local-driver.js';

/**
 * FRD-006 personalisation via Cosmos DB — red baseline for INC-6.
 *
 * These exercise the deterministic LocalAgentDriver (tests/offline). They assert
 * that the driver queries the Cosmos profile store (`cosmos.getTravellerProfile`
 * MCP
 * lifecycle), folds the synthetic "John Doe" profile into a personalisation note,
 * and echoes the applied seat/meal + simulated reward-points accrual at booking.
 * They FAIL until the driver wires the Cosmos profile tool (it currently answers destination,
 * travel and booking turns with no personalisation).
 *
 * Graceful degradation (Cosmos unavailable) is exercised end-to-end via the
 * runtime `?fault=cosmos-error` path in the e2e/BDD suites, not here.
 */
async function run(message: string, history: ChatMessage[] = []): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of new LocalAgentDriver().run({ sessionId: 'cosmos-test', message, history })) {
    events.push(event);
  }
  return events;
}

function toolResult(events: AgentEvent[], name: string): Record<string, unknown> {
  const result = events.find((event) => event.type === 'tool_result' && event.name === name);
  expect(result, `expected a tool_result named "${name}"`).toBeDefined();
  return (result as Extract<AgentEvent, { type: 'tool_result' }>).result as Record<string, unknown>;
}

function toolCallNames(events: AgentEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'tool_call' }> => event.type === 'tool_call')
    .map((event) => event.name);
}

function reply(events: AgentEvent[]): string {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'token' }> => event.type === 'token')
    .map((event) => event.value)
    .join('');
}

const PERSONALISE = 'Where should I go for a warm coastal break?';
const SEARCH_LISBON =
  'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.';

const bookingHistory: ChatMessage[] = [
  { role: 'user', content: SEARCH_LISBON, ts: '2026-08-15T00:00:00Z' },
  { role: 'assistant', content: 'Here are flights and hotels for Lisbon.', ts: '2026-08-15T00:00:01Z' },
];

describe('personalisation via Cosmos DB', () => {
  it('queries the Cosmos profile store for the traveller profile on a suggestion turn (FR-006-1)', async () => {
    const events = await run(PERSONALISE);
    expect(toolCallNames(events)).toContain('cosmos.getTravellerProfile');
    const profile = toolResult(events, 'cosmos.getTravellerProfile');
    expect(profile).toBeDefined();
  });

  it('folds the profile into a personalisation note and explains why (AC-006-1/FR-006-3)', async () => {
    const note = toolResult(await run(PERSONALISE), 'personalise');
    expect(note.available).toBe(true);
    expect(String(note.rationale)).toMatch(/Gold/i);
    expect(String(note.rationale)).toMatch(/aisle|vegetarian|Portugal|reward points/i);
    expect(String(note.rationale)).toMatch(/because|since/i);
  });

  it('reflects the reward points balance from the Cosmos profile (FR-006-2)', async () => {
    const profile = toolResult(await run(PERSONALISE), 'cosmos.getTravellerProfile');
    expect(profile.rewardPoints).toBe(7463);
    expect(String(profile.membershipNumber)).toBe('39302492');
  });

  it('queries the profile to rank airlines at flight search without showing a note (AC-006-2 revised)', async () => {
    const names = toolCallNames(await run(SEARCH_LISBON));
    expect(names).toContain('cosmos.getTravellerProfile');
    expect(names).not.toContain('personalise');
  });

  it('ranks preferred airlines first and flags them at flight search (FR-006-2)', async () => {
    const result = toolResult(await run(SEARCH_LISBON), 'travel-search');
    const flights = result.flights as Array<{ airline: string; preferred?: boolean }>;
    // John Doe prefers Vueling + British Airways; BA floats above TAP/easyJet and is flagged.
    expect(flights[0].airline).toMatch(/British Airways/i);
    expect(flights[0].preferred).toBe(true);
    expect(flights.some((f) => /TAP/i.test(f.airline) && f.preferred)).toBe(false);
  });

  it('echoes the assigned seat and vegetarian meal in the simulated booking (AC-006-5)', async () => {
    const events = await run('Book the first flight and the first hotel.', bookingHistory);
    const booking = toolResult(events, 'booking-simulator');
    expect(String(booking.seatAssignment)).toMatch(/^\d{1,2}[A-F]$/);
    expect(String(booking.mealRequested)).toMatch(/vegetarian/i);
    // Seat/meal now surface on the summary + confirmation cards (not the prose);
    // the booking turn auto-emits the trip summary with the applied preferences.
    const summary = toolResult(events, 'trip-summariser');
    expect((summary.appliedPreferences as { meal: string }).meal).toMatch(/vegetarian/i);
    // The prose is now a brief intro only — the detail lives on the cards.
    expect(reply(events)).toMatch(/book those|go ahead|booking/i);
  });

  it('shows simulated reward points earned against the saved membership at booking (AC-006-5/FR-006-6)', async () => {
    const events = await run('Book the first flight and the first hotel.', bookingHistory);
    const booking = toolResult(events, 'booking-simulator');
    expect(typeof booking.pointsEarned).toBe('number');
    expect(booking.pointsEarned as number).toBeGreaterThan(0);
    expect(String(booking.membershipNumber)).toBe('39302492');
    expect(typeof booking.newBalance).toBe('number');
    expect(booking.newBalance as number).toBe(7463 + (booking.pointsEarned as number));
  });

  it('applies a live seat preference over the saved one and notes the difference (edge)', async () => {
    const note = toolResult(await run('Actually, I would like a window seat this time'), 'personalise');
    expect(String(note.appliedSeat)).toMatch(/window/i);
    expect(String(note.rationale)).toMatch(/instead of|rather than|differs|usually|normally|saved/i);
  });

  it('does not personalise weather turns (regression)', async () => {
    const events = await run("What's the weather like in Lisbon in June?");
    expect(toolCallNames(events)).not.toContain('cosmos.getTravellerProfile');
  });
});
