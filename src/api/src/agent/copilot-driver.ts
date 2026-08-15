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
  isBookingQuery,
  mergeTravelResult,
  prioritiseByPreferredAirlines,
  searchTravel,
  simulateBooking,
  travelRequestFromConversation,
  travelSearchParameters,
  type LiveTravelResult,
} from '../tools/routestack.js';
import {
  recallBookingSelection,
  rememberBookingSelection,
  rememberSearchOptions,
  resolveBookingOptions,
} from '../tools/booking-context.js';
import { hasRouteStackCredentials, searchLiveTravel } from '../tools/routestack-client.js';
import {
  estimateBudget,
  isEurRequest,
  isSummaryQuery,
  summariseTrip,
  weatherNoteFor,
} from '../tools/trip-summary.js';
import { convertFromGBP, offlineConvertFromGBP } from '../tools/currency.js';
import type { TripSummary } from '../../../shared/types/trip-summary-and-budget.js';
import {
  bookingPersonalisation,
  detectSeatOverride,
  personalise,
  profileAuditSummary,
} from '../tools/cosmos.js';
import { fetchTravellerProfile } from '../tools/waypoint-data-client.js';
import type { PersonalisationProfile } from '../../../shared/types/personalisation.js';

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
 * MCP servers (weather, flights/hotels, currency, and the Cosmos profile /
 * travel-guide search) are added per increment; the permission hook and
 * allowlist below keep the audit wiring demonstrable.
 */

