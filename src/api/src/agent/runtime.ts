import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { AgentInput, AgentDriver } from './driver.js';
import { LocalAgentDriver } from './local-driver.js';
import { CopilotAgentDriver, type FoundryProviderConfig } from './copilot-driver.js';
import { adviseDestinations } from '../tools/destination-advisor.js';
import { getTravellerProfile, personalise, profileAuditSummary } from '../tools/cosmos.js';
import { extractMonth, guideAuditSummary } from '../tools/travel-guide.js';
import { searchTravel } from '../tools/routestack.js';
import { estimateBudget, isSummaryQuery, summariseTrip, weatherNoteFor } from '../tools/trip-summary.js';
import type { TravelOptionsResult } from '../../../shared/types/flight-hotel-search-booking.js';
import { logger } from '../logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pick the driver for this environment:
 *   - real Copilot SDK when a model credential is present and we're not testing;
 *   - the deterministic local driver otherwise (tests, offline demo).
 */
function selectDriver(): AgentDriver {
  if (process.env.NODE_ENV !== 'test') {
    // ── B1 / ADR-005: BYOK → Microsoft Foundry model when configured. ──
    const foundry = readFoundryConfig();
    if (foundry) {
      logger.info({ model: foundry.model }, 'Using Copilot SDK agent driver (BYOK → Microsoft Foundry)');
      return new CopilotAgentDriver(foundry);
    }

    // ── ORIGINAL (ADR-002, swapped out): GitHub Copilot models via a service token. ──
    // const token = process.env.COPILOT_GITHUB_TOKEN;
    // if (token) {
    //   logger.info('Using Copilot SDK agent driver (GitHub Copilot models)');
    //   return new CopilotAgentDriver(token);
    // }
  }
  logger.info('Using local agent driver (no Foundry config / test mode)');
  return new LocalAgentDriver();
}

/** Read BYOK → Foundry settings; baseUrl + model + one auth method (key or managed identity) required. */
function readFoundryConfig(): FoundryProviderConfig | undefined {
  const baseUrl = process.env.FOUNDRY_MODEL_URL;
  const apiKey = process.env.FOUNDRY_API_KEY;
  const model = process.env.FOUNDRY_MODEL;
  const useManagedIdentity = process.env.FOUNDRY_USE_MANAGED_IDENTITY === 'true';
  if (!baseUrl || !model || (!apiKey && !useManagedIdentity)) return undefined;
  const wireApi = process.env.FOUNDRY_WIRE_API === 'completions' ? 'completions' : 'responses';
  return { baseUrl, apiKey, model, wireApi, useManagedIdentity };
}

/** One traveller turn → a stream of AgentEvents. Optional `fault` (test/demo only). */
export interface RunAgentInput extends AgentInput {
  fault?: string;
}

export async function* runAgent(input: RunAgentInput): AsyncIterable<AgentEvent> {
  // Test/demo fault hook — never enabled in production (enforced by the route).
  if (input.fault) {
    yield* runFault(input.fault, input);
    return;
  }
  yield* selectDriver().run(input);
}

/**
 * Deterministic failure paths so the error-handling Gherkin scenarios
 * (AC-001-5 and edge cases) are exercisable end-to-end.
 */
