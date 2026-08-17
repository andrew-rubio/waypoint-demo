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
const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/** Deterministic GBP conversion for tests/offline. */
export function offlineConvertToGBP(money: Money): ConvertedMoney {
  const rate = OFFLINE_RATES_TO_GBP[money.currency.toUpperCase()] ?? 1;
  return { source: money, amountGBP: round2(money.amount * rate), rate, rateTimestamp: OFFLINE_RATE_TIMESTAMP };
}

/** A GBP→target conversion result: the converted amount, the rate (target per GBP) and its timestamp. */
export interface FromGbpConversion {
  amount: number;
  /** Units of the target currency per one GBP. */
  rate: number;
  rateTimestamp: string;
}

/** Deterministic GBP→EUR conversion for tests/offline (FR-007-3). */
export function offlineConvertFromGBP(amountGBP: number, target = 'EUR'): FromGbpConversion {
  const gbpPerUnit = OFFLINE_RATES_TO_GBP[target.toUpperCase()] ?? 1;
  const rate = round4(1 / gbpPerUnit);
  return { amount: round2(amountGBP * rate), rate, rateTimestamp: OFFLINE_RATE_TIMESTAMP };
}

/**
 * Live GBP→EUR conversion via Frankfurter (api.frankfurter.dev). Throws on
 * transport/parse failure so the caller can emit an error audit entry and keep
 * the total in GBP (FRD-007 error handling).
 */
export async function convertFromGBP(amountGBP: number, target = 'EUR'): Promise<FromGbpConversion> {
  const currency = target.toUpperCase();
  if (currency === 'GBP') return { amount: round2(amountGBP), rate: 1, rateTimestamp: new Date().toISOString() };
  const url = `https://api.frankfurter.dev/v1/latest?base=GBP&symbols=${encodeURIComponent(currency)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`currency ${res.status}`);
  const data = (await res.json()) as { rates?: Record<string, number>; date?: string };
  const rate = data.rates?.[currency];
  if (typeof rate !== 'number') throw new Error(`currency: no ${currency} rate returned`);
  return {
    amount: round2(amountGBP * rate),
    rate: round4(rate),
    rateTimestamp: data.date ? `${data.date}T00:00:00Z` : new Date().toISOString(),
  };
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
  const { rate, rateTimestamp } = await gbpRate(currency);
  return { source: money, amountGBP: round2(money.amount * rate), rate, rateTimestamp };
}

/** A cached/deduped GBP rate for one source currency. */
interface GbpRate {
  rate: number;
  rateTimestamp: string;
}

const RATE_TTL_MS = 10 * 60_000;
const rateCache = new Map<string, { value: GbpRate; fetchedAt: number }>();
const inflightRate = new Map<string, Promise<GbpRate>>();

/**
 * Fetch the GBP-per-`currency` rate once and share it. A travel search normalises
 * every flight and hotel price at once, so without this a single query fired ~20
 * concurrent identical Frankfurter calls; this collapses them to one and caches
 * the result for RATE_TTL_MS (ECB rates only change daily).
 */
async function gbpRate(currency: string): Promise<GbpRate> {
  const cached = rateCache.get(currency);
  if (cached && Date.now() - cached.fetchedAt < RATE_TTL_MS) return cached.value;

  let inflight = inflightRate.get(currency);
  if (!inflight) {
    inflight = (async () => {
      const url = `https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(currency)}&symbols=GBP`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
      if (!res.ok) throw new Error(`currency ${res.status}`);
      const data = (await res.json()) as { rates?: { GBP?: number }; date?: string };
      const rate = data.rates?.GBP;
      if (typeof rate !== 'number') throw new Error('currency: no GBP rate returned');
      const value: GbpRate = { rate, rateTimestamp: data.date ? `${data.date}T00:00:00Z` : new Date().toISOString() };
      rateCache.set(currency, { value, fetchedAt: Date.now() });
      return value;
    })();
    inflightRate.set(currency, inflight);
    inflight.finally(() => inflightRate.delete(currency));
  }
  return inflight;
}
