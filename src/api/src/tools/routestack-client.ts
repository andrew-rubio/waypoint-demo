import { createHmac, randomUUID } from 'node:crypto';
import type { FlightOption, HotelOption, TravelSearchRequest } from '../../../shared/types/flight-hotel-search-booking.js';
import type { Money } from '../../../shared/types/flight-hotel-search-booking.js';
import type { LiveTravelResult } from './routestack.js';
import { convertToGBP, offlineConvertToGBP } from './currency.js';
import { logger } from '../logger.js';

/**
 * Real RouteStack MCP client (ADR-005 direct-HTTPS grounding, mirroring the
 * Open-Meteo approach in ADR-006). Authenticates with an HMAC partner-token
 * exchange, then searches flights and hotels. Responses are normalised into our
 * FlightOption/HotelOption shapes and priced to GBP via the live Currency tool.
 *
 * The data tier follows the credentials: with production RouteStack keys this is
 * live production data. The endpoint is `ROUTESTACK_BASE_URL` (default
 * `https://mcp.routestack.ai`). Parsing is deliberately lenient; any failure
 * throws so the caller falls back to the deterministic offline catalogue and the
 * demo keeps working.
 */

const BASE_URL = process.env.ROUTESTACK_BASE_URL ?? 'https://mcp.routestack.ai';

// RouteStack's live availability search is heavy, so cap each call and fail fast
// to the offline catalogue rather than letting a slow provider hang the whole
// turn (a stalled search previously blocked for ~48s with no timeout).
const AUTH_TIMEOUT_MS = 6_000;
const LOOKUP_TIMEOUT_MS = 8_000;
const SEARCH_TIMEOUT_MS = 18_000;

