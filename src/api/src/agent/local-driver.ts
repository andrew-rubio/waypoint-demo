import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { WeatherResult } from '../../../shared/types/weather-and-timing.js';
import type { BookingConfirmation, TravelSearchResult } from '../../../shared/types/flight-hotel-search-booking.js';
import type { AgentDriver, AgentInput } from './driver.js';
import { adviseDestinations, destinationRequestFromConversation } from '../tools/destination-advisor.js';
import {
  assessWeather,
  isWeatherQuery,
  offlineClimateFor,
  offlineGeocode,
  weatherRequestFromConversation,
} from '../tools/weather-window.js';
import {
  bookingSelectionFromMessage,
  isBookingQuery,
  isTravelSearchQuery,
  prioritiseByPreferredAirlines,
  searchTravel,
  simulateBooking,
  supplierCurrencyFor,
  travelRequestFromConversation,
} from '../tools/routestack.js';
import { rememberSearchOptions, resolveBookingOptions } from '../tools/booking-context.js';
import {
  bookingPersonalisation,
  detectSeatOverride,
  formatPoints,
  getTravellerProfile,
  personalise,
  profileAuditSummary,
} from '../tools/cosmos.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Emit the Cosmos personalisation lifecycle: the `cosmos.getTravellerProfile`
 * MCP query and the `personalise` skill result the audit trail and
 * personalisation note are built from (FRD-006). Shared by destination and
 * travel turns.
 */
