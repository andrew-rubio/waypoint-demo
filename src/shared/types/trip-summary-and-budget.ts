/**
 * Shared contract for FRD-007 trip summary, budget & currency (INC-7).
 *
 * Once a destination, dates, a flight and a hotel are chosen, the agent's
 * `trip-summariser` skill assembles a readable itinerary and the
 * `budget-estimator` skill totals the cost as (flight × party) + (nightly ×
 * nights × rooms). Prices are shown in GBP by default; on request the total is
 * converted to EUR through the Currency service (Frankfurter/ECB, reused from
 * FRD-005), recording the rate and its timestamp for the audit trail. The
 * summary reflects the traveller's applied preferences (seat + meal) and reward
 * points from the Cosmos profile (FRD-006), and omits them rather than guessing
 * when personalisation is unavailable.
 *
 * In production the agent fills these shapes from the remembered RouteStack
 * options + Currency + Cosmos calls; offline (tests/demo) the deterministic
 * trip-summary tool builds them from the embedded catalogue.
 */

import type { FlightOption, HotelOption } from './flight-hotel-search-booking.js';
import type { DietaryRequirement, SeatPreference } from './personalisation.js';

/** One budget line: a unit price multiplied out to a GBP subtotal. */
export interface BudgetLine {
  /** GBP unit price (per traveller for flights, per night for hotels). */
  unitGBP: number;
  subtotalGBP: number;
}

/** The flight budget line (unit × party). */
export interface FlightBudgetLine extends BudgetLine {
  party: number;
}

/** The hotel budget line (nightly × nights × rooms). */
export interface HotelBudgetLine extends BudgetLine {
  /** GBP nightly rate (alias of unitGBP for readability). */
  nightlyGBP: number;
  nights: number;
  rooms: number;
}

/**
 * The budget-estimator result: line items and the estimated GBP total
 * (FR-007-2). A line is absent when its side is not selected (partial
 * selection, AC-007-4). `taxesAndFeesIncluded` is true only when every selected
 * supplier explicitly marks taxes/fees included; otherwise the total excludes
 * unspecified taxes/fees.
 */
export interface BudgetEstimate {
  flight?: FlightBudgetLine;
  hotel?: HotelBudgetLine;
  totalGBP: number;
  taxesAndFeesIncluded: boolean;
}

/** The GBP→EUR rate used for a conversion, with when it was taken (FR-007-3). */
export interface ExchangeRate {
  /** EUR per one GBP. */
  rate: number;
  /** ISO 8601 timestamp of the exchange rate used. */
  timestamp: string;
}

/**
 * The trip-summariser result rendered as the trip summary card (FR-007-1). EUR
 * fields are present only after an on-request conversion; personalisation
 * fields are present only when the Cosmos profile is available.
 */
export interface TripSummary {
  destination: string;
  dates: { outbound: string; return: string };
  /** One-line weather note from FRD-004 (empty when unavailable). */
  weatherNote: string;
  flight?: FlightOption;
  hotel?: HotelOption;
  partySize: number;
  nights: number;
  roomCount: number;
  totalGBP: number;
  /** Present only after a GBP→EUR conversion (AC-007-2). */
  totalEUR?: number;
  exchangeRate?: ExchangeRate;
  taxesAndFeesIncluded: boolean;
  /** Present only when personalisation is available (AC-007-3/FR-007-4). */
  appliedPreferences?: { seat: SeatPreference; meal: DietaryRequirement };
  /** Reward points balance from the Cosmos profile; absent when unavailable. */
  pointsBalance?: number;
  /** True when a hotel is not selected (partial selection, AC-007-4). */
  hotelMissing?: boolean;
  /** True when personalisation could not be applied (degraded). */
  personalisationUnavailable?: boolean;
}
