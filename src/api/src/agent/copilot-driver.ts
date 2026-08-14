import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import type { AgentDriver, AgentInput } from './driver.js';
import type { ProviderConfig } from '@github/copilot-sdk';
import type { TokenCredential } from '@azure/identity';
import type { DestinationCandidate } from '../../../shared/types/destination-advice.js';
import type { WeatherIntent, WeatherRequest, WeatherResult } from '../../../shared/types/weather-and-timing.js';
import type { TravelSearchRequest, TravelSearchResult } from '../../../shared/types/flight-hotel-search-booking.js';
import { logger } from '../logger.js';
import { waypointSkillSessionConfig } from './runtime-skills.js';
import {
  adviseDestinations,
  destinationAdvisorParameters,
  destinationRequestFromConversation,
} from '../tools/destination-advisor.js';
import { assessWeather, weatherRequestFromConversation, weatherWindowParameters } from '../tools/weather-window.js';
import { climateNormals, geocode } from '../tools/open-meteo.js';
import {
  bookingSelectionFromMessage,
  bookingSimulatorParameters,
  mergeTravelResult,
  searchTravel,
  simulateBooking,
  travelRequestFromConversation,
  travelSearchParameters,
  type LiveTravelResult,
} from '../tools/routestack.js';
import { rememberSearchOptions, resolveBookingOptions } from '../tools/booking-context.js';
import { hasRouteStackCredentials, searchLiveTravel } from '../tools/routestack-client.js';

/**
 * The showcase: a real agent powered by the GitHub Copilot SDK.
 *
 * This is deliberately small — the whole point of the demo is that wiring an
 * agent takes only a handful of calls:
 *   1. `new CopilotClient({ gitHubToken })`  → authenticate
 *   2. `client.createSession({ ... })`        → get a conversation
 *   3. `session.send({ prompt })`             → ask
 *   4. listen for streamed events             → forward to the browser
 *
 * Every observable thing the agent does — a permission decision, an MCP/tool
 * call, its result — is turned into an AgentEvent and streamed out. That stream
 * IS the audit trail. We never forward the model's private reasoning.
 *
 * MCP servers (weather, flights/hotels, currency, Fabric data) are added in
 * later increments; INC-1 only needs chat, but the permission hook and
 * allowlist below are already in place so the audit wiring is demonstrable.
 */

/** The only MCP servers this agent is ever allowed to call (INC-1: none live yet). */
const MCP_ALLOWLIST = ['routestack', 'open-meteo', 'microsoft-fabric-data-agent', 'currency'];

/**
 * Choose a model the current token can actually use. Prefer COPILOT_MODEL, then
 * a sensible fallback order, then whatever the account lists first.
 */
async function pickModel(client: any): Promise<string | undefined> {
  const preferred = ['gpt-4o', 'gpt-4.1', 'claude-sonnet-4.5', 'claude-3.5-sonnet', 'o4-mini', 'gpt-4o-mini'];
  try {
    const models: any[] = (await client.listModels()) ?? [];
    const ids = models.map((m) => m.id ?? m.name ?? m.model).filter(Boolean);
    logger.info({ models: ids }, 'Copilot models available to this token');
    if (process.env.COPILOT_MODEL) return process.env.COPILOT_MODEL;
    return preferred.find((p) => ids.includes(p)) ?? ids[0];
  } catch (err) {
    logger.warn({ err: String(err) }, 'listModels failed; falling back to COPILOT_MODEL/default');
    return process.env.COPILOT_MODEL; // let the SDK apply its own default
  }
}

/**
 * BYOK provider settings for a Microsoft Foundry model deployment (ADR-005).
 * The model is served by Foundry; the GitHub Copilot token is no longer used for
 * inference. Auth is either a Foundry API key or — where policy disables local
 * auth — the Container App's managed identity (Entra).
 */
export interface FoundryProviderConfig {
  /** OpenAI-compatible base URL, e.g. https://<resource>.openai.azure.com/openai/v1/ */
  baseUrl: string;
  /** The Foundry deployment name (e.g. "gpt-5.4-mini"); passed to the SDK as `model`. */
  model: string;
  /** "responses" for GPT-5-series, "completions" for older models. */
  wireApi: 'responses' | 'completions';
  /** API key (BYOK key-based). Omitted when using managed identity. */
  apiKey?: string;
  /** Authenticate the model with the Container App's managed identity (Entra). */
  useManagedIdentity?: boolean;
}

