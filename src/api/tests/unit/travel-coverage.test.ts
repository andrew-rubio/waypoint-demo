import { describe, expect, it } from 'vitest';
import type { ConvertedMoney, HotelOption } from '../../../shared/types/flight-hotel-search-booking.js';
import { mergeTravelResult, searchTravel } from '../../src/tools/routestack.js';

/**
 * BUG-004 — Cities the live RouteStack sandbox covers but the offline catalogue
 * does not (e.g. Paris) returned "outside-coverage" and showed no options, so
 * they could not be booked. Live search must not be gated on offline coverage:
 * a valid request should surface live results for any covered city, with the
 * offline catalogue as a fallback only.
 */
const req = { destination: 'Paris', origin: 'London', checkIn: '2026-10-14', checkOut: '2026-10-21', party: 2 };

function gbp(amount: number): ConvertedMoney {
  return { source: { amount, currency: 'GBP', includesTaxesAndFees: false }, amountGBP: amount, rate: 1, rateTimestamp: '2026-08-14T00:00:00Z' };
}
const parisHotel: HotelOption = { name: 'Hôtel de Paris', rating: 5, nightlyRate: gbp(300), best: true };

describe('live coverage beyond the offline catalogue (BUG-004)', () => {
  it('shows options for a live-only city from live results, even when the offline catalogue does not cover it', () => {
    const base = searchTravel(req);
    expect(base.kind).toBe('outside-coverage');

    const merged = mergeTravelResult(req, base, { flights: [], hotels: [parisHotel], currency: 'GBP', place: 'Paris, France' });
    expect(merged.kind).toBe('options');
    if (merged.kind !== 'options') return;
    expect(merged.place).toMatch(/Paris/);
    expect(merged.hotels).toHaveLength(1);
    expect(merged.hotels[0].name).toBe('Hôtel de Paris');
    expect(merged.checkIn).toBe(req.checkIn);
    expect(merged.nights).toBe(7);
  });

  it('overlays live hotels while keeping offline flights for a covered city', () => {
    const lisbon = { ...req, destination: 'Lisbon' };
    const base = searchTravel(lisbon);
    expect(base.kind).toBe('options');

    const merged = mergeTravelResult(lisbon, base, { flights: [], hotels: [parisHotel], currency: 'GBP', place: 'Lisbon, Portugal' });
    expect(merged.kind).toBe('options');
    if (merged.kind !== 'options') return;
    expect(merged.hotels[0].name).toBe('Hôtel de Paris');
    expect(merged.flights.length).toBeGreaterThan(0);
  });

  it('reports outside-coverage only when neither offline nor live has anything', () => {
    const base = searchTravel(req);
    expect(mergeTravelResult(req, base, undefined).kind).toBe('outside-coverage');
    expect(mergeTravelResult(req, base, { flights: [], hotels: [], currency: 'GBP' }).kind).toBe('outside-coverage');
  });

  it('still short-circuits on a user-input problem regardless of live data', () => {
    const noOrigin = { ...req, origin: undefined };
    const base = searchTravel(noOrigin);
    expect(base.kind).toBe('missing-origin');
    expect(mergeTravelResult(noOrigin, base, { flights: [], hotels: [parisHotel], currency: 'GBP' }).kind).toBe('missing-origin');
  });
});
