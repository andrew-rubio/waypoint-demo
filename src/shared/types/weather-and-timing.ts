/**
 * Shared contract for the FRD-004 weather-window skill + Open-Meteo MCP (INC-4).
 *
 * The agent geocodes a place and reads ERA5 1991–2020 climate normals (or a
 * near-term forecast) from the Open-Meteo MCP, then the trusted weather-window
 * tool shapes those figures into one of these results. Figures always originate
 * from Open-Meteo (or the deterministic offline table) — never invented.
 */

/** Whether the figures are a long-run climate normal or a near-term forecast (FR-004-2a). */
export type WeatherBasis = 'climate-normal' | 'forecast';

export interface WeatherMonthReason {
  month: string;
  reason: string;
}

/** A resolved place returned by Open-Meteo geocoding. */
export interface WeatherPlaceCandidate {
  name: string;
  country: string;
}

/** Monthly climate aggregate — one row per calendar month. */
export interface MonthlyClimate {
  month: string;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
}

export interface MonthWeatherResult {
  kind: 'month-weather';
  /** Canonical resolved place, e.g. "Lisbon, Portugal". */
  place: string;
  month: string;
  tempMaxC: number;
  tempMinC: number;
  precipMm: number;
  basis: WeatherBasis;
  /** Baseline period when the basis is a climate normal, e.g. "1991–2020". */
  baseline?: string;
  /** True when figures are a climate estimate (live Open-Meteo data was unavailable). */
  estimated?: boolean;
  source: 'open-meteo';
  message?: string;
}

export interface WeatherWindowResult {
  kind: 'weather-window';
  place: string;
  recommendedMonths: WeatherMonthReason[];
  avoidMonths: WeatherMonthReason[];
  source: 'open-meteo';
  message?: string;
}

export interface WeatherUnknownPlaceResult {
  kind: 'unknown-place';
  message: string;
}

export interface WeatherAmbiguousPlaceResult {
  kind: 'ambiguous-place';
  message: string;
  candidates: WeatherPlaceCandidate[];
}

export interface WeatherNoDataResult {
  kind: 'no-data';
  message: string;
  place?: string;
}

export type WeatherResult =
  | MonthWeatherResult
  | WeatherWindowResult
  | WeatherUnknownPlaceResult
  | WeatherAmbiguousPlaceResult
  | WeatherNoDataResult;

/** The weather results that render as a card; the other kinds are reply text only. */
export type WeatherCardResult = MonthWeatherResult | WeatherWindowResult;

/** What kind of weather question the traveller is asking. */
export type WeatherIntent = 'month-weather' | 'best-time';

/**
 * Structured input for the weather-window tool. In production the agent fills
 * `resolvedName`/`climate` from the Open-Meteo MCP; offline the tool falls back
 * to its embedded climate table keyed on `place`.
 */
export interface WeatherRequest {
  place: string;
  intent?: WeatherIntent;
  month?: string;
  resolvedName?: string;
  country?: string;
  climate?: MonthlyClimate[];
  /** True when `climate` is an estimate used because live Open-Meteo data failed. */
  estimated?: boolean;
}
