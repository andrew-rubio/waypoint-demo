import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import type { TravelOptionsResult } from '../../../shared/types/flight-hotel-search-booking.js';
import { LocalAgentDriver } from '../../src/agent/local-driver.js';
import { estimateBudget, summariseTrip } from '../../src/tools/trip-summary.js';

/**
 * FRD-007 trip summary, budget & currency — red baseline for INC-7.
 *
 * These exercise the deterministic LocalAgentDriver (tests/offline) plus the
 * pure budget/summary tool. They assert that a summary turn assembles an
 * itinerary from the remembered flight/hotel options, totals the budget
 * ((flight × party) + (nightly × nights × rooms)), labels taxes/fees, reflects
 * the Cosmos preferences + reward points, and converts GBP→EUR on request with
 * the rate + timestamp. They FAIL until the `trip-summary` tool exists and the
 * driver wires a summary turn.
 *
 * Currency-failure and partial-selection degrade paths are exercised
 * end-to-end via the runtime `?fault=` hooks in the e2e/BDD suites; the pure
 * partial-budget maths is covered here.
 */
async function run(message: string, history: ChatMessage[] = []): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of new LocalAgentDriver().run({ sessionId: 'summary-test', message, history })) {
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

const SEARCH_LISBON =
  'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.';
const SUMMARISE = 'Can you summarise the trip and total cost?';
const IN_EUROS = 'show that in euros';

const summaryHistory: ChatMessage[] = [
  { role: 'user', content: SEARCH_LISBON, ts: '2026-08-15T00:00:00Z' },
  { role: 'assistant', content: 'Here are flights and hotels for Lisbon.', ts: '2026-08-15T00:00:01Z' },
];

/** A minimal deterministic options fixture (GBP, taxes not stated) for the pure budget maths. */
function optionsFixture(): TravelOptionsResult {
  const gbp = (amount: number) => ({
    source: { amount, currency: 'GBP', includesTaxesAndFees: false },
    amountGBP: amount,
    rate: 1,
    rateTimestamp: '2026-08-14T00:00:00Z',
  });
  return {
    kind: 'options',
    place: 'Lisbon, Portugal',
    origin: 'London',
    checkIn: '2026-10-14',
    checkOut: '2026-10-21',
    nights: 7,
    party: 2,
    flights: [{ airline: 'British Airways', from: 'LON', to: 'LIS', durationMin: 160, stops: 0, pricePerTraveller: gbp(128) }],
    hotels: [{ name: 'Memmo Alfama', rating: 4, nightlyRate: gbp(175) }],
  };
}

describe('trip summary & budget (pure)', () => {
  it('totals the budget as (flight × party) + (nightly × nights × rooms) (FR-007-2)', () => {
    const budget = estimateBudget(optionsFixture());
    expect(budget.flight?.subtotalGBP).toBe(128 * 2);
    expect(budget.hotel?.subtotalGBP).toBe(175 * 7 * 1);
    expect(budget.totalGBP).toBe(128 * 2 + 175 * 7 * 1);
  });

  it('labels the estimate as excluding taxes/fees when the supplier does not state them (FR-007-2)', () => {
    expect(estimateBudget(optionsFixture()).taxesAndFeesIncluded).toBe(false);
  });

  it('summarises what is selected when a hotel is missing (AC-007-4)', () => {
    const budget = estimateBudget(optionsFixture(), { includeHotel: false });
    expect(budget.flight?.subtotalGBP).toBe(256);
    expect(budget.hotel).toBeUndefined();
    expect(budget.totalGBP).toBe(256);
  });

  it('assembles a summary with the itinerary, party, nights and room count (FR-007-1)', () => {
    const summary = summariseTrip(optionsFixture());
    expect(summary.destination).toMatch(/Lisbon/);
    expect(summary.partySize).toBe(2);
    expect(summary.nights).toBe(7);
    expect(summary.roomCount).toBe(1);
    expect(summary.totalGBP).toBe(1481);
  });
});

describe('trip summary turn (driver)', () => {
  it('emits the trip-summariser and budget-estimator skills (FR-007-1/6)', async () => {
    const names = toolCallNames(await run(SUMMARISE, summaryHistory));
    expect(names).toContain('trip-summariser');
    expect(names).toContain('budget-estimator');
  });

  it('totals GBP as the flight and hotel line items combined (AC-007-1)', async () => {
    const budget = toolResult(await run(SUMMARISE, summaryHistory), 'budget-estimator');
    const flight = budget.flight as { subtotalGBP: number };
    const hotel = budget.hotel as { subtotalGBP: number };
    expect(budget.totalGBP).toBe(flight.subtotalGBP + hotel.subtotalGBP);
    expect(budget.taxesAndFeesIncluded).toBe(false);
  });

  it('reflects the applied preferences and reward points from the Cosmos profile (AC-007-3)', async () => {
    const events = await run(SUMMARISE, summaryHistory);
    expect(toolCallNames(events)).toContain('cosmos.getTravellerProfile');
    const summary = toolResult(events, 'trip-summariser');
    const prefs = summary.appliedPreferences as { seat: string; meal: string };
    expect(prefs.seat).toMatch(/Aisle/i);
    expect(prefs.meal).toMatch(/Vegetarian/i);
    expect(summary.pointsBalance).toBe(7463);
  });

  it('converts GBP→EUR on request with the rate and timestamp (AC-007-2)', async () => {
    const events = await run(IN_EUROS, summaryHistory);
    expect(toolCallNames(events)).toContain('currency.convert');
    const summary = toolResult(events, 'trip-summariser');
    expect(typeof summary.totalEUR).toBe('number');
    expect(summary.totalEUR as number).toBeGreaterThan(0);
    const rate = summary.exchangeRate as { rate: number; timestamp: string };
    expect(rate.rate).toBeGreaterThan(0);
    expect(String(rate.timestamp)).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('explains there is nothing to summarise before any planning (edge)', async () => {
    const events = await run('Can you summarise my trip?');
    expect(toolCallNames(events)).not.toContain('trip-summariser');
    expect(reply(events)).toMatch(/nothing to summarise|choose a destination|search for flights/i);
  });

  it('does not summarise a plain destination turn (regression)', async () => {
    const names = toolCallNames(await run('Where should I go for a warm coastal break?'));
    expect(names).not.toContain('trip-summariser');
    expect(names).not.toContain('budget-estimator');
  });
});

describe('booking auto-summary (bug-spot)', () => {
  it('auto-summarises the exact booked flight and hotel, not the first option (bug-spot)', async () => {
    const events = await run('Book the first flight and the second hotel.', summaryHistory);
    const booking = toolResult(events, 'booking-simulator');
    const summary = toolResult(events, 'trip-summariser');
    const hotel = summary.hotel as { name: string };
    // The summary must reflect what was booked — same hotel and same total.
    expect(String(booking.itinerary)).toContain(hotel.name);
    expect(summary.totalGBP).toBe(booking.estimatedTotalGBP);
    expect(summary.hotelMissing).toBeFalsy();
  });

  it('emits the summary and the confirmation together with only a brief intro (no verbose echo)', async () => {
    const events = await run('Book the first flight and the first hotel.', summaryHistory);
    expect(toolCallNames(events)).toContain('trip-summariser');
    expect(toolCallNames(events)).toContain('booking-simulator');
    const text = reply(events);
    expect(text).toMatch(/book those|go ahead/i);
    expect(text).not.toMatch(/Ref\b|Itinerary:|Estimated total £/i);
  });
});

describe('loading progress feedback (status events)', () => {
  function statusMessages(events: AgentEvent[]): string[] {
    return events
      .filter((event): event is Extract<AgentEvent, { type: 'status' }> => event.type === 'status')
      .map((event) => event.message);
  }

  it('shows a search progress line while looking for flights and hotels', async () => {
    const statuses = statusMessages(await run(SEARCH_LISBON));
    expect(statuses.some((s) => /searching for flights and hotels to lisbon/i.test(s))).toBe(true);
    expect(statuses).toContain('');
  });

  it('shows a booking progress line, then clears it before the confirmation', async () => {
    const statuses = statusMessages(await run('Book the first flight and the first hotel.', summaryHistory));
    expect(statuses.some((s) => /booking your flight and hotel/i.test(s))).toBe(true);
    expect(statuses).toContain('');
  });
});