async function* personaliseEvents(message: string): AsyncIterable<AgentEvent> {
  const profile = getTravellerProfile();
  yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller loyalty, preferences and past destinations' } };
  yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) };
  const note = personalise(profile, message);
  yield { type: 'tool_call', name: 'personalise', args: { seat: note.appliedSeat, meal: note.appliedMeal } };
  yield { type: 'tool_result', name: 'personalise', ok: true, result: note };
}

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
    if (isBookingQuery(input.message, input.history)) {
      yield* this.runBooking(input);
      return;
    }
    if (isTravelSearchQuery(input.message)) {
      yield* this.runTravelSearch(input);
      return;
    }
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
      summary: `Check your Cosmos profile, then use destination-advisor for "${preview(input.message)}".`,
    };

    // 2) Preserve the model audit lifecycle while surfacing the nested skill call.
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };

    // Personalise when we will actually show suggestions or the traveller states a preference.
    const hasSuggestions = destinationResult.kind === 'shortlist' || destinationResult.kind === 'no-match';
    if (hasSuggestions || detectSeatOverride(input.message)) {
      yield* personaliseEvents(input.message);
    }

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

  private async *runTravelSearch(input: AgentInput): AsyncIterable<AgentEvent> {
    const request = travelRequestFromConversation(input.message, input.history);
    const result = searchTravel(request);

    yield { type: 'decision', summary: `Search RouteStack for flights and hotels for "${preview(input.message)}".` };
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };

    // Only a valid, in-coverage search actually reaches the RouteStack sandbox;
    // clarifications/validation short-circuit before any MCP call.
    if (result.kind === 'options') {
      const currency = supplierCurrencyFor(request.destination) ?? result.flights[0]?.pricePerTraveller.source.currency ?? 'GBP';

      yield {
        type: 'tool_call',
        name: 'routestack.flights',
        args: { from: result.flights[0]?.from, to: result.flights[0]?.to, depart: result.checkIn, return: result.checkOut, party: result.party },
      };
      yield { type: 'tool_result', name: 'routestack.flights', ok: true, result: { count: result.flights.length, currency } };

      // Normalise supplier prices to GBP when the supplier does not quote GBP (FR-005-4).
      if (currency !== 'GBP') {
        const sample = result.flights[0]?.pricePerTraveller;
        yield { type: 'tool_call', name: 'currency.convert', args: { from: currency, to: 'GBP', amount: sample?.source.amount } };
        yield {
          type: 'tool_result',
          name: 'currency.convert',
          ok: true,
          result: { amountGBP: sample?.amountGBP, rate: sample?.rate, rateTimestamp: sample?.rateTimestamp },
        };
      }

      yield {
        type: 'tool_call',
        name: 'routestack.hotels',
        args: { destination: result.place, checkIn: result.checkIn, checkOut: result.checkOut, rooms: request.rooms ?? 1 },
      };
      yield { type: 'tool_result', name: 'routestack.hotels', ok: true, result: { count: result.hotels.length, currency } };

      // Rank the shown flights by the traveller's preferred airlines (FR-006-2) — silent, no note.
      const profile = getTravellerProfile();
      yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'preferred airlines and travel preferences' } };
      yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) };
      result.flights = prioritiseByPreferredAirlines(result.flights, profile.preferredAirlines);
    }

    yield { type: 'tool_call', name: 'travel-search', args: { ...request } };
    yield { type: 'tool_result', name: 'travel-search', ok: true, result };
    if (result.kind === 'options') rememberSearchOptions(input.sessionId, result);

    const reply = composeTravelReply(result);
    for (const word of reply.split(' ')) {
      await sleep(8);
      yield { type: 'token', value: word + ' ' };
    }

    yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
    yield { type: 'done' };
  }

  private async *runBooking(input: AgentInput): AsyncIterable<AgentEvent> {
    yield { type: 'decision', summary: 'Simulate a booking for the selected flight and hotel, with your saved preferences.' };
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };

    const options = resolveBookingOptions(input.sessionId, input.history);
    const selection = bookingSelectionFromMessage(input.message);

    if (!options || options.kind !== 'options') {
      const reply = "I don't have any options to book yet — search for flights and hotels first.";
      for (const word of reply.split(' ')) {
        await sleep(8);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
      yield { type: 'done' };
      return;
    }

    // Apply saved preferences + accrue simulated reward points on the membership (FR-006-6).
    const profile = getTravellerProfile();
    yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller loyalty, preferences and membership' } };
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

    yield { type: 'tool_call', name: 'booking-simulator', args: { ...selection } };
    yield { type: 'tool_result', name: 'booking-simulator', ok: true, result: confirmation };

    const reply = composeBookingReply(confirmation);
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

/** A concise conversational wrapper around the structured travel-search result. */
function composeTravelReply(result: TravelSearchResult): string {
  switch (result.kind) {
    case 'options':
      return `Here are your best flight and hotel options for ${result.place}, priced in GBP. Tell me which flight and hotel to book.`;
    case 'missing-origin':
      return 'I need a departure city before I can search flights. Which city are you flying from?';
    case 'invalid-dates':
      return result.reason === 'past'
        ? 'Those dates are in the past. Could you give me valid travel dates in the future?'
        : 'The return date is before the outbound date. Could you correct the dates?';
    case 'no-results':
      return "I couldn't find any availability for those dates. Try adjusting your dates or choosing another destination.";
    case 'outside-coverage':
      return 'The demo sandbox only covers a limited set of cities. Try a covered city such as Lisbon or Barcelona.';
    case 'party-clarify':
      return `${result.message} Let me know if you'd like to adjust the number of travellers.`;
  }
}

/** A concise conversational wrapper around a simulated booking confirmation. */
function composeBookingReply(confirmation: BookingConfirmation): string {
  const base =
    'Done — this is a demo simulation, so no payment was taken and no real reservation was made. ' +
    `Your reference is ${confirmation.ref}. Itinerary: ${confirmation.itinerary}. ` +
    `Estimated total £${confirmation.estimatedTotalGBP}.`;
  if (!confirmation.seatAssignment) return base;
  return (
    base +
    ` You've been booked for seat ${confirmation.seatAssignment} (${confirmation.seatClass}) with a ${confirmation.mealRequested?.toLowerCase()} in-flight meal from your saved preferences — ` +
    `you can amend these any time up to 30 days before departure. ` +
    `You earned ${formatPoints(confirmation.pointsEarned ?? 0)} reward points on membership ${confirmation.membershipNumber} (new balance ${formatPoints(confirmation.newBalance ?? 0)}).`
  );
}

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? clean.slice(0, 57) + '…' : clean;
}