/** The only MCP servers this agent is ever allowed to call. */
const MCP_ALLOWLIST = ['routestack', 'open-meteo', 'currency', 'cosmos', 'travel-guide'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Simulated loading beats for the demo (production only; never under test).
const BOOK_LOAD_MS = 3000;
const CARD_GAP_MS = 1000;

/** The city label for a progress line, e.g. "Lisbon". */
const cityLabel = (place: string): string => place.split(',')[0].trim();

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
    // A booking turn is fully deterministic (no model narration): book the
    // chosen options, then auto-show the trip summary + confirmation cards
    // (FRD-007). Direct-grounded so it never depends on the model choosing to
    // call a tool.
    if (isBookingQuery(input.message, input.history)) {
      yield* this.groundBookingTurn(input);
      return;
    }

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
    // The model streams prose before a tool call and again after it; this flags
    // that a tool ran so the resumed prose gets a paragraph break, not a splice.
    let resumedAfterTool = false;

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
      handler: async (args) => {
        const proposed = args as { candidates?: DestinationCandidate[] };
        const result = adviseDestinations({ ...conversationContext, candidates: proposed?.candidates });
        if (result.kind === 'shortlist' || result.kind === 'no-match' || detectSeatOverride(input.message)) {
          await emitPersonalisation(input.message, (event) => queue.push(event));
        }
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
        if (result.kind === 'options') {
          // Rank flights by the traveller's preferred airlines (FR-006-2) — audit entry only, no note.
          const profile = await resolveProfileWithAudit('preferred airlines and travel preferences', (event) => queue.push(event));
          result.flights = prioritiseByPreferredAirlines(result.flights, profile.preferredAirlines);
          rememberSearchOptions(input.sessionId, result);
        }
        queue.push({ type: 'tool_result', name: 'travel-search', ok: true, result });
        return result;
      },
    });

    const bookingSimulator = defineTool('booking-simulator', {
      description:
        'Produce a clearly-simulated booking confirmation for a chosen flight and hotel from the last search. No payment is taken and no real reservation is made.',
      parameters: bookingSimulatorParameters,
      defer: 'never',
      handler: async (args) => {
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
        // Apply saved preferences + accrue simulated reward points (FR-006-6).
        const profile = await resolveProfileWithAudit('traveller loyalty, preferences and membership', (event) => queue.push(event));
        const flight = options.flights[Math.min(selection.flightIndex, options.flights.length - 1)];
        Object.assign(
          confirmation,
          bookingPersonalisation(profile, {
            ref: confirmation.ref,
            flightGBP: flight.pricePerTraveller.amountGBP,
            party: options.party,
            seat: detectSeatOverride(input.message),
          }),
        );
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
          'You are Waypoint, a concise holiday-planning assistant. For destination recommendations, refinements or travel-fit questions, call destination-advisor and propose three to five candidate destinations (each a canonical "City, Country" name with a one-line rationale and matchedPreferences) drawn from the traveller\'s stated preferences. For any weather or best-time-to-travel question, call weather-window with the place (and the month if the traveller named one); it geocodes the place and reads Open-Meteo ERA5 1991–2020 climate normals for you. To search flights and hotels, call travel-search with the destination, departure city, outbound and return dates (ISO yyyy-mm-dd) and party size; it searches the RouteStack sandbox and normalises prices to GBP — if the traveller has not given a departure city, ask for it. When you present options and offer to book, say you can "book one of the flights and hotels from these options" — do NOT use the words "simulate" or "simulation" at the search stage. When the traveller chooses options to book, call booking-simulator; only in the resulting booking confirmation do you make clear it is a demo simulation with no payment. When the traveller asks for a summary, the total cost, or to see the price in euros, a trip summary card with the itinerary, budget total (in GBP, and EUR when they ask) and their preferences is generated for you automatically — keep your own reply brief, refer them to the card, and never recompute or restate the totals yourself. The traveller\'s Cosmos profile (Gold Tier, reward points, past destinations and seat/meal preferences) is applied automatically to suggestions, flights, the booking and the summary — briefly reference it and explain why you personalised, and if it is unavailable say so and continue. Ground every reply only in the tools\' validated results, preserve canonical place names exactly, always attribute weather figures to Open-Meteo, and never invent prices, weather, availability or travel times.',
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
          resumedAfterTool = true;
          if (!['destination-advisor', 'weather-window', 'travel-search', 'booking-simulator', 'trip-summariser'].includes(i.toolName)) {
            queue.push({ type: 'tool_result', name: i.toolName, ok: true, result: i.result });
          }
          return {};
        },
        onPostToolUseFailure: async (i: any) => {
          resumedAfterTool = true;
          queue.push({ type: 'tool_result', name: i.toolName, ok: false, result: i.error });
          return {};
        },
      },
    });

    // Stream reply text as `token` events. We intentionally do NOT subscribe to
    // `assistant.reasoning_delta` — hidden chain-of-thought never leaves here.
    session.on('assistant.message_delta', (e: any) => {
      const delta: string = e.data.deltaContent ?? '';
      // When prose resumes after a tool call, separate it from the pre-amble with
      // a paragraph break so segments don't splice together ("traveller.Found").
      if (resumedAfterTool && delta.length > 0) {
        resumedAfterTool = false;
        if (reply.length > 0 && !/\s$/.test(reply) && !/^\s/.test(delta)) {
          reply += '\n\n';
          queue.push({ type: 'token', value: '\n\n' });
        }
      }
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

      // Direct-ground a summary turn (FRD-007): the summary card must be built
      // from the remembered options + tools, not left to the model to compute or
      // to decide to call. When the traveller asks for a summary/total/euros and
      // options exist, emit the trip-summariser lifecycle deterministically.
      if (isSummaryQuery(input.message, input.history)) {
        const options = resolveBookingOptions(input.sessionId, input.history);
        if (options && options.kind === 'options') {
          const selection = recallBookingSelection(input.sessionId);
          const summary = await groundSummary(options, input.message, (event) => queue.push(event), selection);
          queue.push({ type: 'tool_call', name: 'trip-summariser', args: { destination: summary.destination } });
          queue.push({ type: 'tool_result', name: 'trip-summariser', ok: true, result: summary });
        }
      }

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

  /**
   * A fully deterministic booking turn (no model): a brief intro, then the
   * booked confirmation and the auto trip summary for the exact chosen flight +
   * hotel (FRD-007). The traveller profile is read via the waypoint-data MCP
   * (offline fallback). No prose beyond the short intro — the detail lives on
   * the summary + confirmation cards.
   */
  private async *groundBookingTurn(input: AgentInput): AsyncIterable<AgentEvent> {
    yield { type: 'decision', summary: 'Book the selected flight and hotel, then summarise the trip.' };
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: this.foundry.model, prompt: input.message } };

    const options = resolveBookingOptions(input.sessionId, input.history);
    const selection = bookingSelectionFromMessage(input.message);

    if (!options || options.kind !== 'options') {
      const msg = "I don't have any options to book yet — search for flights and hotels first.";
      for (const word of msg.split(' ')) yield { type: 'token', value: word + ' ' };
      yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: msg };
      yield { type: 'done' };
      return;
    }

    const intro = 'Sure — let me go ahead and book those for you.';
    for (const word of intro.split(' ')) yield { type: 'token', value: word + ' ' };

    yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller loyalty, preferences and membership' } };
    const { profile } = await fetchTravellerProfile();
    yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) };

    const confirmation = simulateBooking(options, selection, 1);
    const flight = options.flights[Math.min(selection.flightIndex, options.flights.length - 1)];
    Object.assign(
      confirmation,
      bookingPersonalisation(profile, {
        ref: confirmation.ref,
        flightGBP: flight.pricePerTraveller.amountGBP,
        party: options.party,
        seat: detectSeatOverride(input.message),
      }),
    );
    rememberBookingSelection(input.sessionId, selection);
    const budget = estimateBudget(options, { flightIndex: selection.flightIndex, hotelIndex: selection.hotelIndex });
    const summary = summariseTrip(options, {
      profile,
      flightIndex: selection.flightIndex,
      hotelIndex: selection.hotelIndex,
      weatherNote: weatherNoteFor(options.place, options.checkIn),
    });

    // Simulated processing, then the summary (blue) — a beat later the confirmation (green).
    yield { type: 'status', message: 'Booking your flight and hotel…' };
    await sleep(BOOK_LOAD_MS);

    yield { type: 'tool_call', name: 'budget-estimator', args: { party: options.party, nights: options.nights, rooms: 1 } };
    yield { type: 'tool_result', name: 'budget-estimator', ok: true, result: budget };
    yield { type: 'tool_call', name: 'trip-summariser', args: { destination: summary.destination } };
    yield { type: 'tool_result', name: 'trip-summariser', ok: true, result: summary };

    yield { type: 'status', message: '' };
    await sleep(CARD_GAP_MS);

    yield { type: 'tool_call', name: 'booking-simulator', args: { ...selection } };
    yield { type: 'tool_result', name: 'booking-simulator', ok: true, result: confirmation };

    yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: intro };
    yield { type: 'done' };
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
 * Resolve the traveller profile via the `waypoint-data` MCP (a real
 * `cosmos.getTravellerProfile` round-trip, surfaced in the audit) and fall back
 * to the deterministic offline profile when the MCP is not configured or fails.
 */
