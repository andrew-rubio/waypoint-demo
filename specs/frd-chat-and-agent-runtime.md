# FRD-001: Conversational Chat & Copilot SDK Agent Runtime

> **Walking skeleton.** This is the foundational increment every other FRD depends
> on. Priority **P0**. Traces to PRD features **F-001, F-002**.

## Overview

A single-page chat interface where the demo traveller converses with a holiday-planning
agent. The backend hosts a **GitHub Copilot SDK** agent (`@github/copilot-sdk`) that
plans a turn, invokes registered skills/tools/MCP servers, and streams tokens and tool
events back to the UI. This FRD establishes the end-to-end "message in → streamed agent
reply out" loop with an empty tool set; later FRDs register skills and MCP servers into
this runtime.

## Personas

- **Traveller** — sends messages, reads streamed replies.
- **Holiday-Planning Agent** — the Copilot SDK runtime that plans and responds.

## User Stories

- As a **Traveller**, I can type a message and send it, so that I can talk to the agent.
- As a **Traveller**, I see the agent's reply stream in token-by-token, so the app feels responsive.
- As a **Traveller**, I can see the running conversation (my messages and the agent's) in order.
- As a **Traveller**, I can start a **new chat** at any time to clear the conversation and begin fresh.
- As a **Traveller**, I can select the **app logo** to return to the home / new-chat state.
- As a **Demo Presenter**, the agent runtime emits structured events for every decision and tool call, so they can be surfaced later (consumed by FRD-002).

## Functional Requirements

- **FR-001-1** The web UI presents a single chat view: a scrollable message list plus a text input and send control.
- **FR-001-2** Submitting a non-empty message appends it to the list and calls the backend chat endpoint.
- **FR-001-3** The backend instantiates a Copilot SDK agent configured with a holiday-planning **system prompt**, SDK lifecycle events, a per-tool permission handler, and application instrumentation used by FRD-002. Instrumentation records observable orchestration events only, never hidden model reasoning/chain-of-thought.
- **FR-001-4** The client uses `fetch()` to `POST /api/chat` and consumes a framed `text/event-stream` response through `ReadableStream`, emitting typed events: `token`, `decision`, `tool_call`, `tool_result`, `done`, `error`.
- **FR-001-5** The UI renders `token` events incrementally into the current assistant message and finalises it on `done`.
- **FR-001-6** Conversation state is kept **per session in memory** (no database); a `sessionId` correlates a browser session to its turns.
- **FR-001-7** Model/token credentials are read **only from environment variables** (`COPILOT_GITHUB_TOKEN`/`GITHUB_TOKEN`); none are hardcoded or sent to the client.
- **FR-001-8** The backend validates chat requests, tool arguments, and MCP/API responses against explicit schemas, rejects unknown tools, and enforces configurable input/output payload limits.
- **FR-001-9** Prompts and MCP/API responses are treated as untrusted data. External prose cannot override the system prompt, permission policy, tool allowlist, or validation rules.
- **FR-001-10** Secrets and authentication material are redacted on the server before any event is logged or streamed to the client.
- **FR-001-11** A **New chat** control is available in the header on every chat screen. Activating it starts a fresh session: it clears the in-memory conversation, resets to the welcome state, and clears the audit trail (see FRD-002). A new `sessionId` is established.
- **FR-001-12** Selecting the **app logo** navigates to the app home (the welcome / new-chat state). *(In the wireframe prototypes the logo links to the prototype menu `index.html`; in the product it returns to home.)*

## Acceptance Criteria

**AC-001-1 — Send and stream (happy path)**
- **Given** the chat view is open
- **When** the Traveller submits "Hi, I want to plan a holiday"
- **Then** their message appears in the list
- **And** an assistant message appears and fills in via streamed `token` events
- **And** the stream ends with a `done` event.

**AC-001-2 — Empty message rejected**
- **Given** the input is empty or whitespace
- **When** the Traveller presses send
- **Then** no request is made and no message is added.

**AC-001-3 — Conversation ordering**
- **Given** two prior exchanges exist
- **When** a third message is sent
- **Then** all messages render in chronological order, roles visually distinct.

**AC-001-4 — Agent events emitted**
- **Given** the agent processes a turn
- **When** it plans or would invoke a tool
- **Then** the backend emits at least one observable lifecycle or app-generated `decision` summary before the first content `token`
- **And** the event does not contain hidden model reasoning/chain-of-thought.

**AC-001-5 — Mid-stream error surfaced**
- **Given** the agent run fails after streaming starts
- **When** the failure occurs
- **Then** an `error` event is emitted and the UI shows a non-fatal error notice, leaving prior messages intact.

**AC-001-6 — New chat resets the session**
- **Given** a conversation with several messages and audit entries exists
- **When** the Traveller activates **New chat**
- **Then** the conversation clears and returns to the welcome state
- **And** the audit trail is cleared
- **And** a new `sessionId` is used for the next message.

## Edge Cases

| Input condition | Expected behaviour |
|-----------------|--------------------|
| Very long message (> 4k chars) | Accepted; backend may truncate for the model and notes truncation in an event. |
| Rapid double-send | Second send is disabled/queued until the first turn's stream completes. |
| Browser refresh mid-conversation | In-memory session is lost; a new session starts cleanly (acceptable for demo). |
| Network drop during stream | UI shows "connection lost"; the partial assistant message is preserved. |
| User cancels a running turn | Client aborts the fetch; backend cancels the SDK turn where supported and emits no automatic reconnect. |
| New chat pressed mid-stream | The active turn is cancelled, the session is reset, and the audit trail is cleared. |

## Error Handling

| Failure mode | System behaviour | User sees | Retried? |
|--------------|------------------|-----------|----------|
| SDK/agent init failure | Return 503 from chat endpoint; log structured error | "Agent unavailable, try again" | No (manual resend) |
| Model unavailable / auth invalid | Emit `error` event | Non-fatal error notice | No |
| Turn timeout | Abort run, emit `error` with `reason: timeout` | Timeout notice | Manual resend |

## API & Data Requirements

**Endpoint:** `POST /api/chat`
- Request: `{ "sessionId": string, "message": string }`
- Client transport: `fetch()` POST; consume `response.body` with `ReadableStream`.
- Response: `text/event-stream`. Each frame uses standard SSE `event:` and `data:` lines; `data` contains `{ "type": "token"|"decision"|"tool_call"|"tool_result"|"done"|"error", "data": object, "ts": ISO-8601, "turnId": string }`.
- Cancellation: an `AbortSignal` cancels the client request and backend turn where supported.
- Reconnection: no automatic replay/reconnect in the demo; the user manually resends after a dropped stream.

**Types (shared, `src/shared/types/`):**
```ts
type ChatMessage = { role: "user" | "assistant"; content: string; ts: string };
type AgentEventType = "token" | "decision" | "tool_call" | "tool_result" | "done" | "error";
type AgentEvent = { type: AgentEventType; data: unknown; ts: string; turnId: string };
```

## Dependencies

- None (foundational). All other FRDs depend on this one.
- External: GitHub Copilot SDK (`@github/copilot-sdk`), a valid Copilot token or BYOK key.

## Non-Functional Requirements

- First visible lifecycle/tool/content event within ~2s on the demo network.
- Structured logging on the backend mirroring emitted events (no `console.log`).
- Every external call wrapped in error handling; a tool failure must not crash the agent loop.

## Out of Scope

- Authentication, multi-user, persistence across sessions, message editing/deletion.

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| FR-001-1..2, FR-001-11..12, AC-001-1..3, AC-001-6 | F-001 Conversational chat UI |
| FR-001-3..10, AC-001-4..5 | F-002 Copilot SDK agent runtime |