// One credential instance is reused so its internal token cache is effective.
let cachedCredential: TokenCredential | undefined;

/** Build the Copilot SDK provider block for a Foundry model (key or managed identity). */
async function buildFoundryProvider(cfg: FoundryProviderConfig): Promise<ProviderConfig> {
  const base: ProviderConfig = { type: 'openai', baseUrl: cfg.baseUrl, wireApi: cfg.wireApi };
  if (cfg.useManagedIdentity) {
    const { DefaultAzureCredential } = await import('@azure/identity');
    const credential: TokenCredential = (cachedCredential ??= new DefaultAzureCredential());
    return {
      ...base,
      // Entra token for the Azure OpenAI data plane; the SDK calls this per request.
      bearerTokenProvider: async () => {
        const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
        if (!token?.token) throw new Error('Failed to acquire an Entra token for the Foundry model');
        return token.token;
      },
    };
  }
  return { ...base, apiKey: cfg.apiKey };
}

export class CopilotAgentDriver implements AgentDriver {
  // ── B1 / ADR-005: the agent's model is a Microsoft Foundry deployment (BYOK, API key). ──
  constructor(private readonly foundry: FoundryProviderConfig) {}
  // ── ORIGINAL (ADR-002, swapped out): a GitHub Copilot service token. ──
  // constructor(private readonly gitHubToken: string) {}

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    // Lazy import so the SDK (and its bundled runtime) is only loaded when a
    // real credential is present — tests and offline demos never touch it.
    const { CopilotClient, defineTool } = await import('@github/copilot-sdk');

    // ── B1 / ADR-005: BYOK → Microsoft Foundry. No GitHub auth; the model is a
    //    Foundry deployment reached via an OpenAI-compatible endpoint + API key. ──
    const client = new CopilotClient();
    await client.start();
    const model = this.foundry.model;

    // ── ORIGINAL: GitHub Copilot models via COPILOT_GITHUB_TOKEN (kept to show the swap). ──
    // const client = new CopilotClient({ gitHubToken: this.gitHubToken });
    // await client.start();
    // const model = await pickModel(client);

    // A tiny async queue bridges the SDK's callback events into the
    // `for await` stream the route consumes.
    const queue = new EventQueue();
    // Accumulated reply text, echoed into the model's audit entry.
    let reply = '';

    // BYOK provider → a Microsoft Foundry model deployment (ADR-005). This
    // environment disables API keys, so we authenticate with the Container App's
    // managed identity via a bearerTokenProvider (Entra); key-based is the fallback.
    const provider = await buildFoundryProvider(this.foundry);
    const conversationContext = destinationRequestFromConversation(input.message, input.history);
    const destinationAdvisor = defineTool('destination-advisor', {
      description:
        'Recommend a ranked destination shortlist, ask one focused clarification, offer closest alternatives, or redirect non-travel requests.',
      parameters: destinationAdvisorParameters,
      defer: 'never',
      handler: (args) => {
        const proposed = args as { candidates?: DestinationCandidate[] };
        const result = adviseDestinations({ ...conversationContext, candidates: proposed?.candidates });
        queue.push({ type: 'tool_result', name: 'destination-advisor', ok: true, result });
        return result;
      },
    });

    const weatherContext = weatherRequestFromConversation(input.message, input.history);
    const weatherWindow = defineTool('weather-window', {
      description:
        'Answer a weather or best-time-to-travel question for a place. It geocodes the place and reads ERA5 1991–2020 climate normals from Open-Meteo, then returns a grounded monthly summary or best-time window.',
      parameters: weatherWindowParameters,
      defer: 'never',
      handler: async (args) => {
        const proposed = args as Partial<WeatherRequest>;
        const result = await groundWeather(
          {
            place: proposed.place ?? weatherContext.place,
            intent: proposed.intent ?? weatherContext.intent,
            month: proposed.month ?? weatherContext.month,
          },
          (event) => queue.push(event),
        );
        queue.push({ type: 'tool_result', name: 'weather-window', ok: true, result });
        return result;
      },
    });

