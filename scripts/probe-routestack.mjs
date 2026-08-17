// Probe the live RouteStack API to discover which routes actually return flights.
// Replicates the client's auth + search flow (routestack-client.ts). Read-only.
//
//   # load creds into env (not printed), then:
//   node scripts/probe-routestack.mjs
import { createHmac, randomUUID } from 'node:crypto';

const BASE = process.env.ROUTESTACK_BASE_URL ?? 'https://mcp.routestack.ai';
const API_KEY = process.env.ROUTESTACK_API_KEY;
const SECRET = process.env.ROUTESTACK_SECRET;
const ORIGIN = process.env.PROBE_ORIGIN ?? 'London';
const DEPART = process.env.PROBE_DEPART ?? '2027-02-10';
const RETURN = process.env.PROBE_RETURN ?? '2027-02-24';

// A spread of destinations: catalogue cities + travel-guide picks + big hubs.
const DESTINATIONS = (process.env.PROBE_DESTS ?? [
  'Lisbon', 'Barcelona', 'Paris', 'Amsterdam', 'Madrid', 'Rome',
  'New York', 'Ottawa', 'Toronto', 'Tokyo', 'Dubai', 'Bangkok',
  'Reykjavik', 'Sydney', 'Marrakech', 'Istanbul',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

if (!API_KEY || !SECRET) {
  console.error('ROUTESTACK_API_KEY / ROUTESTACK_SECRET not set in env.');
  process.exit(1);
}

async function partnerToken() {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const hmac = createHmac('sha256', SECRET).update(`${API_KEY}:${timestamp}:${nonce}`).digest('base64url');
  const res = await fetch(`${BASE}/mcp/auth/partner-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: API_KEY, timestamp, nonce, hmac }),
  });
  if (!res.ok) throw new Error(`partner-token ${res.status}`);
  const data = await res.json();
  const token = data.token ?? data.jwt ?? data.access_token ?? data.bearer;
  if (!token) throw new Error('no token');
  return token;
}

async function authToken() {
  try { return await partnerToken(); }
  catch { return API_KEY; }
}

async function post(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, json };
}

function firstArray(v) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') for (const x of Object.values(v)) if (Array.isArray(x)) return x;
  return [];
}
const pick = (o, keys) => { if (!o) return undefined; for (const k of keys) { if (o[k] != null && o[k] !== '') return o[k]; } };

async function resolveCode(token, term) {
  const r = await post('/mcp/flight/locations', token, { term }).catch(() => undefined);
  const first = firstArray(r?.json?.result)[0];
  return pick(first, ['code', 'iata', 'airportCode', 'id']) ?? term;
}

async function probe(token, destination) {
  const [originCode, destCode] = await Promise.all([resolveCode(token, ORIGIN), resolveCode(token, destination)]);
  const r = await post('/mcp/flight/search', token, {
    origin: originCode, destination: destCode,
    departureDate: DEPART, returnDate: RETURN,
    adults: 2, children: 0, infants: 0, cabinClass: 'Economy', tripType: 'RoundTrip', currency: 'GBP',
  });
  const items = firstArray(r.json?.result);
  const sample = items[0]?.flights?.[0] ?? {};
  const airline = pick(sample, ['airline', 'airlineName']);
  const price = pick(items[0] ?? {}, ['ourprice', 'showOurprice', 'totalFare', 'convertedCoin', 'coin']);
  const note = r.json?.success === false ? `no-match(${r.json?.code ?? ''})` : (r.ok ? '' : `http ${r.status}`);
  return { destination, originCode, destCode, flights: items.length, airline, price, note };
}

async function main() {
  console.log(`BASE=${BASE}  ORIGIN=${ORIGIN}  DATES=${DEPART}..${RETURN}`);
  const token = await authToken();
  console.log(`auth: ${token === API_KEY ? 'api-key-as-bearer' : 'partner-token'}\n`);

  // Locations mode: dump the top airport candidates each term resolves to.
  if (process.env.PROBE_MODE === 'locations') {
    for (const term of DESTINATIONS) {
      const r = await post('/mcp/flight/locations', token, { term }).catch((e) => ({ json: { error: String(e) } }));
      const cands = firstArray(r.json?.result).slice(0, 6).map((c) => `${pick(c, ['code', 'iata', 'airportCode', 'id'])}:${pick(c, ['name', 'cityName', 'city', 'fullName']) ?? '?'}(${pick(c, ['type', 'locationType']) ?? '?'})`);
      console.log(term.padEnd(12), cands.join('  |  '));
    }
    return;
  }

  // Codes mode: search explicit ORIG>DEST code pairs (no location resolution).
  if (process.env.PROBE_MODE === 'codes') {
    const pairs = (process.env.PROBE_PAIRS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const pair of pairs) {
      const [origin, destination] = pair.split('>');
      const r = await post('/mcp/flight/search', token, {
        origin, destination, departureDate: DEPART, returnDate: RETURN,
        adults: 2, children: 0, infants: 0, cabinClass: 'Economy', tripType: 'RoundTrip', currency: 'GBP',
      });
      const items = firstArray(r.json?.result);
      const s = items[0]?.flights?.[0] ?? {};
      const note = r.json?.success === false ? `no-match(${r.json?.code ?? ''})` : (r.ok ? `${pick(s, ['airline', 'airlineName']) ?? '?'} ${pick(items[0] ?? {}, ['ourprice', 'showOurprice', 'totalFare']) ?? ''}` : `http ${r.status}`);
      console.log(pair.padEnd(12), String(items.length).padStart(5), '  ' + note);
    }
    return;
  }

  console.log('destination'.padEnd(14), 'orig->dest'.padEnd(14), 'flights', ' sample');
  for (const dest of DESTINATIONS) {
    try {
      const p = await probe(token, dest);
      const route = `${p.originCode}->${p.destCode}`;
      const sample = p.flights > 0 ? `${p.airline ?? '?'} ${p.price ?? ''}` : p.note;
      console.log(dest.padEnd(14), route.padEnd(14), String(p.flights).padStart(5), '  ' + sample);
    } catch (err) {
      console.log(dest.padEnd(14), '(error)'.padEnd(14), '    -', '  ' + String(err).slice(0, 60));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