async function resolveProfileWithAudit(query: string, push: (event: AgentEvent) => void): Promise<PersonalisationProfile> {
  push({ type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query } });
  const { profile } = await fetchTravellerProfile();
  push({ type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) });
  return profile;
}

/**
 * Emit the Cosmos personalisation lifecycle (FRD-006): the
 * `cosmos.getTravellerProfile` MCP query and the `personalise` skill result the
 * audit trail and the personalisation note are built from.
 */
async function emitPersonalisation(message: string, push: (event: AgentEvent) => void): Promise<void> {
  const profile = await resolveProfileWithAudit('traveller loyalty, preferences and past destinations', push);
  const note = personalise(profile, message);
  push({ type: 'tool_call', name: 'personalise', args: { seat: note.appliedSeat, meal: note.appliedMeal } });
  push({ type: 'tool_result', name: 'personalise', ok: true, result: note });
}

/**
 * Ground a summary turn (FRD-007): total the budget from the remembered options,
 * fold in the Cosmos preferences + reward points, and convert the total to EUR
 * (live Frankfurter, offline fallback) only when the traveller asks. Emits the
 * observable budget-estimator and currency.convert audit calls.
 */
async function groundSummary(
  options: Extract<TravelSearchResult, { kind: 'options' }>,
  message: string,
  push: (event: AgentEvent) => void,
  selection?: { flightIndex: number; hotelIndex: number },
): Promise<TripSummary> {
  const profile = await resolveProfileWithAudit('traveller preferences and reward points', push);

  const budget = estimateBudget(options, { flightIndex: selection?.flightIndex, hotelIndex: selection?.hotelIndex });
  push({ type: 'tool_call', name: 'budget-estimator', args: { party: options.party, nights: options.nights, rooms: 1 } });
  push({ type: 'tool_result', name: 'budget-estimator', ok: true, result: budget });

  let eur: { totalEUR: number; exchangeRate: { rate: number; timestamp: string } } | undefined;
  if (isEurRequest(message)) {
    push({ type: 'tool_call', name: 'currency.convert', args: { from: 'GBP', to: 'EUR', amount: budget.totalGBP } });
    let converted;
    try {
      converted = await convertFromGBP(budget.totalGBP, 'EUR');
    } catch (err) {
      logger.warn({ err: String(err) }, 'Live GBP→EUR conversion failed; using offline rate');
      converted = offlineConvertFromGBP(budget.totalGBP, 'EUR');
    }
    push({
      type: 'tool_result',
      name: 'currency.convert',
      ok: true,
      result: { amountEUR: converted.amount, rate: converted.rate, rateTimestamp: converted.rateTimestamp },
    });
    eur = { totalEUR: converted.amount, exchangeRate: { rate: converted.rate, timestamp: converted.rateTimestamp } };
  }

  return summariseTrip(options, {
    profile,
    flightIndex: selection?.flightIndex,
    hotelIndex: selection?.hotelIndex,
    weatherNote: weatherNoteFor(options.place, options.checkIn),
    eur,
  });
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

  // Progress feedback while the (real) RouteStack search runs.
  push({ type: 'status', message: `Searching for flights and hotels to ${cityLabel(request.destination)}…` });

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
  if (result.kind !== 'options') {
    push({ type: 'status', message: '' });
    return result;
  }

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

  push({ type: 'status', message: '' });
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
