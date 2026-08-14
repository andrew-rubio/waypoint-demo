/**
 * Shared contract for the FRD-005 flight & hotel search + simulated booking
 * (INC-5). The agent searches the RouteStack sandbox for flights and hotels,
 * preserves each supplier's currency, normalises display prices to GBP through
 * the Currency service (Frankfurter/ECB), and lets the traveller "book" a
 * selection — which produces a clearly-simulated confirmation only. No payment
 * is ever taken and no real reservation is made.
 *
 * In production the agent fills these shapes from the RouteStack + Currency
 * MCP/HTTP calls; offline (tests/demo) the trusted travel-search tool falls
 * back to a deterministic embedded catalogue.
 */

/** A price as quoted by a supplier, in its own ISO 4217 currency. */
export interface Money {
  amount: number;
  currency: string;
  /** Whether the amount already includes taxes and fees. */
  includesTaxesAndFees: boolean;
}

/** A supplier price normalised to GBP, with the rate and when it was taken (FR-005-4). */
export interface ConvertedMoney {
  source: Money;
  amountGBP: number;
  /** GBP per one unit of the source currency (1 when the supplier already quotes GBP). */
  rate: number;
  /** ISO 8601 timestamp of the exchange rate used. */
  rateTimestamp: string;
}

export interface FlightOption {
  airline: string;
  /** Origin IATA/city, e.g. "LON". */
  from: string;
  /** Destination IATA/city, e.g. "LIS". */
  to: string;
  durationMin: number;
  stops: number;
  pricePerTraveller: ConvertedMoney;
  /** Marketing flight number, e.g. "TP2039". */
  flightNumber?: string;
  /** Outbound departure clock time, e.g. "08:15". */
  departTime?: string;
  /** Outbound arrival clock time, e.g. "10:40". */
  arriveTime?: string;
  best?: boolean;
}

export interface HotelOption {
  name: string;
  /** Star rating, e.g. 4. */
  rating: number;
  nightlyRate: ConvertedMoney;
  /** Street/area address, e.g. "Av. da Liberdade 12, Lisbon". */
  address?: string;
  best?: boolean;
}

/** The structured inputs the trusted travel-search tool needs to search. */
export interface TravelSearchRequest {
  destination: string;
  origin?: string;
  /** Outbound date, ISO 8601 (yyyy-mm-dd). */
  checkIn: string;
  /** Return date, ISO 8601 (yyyy-mm-dd). */
  checkOut: string;
  party: number;
  rooms?: number;
}

export interface TravelOptionsResult {
  kind: 'options';
  /** Canonical resolved destination, e.g. "Lisbon, Portugal". */
  place: string;
  origin: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  party: number;
  flights: FlightOption[];
  hotels: HotelOption[];
  message?: string;
}

export interface TravelMissingOriginResult {
  kind: 'missing-origin';
  message: string;
}

export interface TravelInvalidDatesResult {
  kind: 'invalid-dates';
  reason: 'past' | 'reversed';
  message: string;
}

export interface TravelNoResultsResult {
  kind: 'no-results';
  message: string;
}

export interface TravelOutsideCoverageResult {
  kind: 'outside-coverage';
  message: string;
}

export interface TravelPartyClarifyResult {
  kind: 'party-clarify';
  message: string;
}

export type TravelSearchResult =
  | TravelOptionsResult
  | TravelMissingOriginResult
  | TravelInvalidDatesResult
  | TravelNoResultsResult
  | TravelOutsideCoverageResult
  | TravelPartyClarifyResult;

/** The travel-search result that renders as flight/hotel cards; other kinds are reply text only. */
export type TravelCardResult = TravelOptionsResult;

/** A clearly-simulated booking confirmation — no payment, no real reservation (FR-005-5/6). */
export interface BookingConfirmation {
  ref: string;
  simulated: true;
  /** Human-readable itinerary echo, e.g. "TAP LON→LIS · Hotel do Mar, Lisbon · 14–21 Oct". */
  itinerary: string;
  estimatedTotalGBP: number;
}
