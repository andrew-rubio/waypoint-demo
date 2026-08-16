import { z } from 'zod';
import type {
  BookingConfirmation,
  FlightOption,
  HotelOption,
  Money,
  TravelSearchRequest,
  TravelSearchResult,
} from '../../../shared/types/flight-hotel-search-booking.js';
import type { ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { offlineConvertToGBP } from './currency.js';

/**
 * FRD-005 travel-search + booking-simulator tool.
 *
 * Grounds flight/hotel search in the RouteStack sandbox (real cached data) and
 * normalises supplier prices to GBP via the Currency tool. In test/offline mode
 * a deterministic embedded catalogue backs the search so the demo and the tests
 * are reproducible — the real RouteStack HTTPS client lives in the Copilot
 * driver. Booking is always simulated: a deterministic mock confirmation with no
 * payment and no real reservation.
 */

const requestSchema = z.object({
  destination: z.string().trim().min(1),
  origin: z.string().trim().min(1).optional(),
  checkIn: z.string().trim().min(1),
  checkOut: z.string().trim().min(1),
  party: z.number().int().positive(),
  rooms: z.number().int().positive().optional(),
});

/** SDK-facing JSON schema. The agent supplies the trip inputs; the tool searches and prices. */
export const travelSearchParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['destination', 'checkIn', 'checkOut', 'party'],
  properties: {
    destination: { type: 'string', description: 'The destination the traveller wants to visit.' },
    origin: { type: 'string', description: 'Departure city or airport; omit if the traveller has not given one.' },
    checkIn: { type: 'string', description: 'Outbound date, ISO 8601 (yyyy-mm-dd).' },
    checkOut: { type: 'string', description: 'Return date, ISO 8601 (yyyy-mm-dd).' },
    party: { type: 'number', description: 'Number of travellers.' },
    rooms: { type: 'number', description: 'Number of hotel rooms (defaults to 1).' },
  },
} as const;

/** SDK-facing JSON schema for the simulated booking. */
export const bookingSimulatorParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    flightIndex: { type: 'number', description: 'Zero-based index of the chosen flight (0 = first).' },
    hotelIndex: { type: 'number', description: 'Zero-based index of the chosen hotel (0 = first).' },
  },
} as const;

/** The most travellers the sandbox demo will search for before capping. */
const MAX_PARTY = 9;

interface CatalogueFlight {
  airline: string;
  durationMin: number;
  stops: number;
  amount: number;
  best?: boolean;
}

interface CatalogueHotel {
  name: string;
  rating: number;
  amount: number;
  includesTaxesAndFees: boolean;
  address?: string;
  best?: boolean;
}

interface CityInventory {
  place: string;
  iata: string;
  currency: string;
  flights: CatalogueFlight[];
  hotels: CatalogueHotel[];
}

/** IATA codes for common departure cities so the flight legs read realistically. */
const ORIGIN_IATA: Record<string, string> = {
  london: 'LON',
  manchester: 'MAN',
  edinburgh: 'EDI',
  dublin: 'DUB',
  paris: 'PAR',
  amsterdam: 'AMS',
  madrid: 'MAD',
};

/**
 * Deterministic sandbox catalogue (real-city, cached-style data). Prices are in
 * each supplier's own currency to exercise the GBP normalisation path. Aligned
 * with the destination pool and the weather climate table so the flows connect.
 */
