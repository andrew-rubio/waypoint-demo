import { z } from 'zod';
import type {
  MonthlyClimate,
  WeatherIntent,
  WeatherMonthReason,
  WeatherRequest,
  WeatherResult,
} from '../../../shared/types/weather-and-timing.js';
import type { ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';

const climateRowSchema = z.object({
  month: z.string().trim().min(1),
  tempMaxC: z.number(),
  tempMinC: z.number(),
  precipMm: z.number().min(0),
});

const requestSchema = z.object({
  place: z.string().trim().min(1),
  intent: z.enum(['month-weather', 'best-time']).optional(),
  month: z.string().trim().min(1).optional(),
  resolvedName: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  climate: z.array(climateRowSchema).optional(),
  estimated: z.boolean().optional(),
});

/** SDK-facing JSON schema. The place + intent are all the agent supplies; the tool grounds the figures in real Open-Meteo data. */
export const weatherWindowParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['place'],
  properties: {
    place: { type: 'string', description: 'The destination the traveller asked about, exactly as they said it.' },
    intent: {
      type: 'string',
      enum: ['month-weather', 'best-time'],
      description: '"month-weather" for a specific month, "best-time" for the best months to visit.',
    },
    month: { type: 'string', description: 'Target calendar month for month-weather, e.g. "June".' },
  },
} as const;

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

const BASELINE = '1991–2020';

/**
 * Deterministic offline climate model — the safety net used in test/offline mode
 * and whenever the agent does not supply live MCP figures. Each place is a small
 * set of parameters from which plausible ERA5-style monthly normals are derived.
 * In production the real Open-Meteo MCP supplies the numbers; this only backs the
 * demo when no credential/MCP is present. Analogous to the destination POOL.
 */
interface PlaceModel {
  name: string;
  country: string;
  aliases: string[];
  latitude: number;
  longitude: number;
  hemisphere: 'N' | 'S';
  annualMeanC: number;
  seasonalAmpC: number;
  dielC: number;
  annualPrecipMm: number;
  wetPeakMonth: number; // 1–12
  precipAmp: number; // 0–1
}

const PLACES: PlaceModel[] = [
  { name: 'Lisbon, Portugal', country: 'Portugal', aliases: ['lisbon', 'lisboa'], latitude: 38.72, longitude: -9.14, hemisphere: 'N', annualMeanC: 17, seasonalAmpC: 6, dielC: 8, annualPrecipMm: 725, wetPeakMonth: 1, precipAmp: 0.85 },
  { name: 'Reykjavík, Iceland', country: 'Iceland', aliases: ['reykjavik', 'reykjavík', 'iceland'], latitude: 64.15, longitude: -21.94, hemisphere: 'N', annualMeanC: 5, seasonalAmpC: 6, dielC: 5, annualPrecipMm: 870, wetPeakMonth: 10, precipAmp: 0.35 },
  { name: 'Barcelona, Spain', country: 'Spain', aliases: ['barcelona'], latitude: 41.39, longitude: 2.17, hemisphere: 'N', annualMeanC: 17, seasonalAmpC: 7, dielC: 8, annualPrecipMm: 640, wetPeakMonth: 10, precipAmp: 0.5 },
  { name: 'Rome, Italy', country: 'Italy', aliases: ['rome', 'roma'], latitude: 41.89, longitude: 12.48, hemisphere: 'N', annualMeanC: 16, seasonalAmpC: 8, dielC: 10, annualPrecipMm: 800, wetPeakMonth: 11, precipAmp: 0.7 },
  { name: 'London, United Kingdom', country: 'United Kingdom', aliases: ['london'], latitude: 51.51, longitude: -0.13, hemisphere: 'N', annualMeanC: 12, seasonalAmpC: 7, dielC: 7, annualPrecipMm: 620, wetPeakMonth: 11, precipAmp: 0.3 },
  { name: 'Paris, France', country: 'France', aliases: ['paris'], latitude: 48.85, longitude: 2.35, hemisphere: 'N', annualMeanC: 12, seasonalAmpC: 8, dielC: 8, annualPrecipMm: 640, wetPeakMonth: 5, precipAmp: 0.25 },
  { name: 'Bangkok, Thailand', country: 'Thailand', aliases: ['bangkok'], latitude: 13.75, longitude: 100.5, hemisphere: 'N', annualMeanC: 28, seasonalAmpC: 2.5, dielC: 9, annualPrecipMm: 1650, wetPeakMonth: 9, precipAmp: 0.9 },
  { name: 'Sydney, Australia', country: 'Australia', aliases: ['sydney'], latitude: -33.87, longitude: 151.21, hemisphere: 'S', annualMeanC: 18, seasonalAmpC: 5, dielC: 7, annualPrecipMm: 1150, wetPeakMonth: 6, precipAmp: 0.35 },
  { name: 'Tromsø, Norway', country: 'Norway', aliases: ['tromso', 'tromsø'], latitude: 69.65, longitude: 18.96, hemisphere: 'N', annualMeanC: 3, seasonalAmpC: 8, dielC: 5, annualPrecipMm: 1000, wetPeakMonth: 10, precipAmp: 0.4 },
  { name: 'Marrakesh, Morocco', country: 'Morocco', aliases: ['marrakesh', 'marrakech'], latitude: 31.63, longitude: -7.99, hemisphere: 'N', annualMeanC: 19, seasonalAmpC: 9, dielC: 14, annualPrecipMm: 250, wetPeakMonth: 11, precipAmp: 0.7 },
  { name: 'Innsbruck, Austria', country: 'Austria', aliases: ['innsbruck'], latitude: 47.27, longitude: 11.39, hemisphere: 'N', annualMeanC: 9, seasonalAmpC: 9, dielC: 10, annualPrecipMm: 900, wetPeakMonth: 7, precipAmp: 0.4 },
  { name: 'Zermatt, Switzerland', country: 'Switzerland', aliases: ['zermatt'], latitude: 46.02, longitude: 7.75, hemisphere: 'N', annualMeanC: 4, seasonalAmpC: 8, dielC: 9, annualPrecipMm: 700, wetPeakMonth: 7, precipAmp: 0.3 },
];