// Cache the partner token across searches so we pay the auth round trip once per
// token lifetime instead of on every request (it sits on the critical path
// before the flight/hotel fan-out).
let cachedToken: { token: string; expiresAt: number } | undefined;

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
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`routestack partner-token ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  const token = pickString(data, ['token', 'jwt', 'access_token', 'bearer']);
  if (!token) throw new Error('routestack partner-token: no token in response');
  return token;
}

/** Milliseconds until a JWT expires (30s early), or a conservative default. */
function tokenTtlMs(token: string): number {
  const DEFAULT_TTL = 4 * 60_000;
  const parts = token.split('.');
  if (parts.length !== 3) return DEFAULT_TTL;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: number };
    if (typeof payload.exp === 'number') {
      const ms = payload.exp * 1000 - Date.now() - 30_000;
      return ms > 30_000 ? ms : DEFAULT_TTL;
    }
  } catch {
    // Not a JWT (e.g. an opaque bearer); fall back to the default TTL.
  }
  return DEFAULT_TTL;
}

async function post(path: string, token: string, body: unknown, timeoutMs = SEARCH_TIMEOUT_MS): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
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
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  try {
    const token = await partnerToken();
    cachedToken = { token, expiresAt: Date.now() + tokenTtlMs(token) };
    return token;
  } catch (err) {
    logger.warn({ err: String(err) }, 'RouteStack partner-token failed; trying the API key as a direct bearer');
    return process.env.ROUTESTACK_API_KEY!;
  }
}

/**
 * Curated city → IATA map so we search the RIGHT airport. RouteStack's location
 * lookup returns many matches and the first is often wrong (e.g. "Lisbon" → ZYD, a
 * rail code, instead of LIS). City-aggregate codes ("all airports": LON, PAR, ROM,
 * NYC, TYO) search every airport for that city and return the most options. For a
 * city not listed, we fall back to the lookup's "all airports"/"international"
 * candidate, else the first match.
 */
const CITY_IATA: Record<string, string> = {
  london: 'LON', manchester: 'MAN', edinburgh: 'EDI', glasgow: 'GLA', birmingham: 'BHX', dublin: 'DUB', galway: 'NOC',
  lisbon: 'LIS', porto: 'OPO', madrid: 'MAD', barcelona: 'BCN', valencia: 'VLC', seville: 'SVQ', 'san sebastián': 'EAS', 'san sebastian': 'EAS', malaga: 'AGP', bilbao: 'BIO', palma: 'PMI', ibiza: 'IBZ',
  paris: 'PAR', nice: 'NCE', marseille: 'MRS', lyon: 'LYS', corsica: 'AJA', amsterdam: 'AMS', brussels: 'BRU',
  rome: 'ROM', milan: 'MIL', venice: 'VCE', florence: 'FLR', tuscany: 'FLR', naples: 'NAP', athens: 'ATH', crete: 'HER', chania: 'CHQ', corfu: 'CFU', santorini: 'JTR', split: 'SPU', 'dalmatian coast': 'SPU', dubrovnik: 'DBV', istanbul: 'IST', antalya: 'AYT', 'lycian coast': 'AYT', 'lake bled': 'LJU', slovenia: 'LJU',
  vienna: 'VIE', salzburg: 'SZG', innsbruck: 'INN', zurich: 'ZRH', geneva: 'GVA', lucerne: 'ZRH', zermatt: 'ZRH', munich: 'MUC', berlin: 'BER', frankfurt: 'FRA', hamburg: 'HAM', 'black forest': 'STR', prague: 'PRG', budapest: 'BUD', warsaw: 'WAW', copenhagen: 'CPH', stockholm: 'STO', oslo: 'OSL', bergen: 'BGO', 'tromsø': 'TOS', tromso: 'TOS', svalbard: 'LYR', helsinki: 'HEL', lapland: 'RVN', reykjavik: 'KEF', 'reykjavík': 'KEF',
  'new york': 'NYC', boston: 'BOS', washington: 'WAS', chicago: 'CHI', miami: 'MIA', 'los angeles': 'LAX', 'san francisco': 'SFO', 'las vegas': 'LAS', seattle: 'SEA', denver: 'DEN', 'jackson hole': 'JAC', albuquerque: 'ABQ', 'santa fe': 'SAF', ottawa: 'YOW', toronto: 'YYZ', montreal: 'YUL', vancouver: 'YVR', calgary: 'YYC',
  'mexico city': 'MEX', cancun: 'CUN', oaxaca: 'OAX', havana: 'HAV', 'buenos aires': 'BUE', santiago: 'SCL', lima: 'LIM', cusco: 'CUZ', 'machu picchu': 'CUZ', 'rio de janeiro': 'RIO', bogota: 'BOG', quito: 'UIO', 'the bahamas': 'NAS', bahamas: 'NAS', tortola: 'EIS', 'san pedro de atacama': 'CJC',
  dubai: 'DXB', 'abu dhabi': 'AUH', doha: 'DOH', cairo: 'CAI', marrakech: 'RAK', casablanca: 'CMN', 'cape town': 'CPT', johannesburg: 'JNB', nairobi: 'NBO', kilimanjaro: 'JRO', windhoek: 'WDH',
  tokyo: 'TYO', kyoto: 'OSA', osaka: 'OSA', beijing: 'BJS', shanghai: 'SHA', 'hong kong': 'HKG', seoul: 'SEL', singapore: 'SIN', bangkok: 'BKK', phuket: 'HKT', 'kuala lumpur': 'KUL', bali: 'DPS', delhi: 'DEL', agra: 'DEL', mumbai: 'BOM', kerala: 'COK', colombo: 'CMB', kandy: 'CMB', hanoi: 'HAN', 'hoi an': 'DAD', sydney: 'SYD', melbourne: 'MEL', brisbane: 'BNE', 'the maldives': 'MLE', maldives: 'MLE',
};

/**
 * Resolve the best airport code for a place. Prefers the curated city map, then a
 * lookup candidate whose name is an "all airports" aggregate or "international"
 * airport, then the first match. Fixes RouteStack returning zero flights when its
 * first lookup match is an obscure airport (e.g. Lisbon → ZYD not LIS).
 */
function bestAirportCode(term: string, locResponse: any): string {
  const city = term.split(',')[0].trim().toLowerCase();
  if (CITY_IATA[city]) return CITY_IATA[city];
  const cands = firstArray(locResponse?.result)
    .map((c) => ({ code: pickString(c, ['code', 'iata', 'airportCode', 'id']), name: (pickString(c, ['name', 'cityName', 'city', 'fullName']) ?? '').toLowerCase() }))
    .filter((c): c is { code: string; name: string } => Boolean(c.code));
  return (
    cands.find((c) => c.name.includes('all airports'))?.code ??
    cands.find((c) => /international|\bintl\b/.test(c.name))?.code ??
    cands[0]?.code ??
    city.toUpperCase().slice(0, 3)
  );
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
    post('/mcp/flight/locations', token, { term: request.origin }, LOOKUP_TIMEOUT_MS).catch(() => undefined),
    post('/mcp/flight/locations', token, { term: request.destination }, LOOKUP_TIMEOUT_MS).catch(() => undefined),
  ]);
  const originCode = bestAirportCode(request.origin ?? 'London', originLoc);
  const destCode = bestAirportCode(request.destination, destLoc);

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
  // Drop ground-transport entries (RouteStack lumps some coach/rail options into
  // flight results), then keep a wider set so the airline-preference ranking has
  // candidates to promote; the caller re-ranks and caps to three.
  const items = firstArray(raw.result).filter((it) => !isGroundTransport(it)).slice(0, 8);
  return Promise.all(items.map((item, index) => normaliseFlight(item, request, index === 0)));
}

/** True when an offer is a coach/rail/ferry option rather than a flight. */
function isGroundTransport(item: Record<string, any>): boolean {
  const legs = Array.isArray(item.flights) ? (item.flights as Record<string, any>[]) : [];
  const airline = String(legs[0]?.airline ?? legs[0]?.airlineName ?? '').toLowerCase();
  return /bus|coach|rail|ferry|shuttle|transfer|train/.test(airline);
}

/** Live hotels via the documented search-destinations → search-hotels flow. */
async function searchLiveHotels(request: TravelSearchRequest, token: string): Promise<{ hotels: HotelOption[]; place?: string }> {
  const destination = await post('/mcp/hotel/search-destinations', token, { type: 'DESTINATION', query: request.destination }, LOOKUP_TIMEOUT_MS);
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
  // Fetch a wider set so the 5/4/3-star spread selection has choices; the caller picks three.
  const items = firstArray(hotelsRaw?.result?.result ?? hotelsRaw?.result).slice(0, 12);
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
    rating: Math.round(pickNumber(item, ['starRating', 'rating', 'stars', 'category']) ?? 3),
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
