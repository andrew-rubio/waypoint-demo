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
  | 'decision'          // an observable choice the agent made (e.g. "call weather MCP")
  | 'token'             // a chunk of the assistant's reply text
  | 'status'            // a transient progress line (e.g. "Searching for flights…"); UI-only, not audited
  | 'tool_call'         // the agent invoked a skill / tool / MCP server
  | 'tool_result'       // the result returned from that invocation
  | 'approval_request'  // runtime governance requires human approval before a consequential action
  | 'approval_resolved' // the human approved or denied the pending action
  | 'done'              // the reply finished successfully (always last on success)
  | 'error';            // something failed; the turn is aborted

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

/**
 * A transient progress line shown while the agent works (e.g. "Searching for
 * flights and hotels to Lisbon…"). UI-only feedback — not part of the audit
 * trail. An empty `message` clears the current indicator.
 */
export interface StatusEvent {
  type: 'status';
  message: string;
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

/**
 * Runtime governance (ADR-013) requires explicit human approval before a
 * consequential action (e.g. a simulated booking). The stream pauses on this
 * event; the client resolves it via `POST /api/chat/approve`, after which the
 * agent emits `approval_resolved` and continues (or declines) on the same stream.
 */
export interface ApprovalRequestEvent {
  type: 'approval_request';
  /** Opaque id the client echoes back to `POST /api/chat/approve`. */
  approvalId: string;
  /** The tool/action awaiting approval, e.g. "booking-simulator". */
  tool: string;
  /** The exact thing being authorised (approval is bound to it), e.g. an itinerary id. */
  itineraryId: string;
  /** Human-readable prompt shown on the approval card. */
  summary: string;
  /** Why approval is required (the matched policy reason). */
  reason: string;
}

/** The outcome of an `ApprovalRequestEvent` once the human decides. */
export interface ApprovalResolvedEvent {
  type: 'approval_resolved';
  approvalId: string;
  decision: 'approved' | 'denied';
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
  | StatusEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | ApprovalResolvedEvent
  | DoneEvent
  | ErrorEvent;

// ── Non-stream error responses ──────────────────────────────────────────────

/** JSON body returned for 4xx/5xx responses (non-streamed failures). */
export interface ChatErrorResponse {
  error: string;
  code: 'invalid_request' | 'payload_too_large' | 'agent_unavailable';
}

/** Body of `POST /api/chat/approve` — resolves a pending `approval_request`. */
export interface ApprovalDecisionRequest {
  sessionId: string;
  approvalId: string;
  /** The human's decision. */
  decision: 'approve' | 'deny';
}

/** Success body of `POST /api/chat/approve`. */
export interface ApprovalDecisionResponse {
  ok: true;
  approvalId: string;
  decision: 'approved' | 'denied';
}

// ── Boundary limits (kept in one place so API and Web agree) ────────────────

export const CHAT_LIMITS = {
  /** Hard maximum accepted by the endpoint (FR-001-8). */
  maxMessageLength: 8000,
} as const;
