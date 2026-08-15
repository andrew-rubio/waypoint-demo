import type { ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import type { TravelOptionsResult } from '../../../shared/types/flight-hotel-search-booking.js';
import type { PersonalisationProfile } from '../../../shared/types/personalisation.js';
import type {
  BudgetEstimate,
  ExchangeRate,
  TripSummary,
} from '../../../shared/types/trip-summary-and-budget.js';
import { MONTHS, offlineClimateFor } from './weather-window.js';

/**
 * FRD-007 trip-summary tool — the pure summariser + budget maths shared by the
 * real Copilot driver and the local test driver. `estimateBudget` totals the
 * cost as (flight × party) + (nightly × nights × rooms); `summariseTrip`
 * assembles the itinerary card, folding in the Cosmos preferences + reward
 * points and (when converted) the EUR figures. Currency conversion itself is
 * async and lives in currency.ts — the EUR result is passed in.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** SDK-facing JSON schema. The agent supplies only the display currency; the tool grounds the figures. */
export const tripSummaryParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    currency: {
      type: 'string',
      enum: ['GBP', 'EUR'],
      description: 'Display currency for the total; use EUR only when the traveller asks to see euros.',
    },
  },
} as const;

export interface BudgetOptions {
  rooms?: number;
  includeFlight?: boolean;
  includeHotel?: boolean;
  flightIndex?: number;
  hotelIndex?: number;
}

/**
 * Total the estimated GBP cost from the remembered options (FR-007-2). A line is
 * omitted when its side is not selected (partial selection, AC-007-4). Taxes/fees
 * are marked included only when every selected supplier explicitly includes them.
 */
export function estimateBudget(options: TravelOptionsResult, opts: BudgetOptions = {}): BudgetEstimate {
  const rooms = opts.rooms ?? 1;
  const includeFlight = opts.includeFlight ?? true;
  const includeHotel = opts.includeHotel ?? true;
  const flight = includeFlight ? options.flights[Math.min(opts.flightIndex ?? 0, options.flights.length - 1)] : undefined;
  const hotel = includeHotel ? options.hotels[Math.min(opts.hotelIndex ?? 0, options.hotels.length - 1)] : undefined;

  const estimate: BudgetEstimate = { totalGBP: 0, taxesAndFeesIncluded: false };
  const included: boolean[] = [];
  let total = 0;

  if (flight) {
    const unitGBP = flight.pricePerTraveller.amountGBP;
    const subtotalGBP = round2(unitGBP * options.party);
    estimate.flight = { unitGBP, party: options.party, subtotalGBP };
    total += subtotalGBP;
    included.push(flight.pricePerTraveller.source.includesTaxesAndFees);
  }
  if (hotel) {
    const nightlyGBP = hotel.nightlyRate.amountGBP;
    const subtotalGBP = round2(nightlyGBP * options.nights * rooms);
    estimate.hotel = { unitGBP: nightlyGBP, nightlyGBP, nights: options.nights, rooms, subtotalGBP };
    total += subtotalGBP;
    included.push(hotel.nightlyRate.source.includesTaxesAndFees);
  }

  estimate.totalGBP = round2(total);
  estimate.taxesAndFeesIncluded = included.length > 0 && included.every(Boolean);
  return estimate;
}

export interface SummaryOptions extends BudgetOptions {
  profile?: PersonalisationProfile;
  weatherNote?: string;
  /** EUR figures from a GBP→EUR conversion (AC-007-2). */
  eur?: { totalEUR: number; exchangeRate: ExchangeRate };
  personalisationUnavailable?: boolean;
}

/** Assemble the trip summary card from the remembered options (FR-007-1). */
export function summariseTrip(options: TravelOptionsResult, opts: SummaryOptions = {}): TripSummary {
  const rooms = opts.rooms ?? 1;
  const includeHotel = opts.includeHotel ?? true;
  const budget = estimateBudget(options, { ...opts, rooms });
  const flight = options.flights[Math.min(opts.flightIndex ?? 0, options.flights.length - 1)];
  const hotel = includeHotel ? options.hotels[Math.min(opts.hotelIndex ?? 0, options.hotels.length - 1)] : undefined;

  const summary: TripSummary = {
    destination: options.place,
    dates: { outbound: options.checkIn, return: options.checkOut },
    weatherNote: opts.weatherNote ?? weatherNoteFor(options.place, options.checkIn),
    flight,
    hotel,
    partySize: options.party,
    nights: options.nights,
    roomCount: rooms,
    totalGBP: budget.totalGBP,
    taxesAndFeesIncluded: budget.taxesAndFeesIncluded,
  };

  if (opts.profile) {
    summary.appliedPreferences = { seat: opts.profile.seat, meal: opts.profile.dietary };
    summary.pointsBalance = opts.profile.rewardPoints;
  } else if (opts.personalisationUnavailable) {
    summary.personalisationUnavailable = true;
  }

  if (!includeHotel) summary.hotelMissing = true;
  if (opts.eur) {
    summary.totalEUR = opts.eur.totalEUR;
    summary.exchangeRate = opts.eur.exchangeRate;
  }
  return summary;
}

/** A one-line weather note for the outbound month from the offline climate model (FR-007-1). */
export function weatherNoteFor(place: string, checkInISO: string): string {
  const climate = offlineClimateFor(place);
  if (!climate) return '';
  const monthIndex = new Date(`${checkInISO}T00:00:00Z`).getUTCMonth();
  if (Number.isNaN(monthIndex)) return '';
  const row = climate.find((c) => c.month === MONTHS[monthIndex]);
  if (!row) return '';
  let label: string;
  if (row.tempMaxC >= 24) label = 'Warm';
  else if (row.tempMaxC >= 18) label = 'Mild';
  else if (row.tempMaxC >= 10) label = 'Cool';
  else label = 'Cold';
  label += row.precipMm > 80 ? ' & wet' : ' & dry';
  return `${label} (~${Math.round(row.tempMaxC)}°C)`;
}

const SUMMARY_RE = /\bsummar(y|ise|ize|ising|izing)\b|\btrip summary\b|\btotal (cost|price|spend|budget)\b|\bbudget\b|\bhow much\b.*\b(cost|total|come to)\b|\bwhat.?s the total\b/i;

/** Detect a request to see the trip summary / budget, or to convert it to EUR. */
export function isSummaryQuery(message: string, _history: ChatMessage[] = []): boolean {
  return SUMMARY_RE.test(message) || isEurRequest(message);
}

/** Detect a request to show the total in euros (AC-007-2). */
export function isEurRequest(message: string): boolean {
  const text = message.toLowerCase();
  if (!/\beuros?\b|\beur\b|€/.test(text)) return false;
  return /\b(show|convert|see|in|to|display|give|what)\b/.test(text);
}
