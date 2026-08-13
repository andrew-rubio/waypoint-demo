/**
 * Shared contract types for Chat & Agent Runtime (FRD-001, INC-1).
 *
 * These types are the single source of truth shared between the Express API
 * (`src/api`) and the Next.js web app (`src/web`). They describe the request to
 * `POST /api/chat` and the Server-Sent Events the agent streams back.
 *
 * The stream is deliberately transparent: it carries the agent's *observable*
 * decisions, tool/MCP calls and results — the raw material of the audit trail —
 * but never hidden model reasoning (no chain-of-thought). Keep it that way.
 */

// ── Request ─────────────────────────────────────────────────────────────────

/** Body of `POST /api/chat`. */
export interface ChatRequest {
  /** Opaque per-conversation id. "New chat" issues a fresh id. */
  sessionId: string;
  /** The traveller's message. Must contain non-whitespace text. */
  message: string;
}

/** One turn stored in a conversation (in-memory session store, FR-001-6). */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** ISO-8601 timestamp. */
  ts: string;
}

// ── Streamed agent events (Server-Sent Events) ──────────────────────────────

/** Discriminator for every event the agent can stream. */
export type AgentEventType =
  | 'decision'      // an observable choice the agent made (e.g. "call weather MCP")
  | 'token'         // a chunk of the assistant's reply text
  | 'tool_call'     // the agent invoked a skill / tool / MCP server
  | 'tool_result'   // the result returned from that invocation
  | 'done'          // the reply finished successfully (always last on success)
  | 'error';        // something failed; the turn is aborted

/** An agent decision — the "why" surfaced to the audit trail, not model CoT. */
export interface DecisionEvent {
  type: 'decision';
  /** Human-readable summary, e.g. "Look up weather before recommending dates". */
  summary: string;
}

/** A chunk of reply text. Concatenate `value`s in order to rebuild the reply. */
export interface TokenEvent {
  type: 'token';
  value: string;
}

/** The agent called a skill, tool, or MCP server. */
export interface ToolCallEvent {
  type: 'tool_call';
  /** e.g. "open-meteo", "routestack", "currency", or a local skill name. */
  name: string;
  /** Sanitised call arguments (secrets already redacted). */
  args?: Record<string, unknown>;
}

/** The result of a preceding tool_call. */
export interface ToolResultEvent {
  type: 'tool_result';
  name: string;
  ok: boolean;
  /** Sanitised result payload or a short summary. */
  result?: unknown;
}

/** Terminal success event. */
export interface DoneEvent {
  type: 'done';
}

/** Terminal failure event (validation, mid-stream error, timeout, etc.). */
export interface ErrorEvent {
  type: 'error';
  /** Stable machine code, e.g. "agent_unavailable". */
  code: string;
  /** Traveller-facing, non-technical message. */
  message: string;
}

/** The union of everything that can appear on the `POST /api/chat` stream. */
export type AgentEvent =
  | DecisionEvent
  | TokenEvent
  | ToolCallEvent
  | ToolResultEvent
  | DoneEvent
  | ErrorEvent;

// ── Non-stream error responses ──────────────────────────────────────────────

/** JSON body returned for 4xx/5xx responses (non-streamed failures). */
export interface ChatErrorResponse {
  error: string;
  code: 'invalid_request' | 'payload_too_large' | 'agent_unavailable';
}

// ── Boundary limits (kept in one place so API and Web agree) ────────────────

export const CHAT_LIMITS = {
  /** Hard maximum accepted by the endpoint (FR-001-8). */
  maxMessageLength: 8000,
} as const;
