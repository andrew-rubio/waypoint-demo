import type { ConvertedMoney, Money } from '../../../shared/types/flight-hotel-search-booking.js';

/**
 * Currency normalisation to GBP (FRD-005 FR-005-4), reused by FRD-007 for EUR
 * display. Live rates come from Frankfurter (ECB daily, keyless). Offline
 * (tests/demo) a small deterministic rate table backs the conversion so figures
 * are reproducible. Every conversion records the rate and the timestamp it was
 * taken, which the audit trail surfaces.
 */

/** GBP per one unit of the source currency — deterministic offline fallback. */
const OFFLINE_RATES_TO_GBP: Record<string, number> = {
  GBP: 1,
  EUR: 0.85,
  USD: 0.78,
  ISK: 0.0057,
  CHF: 0.88,
  SEK: 0.074,
  NOK: 0.073,
};

const OFFLINE_RATE_TIMESTAMP = '2026-08-14T00:00:00Z';

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Deterministic GBP conversion for tests/offline. */
export function offlineConvertToGBP(money: Money): ConvertedMoney {
  const rate = OFFLINE_RATES_TO_GBP[money.currency.toUpperCase()] ?? 1;
  return { source: money, amountGBP: round2(money.amount * rate), rate, rateTimestamp: OFFLINE_RATE_TIMESTAMP };
}

/**
 * Live GBP conversion via Frankfurter (api.frankfurter.dev). GBP is a no-op.
 * Throws on transport/parse failure so the caller can fall back to the offline
 * table or emit an error audit entry.
 */
export async function convertToGBP(money: Money): Promise<ConvertedMoney> {
  const currency = money.currency.toUpperCase();
  if (currency === 'GBP') {
    return { source: money, amountGBP: round2(money.amount), rate: 1, rateTimestamp: new Date().toISOString() };
  }
  const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(currency)}&symbols=GBP`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`currency ${res.status}`);
  const data = (await res.json()) as { rates?: { GBP?: number }; date?: string };
  const rate = data.rates?.GBP;
  if (typeof rate !== 'number') throw new Error('currency: no GBP rate returned');
  return {
    source: money,
    amountGBP: round2(money.amount * rate),
    rate,
    rateTimestamp: data.date ? `${data.date}T00:00:00Z` : new Date().toISOString(),
  };
}
