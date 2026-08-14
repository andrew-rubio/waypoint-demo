import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { rememberSearchOptions, resolveBookingOptions } from '../../src/tools/booking-context.js';
import { searchTravel } from '../../src/tools/routestack.js';

/**
 * BUG-003 — Live booking failed with "The demo booking failed for that
 * selection". Root cause: booking re-derived the options by re-parsing the
 * chat text through the offline catalogue (6 cities only), so any city the live
 * RouteStack sandbox covered — or any search where the model supplied the dates
 * — could not be reconstructed and booking failed. Booking must use the options
 * that were actually shown for the session.
 */
describe('booking context (BUG-003)', () => {
  it('books the options that were actually shown, even when they cannot be re-derived from the chat text', () => {
    const sessionId = 'bug003';
    const shown = searchTravel({ destination: 'Lisbon', origin: 'London', checkIn: '2026-10-14', checkOut: '2026-10-21', party: 2 });
    expect(shown.kind).toBe('options');
    rememberSearchOptions(sessionId, shown as Extract<typeof shown, { kind: 'options' }>);

    // The booking turn cannot re-parse a search from history (mirrors the live
    // case: model-supplied dates and/or a city outside the offline catalogue).
    const options = resolveBookingOptions(sessionId, []);
    expect(options?.kind).toBe('options');
    expect(options).toEqual(shown);
  });

  it('falls back to re-deriving from history when nothing was remembered for the session', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'Find flights and hotels to Lisbon from London for 2 travellers, outbound 2026-10-14 returning 2026-10-21.', ts: '2026-08-14T00:00:00Z' },
    ];
    const options = resolveBookingOptions('no-cache-session', history);
    expect(options?.kind).toBe('options');
  });

  it('returns undefined when there is neither a remembered nor a re-derivable search', () => {
    expect(resolveBookingOptions('empty-session', [])).toBeUndefined();
  });
});