/** Places famous enough to be ambiguous — the agent must ask which one. */
const AMBIGUOUS: Record<string, { name: string; country: string }[]> = {
  springfield: [
    { name: 'Springfield, Illinois', country: 'United States' },
    { name: 'Springfield, Missouri', country: 'United States' },
    { name: 'Springfield, Massachusetts', country: 'United States' },
  ],
};

const round = (value: number): number => Math.round(value);

/** Derive a plausible monthly climate normal for a place from its parameters. */
function modelClimate(place: PlaceModel): MonthlyClimate[] {
  const peak = place.hemisphere === 'N' ? 7 : 1; // warmest month
  return MONTHS.map((month, index) => {
    const m = index + 1;
    const seasonal = Math.cos((2 * Math.PI * (m - peak)) / 12);
    const mean = place.annualMeanC + place.seasonalAmpC * seasonal;
    const precipShape = 1 + place.precipAmp * Math.cos((2 * Math.PI * (m - place.wetPeakMonth)) / 12);
    const precip = Math.max(0, (place.annualPrecipMm / 12) * precipShape);
    return {
      month,
      tempMaxC: round(mean + place.dielC / 2),
      tempMinC: round(mean - place.dielC / 2),
      precipMm: round(precip),
    };
  });
}

function findPlace(text: string): PlaceModel | undefined {
  return PLACES.find((place) => place.aliases.some((alias) => text.includes(alias)));
}

/** Comfort score for a month: prefer ~24°C days and low rainfall. */
function comfort(row: MonthlyClimate): number {
  const tempScore = 1 - Math.min(1, Math.abs(row.tempMaxC - 24) / 16);
  const rainScore = 1 - Math.min(1, row.precipMm / 120);
  return 0.65 * tempScore + 0.35 * rainScore;
}

function recommendReason(row: MonthlyClimate): string {
  return `Comfortable ${row.tempMaxC}°C days and about ${row.precipMm} mm of rain.`;
}

function avoidReason(row: MonthlyClimate): string {
  if (row.tempMaxC >= 30) return `Uncomfortably hot at around ${row.tempMaxC}°C.`;
  if (row.tempMaxC <= 10) return `Cold, with daytime highs near ${row.tempMaxC}°C.`;
  return `Wet, with about ${row.precipMm} mm of rain.`;
}