const CATALOGUE: Record<string, CityInventory> = {
  lisbon: {
    place: 'Lisbon, Portugal',
    iata: 'LIS',
    currency: 'EUR',
    flights: [
      { airline: 'TAP Air Portugal', durationMin: 165, stops: 0, amount: 148, best: true },
      { airline: 'British Airways', durationMin: 170, stops: 0, amount: 172 },
      { airline: 'easyJet', durationMin: 175, stops: 0, amount: 114 },
    ],
    hotels: [
      { name: 'Hotel do Mar', rating: 4, amount: 132, includesTaxesAndFees: true, best: true },
      { name: 'Baixa Boutique', rating: 4, amount: 156, includesTaxesAndFees: false },
      { name: 'Tejo Riverside', rating: 3, amount: 98, includesTaxesAndFees: true },
    ],
  },
  barcelona: {
    place: 'Barcelona, Spain',
    iata: 'BCN',
    currency: 'EUR',
    flights: [
      { airline: 'Vueling', durationMin: 130, stops: 0, amount: 96, best: true },
      { airline: 'British Airways', durationMin: 135, stops: 0, amount: 158 },
      { airline: 'Ryanair', durationMin: 140, stops: 0, amount: 82 },
    ],
    hotels: [
      { name: 'Gòtic Rambla', rating: 4, amount: 145, includesTaxesAndFees: true, best: true },
      { name: 'Eixample Suites', rating: 4, amount: 168, includesTaxesAndFees: false },
      { name: 'Barceloneta Beach Inn', rating: 3, amount: 112, includesTaxesAndFees: true },
    ],
  },
  rome: {
    place: 'Rome, Italy',
    iata: 'FCO',
    currency: 'EUR',
    flights: [
      { airline: 'ITA Airways', durationMin: 155, stops: 0, amount: 162, best: true },
      { airline: 'British Airways', durationMin: 150, stops: 0, amount: 188 },
      { airline: 'Wizz Air', durationMin: 160, stops: 1, amount: 119 },
    ],
    hotels: [
      { name: 'Trastevere Grand', rating: 4, amount: 175, includesTaxesAndFees: true, best: true },
      { name: 'Colosseo Suites', rating: 4, amount: 198, includesTaxesAndFees: false },
      { name: 'Termini Comfort', rating: 3, amount: 121, includesTaxesAndFees: true },
    ],
  },
  reykjavik: {
    place: 'Reykjavík, Iceland',
    iata: 'KEF',
    currency: 'ISK',
    flights: [
      { airline: 'Icelandair', durationMin: 195, stops: 0, amount: 41200, best: true },
      { airline: 'British Airways', durationMin: 200, stops: 0, amount: 52800 },
      { airline: 'Play', durationMin: 205, stops: 0, amount: 32600 },
    ],
    hotels: [
      { name: 'Harpa Harbour Hotel', rating: 4, amount: 31800, includesTaxesAndFees: true, best: true },
      { name: 'Laugavegur Lofts', rating: 4, amount: 36400, includesTaxesAndFees: false },
      { name: 'Aurora Guesthouse', rating: 3, amount: 24900, includesTaxesAndFees: true },
    ],
  },
  amsterdam: {
    place: 'Amsterdam, Netherlands',
    iata: 'AMS',
    currency: 'EUR',
    flights: [
      { airline: 'KLM', durationMin: 80, stops: 0, amount: 128, best: true },
      { airline: 'British Airways', durationMin: 85, stops: 0, amount: 152 },
      { airline: 'easyJet', durationMin: 90, stops: 0, amount: 89 },
    ],
    hotels: [
      { name: 'Canal House', rating: 4, amount: 168, includesTaxesAndFees: true, best: true },
      { name: 'Jordaan Boutique', rating: 4, amount: 189, includesTaxesAndFees: false },
      { name: 'Museumplein Inn', rating: 3, amount: 124, includesTaxesAndFees: true },
    ],
  },
  innsbruck: {
    place: 'Innsbruck, Austria',
    iata: 'INN',
    currency: 'EUR',
    flights: [
      { airline: 'Austrian Airlines', durationMin: 150, stops: 0, amount: 176, best: true },
      { airline: 'British Airways', durationMin: 175, stops: 1, amount: 204 },
      { airline: 'easyJet', durationMin: 145, stops: 0, amount: 138 },
    ],
    hotels: [
      { name: 'Alpin Resort', rating: 4, amount: 158, includesTaxesAndFees: true, best: true },
      { name: 'Altstadt Lodge', rating: 4, amount: 182, includesTaxesAndFees: false },
      { name: 'Nordkette View', rating: 3, amount: 116, includesTaxesAndFees: true },
    ],
  },
};