    const travelContext = travelRequestFromConversation(input.message, input.history);
    const travelSearch = defineTool('travel-search', {
      description:
        'Search flights and hotels for a destination and dates, normalise prices to GBP, and return up to three of each. Ask for a departure city if none is known; flag invalid dates and out-of-coverage destinations.',
      parameters: travelSearchParameters,
      defer: 'never',
      handler: async (args) => {
        const proposed = args as Partial<TravelSearchRequest>;
        const request: TravelSearchRequest = {
          destination: proposed.destination ?? travelContext.destination,
          origin: proposed.origin ?? travelContext.origin,
          checkIn: proposed.checkIn ?? travelContext.checkIn,
          checkOut: proposed.checkOut ?? travelContext.checkOut,
          party: proposed.party ?? travelContext.party,
          rooms: proposed.rooms ?? travelContext.rooms,
        };
        const result = await groundTravel(request, (event) => queue.push(event));
        if (result.kind === 'options') rememberSearchOptions(input.sessionId, result);
        queue.push({ type: 'tool_result', name: 'travel-search', ok: true, result });
        return result;
      },
    });

    const bookingSimulator = defineTool('booking-simulator', {
      description:
        'Produce a clearly-simulated booking confirmation for a chosen flight and hotel from the last search. No payment is taken and no real reservation is made.',
      parameters: bookingSimulatorParameters,
      defer: 'never',
      handler: (args) => {
        const proposed = args as { flightIndex?: number; hotelIndex?: number };
        const selection = {
          flightIndex: proposed.flightIndex ?? bookingSelectionFromMessage(input.message).flightIndex,
          hotelIndex: proposed.hotelIndex ?? bookingSelectionFromMessage(input.message).hotelIndex,
        };
        const options = resolveBookingOptions(input.sessionId, input.history);
        if (!options || options.kind !== 'options') {
          const result = { error: 'No options to book — search for flights and hotels first.' };
          queue.push({ type: 'tool_result', name: 'booking-simulator', ok: false, result: result.error });
          return result;
        }
        const confirmation = simulateBooking(options, selection, 1);
        queue.push({ type: 'tool_result', name: 'booking-simulator', ok: true, result: confirmation });
        return confirmation;
      },
    });

    const session = await client.createSession({
      ...waypointSkillSessionConfig,
      model,
      streaming: true,
      provider,
      tools: [destinationAdvisor, weatherWindow, travelSearch, bookingSimulator],
      systemMessage: {
        mode: 'append',
        content:
          'You are Waypoint, a concise holiday-planning assistant. For destination recommendations, refinements or travel-fit questions, call destination-advisor and propose three to five candidate destinations (each a canonical "City, Country" name with a one-line rationale and matchedPreferences) drawn from the traveller\'s stated preferences. For any weather or best-time-to-travel question, call weather-window with the place (and the month if the traveller named one); it geocodes the place and reads Open-Meteo ERA5 1991–2020 climate normals for you. To search flights and hotels, call travel-search with the destination, departure city, outbound and return dates (ISO yyyy-mm-dd) and party size; it searches the RouteStack sandbox and normalises prices to GBP — if the traveller has not given a departure city, ask for it. When the traveller chooses options to book, call booking-simulator; the booking is always a clearly-labelled demo simulation with no payment. Ground every reply only in the tools\' validated results, preserve canonical place names exactly, always attribute weather figures to Open-Meteo, and never invent prices, weather, availability or travel times.',
      },

      // Called before every tool call. This is where the audit trail is born: we
      // record the decision, enforce the MCP allowlist, then approve.
      onPermissionRequest: (request: any) => {
        const name: string = request.toolName ?? request.kind ?? 'tool';
        queue.push({ type: 'decision', summary: `Use ${name} to help answer the request.` });

        if (request.kind === 'mcp') {
          const server = String(name).split('-')[0];
          if (!MCP_ALLOWLIST.includes(server)) {
            return { kind: 'reject', feedback: `MCP server "${server}" is not allow-listed.` };
          }
        }
        return { kind: 'approve-once' };
      },

      // Observe tool execution start/finish and surface them to the audit trail.
      // destination-advisor and weather-window emit their own results from their
      // handlers (weather-window also emits its nested open-meteo.* calls).
      hooks: {
        onPreToolUse: async (i: any) => {
          queue.push({ type: 'tool_call', name: i.toolName, args: i.toolArgs });
          return { permissionDecision: 'allow' };
        },
        onPostToolUse: async (i: any) => {
          if (!['destination-advisor', 'weather-window', 'travel-search', 'booking-simulator'].includes(i.toolName)) {
            queue.push({ type: 'tool_result', name: i.toolName, ok: true, result: i.result });
          }
          return {};
        },
        onPostToolUseFailure: async (i: any) => {
          queue.push({ type: 'tool_result', name: i.toolName, ok: false, result: i.error });
          return {};
        },
      },
    });

