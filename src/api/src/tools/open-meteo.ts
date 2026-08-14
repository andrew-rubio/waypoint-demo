import { z } from 'zod';
import type { MonthlyClimate, WeatherPlaceCandidate } from '../../../shared/types/weather-and-timing.js';
import { MONTHS } from './weather-window.js';

/**
 * Direct Open-Meteo REST client (ADR-006, Option C). The Copilot SDK preview does
 * not surface MCP tools to a Foundry-BYOK session, so instead of a separate MCP
 * server the weather flow calls Open-Meteo's free, keyless HTTP API here. These
 * are the real `open-meteo.geocoding` and `open-meteo.climate` calls surfaced in
 * the audit trail — grounded in live ERA5 1991–2020 data. CC BY 4.0.
 */
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const REQUEST_TIMEOUT_MS = 20_000;

export interface GeocodedPlace {
  name: string; // canonical "City, Country"
  latitude: number;
  longitude: number;
  country: string;
  timezone?: string;
}

export type GeocodeOutcome =
  | { kind: 'match'; place: GeocodedPlace }
  | { kind: 'ambiguous'; place: GeocodedPlace; candidates: WeatherPlaceCandidate[] }
  | { kind: 'none' };

const geocodeResultSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
  population: z.number().optional(),
});
const geocodeResponseSchema = z.object({ results: z.array(geocodeResultSchema).optional() });

const archiveResponseSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
  }),
});

async function getJson(url: string): Promise<unknown> {
  // One retry, then give up (FRD-004 error handling).
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`Open-Meteo responded ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Open-Meteo request failed');
}

const canonicalName = (name: string, country?: string): string =>
  country && country.toLowerCase() !== name.toLowerCase() ? `${name}, ${country}` : name;

/** Resolve a free-text place to coordinates via the Open-Meteo geocoding API (FR-004-1). */
export async function geocode(query: string): Promise<GeocodeOutcome> {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const data = geocodeResponseSchema.parse(await getJson(url));
  const results = data.results ?? [];
  if (results.length === 0) return { kind: 'none' };

  const top = results[0];
  const place: GeocodedPlace = {
    name: canonicalName(top.name, top.country),
    latitude: top.latitude,
    longitude: top.longitude,
    country: top.country ?? '',
    timezone: top.timezone,
  };

  // Ambiguous only when a similarly-named place is comparably prominent. Open-Meteo
  // ranks by population, so a dominant top hit (e.g. Lisbon, Portugal) wins outright;
  // genuinely competing places (e.g. the several Springfields) trigger a follow-up.
  const sameName = results.filter((r) => r.name.toLowerCase() === top.name.toLowerCase());
  const runnerUp = sameName[1];
  const topPop = top.population ?? 0;
  const runnerUpPop = runnerUp?.population ?? 0;
  const competing = runnerUp && (topPop === 0 || runnerUpPop / topPop > 0.4);
  if (competing) {
    const candidates = sameName.slice(0, 4).map((r) => ({
      name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name,
      country: r.country ?? '',
    }));
    return { kind: 'ambiguous', place, candidates };
  }
  return { kind: 'match', place };
}

/**
 * Fetch the ERA5 1991–2020 daily archive for a point and aggregate to monthly
 * climate normals: mean daily max/min (°C) and the average monthly precipitation
 * total (mm). At least 90% daily completeness is required per calendar month
 * (FR-004-2); otherwise that month is omitted.
 */
export async function climateNormals(latitude: number, longitude: number): Promise<MonthlyClimate[]> {
  const url =
    `${ARCHIVE_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&start_date=1991-01-01&end_date=2020-12-31` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`;
  const { daily } = archiveResponseSchema.parse(await getJson(url));

  const buckets = MONTHS.map(() => ({ maxSum: 0, minSum: 0, tempDays: 0, precipSum: 0, precipDays: 0, years: new Set<number>() }));
  for (let i = 0; i < daily.time.length; i += 1) {
    const date = new Date(daily.time[i]);
    const bucket = buckets[date.getUTCMonth()];
    const max = daily.temperature_2m_max[i];
    const min = daily.temperature_2m_min[i];
    const precip = daily.precipitation_sum[i];
    if (max != null && min != null) {
      bucket.maxSum += max;
      bucket.minSum += min;
      bucket.tempDays += 1;
    }
    if (precip != null) {
      bucket.precipSum += precip;
      bucket.precipDays += 1;
      bucket.years.add(date.getUTCFullYear());
    }
  }

  const rows: MonthlyClimate[] = [];
  for (let m = 0; m < 12; m += 1) {
    const bucket = buckets[m];
    const expectedDays = daysInMonth(m) * 30; // ~30 years of the 1991–2020 baseline
    if (bucket.tempDays < expectedDays * 0.9) continue; // insufficient completeness
    const years = Math.max(1, bucket.years.size);
    rows.push({
      month: MONTHS[m],
      tempMaxC: Math.round(bucket.maxSum / bucket.tempDays),
      tempMinC: Math.round(bucket.minSum / bucket.tempDays),
      precipMm: Math.round(bucket.precipSum / years),
    });
  }
  return rows;
}

function daysInMonth(monthIndex: number): number {
  return [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthIndex];
}
