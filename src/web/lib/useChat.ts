'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { AgentEvent } from '../../shared/types/chat-and-agent-runtime';
import type { DestinationAdviceResult } from '../../shared/types/destination-advice';
import type { WeatherCardResult } from '../../shared/types/weather-and-timing';
import type { BookingConfirmation, TravelCardResult } from '../../shared/types/flight-hotel-search-booking';
import type { PersonalisationResult } from '../../shared/types/personalisation';
import type { TripSummary } from '../../shared/types/trip-summary-and-budget';
import { applyAuditEvent, auditTurns, emptyAuditState, type AuditState } from '../../shared/audit';

/** A message as shown in the UI (flat list; index drives the data-testid). */
export interface UiMessage {
  role: 'user' | 'assistant';
  content: string;
  destinationAdvice?: DestinationAdviceResult;
  weatherAdvice?: WeatherCardResult;
  travelOptions?: TravelCardResult;
  booking?: BookingConfirmation;
  personalisation?: PersonalisationResult;
  tripSummary?: TripSummary;
  /** A "tell me more" reply grounded in web research (Wikipedia). */
  research?: boolean;
}

/** Anything longer than this is shortened for the agent (edge case). */
const TRUNCATE_AT = 4000;

const newSessionId = () => `sess-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const newTurnId = () => `t-${Math.random().toString(36).slice(2)}-${Date.now()}`;

/** Read the optional `?fault=` test hook so demos can simulate failures. */
function faultParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('fault');
}

/**
 * useChat — the entire client side of the walking skeleton. It POSTs to
 * `/api/chat`, reads the Server-Sent Events stream, and turns `token` events
 * into a progressively-filled assistant reply. Decision/tool events are carried
 * on the same stream (they feed the audit trail in a later increment).
 */
export function useChat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [audit, setAudit] = useState<AuditState>(emptyAuditState);
  const [auditOpen, setAuditOpen] = useState(false);
  const sessionId = useRef<string>(newSessionId());
  const abortRef = useRef<AbortController | null>(null);

  const started = messages.length > 0;
  const auditGroups = useMemo(() => auditTurns(audit), [audit]);

  const send = useCallback(
    async (raw: string): Promise<boolean> => {
      const text = raw.trim();
      if (!text || streaming) return false; // empty/whitespace or busy → ignore

      setError(null);
      setTruncated(text.length > TRUNCATE_AT);

      // Show the user's turn and an empty assistant bubble to stream into.
      setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
      setStreaming(true);

      // Each send is one audit turn; events below fold into it.
      const turnId = newTurnId();
      let failed = false;

      const controller = new AbortController();
      abortRef.current = controller;

      // A streamed response won't always error on its own when connectivity
      // drops, so react to the browser's offline event and abort the read.
      const onOffline = () => controller.abort();
      if (typeof window !== 'undefined') window.addEventListener('offline', onOffline);

      const fault = faultParam();
      const url = fault ? `/api/chat?fault=${encodeURIComponent(fault)}` : '/api/chat';

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionId.current, message: text }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`chat failed: ${res.status}`);

        await readSse(res.body, (event) => {
          if (event.type === 'error') failed = true;
          if (event.type === 'status') setLoadingStatus(event.message || null);
          if (event.type === 'done' || event.type === 'error') setLoadingStatus(null);
          applyEvent(event, setMessages, setError);
          setAudit((prev) => applyAuditEvent(prev, turnId, event, Date.now()));
        });
      } catch (err) {
        failed = true;
        // A dropped connection (offline) keeps the partial reply visible.
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setError('The connection was lost. Your reply so far is preserved — please try again.');
        } else if ((err as Error).name !== 'AbortError') {
          setError('Something went wrong. Please try again.');
        }
      } finally {
        if (typeof window !== 'undefined') window.removeEventListener('offline', onOffline);
        setStreaming(false);
        setLoadingStatus(null);
        abortRef.current = null;
      }

      // Report success so the composer can preserve the draft for a resend on failure.
      return !failed;
    },
    [streaming],
  );

  /** Reset to a brand-new, empty session (New chat + logo/home). Clears the audit trail (FR-002-9). */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    sessionId.current = newSessionId();
    setMessages([]);
    setError(null);
    setTruncated(false);
    setStreaming(false);
    setLoadingStatus(null);
    setAudit(emptyAuditState());
  }, []);

  /** Show/hide the audit panel (AC-002-1); never touches the conversation. */
  const toggleAudit = useCallback(() => setAuditOpen((o) => !o), []);

  /** Empty the audit trail between demo runs (AC-002-5). */
  const clearAudit = useCallback(() => setAudit(emptyAuditState()), []);

  return {
    messages,
    streaming,
    error,
    truncated,
    loadingStatus,
    started,
    send,
    reset,
    auditOpen,
    auditGroups,
    toggleAudit,
    clearAudit,
  };
}

/** Route a single AgentEvent into UI state. */
function applyEvent(
  event: AgentEvent,
  setMessages: React.Dispatch<React.SetStateAction<UiMessage[]>>,
  setError: React.Dispatch<React.SetStateAction<string | null>>,
): void {
  if (event.type === 'token') {
    // Append to the last (assistant) message.
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + event.value };
      return next;
    });
  } else if (event.type === 'tool_result' && event.name === 'destination-advisor' && event.ok && isDestinationAdvice(event.result)) {
    const destinationAdvice = event.result;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, destinationAdvice };
      return next;
    });
  } else if (event.type === 'tool_result' && event.name === 'weather-window' && event.ok && isWeatherAdvice(event.result)) {
    const weatherAdvice = event.result;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, weatherAdvice };
      return next;
    });
  } else if (event.type === 'tool_result' && event.name === 'travel-search' && event.ok && isTravelOptions(event.result)) {
    const travelOptions = event.result;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, travelOptions };
      return next;
    });
  } else if (event.type === 'tool_result' && event.name === 'booking-simulator' && event.ok && isBooking(event.result)) {
    const booking = event.result;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, booking };
      return next;
    });
  } else if (event.type === 'tool_result' && event.name === 'personalise' && event.ok && isPersonalisation(event.result)) {
    const personalisation = event.result;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, personalisation };
      return next;
    });
  } else if (event.type === 'tool_result' && event.name === 'trip-summariser' && event.ok && isTripSummary(event.result)) {
    const tripSummary = event.result;
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, tripSummary };
      return next;
    });
  } else if (event.type === 'tool_result' && event.name === 'wikipedia.summary' && event.ok) {
    // A "tell me more" turn is grounded in web research; mark the reply so the UI shows the source.
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === 'assistant') next[next.length - 1] = { ...last, research: true };
      return next;
    });
  } else if (event.type === 'error') {
    setError(event.message);
  }
  // Other observable events are surfaced in the audit trail.
}

function isDestinationAdvice(value: unknown): value is DestinationAdviceResult {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;
  const kind = (value as { kind: unknown }).kind;
  if (kind === 'clarification' || kind === 'redirect') return typeof (value as { message?: unknown }).message === 'string';
  if (kind !== 'shortlist' && kind !== 'no-match') return false;
  return Array.isArray((value as { suggestions?: unknown }).suggestions);
}

/** Only month-weather and best-time windows render as a card; other kinds are reply text only. */
function isWeatherAdvice(value: unknown): value is WeatherCardResult {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;
  const kind = (value as { kind: unknown }).kind;
  if (kind === 'month-weather') return typeof (value as { tempMaxC?: unknown }).tempMaxC === 'number';
  if (kind === 'weather-window') return Array.isArray((value as { recommendedMonths?: unknown }).recommendedMonths);
  return false;
}

/** Only the options result renders flight/hotel cards; other kinds are reply text only. */
function isTravelOptions(value: unknown): value is TravelCardResult {
  if (!value || typeof value !== 'object' || !('kind' in value)) return false;
  if ((value as { kind: unknown }).kind !== 'options') return false;
  return Array.isArray((value as { flights?: unknown }).flights) && Array.isArray((value as { hotels?: unknown }).hotels);
}

function isBooking(value: unknown): value is BookingConfirmation {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { simulated?: unknown }).simulated === true &&
    typeof (value as { ref?: unknown }).ref === 'string'
  );
}

/** Only an available personalisation note renders; the degraded case shows the error notice instead. */
function isPersonalisation(value: unknown): value is PersonalisationResult {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { available?: unknown }).available === true &&
    typeof (value as { rationale?: unknown }).rationale === 'string'
  );
}

function isTripSummary(value: unknown): value is TripSummary {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { destination?: unknown }).destination === 'string' &&
    typeof (value as { totalGBP?: unknown }).totalGBP === 'number' &&
    typeof (value as { taxesAndFeesIncluded?: unknown }).taxesAndFeesIncluded === 'boolean'
  );
}

/** Minimal SSE reader: split on blank lines, parse each `data:` JSON payload. */
async function readSse(body: ReadableStream<Uint8Array>, onEvent: (e: AgentEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = block.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent);
      } catch {
        /* ignore malformed keep-alive lines */
      }
    }
  }
}