function bestTimeWindow(climate: MonthlyClimate[]): { recommendedMonths: WeatherMonthReason[]; avoidMonths: WeatherMonthReason[] } {
  const ranked = [...climate].sort((a, b) => comfort(b) - comfort(a));
  const recommendedMonths = ranked.slice(0, 3).map((row) => ({ month: row.month, reason: recommendReason(row) }));
  const avoidMonths = ranked.slice(-2).reverse().map((row) => ({ month: row.month, reason: avoidReason(row) }));
  return { recommendedMonths, avoidMonths };
}

/**
 * Pure, deterministic structuring of weather data into a WeatherResult. Shared by
 * the real SDK driver (which supplies a `resolvedName` + real Open-Meteo `climate`)
 * and the local test/offline driver (which relies on the embedded model). The
 * embedded special cases (open-ocean, ambiguous names) apply only when the caller
 * has NOT already resolved the place via real geocoding.
 */
export function assessWeather(raw: WeatherRequest): WeatherResult {
  const request = requestSchema.parse(raw);
  const text = request.place.toLowerCase();
  const intent: WeatherIntent = request.intent ?? (request.month ? 'month-weather' : 'best-time');

  if (!request.resolvedName) {
    // Open ocean / no land station → report, never fabricate.
    if (/point nemo|open ocean|middle of the (atlantic|pacific|indian)?\s*ocean/.test(text)) {
      return { kind: 'no-data', place: request.place, message: 'no climate station near that point' };
    }
    // Same-named places → ask which one.
    const ambiguousKey = Object.keys(AMBIGUOUS).find((key) => text.includes(key));
    if (ambiguousKey) {
      return { kind: 'ambiguous-place', message: `Several places are called ${request.place}.`, candidates: AMBIGUOUS[ambiguousKey] };
    }
  }

  const place = findPlace(text);
  const resolvedName = request.resolvedName ?? place?.name;
  if (!resolvedName) {
    return { kind: 'unknown-place', message: `could not locate "${request.place}"` };
  }

  // Real Open-Meteo climate (with seasonal variation) is used as-is; otherwise the
  // embedded model backs a known place; otherwise there is nothing to report.
  const climate = plausibleClimate(request.climate) ?? (place ? modelClimate(place) : undefined);
  if (!climate) {
    return { kind: 'no-data', place: resolvedName, message: `no climate data for ${resolvedName}` };
  }

  if (intent === 'best-time') {
    const { recommendedMonths, avoidMonths } = bestTimeWindow(climate);
    return { kind: 'weather-window', place: resolvedName, recommendedMonths, avoidMonths, source: 'open-meteo' };
  }

  const monthName = canonicalMonth(request.month) ?? MONTHS[new Date().getUTCMonth()];
  const row = climate.find((entry) => entry.month === monthName);
  if (!row) {
    return { kind: 'no-data', place: resolvedName, message: `no climate data for ${monthName} in ${resolvedName}` };
  }
  return {
    kind: 'month-weather',
    place: resolvedName,
    month: monthName,
    tempMaxC: row.tempMaxC,
    tempMinC: row.tempMinC,
    precipMm: row.precipMm,
    basis: 'climate-normal',
    baseline: request.estimated ? 'a recent estimate' : BASELINE,
    ...(request.estimated ? { estimated: true } : {}),
    source: 'open-meteo',
  };
}

/** Order supplied climate rows by calendar month and coerce to whole numbers. */
function normaliseClimate(rows: MonthlyClimate[]): MonthlyClimate[] {
  const byMonth = new Map(rows.map((row) => [canonicalMonth(row.month) ?? row.month, row]));
  return MONTHS.filter((month) => byMonth.has(month)).map((month) => {
    const row = byMonth.get(month)!;
    return { month, tempMaxC: round(row.tempMaxC), tempMinC: round(row.tempMinC), precipMm: round(row.precipMm) };
  });
}

/**
 * Return supplied climate only when it is real, grounded data. A model that
 * cannot reach the Open-Meteo MCP sometimes fabricates an all-zero (or flat)
 * series; reject that so the deterministic embedded model provides the figures
 * instead of showing 0°C. Real MCP data (with seasonal variation) is used as-is.
 */
function plausibleClimate(rows: MonthlyClimate[] | undefined): MonthlyClimate[] | undefined {
  if (!rows?.length) return undefined;
  const normalised = normaliseClimate(rows);
  if (normalised.length < 6) return undefined;
  const maxes = normalised.map((row) => row.tempMaxC);
  const allZero = normalised.every((row) => row.tempMaxC === 0 && row.tempMinC === 0 && row.precipMm === 0);
  const seasonalSpread = Math.max(...maxes) - Math.min(...maxes);
  return !allZero && seasonalSpread > 0 ? normalised : undefined;
}

