# FRD-002: Audit Trail Side Panel

> Priority **P0**. Traces to PRD features **F-003, F-012**. Depends on **FRD-001**.

## Overview

A toggleable side panel that shows a **live, chronological log** of the current chat's
agent activity: model request lifecycle, app-generated decision summaries, permission
decisions, skill invocations, MCP calls, retries, and outbound API calls — each with a
summarised input/output, timing, and status. This panel is the centrepiece of the live
demo: it makes observable orchestration and every external round-trip visible. It is fed
by SDK events, the permission handler, and application instrumentation established in
FRD-001. It never requests or displays hidden model reasoning/chain-of-thought.

> **Traces (INC-10, ADR-011):** the same audit-event stream is mirrored to **GenAI
> OpenTelemetry** traces — the dialogue plus every audit item (decision, MCP/tool, Cosmos/
> data, skill, model), each tagged with its audit type — exported to the Application Insights
> linked to the Foundry project and visible in the **Foundry portal Observability** tab. The
> deployed ACA web app emits the same traces, so a live chat appears as a trace + conversation
> audit in the portal.

## Personas

- **Demo Presenter** — toggles the panel and narrates the agent's activity.
- **Traveller** — may glance at it but does not depend on it.

## User Stories

- As a **Demo Presenter**, I can toggle an audit panel in/out of view without interrupting the chat.
- As a **Demo Presenter**, I see each observable orchestration step as it happens: an app-generated rationale, which skill/MCP/API was called, with what inputs, what came back, how long it took, and success/failure.
- As a **Demo Presenter**, I can clear the audit log between demo runs.
- As a **Demo Presenter**, I may copy/export the current trail as a P3 enhancement.

## Functional Requirements

- **FR-002-1** A toggle control shows/hides the audit panel; toggling never alters or interrupts the conversation.
- **FR-002-2** The panel subscribes to the same agent event stream as the chat and renders one entry per `decision`, `tool_call`/`tool_result` (paired), grouped by `turnId`.
- **FR-002-3** Each entry displays: **type** (decision | skill | mcp | api), **name** (e.g. `open-meteo.getClimate`), **request summary**, **response summary**, **duration (ms)**, **status** (`pending` | `ok` | `error`), and **timestamp**.
- **FR-002-4** Long request/response payloads are **truncated** with an expand affordance.
- **FR-002-5** Secrets (API keys, tokens, auth headers) are **redacted on the server before streaming** and therefore never enter client-side audit state.
- **FR-002-6** A **Clear** action empties the current audit log. Copy/export as JSON/text is an optional P3 enhancement and does not block FRD-002 completion.
- **FR-002-9** Starting a **New chat** (FRD-001, FR-001-11) also clears the audit trail as part of resetting the session.
- **FR-002-7** Entries render in the exact order events are received; failures render as an `error`-status entry, not a thrown exception.
- **FR-002-8** Decision entries contain only app-generated summaries of observable choices (for example, "weather data is required, selecting Open-Meteo"); hidden model reasoning/chain-of-thought is neither requested nor displayed.

## Acceptance Criteria

**AC-002-1 — Toggle visibility**
- **Given** the panel is hidden
- **When** the Presenter clicks the toggle
- **Then** the panel appears and the conversation state is unchanged; toggling again hides it.

**AC-002-2 — Live entry on tool call**
- **Given** the panel is open
- **When** the agent invokes an MCP tool during a turn
- **Then** a new entry appears with type `mcp`, the tool name, a request summary, and a `pending` state that resolves to `ok` with a duration on completion.

**AC-002-3 — Decision entries**
- **Given** the agent plans a turn
- **When** it decides to call (or not call) a tool
- **Then** an app-generated `decision` entry describes the observable choice in human-readable text
- **And** it contains no hidden model reasoning/chain-of-thought.

**AC-002-4 — Secret redaction**
- **Given** an outbound call includes an API key or auth header
- **When** the entry is rendered
- **Then** the secret value is replaced with `***redacted***`.

**AC-002-5 — Clear between runs**
- **Given** entries exist
- **When** the Presenter clicks Clear
- **Then** the panel empties and subsequent turns start a fresh trail.

**AC-002-6 — Error entry, not crash**
- **Given** an MCP call fails
- **When** the failure event arrives
- **Then** an entry with status `error` and the reason is shown, and the panel keeps functioning.

## Edge Cases

| Condition | Expected behaviour |
|-----------|--------------------|
| Burst of events in one turn | All render in received order; UI stays responsive. |
| Very large payload | Truncated preview + expand; never freezes the panel. |
| No activity yet | Panel shows an empty state ("No agent activity yet"). |
| Event arrives while panel hidden | Entry is buffered and visible when the panel is next opened. |

## Error Handling

| Failure mode | System behaviour | User sees |
|--------------|------------------|-----------|
| Malformed audit event | Skip it, log a warning; do not crash the panel | Nothing (silently skipped) |
| Optional export failure | Show a small inline error | "Couldn't export, try again" |

## API & Data Requirements

Reuses the FRD-001 SSE stream. The backend enriches tool events into audit-shaped data:

```ts
type AuditEntry = {
  id: string;
  turnId: string;
  type: "decision" | "skill" | "mcp" | "api";
  name: string;                 // e.g. "routestack.searchFlights"
  requestSummary: string;       // redacted, truncated
  responseSummary: string;      // redacted, truncated
  durationMs: number | null;    // null while pending
  status: "pending" | "ok" | "error";
  reason?: string;              // present when status = error
  ts: string;                   // ISO-8601
};
```

## Dependencies

- **FRD-001** (agent event stream, SDK lifecycle events, permission handler, and application instrumentation).

## Non-Functional Requirements

- Redaction is mandatory (security). Panel rendering must never block or crash the chat.

## Out of Scope

- Persisting audit logs across sessions; server-side audit storage; analytics dashboards.

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| FR-002-1..5, AC-002-1..4, AC-002-6 | F-003 Audit-trail side panel |
| FR-002-6, AC-002-5 | F-012 Audit clear; export remains optional P3 |
