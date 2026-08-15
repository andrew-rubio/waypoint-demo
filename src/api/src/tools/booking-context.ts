import type { ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import type { TravelOptionsResult } from '../../../shared/types/flight-hotel-search-booking.js';
import { lastSearchRequest, searchTravel, type BookingSelection } from './routestack.js';

/**
 * Per-session memory of the flight/hotel options actually shown to the
 * traveller, so a booking books what they saw (BUG-003). Without this, booking
 * re-derived options from the chat text via the offline catalogue, which fails
 * for any destination the live RouteStack sandbox covers but the offline
 * catalogue does not, and for searches whose dates the model supplied.
 *
 * In-memory only — one demo user, no persistence (same lifetime as the session
 * store).
 */
const lastOptions = new Map<string, TravelOptionsResult>();

/** Per-session memory of the flight/hotel indices the traveller actually booked, so a later summary reflects the booked selection (FRD-007). */
const lastSelection = new Map<string, BookingSelection>();

export function rememberSearchOptions(sessionId: string, options: TravelOptionsResult): void {
  lastOptions.set(sessionId, options);
}

export function recallSearchOptions(sessionId: string): TravelOptionsResult | undefined {
  return lastOptions.get(sessionId);
}

export function rememberBookingSelection(sessionId: string, selection: BookingSelection): void {
  lastSelection.set(sessionId, selection);
}

export function recallBookingSelection(sessionId: string): BookingSelection | undefined {
  return lastSelection.get(sessionId);
}

/**
 * The options to book: the ones actually shown for this session if remembered,
 * otherwise re-derived from the conversation (backward-compatible fallback).
 */
export function resolveBookingOptions(sessionId: string, history: ChatMessage[]): TravelOptionsResult | undefined {
  const remembered = lastOptions.get(sessionId);
  if (remembered) return remembered;

  const request = lastSearchRequest(history);
  if (!request) return undefined;
  const result = searchTravel(request);
  return result.kind === 'options' ? result : undefined;
}
