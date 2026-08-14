import { createHmac, randomUUID } from 'node:crypto';
import type { FlightOption, HotelOption, TravelSearchRequest } from '../../../shared/types/flight-hotel-search-booking.js';
import type { Money } from '../../../shared/types/flight-hotel-search-booking.js';
import type { LiveTravelResult } from './routestack.js';
import { convertToGBP, offlineConvertToGBP } from './currency.js';
import { logger } from '../logger.js';

/**
 * Real RouteStack sandbox client (ADR-005 direct-HTTPS grounding, mirroring the
 * Open-Meteo approach in ADR-006). Authenticates with an HMAC partner-token
 * exchange, then searches flights and hotels. Responses are normalised into our
 * FlightOption/HotelOption shapes and priced to GBP via the live Currency tool.
 *
 * The sandbox returns real cached data. Parsing is deliberately lenient because
 * the sandbox payload shape is validated at deploy time; any failure throws so
 * the caller falls back to the deterministic offline catalogue and the demo
 * keeps working.
 */

const BASE_URL = process.env.ROUTESTACK_BASE_URL ?? 'https://mcp.routestack.ai';

export function hasRouteStackCredentials(): boolean {
  return Boolean(process.env.ROUTESTACK_API_KEY && process.env.ROUTESTACK_SECRET);
}

/** Exchange partner credentials for a short-lived JWT bearer token. */
async function partnerToken(): Promise<string> {
  const apiKey = process.env.ROUTESTACK_API_KEY!;
  const secret = process.env.ROUTESTACK_SECRET!;
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  // HMAC of apiKey:timestamp:nonce, base64url-encoded (matches the RouteStack reference client).
  const hmac = createHmac('sha256', secret).update(`${apiKey}:${timestamp}:${nonce}`).digest('base64url');

  const res = await fetch(`${BASE_URL}/mcp/auth/partner-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, timestamp, nonce, hmac }),
  });
  if (!res.ok) throw new Error(`routestack partner-token ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const token = pickString(data, ['token', 'jwt', 'access_token', 'bearer']);
  if (!token) throw new Error('routestack partner-token: no token in response');
  return token;
}

async function post(path: string, token: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`routestack ${path} ${res.status} ${text.slice(0, 400)}`);
  }
  return res.json();
}

/**
 * Resolve a bearer token. Prefer the HMAC partner-token exchange; if it is
 * rejected (some sandbox deployments do not use it), fall back to the API key
 * as a direct bearer, which the RouteStack reference client also supports.
 */
async function authToken(): Promise<string> {
  try {
    return await partnerToken();
  } catch (err) {
    logger.warn({ err: String(err) }, 'RouteStack partner-token failed; trying the API key as a direct bearer');
    return process.env.ROUTESTACK_API_KEY!;
  }
}

/**
 * Search live flights and hotels for a trip. Flights and hotels are fetched
 * independently so a failure in one still yields the other; the caller keeps its
 * offline data for whichever side is empty. Throws only if BOTH sides fail.
 */
export async function searchLiveTravel(request: TravelSearchRequest): Promise<LiveTravelResult> {
  const token = await authToken();

  const [flightsRes, hotelsRes] = await Promise.allSettled([
    searchLiveFlights(request, token),
    searchLiveHotels(request, token),
  ]);

  const flights = flightsRes.status === 'fulfilled' ? flightsRes.value : [];
  const hotelsOut = hotelsRes.status === 'fulfilled' ? hotelsRes.value : { hotels: [] as HotelOption[], place: undefined };
  if (flightsRes.status === 'rejected') logger.warn({ err: String(flightsRes.reason) }, 'RouteStack flight search failed');
  if (hotelsRes.status === 'rejected') logger.warn({ err: String(hotelsRes.reason) }, 'RouteStack hotel search failed');
  const hotels = hotelsOut.hotels;
  if (flights.length === 0 && hotels.length === 0) throw new Error('routestack: no live flights or hotels');

  const currency = flights[0]?.pricePerTraveller.source.currency ?? hotels[0]?.nightlyRate.source.currency ?? 'GBP';
  return { flights, hotels, currency, place: hotelsOut.place };
}

/** Live flights via the flight locations → search flow. Best-effort; returns [] when the sandbox has no match. */
async function searchLiveFlights(request: TravelSearchRequest, token: string): Promise<FlightOption[]> {
  const [originLoc, destLoc] = await Promise.all([
    post('/mcp/flight/locations', token, { term: request.origin }).catch(() => undefined),
    post('/mcp/flight/locations', token, { term: request.destination }).catch(() => undefined),
  ]);
  const originCode = pickString(firstArray(originLoc?.result)[0], ['code', 'iata', 'airportCode', 'id']) ?? request.origin;
  const destCode = pickString(firstArray(destLoc?.result)[0], ['code', 'iata', 'airportCode', 'id']) ?? request.destination;

  const raw = await post('/mcp/flight/search', token, {
    origin: originCode,
    destination: destCode,
    departureDate: request.checkIn,
    returnDate: request.checkOut,
    adults: request.party,
    children: 0,
    infants: 0,
    cabinClass: 'Economy',
    tripType: 'RoundTrip',
    currency: 'GBP',
  });
  // The sandbox returns { success:false, code:'1051' } when no flights match; keep offline flights in that case.
  if (raw?.success === false || !raw?.result) return [];
  const items = firstArray(raw.result).slice(0, 3);
  return Promise.all(items.map((item, index) => normaliseFlight(item, request, index === 0)));
}