    // Stream reply text as `token` events. We intentionally do NOT subscribe to
    // `assistant.reasoning_delta` — hidden chain-of-thought never leaves here.
    session.on('assistant.message_delta', (e: any) => {
      const delta = e.data.deltaContent;
      reply += delta;
      queue.push({ type: 'token', value: delta });
    });
    session.on('session.idle', () => {
      // Close out the model-generation audit entry with the reply that was sent.
      queue.push({ type: 'tool_result', name: 'copilot.chat', ok: true, result: markdownToPlainText(reply) || 'Response generated.' });
      queue.close();
    });

    try {
      // Always record the model turn so the audit trail shows activity even when
      // no external tool is called (a plain conversational reply).
      queue.push({ type: 'decision', summary: 'Plan a reply for the traveller.' });
      queue.push({ type: 'tool_call', name: 'copilot.chat', args: { model: model ?? 'copilot', prompt: input.message } });
      await session.send({ prompt: buildContextualPrompt(input.message, input.history) });
      // Drain events until the session goes idle.
      for await (const event of queue) {
        yield event;
      }
      yield { type: 'done' };
    } catch (err) {
      logger.error({ err: String(err) }, 'Copilot session failed');
      yield {
        type: 'error',
        code: 'agent_unavailable',
        message: 'The assistant is unavailable right now.',
      };
    } finally {
      await session.disconnect();
      await client.stop();
    }
  }
}

function markdownToPlainText(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim();
}

/**
 * The session is stateless per request, so give the model the recent conversation
 * as context. This lets it resolve references like "there" / "that place" to the
 * destination discussed earlier (the audit `copilot.chat` entry still shows only
 * the traveller's actual message).
 */