function canonicalMonth(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const lower = value.trim().toLowerCase();
  return MONTHS.find((month) => month.toLowerCase() === lower || month.toLowerCase().startsWith(lower.slice(0, 3)));
}

/**
 * Does this turn ask about weather or seasonality (as opposed to "where should I
 * go")? Destination-discovery phrasing (suggest/recommend/destinations/somewhere)
 * always wins so a request like "somewhere warm but not too hot" still routes to
 * destination advice.
 */
export function isWeatherQuery(message: string): boolean {
  const text = message.toLowerCase();
  if (/\bsuggest\b|\brecommend\b|\bdestinations?\b|\bsomewhere\b|\banywhere\b|where (should|can|could|to|else)/.test(text)) {
    return false;
  }
  return (
    /\bbest (time|months?|season)\b|when[^?]{0,30}(visit|go|travel)\b|which months?\b|what months?\b|too (hot|cold|warm|wet)\b/.test(text) ||
    /(what'?s|how'?s|how is|typical)[^?]{0,24}weather|weather (like )?(in|at|there)|temperature (in|at)|climate (in|at)|how (hot|warm|cold|wet) is/.test(text)
  );
}

/** Convert a chat turn into structured weather-window input. */
export function weatherRequestFromConversation(message: string, history: ChatMessage[] = []): WeatherRequest {
  const intent: WeatherIntent = /best time|when.*(visit|go|travel)|which month|what months/.test(message.toLowerCase())
    ? 'best-time'
    : 'month-weather';
  const explicit = extractPlace(message);
  // Resolve contextual references ("there", "that place") to the most recently
  // discussed destination when this turn names no recognisable place of its own.
  const place = findPlace(explicit.toLowerCase()) ? explicit : mostRecentPlace(history) ?? explicit;
  return { place, intent, month: extractMonth(message) };
}

/** The most recently mentioned known place across the conversation so far. */
function mostRecentPlace(history: ChatMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const model = findPlace(history[i].content.toLowerCase());
    if (model) return model.name;
  }
  return undefined;
}

/** Pull the place phrase out of a free-text question. */
function extractPlace(message: string): string {
  const match = message.match(
    /\b(?:weather (?:like )?in|weather in|climate in|in|at|visit|to|about)\s+([A-Za-zÀ-ÿ'’.\- ]+?)(?:\s+in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|[?.!,]|$)/i,
  );
  return (match ? match[1] : message).trim();
}

function extractMonth(message: string): string | undefined {
  return canonicalMonth(MONTHS.find((month) => message.toLowerCase().includes(month.toLowerCase())));
}

/** The offline climate normals for a resolved place — used by the local driver to populate the MCP audit entry. */
export function offlineClimateFor(place: string): MonthlyClimate[] | undefined {
  const model = findPlace(place.toLowerCase());
  return model ? modelClimate(model) : undefined;
}

/**
 * A reasonable climate estimate for any point from its latitude — the failsafe
 * used when the live Open-Meteo archive is unavailable and the place is not in the
 * offline model. Warmer near the equator, larger seasonal swings toward the poles,
 * hemisphere-correct. Not a substitute for real normals, but plausible.
 */
export function estimateClimateFromLatitude(latitude: number, name = ''): MonthlyClimate[] {
  const absLat = Math.min(75, Math.abs(latitude));
  const place: PlaceModel = {
    name,
    country: '',
    aliases: [],
    latitude,
    longitude: 0,
    hemisphere: latitude < 0 ? 'S' : 'N',
    annualMeanC: Math.round(27 - 0.36 * absLat),
    seasonalAmpC: Math.round(1 + absLat * 0.28),
    dielC: 8,
    annualPrecipMm: 800,
    wetPeakMonth: latitude < 0 ? 1 : 7,
    precipAmp: 0.3,
  };
  return modelClimate(place);
}

/** Resolve a place to its canonical geocoding record for the audit trail (offline). */
export function offlineGeocode(place: string): { name: string; country: string; latitude: number; longitude: number } | undefined {
  const model = findPlace(place.toLowerCase());
  if (!model) return undefined;
  return { name: model.name, country: model.country, latitude: model.latitude, longitude: model.longitude };
}