/** Live hotels via the documented search-destinations → search-hotels flow. */
async function searchLiveHotels(request: TravelSearchRequest, token: string): Promise<{ hotels: HotelOption[]; place?: string }> {
  const destination = await post('/mcp/hotel/search-destinations', token, { type: 'DESTINATION', query: request.destination });
  const dest = firstArray(destination?.result)[0] as Record<string, any> | undefined;
  if (!dest) return { hotels: [] };
  const place = pickString(dest, ['fullName', 'name']);
  // Coordinates are nested under `coordinates`; destinationId is `id`.
  const coords = (dest.coordinates ?? {}) as Record<string, any>;
  const lat = pickNumber(coords, ['lat', 'latitude']) ?? pickNumber(dest, ['lat', 'latitude']);
  const long = pickNumber(coords, ['long', 'lng', 'longitude']) ?? pickNumber(dest, ['long', 'longitude']);
  const destinationId = pickString(dest, ['id', 'destinationId', 'referenceId']);

  const hotelsRaw = await post('/mcp/hotel/search-hotels', token, {
    destinationId,
    destinationType: 'DESTINATION',
    currency: 'GBP',
    lat,
    long,
    checkIn: request.checkIn,
    checkOut: request.checkOut,
    roomCount: request.rooms ?? 1,
    rooms: [{ adults: request.party }],
  });
  const currency = pickString(hotelsRaw?.result, ['currency']) ?? 'GBP';
  const nightsCount = Math.max(1, Math.round((Date.parse(request.checkOut) - Date.parse(request.checkIn)) / 86_400_000));
  const items = firstArray(hotelsRaw?.result?.result ?? hotelsRaw?.result).slice(0, 3);
  const hotels = await Promise.all(items.map((item, index) => normaliseHotel(item, currency, nightsCount, index === 0)));
  return { hotels, place };
}

async function priceToGBP(money: Money) {
  try {
    return await convertToGBP(money);
  } catch (err) {
    logger.warn({ err: String(err) }, 'currency conversion failed; using offline rate');
    return offlineConvertToGBP(money);
  }
}

async function normaliseFlight(item: Record<string, any>, request: TravelSearchRequest, best: boolean): Promise<FlightOption> {
  // A flight offer carries its itinerary legs (outbound legindicator 0, return 1)
  // and a party-total price; derive the per-traveller price.
  const legs = Array.isArray(item.flights) ? (item.flights as Record<string, any>[]) : [];
  const first = legs[0] ?? {};
  const outbound = legs.filter((l) => l.legindicator === 0);
  const lastOutbound = outbound[outbound.length - 1] ?? first;
  const durationMin = (outbound.length ? outbound : [first]).reduce((sum, l) => sum + (Number(l.triptime) || 0), 0);
  const quantity = Number(item.quantity) || request.party || 1;
  const total = pickNumber(item, ['ourprice', 'showOurprice', 'totalFare', 'convertedCoin', 'coin']) ?? 0;
  const currency = pickString(item, ['currency', 'coinType']) ?? 'GBP';
  const source: Money = { amount: Math.round((total / Math.max(1, quantity)) * 100) / 100, currency, includesTaxesAndFees: true };
  const code = pickString(first, ['flightCode', 'airlineCode']);
  const num = pickString(first, ['flightNumber']);
  return {
    airline: pickString(first, ['airline', 'airlineName']) ?? 'Airline',
    from: pickString(first, ['departure', 'departurelocation']) ?? request.origin ?? '',
    to: pickString(lastOutbound, ['arrival', 'arrivallocation']) ?? request.destination,
    durationMin,
    stops: pickNumber(item, ['stops']) ?? Math.max(0, outbound.length - 1),
    pricePerTraveller: await priceToGBP(source),
    flightNumber: code && num ? `${code}${num}` : (num ?? undefined),
    departTime: hhmm(pickString(first, ['departureTime'])),
    arriveTime: hhmm(pickString(lastOutbound, ['arrivalTime'])),
    ...(best ? { best: true } : {}),
  };
}

async function normaliseHotel(item: Record<string, any>, currency: string, nights: number, best: boolean): Promise<HotelOption> {
  // RouteStack quotes a total-stay price; divide by nights for the per-night rate.
  const total = pickNumber(item, ['ourprice', 'publishedRate', 'price', 'nightlyRate', 'rate', 'amount', 'minRate']) ?? 0;
  const nightly = Math.round((total / Math.max(1, nights)) * 100) / 100;
  const source: Money = { amount: nightly, currency, includesTaxesAndFees: Boolean(item.taxesIncluded ?? item.includesTaxesAndFees) };
  return {
    name: pickString(item, ['name', 'hotelName', 'title']) ?? 'Hotel',
    rating: pickNumber(item, ['starRating', 'rating', 'stars', 'category']) ?? 3,
    nightlyRate: await priceToGBP(source),
    address: pickString(item, ['address', 'fullAddress', 'hotelAddress', 'location', 'addressLine']),
    ...(best ? { best: true } : {}),
  };
}

// ── Lenient extractors (the sandbox payload shape is validated at deploy) ──

/** "2026-10-14T06:15:00" → "06:15". */
function hhmm(value: string | undefined): string | undefined {
  const match = value?.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : undefined;
}

function firstArray(value: unknown): Record<string, any>[] {
  if (Array.isArray(value)) return value as Record<string, any>[];
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) if (Array.isArray(v)) return v as Record<string, any>[];
  }
  return [];
}

function pickString(obj: Record<string, any> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

function pickNumber(obj: Record<string, any> | undefined, keys: string[]): number | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}
