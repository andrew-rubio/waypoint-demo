import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { WeatherResult } from '../../../shared/types/weather-and-timing.js';
import type { TravelSearchResult } from '../../../shared/types/flight-hotel-search-booking.js';
import type { AgentDriver, AgentInput } from './driver.js';
import { adviseDestinations, destinationRequestFromConversation, isDetailQuery } from '../tools/destination-advisor.js';
import { guideAuditSummary, searchGuideByMonth } from '../tools/travel-guide.js';
import { composeResearchReply, extractResearchPlace, researchAuditSummary, researchPlace } from '../tools/research.js';
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
import { rememberBookingSelection, recallBookingSelection, rememberSearchOptions, resolveBookingOptions } from '../tools/booking-context.js';
import {
  bookingPersonalisation,
  detectSeatOverride,
  formatPoints,
  getTravellerProfile,
  personalise,
  profileAuditSummary,
} from '../tools/cosmos.js';
import { estimateBudget, isEurRequest, isSummaryQuery, summariseTrip, weatherNoteFor } from '../tools/trip-summary.js';
import { offlineConvertFromGBP } from '../tools/currency.js';
import type { TripSummary } from '../../../shared/types/trip-summary-and-budget.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Simulated loading delays for the demo — skipped under test so the suite stays fast.
const TEST = process.env.NODE_ENV === 'test';
const SEARCH_LOAD_MS = TEST ? 0 : 1200;
const BOOK_LOAD_MS = TEST ? 0 : 3000;
const CARD_GAP_MS = TEST ? 0 : 1000;
const GUIDE_LOAD_MS = TEST ? 0 : 1200;
const WEATHER_LOAD_MS = TEST ? 0 : 1200;
const RESEARCH_LOAD_MS = TEST ? 0 : 1200;

