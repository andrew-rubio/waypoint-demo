import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { WeatherResult } from '../../../shared/types/weather-and-timing.js';
import type { AgentDriver, AgentInput } from './driver.js';
import { adviseDestinations, destinationRequestFromConversation } from '../tools/destination-advisor.js';
import {
  assessWeather,
  isWeatherQuery,
  offlineClimateFor,
  offlineGeocode,
  weatherRequestFromConversation,
} from '../tools/weather-window.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Deterministic, dependency-free agent used for tests and for running the demo
 * without a Copilot credential. It emits exactly the same event shape as the
 * real Copilot driver: one observable `decision`, then streamed `token`s, then
 * `done`. It never emits hidden reasoning — that guarantee is part of the
 * contract (AC-001-4).
 *
 * Weather/timing turns are routed to the weather-window skill and emit the same
 * `open-meteo.geocoding` / `open-meteo.climate` MCP audit lifecycle the real
 * driver produces against the Open-Meteo MCP (FRD-004). Everything else is a
 * destination-advice turn.
 */
export class LocalAgentDriver implements AgentDriver {
  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    if (isWeatherQuery(input.message)) {
      yield* this.runWeather(input);
      return;
    }
    yield* this.runDestinations(input);
  }

  private async *runDestinations(input: AgentInput): AsyncIterable<AgentEvent> {
    const destinationRequest = destinationRequestFromConversation(input.message, input.history);
    const destinationResult = adviseDestinations(destinationRequest);

    // 1) An observable decision ALWAYS precedes the reply text.
    yield {
      type: 'decision',
      summary: `Use destination-advisor to help with "${preview(input.message)}".`,
    };

    // 2) Preserve the model audit lifecycle while surfacing the nested skill call.
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };
    yield { type: 'tool_call', name: 'destination-advisor', args: { ...destinationRequest } };
    yield { type: 'tool_result', name: 'destination-advisor', ok: true, result: destinationResult };

    // 3) Stream the reply one word at a time so the UI fills in progressively.
    const reply = composeDestinationReply(destinationResult);
    for (const word of reply.split(' ')) {
      await sleep(8);
      yield { type: 'token', value: word + ' ' };
    }

    yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
    yield { type: 'done' };
  }

  private async *runWeather(input: AgentInput): AsyncIterable<AgentEvent> {
    const request = weatherRequestFromConversation(input.message, input.history);
    const result = assessWeather(request);
    const geocode = offlineGeocode(request.place);

    yield { type: 'decision', summary: `Use the Open-Meteo MCP to answer "${preview(input.message)}".` };
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };

    // Open-Meteo MCP: geocode the place first (FR-004-1).
    yield { type: 'tool_call', name: 'open-meteo.geocoding', args: { query: request.place } };
    if (result.kind === 'unknown-place') {
      yield { type: 'tool_result', name: 'open-meteo.geocoding', ok: true, result: { query: request.place, matches: 0 } };
    } else if (result.kind === 'ambiguous-place') {
      yield {
        type: 'tool_result',
        name: 'open-meteo.geocoding',
        ok: true,
        result: { query: request.place, matches: result.candidates.length, candidates: result.candidates },
      };
    } else {
      const place = 'place' in result && result.place ? result.place : request.place;
      yield { type: 'tool_result', name: 'open-meteo.geocoding', ok: true, result: geocode ?? { name: place } };

      // Open-Meteo MCP: read ERA5 climate normals for the resolved point (FR-004-2).
      yield {
        type: 'tool_call',
        name: 'open-meteo.climate',
        args: { latitude: geocode?.latitude, longitude: geocode?.longitude, baseline: '1991-2020' },
      };
      if (result.kind === 'no-data') {
        yield {
          type: 'tool_result',
          name: 'open-meteo.climate',
          ok: true,
          result: { available: false, note: 'no land station near that point' },
        };
      } else {
        yield {
          type: 'tool_result',
          name: 'open-meteo.climate',
          ok: true,
          result: { place, baseline: '1991–2020', months: offlineClimateFor(request.place)?.length ?? 12 },
        };
      }
    }

    // The weather-window skill structures the grounded figures into an answer.
    yield { type: 'tool_call', name: 'weather-window', args: { ...request } };
    yield { type: 'tool_result', name: 'weather-window', ok: true, result };

    const reply = composeWeatherReply(result);
    for (const word of reply.split(' ')) {
      await sleep(8);
      yield { type: 'token', value: word + ' ' };
    }

    yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
    yield { type: 'done' };
  }
}

/** A concise conversational wrapper around the structured destination result. */
function composeDestinationReply(result: ReturnType<typeof adviseDestinations>): string {
  if (result.kind === 'clarification' || result.kind === 'redirect') return result.message;
  const names = result.suggestions.map((suggestion) => suggestion.name).join(', ');
  const prefix = result.message ? `${result.message} ` : '';
  return `${prefix}My ranked suggestions are ${names}.`;
}

/** A concise conversational wrapper around the structured weather result. */
function composeWeatherReply(result: WeatherResult): string {
  switch (result.kind) {
    case 'month-weather':
      return `In ${result.place}, ${result.month} is typically around ${result.tempMaxC}°C by day and ${result.tempMinC}°C at night, with about ${result.precipMm} mm of rain across the month. Those are Open-Meteo ERA5 ${result.baseline ?? '1991–2020'} normals.`;
    case 'weather-window': {
      const recommended = result.recommendedMonths.map((m) => m.month).join(', ');
      const avoid = result.avoidMonths.map((m) => m.month).join(', ');
      return `The best months to visit ${result.place} are ${recommended}. I'd avoid ${avoid}. That is based on Open-Meteo ERA5 1991–2020 normals.`;
    }
    case 'unknown-place':
      return `I couldn't locate that place. Could you give me a real destination to check?`;
    case 'ambiguous-place': {
      const [first, second] = result.candidates;
      return `There are a few places with that name — did you mean ${first.name} or ${second?.name ?? 'another'}? Which one did you mean?`;
    }
    case 'no-data':
      return `I couldn't find climate data for that point — it looks like open ocean with no nearby land station, so I won't guess the weather.`;
  }
}

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? clean.slice(0, 57) + '…' : clean;
}