async function* runFault(kind: string, input: RunAgentInput): AsyncIterable<AgentEvent> {
  switch (kind) {
    case 'agent-unavailable':
    case 'model-unavailable':
      yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now. Please try again.' };
      return;

    case 'timeout':
      yield { type: 'decision', summary: 'Attempt to answer the traveller.' };
      yield { type: 'error', code: 'timeout', message: 'The assistant timed out. Please try again.' };
      return;

    case 'mid-stream-error':
      yield { type: 'decision', summary: 'Attempt to answer the traveller.' };
      yield { type: 'token', value: 'Let me help you ' };
      yield { type: 'token', value: 'plan that' };
      yield { type: 'error', code: 'stream_error', message: 'The reply was interrupted. Please try again.' };
      return;

    case 'destination-advisor-error':
      yield { type: 'decision', summary: 'Use destination-advisor to recommend suitable places.' };
      yield { type: 'tool_call', name: 'destination-advisor', args: { interests: ['destination advice'] } };
      yield { type: 'tool_result', name: 'destination-advisor', ok: false, result: 'Destination advice failed.' };
      yield { type: 'error', code: 'destination_advisor_error', message: "I couldn't work that out — could you rephrase?" };
      return;

    case 'slow-reply': {
      yield { type: 'decision', summary: 'Attempt to answer the traveller.' };
      const words = 'Working on your holiday plan, one moment while I gather a few details...'.split(' ');
      for (const word of words) {
        await sleep(500);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'done' };
      return;
    }

    // A representative tool-using turn so the audit trail (FRD-002) can be
    // exercised before real MCP servers arrive (INC-3+). The apiKey below is
    // deliberately present — it must be redacted at the SSE boundary, never
    // reaching the client.
    case 'sample-tools': {
      yield { type: 'decision', summary: 'Live flight search required — calling RouteStack.' };
      yield {
        type: 'tool_call',
        name: 'routestack.searchFlights',
        args: { from: 'LON', to: 'LIS', depart: '2026-10-14', return: '2026-10-21', pax: 2, apiKey: 'super-secret-key-value' },
      };
      await sleep(120);
      yield {
        type: 'tool_result',
        name: 'routestack.searchFlights',
        ok: true,
        result: [
          { airline: 'TAP', price: { amount: 128, ccy: 'GBP' }, stops: 0 },
          { airline: 'BA', price: { amount: 146, ccy: 'GBP' }, stops: 0 },
          { airline: 'easyJet', price: { amount: 97, ccy: 'GBP' }, stops: 0 },
        ],
      };
      const words = 'Here are three direct options from London to Lisbon in October.'.split(' ');
      for (const word of words) {
        await sleep(8);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'done' };
      return;
    }

    // A markdown-formatted reply so the rich-text rendering in the chat is
    // exercisable (bold, bullet list, heading).
    case 'sample-markdown': {
      yield { type: 'decision', summary: 'Reply with a formatted answer.' };
      const md =
        '### Two great options\n\nHere are **two** places to consider:\n\n' +
        '- **Lisbon** — sunny and coastal\n- **Kyoto** — temples and gardens\n\nTell me which you prefer.';
      for (const chunk of md.match(/[\s\S]{1,8}/g) ?? [md]) {
        await sleep(8);
        yield { type: 'token', value: chunk };
      }
      yield { type: 'done' };
      return;
    }

    // A weather turn where the Open-Meteo MCP fails — the FRD-004 degrade path.
    // Geocoding is attempted, fails, and surfaces both a chat notice and an
    // error-status MCP audit entry (never a crash). One retry, then give up.
    case 'weather-mcp-error': {
      yield { type: 'decision', summary: 'Use the Open-Meteo MCP to check the weather.' };
      yield { type: 'tool_call', name: 'open-meteo.geocoding', args: { query: 'Lisbon' } };
      await sleep(60);
      yield { type: 'tool_result', name: 'open-meteo.geocoding', ok: false, result: 'Open-Meteo request timed out' };
      yield { type: 'error', code: 'weather_unavailable', message: 'Weather data is unavailable right now. Please try again shortly.' };
      return;
    }

    // A travel-search turn where the RouteStack MCP fails — the FRD-005 degrade
    // path. Emits an error-status mcp audit entry and a traveller notice (one
    // retry, then give up), never a crash.
    case 'routestack-error': {
      yield { type: 'decision', summary: 'Search RouteStack for flights and hotels.' };
      yield { type: 'tool_call', name: 'routestack.flights', args: { from: 'LON', to: 'LIS', depart: '2026-10-14', return: '2026-10-21', party: 2 } };
      await sleep(60);
      yield { type: 'tool_result', name: 'routestack.flights', ok: false, result: 'RouteStack request timed out' };
      yield { type: 'error', code: 'travel_unavailable', message: 'Travel search is unavailable right now. Please try again shortly.' };
      return;
    }

    // The RouteStack sandbox token quota is exhausted — explained, not retried.
    case 'routestack-quota': {
      yield { type: 'decision', summary: 'Search RouteStack for flights and hotels.' };
      yield { type: 'tool_call', name: 'routestack.flights', args: { from: 'LON', to: 'LIS', depart: '2026-10-14', return: '2026-10-21', party: 2 } };
      await sleep(60);
      yield { type: 'tool_result', name: 'routestack.flights', ok: false, result: 'sandbox token quota exhausted' };
      yield { type: 'error', code: 'search_quota', message: 'Search quota reached for the demo.' };
      return;
    }

    // A booking-simulator failure — an error-status skill audit entry and a
    // notice, with no confirmation issued (FRD-005 error handling).
    case 'booking-error': {
      yield { type: 'decision', summary: 'Simulate a booking for the selected flight and hotel.' };
      yield { type: 'tool_call', name: 'booking-simulator', args: { flightIndex: 0, hotelIndex: 0 } };
      await sleep(60);
      yield { type: 'tool_result', name: 'booking-simulator', ok: false, result: 'booking simulation failed' };
      yield { type: 'error', code: 'booking_error', message: "Couldn't complete the (simulated) booking. Please try again." };
      return;
    }

    // A destination turn where the Cosmos profile store (via the waypoint-data
    // MCP) fails — the FRD-006 degrade path. The profile query fails
    // (error-status mcp audit entry + a traveller notice), then the agent STILL
    // suggests destinations from the conversation, without personalisation. One
    // retry, then give up.
    case 'cosmos-error': {
      yield { type: 'decision', summary: 'Personalise from the Cosmos profile, then recommend destinations.' };
      yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller loyalty, preferences and past destinations' } };
      await sleep(60);
      yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: false, result: 'Cosmos profile request timed out' };
      yield { type: 'error', code: 'personalisation_unavailable', message: 'Personalised data is unavailable right now. Please try again shortly.' };
      const request = { interests: ['warm coastal break'], constraints: [] };
      const result = adviseDestinations(request);
      yield { type: 'tool_call', name: 'destination-advisor', args: { ...request } };
      yield { type: 'tool_result', name: 'destination-advisor', ok: true, result };
      const reply = "I couldn't reach your personalised profile, but here are some ideas for a warm coastal break.";
      for (const word of reply.split(' ')) {
        await sleep(8);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'done' };
      return;
    }

    // Partial Cosmos data — preferences present, past destinations missing. The
    // agent uses only what is available and fabricates no past destination
    // (FRD-006 edge case).
    case 'cosmos-no-history': {
      yield { type: 'decision', summary: 'Personalise from the Cosmos profile (preferences only), then recommend destinations.' };
      yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller loyalty and preferences' } };
      await sleep(60);
      const profile = getTravellerProfile({ includeHistory: false });
      yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) };
      const note = personalise(profile, '');
      yield { type: 'tool_call', name: 'personalise', args: { seat: note.appliedSeat, meal: note.appliedMeal } };
      yield { type: 'tool_result', name: 'personalise', ok: true, result: note };
      const request = { interests: ['warm coastal break'], constraints: [] };
      const result = adviseDestinations(request);
      yield { type: 'tool_call', name: 'destination-advisor', args: { ...request } };
      yield { type: 'tool_result', name: 'destination-advisor', ok: true, result };
      const reply = 'Here are some ideas that match your saved preferences.';
      for (const word of reply.split(' ')) {
        await sleep(8);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'done' };
      return;
    }

    // A month turn where the travel guide has no strong match — the FRD-003
    // (INC-8) fallback path. The travel-guide search succeeds but returns no
    // passages, so the agent falls back to preference-based suggestions and says
    // so, while the profile still personalises the shortlist.
    case 'travel-guide-no-match': {
      const month = extractMonth(input.message) ?? 'that month';
      yield { type: 'decision', summary: `Search the travel guide for ${month}, then recommend from your preferences.` };
      yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };
      yield { type: 'tool_call', name: 'travel-guide.searchByMonth', args: { month } };
      await sleep(60);
      yield { type: 'tool_result', name: 'travel-guide.searchByMonth', ok: true, result: guideAuditSummary(month, []) };
      const profile = getTravellerProfile();
      yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller loyalty, preferences and past destinations' } };
      yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) };
      const note = personalise(profile, input.message);
      yield { type: 'tool_call', name: 'personalise', args: { seat: note.appliedSeat, meal: note.appliedMeal } };
      yield { type: 'tool_result', name: 'personalise', ok: true, result: note };
      const pastDestinations = (profile.pastDestinations ?? []).map((d) => `${d.city}, ${d.country}`);
      const request = { interests: [input.message], constraints: [], month, guidePassages: [], pastDestinations };
      const result = adviseDestinations(request);
      yield { type: 'tool_call', name: 'destination-advisor', args: { ...request } };
      yield { type: 'tool_result', name: 'destination-advisor', ok: true, result };
      const reply = `The travel guide had no strong match for ${month}, so here are ideas based on your saved preferences.`;
      for (const word of reply.split(' ')) {
        await sleep(8);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'done' };
      return;
    }

    // A summary turn where the EUR conversion fails — the FRD-007 error path.
    // The prior GBP summary stays; the currency MCP entry is error-status and a
    // notice explains it, one retry then give up.
    case 'currency-error': {
      yield { type: 'decision', summary: 'Convert the trip total to EUR via the Currency service.' };
      yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };
      yield { type: 'tool_call', name: 'currency.convert', args: { from: 'GBP', to: 'EUR' } };
      await sleep(60);
      yield { type: 'tool_result', name: 'currency.convert', ok: false, result: 'Currency request timed out' };
      yield { type: 'error', code: 'currency_unavailable', message: "Couldn't convert to EUR right now — showing GBP." };
      return;
    }

    // A partial selection: a flight chosen but no hotel — the AC-007-4 path.
    case 'summary-flight-only': {
      yield* runSummaryFault(input, { includeHotel: false });
      return;
    }

    // A summary turn where the Cosmos profile is unavailable — preferences and
    // points are omitted but the itinerary and total still show. Non-summary
    // turns (e.g. the preceding search) fall through to the normal driver.
    case 'summary-no-personalisation': {
      if (!isSummaryQuery(input.message, input.history)) {
        yield* selectDriver().run(input);
        return;
      }
      yield* runSummaryFault(input, { personalisationUnavailable: true });
      return;
    }

    default:
      yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now.' };
  }
}