/** The city label for the search progress line, e.g. "Lisbon". */
const cityLabel = (place: string): string => place.split(',')[0].trim();

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
    if (isSummaryQuery(input.message, input.history)) {
      yield* this.runSummary(input);
      return;
    }
    if (isDetailQuery(input.message)) {
      yield* this.runResearch(input);
      return;
    }
    yield* this.runDestinations(input);
  }

  private async *runDestinations(input: AgentInput): AsyncIterable<AgentEvent> {
    const conversationRequest = destinationRequestFromConversation(input.message, input.history);
    const month = conversationRequest.month;

    // INC-8: a month turn retrieves guide passages and the traveller's past destinations to avoid.
    const guidePassages = month ? searchGuideByMonth(month) : [];
    const profile = getTravellerProfile();
    const pastDestinations = (profile.pastDestinations ?? []).map((d) => `${d.city}, ${d.country}`);
    const destinationRequest = { ...conversationRequest, guidePassages, pastDestinations };
    const destinationResult = adviseDestinations(destinationRequest);

    // 1) An observable decision ALWAYS precedes the reply text.
    yield {
      type: 'decision',
      summary: month
        ? `Search the travel guide for ${month}, check your Cosmos profile, then use destination-advisor for "${preview(input.message)}".`
        : `Check your Cosmos profile, then use destination-advisor for "${preview(input.message)}".`,
    };

    // 2) Preserve the model audit lifecycle while surfacing the nested skill call.
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };

    // Personalise when we will actually show suggestions or the traveller states a preference.
    const hasSuggestions = destinationResult.kind === 'shortlist' || destinationResult.kind === 'no-match';
    const detail = isDetailQuery(input.message);

    // INC-8: the travel-guide MCP call is visible in the audit when a month grounds the shortlist.
    if (month && hasSuggestions) {
      yield { type: 'status', message: `Searching the travel guide for ${month} recommendations…` };
      await sleep(GUIDE_LOAD_MS);
      yield { type: 'tool_call', name: 'travel-guide.searchByMonth', args: { month } };
      yield { type: 'tool_result', name: 'travel-guide.searchByMonth', ok: true, result: guideAuditSummary(month, guidePassages) };
      yield { type: 'status', message: '' };
    }

    // Skip personalisation on a "tell me more about X" detail turn so the note isn't repeated.
    if ((hasSuggestions || detectSeatOverride(input.message)) && !detail) {
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

  /** A "tell me more about X" turn: research the place (Wikipedia) and describe it richly. */
  private async *runResearch(input: AgentInput): AsyncIterable<AgentEvent> {
    const place = extractResearchPlace(input.message, input.history);
    yield { type: 'decision', summary: `Research more detail about ${place} for the traveller.` };
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };
    yield { type: 'status', message: `Researching more into ${place}…` };
    await sleep(RESEARCH_LOAD_MS);
    const research = await researchPlace(place);
    yield { type: 'tool_call', name: 'wikipedia.summary', args: { title: place.split(',')[0].trim() } };
    yield { type: 'tool_result', name: 'wikipedia.summary', ok: true, result: researchAuditSummary(place, research) };
    yield { type: 'status', message: '' };
    const reply = composeResearchReply(place, research);
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

    // Progress feedback while the Open-Meteo lookup runs.
    yield { type: 'status', message: `Looking up weather data for ${cityLabel(request.place)}…` };
    await sleep(WEATHER_LOAD_MS);

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
    yield { type: 'status', message: '' };

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
      // Progress feedback while the RouteStack search runs.
      yield { type: 'status', message: `Searching for flights and hotels to ${cityLabel(result.place)}…` };
      await sleep(SEARCH_LOAD_MS);

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

      yield { type: 'status', message: '' };
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
    yield { type: 'decision', summary: 'Book the selected flight and hotel, then summarise the trip.' };
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

    // A brief intro precedes the summary + confirmation cards — the detailed
    // itinerary/total live on the cards, not in the prose.
    const reply = 'Sure — let me go ahead and book those for you.';
    for (const word of reply.split(' ')) {
      await sleep(8);
      yield { type: 'token', value: word + ' ' };
    }

    // Apply saved preferences + accrue simulated reward points on the membership (FR-006-6).
    const profile = getTravellerProfile();
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

    yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller loyalty, preferences and membership' } };
    yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) };
    yield { type: 'tool_call', name: 'budget-estimator', args: { party: options.party, nights: options.nights, rooms: 1 } };
    yield { type: 'tool_result', name: 'budget-estimator', ok: true, result: budget };
    yield { type: 'tool_call', name: 'trip-summariser', args: { destination: summary.destination } };
    yield { type: 'tool_result', name: 'trip-summariser', ok: true, result: summary };

    yield { type: 'status', message: '' };
    await sleep(CARD_GAP_MS);

    yield { type: 'tool_call', name: 'booking-simulator', args: { ...selection } };
    yield { type: 'tool_result', name: 'booking-simulator', ok: true, result: confirmation };

    yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
    yield { type: 'done' };
  }

  private async *runSummary(input: AgentInput): AsyncIterable<AgentEvent> {
    yield { type: 'decision', summary: 'Summarise the selected trip and total the budget in GBP.' };
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };

    const options = resolveBookingOptions(input.sessionId, input.history);
    if (!options || options.kind !== 'options') {
      const reply =
        "There's nothing to summarise yet — pick a destination, then search for flights and a hotel and I'll total up the trip for you.";
      for (const word of reply.split(' ')) {
        await sleep(8);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
      yield { type: 'done' };
      return;
    }

    // Preferences + reward points for the summary come from the Cosmos profile (FR-007-4).
    const profile = getTravellerProfile();
    yield { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { query: 'traveller preferences and reward points' } };
    yield { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: profileAuditSummary(profile) };

    // Reflect the flight + hotel the traveller actually booked, if any (FRD-007 bug-spot).
    const selection = recallBookingSelection(input.sessionId);
    const budget = estimateBudget(options, { flightIndex: selection?.flightIndex, hotelIndex: selection?.hotelIndex });
    yield { type: 'tool_call', name: 'budget-estimator', args: { party: options.party, nights: options.nights, rooms: 1 } };
    yield { type: 'tool_result', name: 'budget-estimator', ok: true, result: budget };

    // Convert to EUR only on request (AC-007-2); the rate + timestamp are audited.
    let eur: { totalEUR: number; exchangeRate: { rate: number; timestamp: string } } | undefined;
    if (isEurRequest(input.message)) {
      const converted = offlineConvertFromGBP(budget.totalGBP, 'EUR');
      yield { type: 'tool_call', name: 'currency.convert', args: { from: 'GBP', to: 'EUR', amount: budget.totalGBP } };
      yield {
        type: 'tool_result',
        name: 'currency.convert',
        ok: true,
        result: { amountEUR: converted.amount, rate: converted.rate, rateTimestamp: converted.rateTimestamp },
      };
      eur = { totalEUR: converted.amount, exchangeRate: { rate: converted.rate, timestamp: converted.rateTimestamp } };
    }

    const summary = summariseTrip(options, {
      profile,
      flightIndex: selection?.flightIndex,
      hotelIndex: selection?.hotelIndex,
      weatherNote: weatherNoteFor(options.place, options.checkIn),
      eur,
    });
    yield { type: 'tool_call', name: 'trip-summariser', args: { destination: summary.destination } };
    yield { type: 'tool_result', name: 'trip-summariser', ok: true, result: summary };

    const reply = composeSummaryReply(summary);
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
    case 'missing-dates':
      return result.message;
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

/** A concise conversational wrapper around the structured trip summary. */
function composeSummaryReply(summary: TripSummary): string {
  const hotelPart = summary.hotelMissing ? 'no hotel selected yet' : summary.hotel?.name ?? 'your hotel';
  const taxNote = summary.taxesAndFeesIncluded ? 'including taxes and fees' : 'excluding unspecified taxes and fees';
  let reply =
    `Here's your trip to ${summary.destination} for ${summary.partySize} traveller${summary.partySize === 1 ? '' : 's'}, ` +
    `${summary.nights} night${summary.nights === 1 ? '' : 's'} in ${summary.roomCount} room${summary.roomCount === 1 ? '' : 's'} — ` +
    `${summary.flight?.airline ?? 'your flight'} and ${hotelPart}. ` +
    `The estimated total is £${summary.totalGBP} (${taxNote}).`;
  if (summary.totalEUR && summary.exchangeRate) {
    reply += ` That's about €${summary.totalEUR} at 1 GBP = ${summary.exchangeRate.rate} EUR (as of ${summary.exchangeRate.timestamp.slice(0, 10)}).`;
  }
  if (summary.appliedPreferences) {
    reply += ` Your ${summary.appliedPreferences.seat.toLowerCase()} seat and ${summary.appliedPreferences.meal.toLowerCase()} meal are pre-selected, and your balance is ${formatPoints(summary.pointsBalance ?? 0)} reward points.`;
  } else if (summary.personalisationUnavailable) {
    reply += ' Personalisation is unavailable right now, so preferences and points are not shown.';
  }
  return reply;
}

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? clean.slice(0, 57) + '…' : clean;
}