/** Covered cities that deliberately return no inventory, to exercise the no-availability path. */
const COVERED_NO_INVENTORY = new Set(['faro']);

const cityKey = (destination: string): string => destination.trim().toLowerCase().split(',')[0].trim();

/** IATA marketing codes for the catalogue airlines, to synthesise flight numbers offline. */
const AIRLINE_CODES: Record<string, string> = {
  'TAP Air Portugal': 'TP',
  'British Airways': 'BA',
  easyJet: 'U2',
  Vueling: 'VY',
  Ryanair: 'FR',
  'ITA Airways': 'AZ',
  'Wizz Air': 'W6',
  Icelandair: 'FI',
  Play: 'OG',
  KLM: 'KL',
  'Austrian Airlines': 'OS',
};

const OFFLINE_DEPARTURES = ['07:35', '12:20', '18:50'];

function addMinutes(clock: string, minutes: number): string {
  const [h, m] = clock.split(':').map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Build a GBP-normalised flight from a catalogue entry, with a synthesised number + times (offline). */
function toFlightOption(entry: CatalogueFlight, index: number, fromIata: string, toIata: string, currency: string): FlightOption {
  const source: Money = { amount: entry.amount, currency, includesTaxesAndFees: false };
  const code = AIRLINE_CODES[entry.airline] ?? entry.airline.slice(0, 2).toUpperCase();
  const departTime = OFFLINE_DEPARTURES[index] ?? '09:00';
  return {
    airline: entry.airline,
    from: fromIata,
    to: toIata,
    durationMin: entry.durationMin,
    stops: entry.stops,
    pricePerTraveller: offlineConvertToGBP(source),
    flightNumber: `${code}${2000 + index * 17 + toIata.charCodeAt(0)}`,
    departTime,
    arriveTime: addMinutes(departTime, entry.durationMin),
    ...(entry.best ? { best: true } : {}),
  };
}

/** Build a GBP-normalised hotel from a catalogue entry. */
function toHotelOption(entry: CatalogueHotel, place: string, currency: string): HotelOption {
  const source: Money = { amount: entry.amount, currency, includesTaxesAndFees: entry.includesTaxesAndFees };
  const city = place.split(',')[0].trim();
  return {
    name: entry.name,
    rating: entry.rating,
    nightlyRate: offlineConvertToGBP(source),
    address: entry.address ? `${entry.address}, ${city}` : `Central ${city}`,
    ...(entry.best ? { best: true } : {}),
  };
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = Date.parse(checkOut) - Date.parse(checkIn);
  const nights = Math.round(ms / 86_400_000);
  return nights > 0 ? nights : 1;
}

/** Basic date sanity — null when a date cannot be parsed. */
function validateDates(checkIn: string, checkOut: string): 'past' | 'reversed' | null {
  const inMs = Date.parse(checkIn);
  const outMs = Date.parse(checkOut);
  if (Number.isNaN(inMs) || Number.isNaN(outMs)) return null;
  const todayMs = Date.parse(new Date().toISOString().slice(0, 10));
  if (inMs < todayMs) return 'past';
  if (outMs <= inMs) return 'reversed';
  return null;
}

/**
 * Pure, deterministic travel search shared by the local (offline) driver and the
 * Copilot driver's fallback. Returns one of the TravelSearchResult kinds.
 */
export function searchTravel(raw: TravelSearchRequest): TravelSearchResult {
  // Ask for dates before anything else — never search (or invent) without them.
  if (!raw.checkIn?.trim() || !raw.checkOut?.trim()) {
    return {
      kind: 'missing-dates',
      message: 'When are you travelling? Share your outbound (departure) and return dates and I’ll search flights and hotels.',
    };
  }
  const request = requestSchema.parse(raw);

  const dateProblem = validateDates(request.checkIn, request.checkOut);
  if (dateProblem === 'past') {
    return { kind: 'invalid-dates', reason: 'past', message: 'Those dates are in the past.' };
  }
  if (dateProblem === 'reversed') {
    return { kind: 'invalid-dates', reason: 'reversed', message: 'The return date is before the outbound date.' };
  }

  if (!request.origin) {
    return { kind: 'missing-origin', message: 'I need a departure city before I can search flights.' };
  }

  const key = cityKey(request.destination);
  if (COVERED_NO_INVENTORY.has(key)) {
    return { kind: 'no-results', message: `No availability for ${request.destination} on those dates.` };
  }
  const inventory = CATALOGUE[key];
  if (!inventory) {
    return { kind: 'outside-coverage', message: `The demo sandbox does not cover ${request.destination}.` };
  }

  if (request.party > MAX_PARTY) {
    return {
      kind: 'party-clarify',
      message: `That is a large group of ${request.party}. I will continue with a supported party size of ${MAX_PARTY} travellers.`,
    };
  }

  const fromIata = ORIGIN_IATA[request.origin.trim().toLowerCase()] ?? request.origin.trim().slice(0, 3).toUpperCase();
  const flights = inventory.flights.map((f, i) => toFlightOption(f, i, fromIata, inventory.iata, inventory.currency));
  const hotels = inventory.hotels.map((h) => toHotelOption(h, inventory.place, inventory.currency));

  return {
    kind: 'options',
    place: inventory.place,
    origin: request.origin,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    nights: nightsBetween(request.checkIn, request.checkOut),
    party: request.party,
    flights,
    hotels,
  };
}

/** The supplier currency for a destination (offline), used to drive the currency.convert audit entry. */
export function supplierCurrencyFor(destination: string): string | undefined {
  return CATALOGUE[cityKey(destination)]?.currency;
}

/**
 * Reorder flights so the traveller's preferred airlines come first (each flagged
 * `preferred: true`), backfilled with the rest, capped at `limit` (FR-006-2).
 * Matching is case-insensitive and tolerant of name variants (e.g. "Vueling" vs
 * "Vueling Airlines"). Order within each group is preserved (stable).
 */
export function prioritiseByPreferredAirlines(
  flights: FlightOption[],
  preferredAirlines: string[] = [],
  limit = 3,
): FlightOption[] {
  const wanted = preferredAirlines.map((a) => a.trim().toLowerCase()).filter(Boolean);
  const isPreferred = (airline: string): boolean => {
    const name = airline.trim().toLowerCase();
    return wanted.some((w) => name === w || name.includes(w) || w.includes(name));
  };
  const flagged = flights.map((f) => (isPreferred(f.airline) ? { ...f, preferred: true } : f));
  const preferred = flagged.filter((f) => f.preferred);
  const others = flagged.filter((f) => !f.preferred);
  return [...preferred, ...others].slice(0, limit);
}

/** Live flight/hotel results (from the RouteStack sandbox) to merge with the offline base. */
export interface LiveTravelResult {
  flights: FlightOption[];
  hotels: HotelOption[];
  currency: string;
  place?: string;
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function nights(checkIn: string, checkOut: string): number {
  const n = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Combine the offline search result with live RouteStack results into what the
 * traveller sees. Live results are preferred per side (flights, hotels) and the
 * offline catalogue is the fallback, so any city the live sandbox covers yields
 * bookable options even when it is not in the offline catalogue (BUG-004). Pure
 * so it is unit-testable without the network.
 */
export function mergeTravelResult(
  request: TravelSearchRequest,
  offlineBase: TravelSearchResult,
  live: LiveTravelResult | undefined,
): TravelSearchResult {
  // A user-input problem short-circuits regardless of any live data.
  if (
    offlineBase.kind === 'missing-origin' ||
    offlineBase.kind === 'missing-dates' ||
    offlineBase.kind === 'invalid-dates' ||
    offlineBase.kind === 'party-clarify'
  ) {
    return offlineBase;
  }

  const offlineOptions = offlineBase.kind === 'options' ? offlineBase : undefined;
  const flights = live?.flights.length ? live.flights : (offlineOptions?.flights ?? []);
  const hotels = live?.hotels.length ? live.hotels : (offlineOptions?.hotels ?? []);

  // Nothing anywhere → keep the offline message (no-results / outside-coverage).
  if (flights.length === 0 && hotels.length === 0) return offlineBase;

  return {
    kind: 'options',
    place: offlineOptions?.place ?? live?.place ?? titleCase(request.destination),
    origin: request.origin ?? '',
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    nights: nights(request.checkIn, request.checkOut),
    party: request.party,
    flights,
    hotels,
  };
}

/** Zero-based flight/hotel selection parsed from a booking instruction. */
export interface BookingSelection {
  flightIndex: number;
  hotelIndex: number;
}

const ORDINALS: Record<string, number> = { first: 0, '1st': 0, second: 1, '2nd': 1, third: 2, '3rd': 2 };

function ordinalBefore(message: string, noun: 'flight' | 'hotel'): number {
  const match = message.toLowerCase().match(new RegExp(`(first|second|third|1st|2nd|3rd)\\s+${noun}`));
  return match ? (ORDINALS[match[1]] ?? 0) : 0;
}

export function bookingSelectionFromMessage(message: string): BookingSelection {
  return { flightIndex: ordinalBefore(message, 'flight'), hotelIndex: ordinalBefore(message, 'hotel') };
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

function bookingRef(place: string, checkIn: string): string {
  const iata = CATALOGUE[cityKey(place)]?.iata ?? place.slice(0, 3).toUpperCase();
  const seed = Math.abs(hash(`${place}|${checkIn}`)) % 46656; // 3 base-36 chars
  return `WP-${iata}-${seed.toString(36).toUpperCase().padStart(3, '0')}`;
}

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return h;
}

/**
 * Simulate a booking from a prior search result. Deterministic, no payment, no
 * reservation — the confirmation is clearly a demo mock (FR-005-5/6).
 */
export function simulateBooking(
  options: Extract<TravelSearchResult, { kind: 'options' }>,
  selection: BookingSelection,
  rooms = 1,
): BookingConfirmation {
  const flight = options.flights[Math.min(selection.flightIndex, options.flights.length - 1)];
  const hotel = options.hotels[Math.min(selection.hotelIndex, options.hotels.length - 1)];
  const estimatedTotalGBP = round2(
    flight.pricePerTraveller.amountGBP * options.party + hotel.nightlyRate.amountGBP * options.nights * rooms,
  );
  const itinerary =
    `${flight.airline} ${flight.from}→${flight.to} · ${hotel.name}, ${options.place} · ` +
    `${options.checkIn} to ${options.checkOut} · ${options.party} traveller${options.party === 1 ? '' : 's'}`;
  return { ref: bookingRef(options.place, options.checkIn), simulated: true, itinerary, estimatedTotalGBP };
}

// ── Conversation classification + parsing ────────────────────────────

const MONTHS_RE = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const DAY_MONTH = new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+(of\\s+)?(${MONTHS_RE})\\b|\\b(${MONTHS_RE})\\s+\\d{1,2}\\b`, 'i');
const ISO_DATE_ANY = /\d{4}-\d{2}-\d{2}/;
const SLASH_DATE = /\b\d{1,2}[\/.]\d{1,2}(?:[\/.]\d{2,4})?\b/;
const RELATIVE_DATE = /\b(today|tonight|tomorrow|this (week|weekend)|next (week|weekend|month)|in \d+ (day|days|week|weeks|month|months))\b/i;

/**
 * True when the conversation gives a specific travel-date reference (an ISO date,
 * a day + month like "14 October", a DD/MM date, or a relative term). A bare
 * month alone is NOT enough — the agent should ask for exact dates first.
 */
export function conversationMentionsDates(message: string, history: ChatMessage[] = []): boolean {
  const text = [message, ...history.filter((m) => m.role === 'user').map((m) => m.content)].join(' ');
  return ISO_DATE_ANY.test(text) || SLASH_DATE.test(text) || DAY_MONTH.test(text) || RELATIVE_DATE.test(text);
}

/** Does this turn ask to search flights/hotels (as opposed to booking one)? */
export function isTravelSearchQuery(message: string): boolean {
  const text = message.toLowerCase();
  if (isBookingInstruction(text)) return false;
  const mentionsTravel = /\bflights?\b|\bhotels?\b/.test(text);
  const searchIntent = /\b(find|search|look|show|get|need|want|book)\b/.test(text) || /\b(to|for|from)\b/.test(text);
  return mentionsTravel && searchIntent;
}

/** A pure "book the …" instruction (no dependency on history). */
function isBookingInstruction(text: string): boolean {
  return /\bbook(ing)?\b/.test(text) && /\b(flight|hotel|option|first|second|third|both|it|this|that)\b/.test(text);
}

/** Does this turn ask to book a previously-shown option? Requires a prior search in the conversation. */
export function isBookingQuery(message: string, history: ChatMessage[] = []): boolean {
  if (!isBookingInstruction(message.toLowerCase())) return false;
  return history.some((m) => m.role === 'user' && isTravelSearchQuery(m.content));
}

const ISO_DATE = /(\d{4}-\d{2}-\d{2})/g;

/** Parse a free-text search turn into a structured request (origin may be absent). */
export function travelRequestFromConversation(message: string, history: ChatMessage[] = []): TravelSearchRequest {
  const dates = message.match(ISO_DATE) ?? [];
  const [checkIn = '', checkOut = ''] = dates;
  return {
    destination: extractDestination(message) ?? mostRecentDestination(history) ?? '',
    origin: extractOrigin(message) ?? mostRecentOrigin(history),
    checkIn,
    checkOut,
    party: extractParty(message) ?? 2,
    rooms: extractRooms(message),
  };
}

/** Rebuild the most recent search request from the conversation, for booking. */
export function lastSearchRequest(history: ChatMessage[]): TravelSearchRequest | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m.role === 'user' && isTravelSearchQuery(m.content)) {
      return travelRequestFromConversation(m.content, history.slice(0, i + 1));
    }
  }
  return undefined;
}

function extractDestination(message: string): string | undefined {
  const match = message.match(/\bto\s+([A-Za-zÀ-ÿ'’.\- ]+?)(?=\s+from\b|\s+for\b|\s+on\b|\s+outbound\b|\s+returning\b|[,.!?]|$)/i);
  return match ? cleanPlace(match[1]) : undefined;
}

function extractOrigin(message: string): string | undefined {
  const match = message.match(/\bfrom\s+([A-Za-zÀ-ÿ'’.\- ]+?)(?=\s+to\b|\s+for\b|\s+on\b|\s+outbound\b|\s+returning\b|[,.!?]|$)/i);
  return match ? cleanPlace(match[1]) : undefined;
}

function extractParty(message: string): number | undefined {
  const match = message.match(/\b(?:for|party of|group of)\s+(\d+)\b|\b(\d+)\s+(?:travellers?|people|adults?|guests?|passengers?)\b/i);
  if (!match) return undefined;
  const value = Number(match[1] ?? match[2]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractRooms(message: string): number | undefined {
  const match = message.match(/\b(\d+)\s+rooms?\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function cleanPlace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function mostRecentDestination(history: ChatMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const found = extractDestination(history[i].content);
    if (found) return found;
  }
  return undefined;
}

function mostRecentOrigin(history: ChatMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const found = extractOrigin(history[i].content);
    if (found) return found;
  }
  return undefined;
}
