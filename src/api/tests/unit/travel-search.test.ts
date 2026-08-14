import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { LocalAgentDriver } from '../../src/agent/local-driver.js';

/**
 * FRD-005 flight & hotel search + simulated booking — red baseline for INC-5.
 *
 * These exercise the deterministic LocalAgentDriver (tests/offline). They assert
 * the travel-search behaviour, the RouteStack + Currency MCP audit lifecycle the
 * driver must emit, and the clearly-simulated booking-simulator. They FAIL until
 * the driver routes travel-search / booking turns (it currently answers every
 * non-weather turn with destination-advisor).
 */
async function run(message: string, history: ChatMessage[] = []): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of new LocalAgentDriver().run({ sessionId: 'search-test', message, history })) {
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

const bookingHistory: ChatMessage[] = [
  { role: 'user', content: SEARCH_LISBON, ts: '2026-08-14T00:00:00Z' },
  { role: 'assistant', content: 'Here are flights and hotels for Lisbon.', ts: '2026-08-14T00:00:01Z' },
];

describe('travel-search skill (RouteStack + Currency)', () => {
  it('returns up to three flight and hotel options normalised to GBP (AC-005-1)', async () => {
    const events = await run(SEARCH_LISBON);

    // Grounding: the agent searches RouteStack for flights and hotels.
    const calls = toolCallNames(events);
    expect(calls).toContain('routestack.flights');
    expect(calls).toContain('routestack.hotels');

    const result = toolResult(events, 'travel-search');
    expect(result.kind).toBe('options');
    expect(String(result.place)).toMatch(/Lisbon/);

    const flights = result.flights as Array<Record<string, any>>;
    const hotels = result.hotels as Array<Record<string, any>>;
    expect(flights.length).toBeGreaterThanOrEqual(1);
    expect(flights.length).toBeLessThanOrEqual(3);
    expect(hotels.length).toBeGreaterThanOrEqual(1);
    expect(hotels.length).toBeLessThanOrEqual(3);

    for (const flight of flights) {
      expect(flight.airline).toBeTruthy();
      expect(flight.from).toBeTruthy();
      expect(flight.to).toBeTruthy();
      expect(typeof flight.durationMin).toBe('number');
      expect(typeof flight.stops).toBe('number');
      expect(typeof flight.pricePerTraveller.amountGBP).toBe('number');
    }
    for (const hotel of hotels) {
      expect(hotel.name).toBeTruthy();
      expect(typeof hotel.rating).toBe('number');
      expect(typeof hotel.nightlyRate.amountGBP).toBe('number');
    }
  });

  it('preserves the supplier currency and records the GBP conversion rate + timestamp (FR-005-4)', async () => {
    const events = await run(SEARCH_LISBON);
    expect(toolCallNames(events)).toContain('currency.convert');

    const result = toolResult(events, 'travel-search');
    const flight = (result.flights as Array<Record<string, any>>)[0];
    expect(flight.pricePerTraveller.source.currency).toBe('EUR');
    expect(flight.pricePerTraveller.source.amount).toBeGreaterThan(0);
    expect(typeof flight.pricePerTraveller.rate).toBe('number');
    expect(typeof flight.pricePerTraveller.rateTimestamp).toBe('string');
  });

  it('marks at most one flight and one hotel as the best option (FR-005-2)', async () => {
    const result = toolResult(await run(SEARCH_LISBON), 'travel-search');
    const bestFlights = (result.flights as Array<Record<string, any>>).filter((f) => f.best === true);
    const bestHotels = (result.hotels as Array<Record<string, any>>).filter((h) => h.best === true);
    expect(bestFlights.length).toBeLessThanOrEqual(1);
    expect(bestHotels.length).toBeLessThanOrEqual(1);
  });

  it('emits the RouteStack MCP call lifecycle so travel search is auditable (FR-005-7)', async () => {
    const events = await run(SEARCH_LISBON);
    const flights = events.find((e) => e.type === 'tool_result' && e.name === 'routestack.flights');
    const hotels = events.find((e) => e.type === 'tool_result' && e.name === 'routestack.hotels');
    expect(flights).toBeDefined();
    expect(hotels).toBeDefined();
    expect((flights as Extract<AgentEvent, { type: 'tool_result' }>).ok).toBe(true);
    expect((hotels as Extract<AgentEvent, { type: 'tool_result' }>).ok).toBe(true);
  });

  it('asks for the departure city when no origin is known (AC-005-2)', async () => {
    const events = await run(
      'Find flights and hotels to Lisbon for 2 travellers, outbound 2026-10-14 returning 2026-10-21.',
    );
    const result = toolResult(events, 'travel-search');
    expect(result.kind).toBe('missing-origin');
    expect(reply(events)).toMatch(/departure city|flying from|leaving from|which airport/i);
    expect(toolCallNames(events)).not.toContain('routestack.flights');
  });

  it('rejects travel dates in the past and asks for valid dates (edge case)', async () => {
    const result = toolResult(
      await run('Find flights and hotels to Lisbon from London for 2 travellers, outbound 2020-01-14 returning 2020-01-21.'),
      'travel-search',
    );
    expect(result.kind).toBe('invalid-dates');
    expect(result.reason).toBe('past');
  });

  it('detects a return date before the outbound date (edge case)', async () => {
    const result = toolResult(
      await run('Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-21 returning 2026-10-14.'),
      'travel-search',
    );
    expect(result.kind).toBe('invalid-dates');
    expect(result.reason).toBe('reversed');
  });

  it('reports no availability for a covered city with no inventory (AC-005-4)', async () => {
    const events = await run(
      'Find flights and hotels to Faro from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.',
    );
    const result = toolResult(events, 'travel-search');
    expect(result.kind).toBe('no-results');
    expect(reply(events)).toMatch(/no availability|no.*results|couldn'?t find/i);
  });

  it('explains limited demo coverage for an uncovered destination (edge case)', async () => {
    const events = await run(
      'Find flights and hotels to Timbuktu from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.',
    );
    const result = toolResult(events, 'travel-search');
    expect(result.kind).toBe('outside-coverage');
    expect(reply(events)).toMatch(/coverage|covered|sandbox/i);
  });

  it('still answers destination requests via destination-advisor (regression)', async () => {
    const result = toolResult(await run('Suggest destinations for warm weather, hiking, and good seafood'), 'destination-advisor');
    expect(result.kind).toBe('shortlist');
  });

  it('still answers weather questions via weather-window (regression)', async () => {
    const result = toolResult(await run("What's the weather like in Lisbon in June?"), 'weather-window');
    expect(result.kind).toBe('month-weather');
  });
});

describe('booking-simulator skill', () => {
  it('produces a clearly-simulated confirmation with a reference code and itinerary echo (AC-005-3)', async () => {
    const events = await run('Book the first flight and the first hotel.', bookingHistory);

    expect(toolCallNames(events)).toContain('booking-simulator');
    const result = toolResult(events, 'booking-simulator');
    expect(result.simulated).toBe(true);
    expect(typeof result.ref).toBe('string');
    expect(String(result.ref).length).toBeGreaterThan(0);
    expect(String(result.itinerary)).toMatch(/Lisbon/);
    expect(typeof result.estimatedTotalGBP).toBe('number');

    expect(reply(events)).toMatch(/simulation|demo/i);
  });

  it('takes no payment — the confirmation is a mock only (FR-005-5/6)', async () => {
    const result = toolResult(await run('Book the first flight and the first hotel.', bookingHistory), 'booking-simulator');
    expect(result.simulated).toBe(true);
    expect(result).not.toHaveProperty('paymentUrl');
    expect(result).not.toHaveProperty('checkoutUrl');
  });
});