/** The canonical demo trip (Lisbon) used by the summary fault paths. */
function faultOptions(): TravelOptionsResult | undefined {
  const result = searchTravel({
    destination: 'Lisbon',
    origin: 'London',
    checkIn: '2026-10-14',
    checkOut: '2026-10-21',
    party: 2,
    rooms: 1,
  });
  return result.kind === 'options' ? result : undefined;
}

/** Emit a summary turn for the degraded FRD-007 paths (no hotel / no personalisation). */
async function* runSummaryFault(
  input: RunAgentInput,
  opts: { includeHotel?: boolean; personalisationUnavailable?: boolean },
): AsyncIterable<AgentEvent> {
  yield { type: 'decision', summary: 'Summarise the selected trip and total the budget in GBP.' };
  yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };

  const options = faultOptions();
  if (!options) {
    yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now.' };
    return;
  }

  const applyProfile = !opts.personalisationUnavailable;
  const profile = applyProfile ? getTravellerProfile() : undefined;
  if (profile) {
    yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller preferences and reward points' } };
    yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) };
  }

  const budget = estimateBudget(options, { includeHotel: opts.includeHotel ?? true });
  yield { type: 'tool_call', name: 'budget-estimator', args: { party: options.party, nights: options.nights, rooms: 1 } };
  yield { type: 'tool_result', name: 'budget-estimator', ok: true, result: budget };

  const summary = summariseTrip(options, {
    profile,
    includeHotel: opts.includeHotel ?? true,
    personalisationUnavailable: opts.personalisationUnavailable,
    weatherNote: weatherNoteFor(options.place, options.checkIn),
  });
  yield { type: 'tool_call', name: 'trip-summariser', args: { destination: summary.destination } };
  yield { type: 'tool_result', name: 'trip-summariser', ok: true, result: summary };

  const reply = opts.includeHotel === false
    ? `Here's your trip to ${summary.destination} so far — flight only, no hotel selected yet. Total so far £${summary.totalGBP}.`
    : `Here's your trip to ${summary.destination}. Estimated total £${summary.totalGBP}. Personalisation is unavailable right now, so preferences and points aren't shown.`;
  for (const word of reply.split(' ')) {
    await sleep(8);
    yield { type: 'token', value: word + ' ' };
  }
  yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
  yield { type: 'done' };
}