function buildContextualPrompt(message: string, history: ChatMessage[]): string {
  const prior = history
    .filter((m) => m.content?.trim() && m.content !== message)
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'Traveller' : 'Assistant'}: ${truncate(m.content, 500)}`)
    .join('\n');
  return prior ? `Conversation so far:\n${prior}\n\nTraveller: ${message}` : message;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

/**
 * Ground a weather turn in real Open-Meteo data (ADR-006, Option C). Emits the
 * observable `open-meteo.geocoding` and `open-meteo.climate` audit calls, then
 * hands the resolved place + real climate normals to the pure weather-window
 * tool. Degrades gracefully (embedded model / unknown-place) on failure.
 */
async function groundWeather(
  req: { place: string; intent?: WeatherIntent; month?: string },
  push: (event: AgentEvent) => void,
): Promise<WeatherResult> {
  const place = req.place.trim();

  push({ type: 'tool_call', name: 'open-meteo.geocoding', args: { query: place } });
  let geo;
  try {
    geo = await geocode(place);
  } catch (err) {
    push({ type: 'tool_result', name: 'open-meteo.geocoding', ok: false, result: String(err) });
    return assessWeather({ place, intent: req.intent, month: req.month });
  }
  if (geo.kind === 'none') {
    push({ type: 'tool_result', name: 'open-meteo.geocoding', ok: true, result: { query: place, matches: 0 } });
    return { kind: 'unknown-place', message: `could not locate "${place}"` };
  }
  if (geo.kind === 'ambiguous') {
    push({ type: 'tool_result', name: 'open-meteo.geocoding', ok: true, result: { query: place, matches: geo.candidates.length, candidates: geo.candidates } });
    return { kind: 'ambiguous-place', message: `Several places are called ${place}.`, candidates: geo.candidates };
  }

  const resolved = geo.place;
  push({
    type: 'tool_result',
    name: 'open-meteo.geocoding',
    ok: true,
    result: { name: resolved.name, country: resolved.country, latitude: resolved.latitude, longitude: resolved.longitude, timezone: resolved.timezone },
  });

  push({
    type: 'tool_call',
    name: 'open-meteo.climate',
    args: { latitude: resolved.latitude, longitude: resolved.longitude, baseline: '1991-2020', daily: ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum'] },
  });
  let climate;
  try {
    climate = await climateNormals(resolved.latitude, resolved.longitude);
  } catch (err) {
    push({ type: 'tool_result', name: 'open-meteo.climate', ok: false, result: String(err) });
    return assessWeather({ place, resolvedName: resolved.name, intent: req.intent, month: req.month });
  }
  push({ type: 'tool_result', name: 'open-meteo.climate', ok: true, result: { place: resolved.name, baseline: '1991–2020', months: climate.length } });

  return assessWeather({ place, resolvedName: resolved.name, intent: req.intent, month: req.month, climate });
}

/**
 * Ground a travel-search turn in the RouteStack sandbox (direct HTTPS) with GBP
 * normalisation via the Currency tool. Emits the observable routestack.flights /
 * currency.convert / routestack.hotels audit calls. Validation and clarification
 * kinds short-circuit before any MCP call. Falls back to the deterministic
 * offline catalogue if the live sandbox is unavailable, so the demo always works.
 */
async function groundTravel(
  request: TravelSearchRequest,
  push: (event: AgentEvent) => void,
): Promise<TravelSearchResult> {
  const base = searchTravel(request);
  // A user-input problem short-circuits before any search.
  if (base.kind === 'missing-origin' || base.kind === 'invalid-dates' || base.kind === 'party-clarify') {
    return base;
  }

  // Always attempt live RouteStack for a valid request — not gated on whether the
  // offline catalogue covers the city (BUG-004). Offline is the fallback.
  let live: LiveTravelResult | undefined;
  if (hasRouteStackCredentials()) {
    try {
      live = await searchLiveTravel(request);
    } catch (err) {
      logger.warn({ err: String(err) }, 'RouteStack live search failed; using offline catalogue');
    }
  }

  const result = mergeTravelResult(request, base, live);
  if (result.kind !== 'options') return result;

  const flightSource = live?.flights.length ? 'routestack-sandbox' : 'offline-catalogue';
  const hotelSource = live?.hotels.length ? 'routestack-sandbox' : 'offline-catalogue';
  const flightCurrency = result.flights[0]?.pricePerTraveller.source.currency ?? 'GBP';
  const hotelCurrency = result.hotels[0]?.nightlyRate.source.currency ?? 'GBP';

  push({
    type: 'tool_call',
    name: 'routestack.flights',
    args: { from: result.flights[0]?.from, to: result.flights[0]?.to, depart: request.checkIn, return: request.checkOut, party: request.party },
  });
  push({ type: 'tool_result', name: 'routestack.flights', ok: true, result: { count: result.flights.length, currency: flightCurrency, source: flightSource } });

  // A supplier price not already in GBP was normalised via the Currency tool (FR-005-4).
  const converted = [...result.flights.map((f) => f.pricePerTraveller), ...result.hotels.map((h) => h.nightlyRate)].find(
    (money) => money.source.currency !== 'GBP',
  );
  if (converted) {
    push({ type: 'tool_call', name: 'currency.convert', args: { from: converted.source.currency, to: 'GBP', amount: converted.source.amount } });
    push({
      type: 'tool_result',
      name: 'currency.convert',
      ok: true,
      result: { amountGBP: converted.amountGBP, rate: converted.rate, rateTimestamp: converted.rateTimestamp },
    });
  }

  push({
    type: 'tool_call',
    name: 'routestack.hotels',
    args: { destination: result.place, checkIn: request.checkIn, checkOut: request.checkOut, rooms: request.rooms ?? 1 },
  });
  push({ type: 'tool_result', name: 'routestack.hotels', ok: true, result: { count: result.hotels.length, currency: hotelCurrency, source: hotelSource } });

  return result;
}

/**
 * Minimal push/pull async queue: SDK callbacks `push()`, the generator awaits
 * the next item, and `close()` ends the stream.
 */
class EventQueue implements AsyncIterable<AgentEvent> {
  private readonly buffer: AgentEvent[] = [];
  private waiting: ((r: IteratorResult<AgentEvent>) => void) | null = null;
  private closed = false;

  push(event: AgentEvent): void {
    if (this.waiting) {
      this.waiting({ value: event, done: false });
      this.waiting = null;
    } else {
      this.buffer.push(event);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      this.waiting({ value: undefined as never, done: true });
      this.waiting = null;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift() as AgentEvent;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<AgentEvent>>((resolve) => {
        this.waiting = resolve;
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
