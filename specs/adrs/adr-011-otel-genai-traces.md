# ADR-011: Emit OpenTelemetry GenAI agent/tool spans from the audit-event stream

- **Status:** Proposed — depends on **ADR-010** (Foundry Agent Service hosting). Branch:
  `spec2cloud/foundry-hosted`. Date: 2026-09-03.
- **Deciders:** Stakeholder + orchestrator.
- **Increment:** INC-10 (new — see `specs/increment-plan.md`).

## Context

Foundry's native **Observability**, **trace analysis**, and **continuous evaluation** are
**trace-driven**: they read **GenAI OpenTelemetry semantic-convention** spans from the
Foundry project's linked **Application Insights** — attributes such as
`gen_ai.operation.name`, `gen_ai.agent.name`, `gen_ai.conversation.id`, and
`azure.ai.agentserver.*` (confirmed via the `microsoft-foundry` `trace` skill, 2026-09-03).

Waypoint already has the raw material:

- A per-turn **observable event stream** — `decision | tool_call | tool_result | token |
  done | error` (FRD-001, FRD-002) — with request/response summaries, durations, and
  status already computed for the audit trail.
- **Application Insights + OpenTelemetry** already wired (`specs/tech-stack.md`,
  Observability).

But the **Copilot SDK performs its own model calls** (BYOK → Foundry, ADR-005). Without
explicit instrumentation, the Foundry portal will **not** automatically render the
agent-run / tool-call / conversation views at full fidelity, so native eval + observability
would be starved of data.

## Decision

**Add an OTel instrumentation layer that maps each `AgentEvent` to GenAI-convention
spans**, exported through the existing OTLP → Application Insights pipeline linked to the
Foundry project.

- Per turn, open a root **`invoke_agent` span** (`gen_ai.operation.name = invoke_agent`,
  `gen_ai.agent.name = "waypoint"`, conversation id = `sessionId`, correlated by `turnId`).
- For each `tool_call` / `tool_result` pair, emit a child **`execute_tool` span** (tool
  name, input/output **summaries**, status, duration) — **reusing the audit summaries**
  already produced for FRD-002.
- Emit a **model/chat span** capturing the Foundry model deployment and token usage where
  the SDK exposes it.
- Record `decision` entries as **span events** — **observable orchestration only; never
  hidden model reasoning / chain-of-thought** (FR-001-3, FR-002-8).
- Apply the same **server-side secret redaction** (FR-002-5) **before any span attribute is
  set**.
- Conversation key = `coalesce(gen_ai.conversation.id, sessionId)` so every turn rolls up
  to a stable conversation in the portal.

## Consequences

- **Positive:** the in-app **audit trail** and the **Foundry portal traces** become two
  views of the *same* truth — a uniquely strong demo beat: "our audit panel **is** the
  eval/observability input."
- **Positive:** unlocks Foundry **continuous/online evaluation** and trace-based
  failure/latency analysis with **no separate data path**.
- **Cost:** an instrumentation module + attribute mapping + tests; discipline to keep
  chain-of-thought out and secrets redacted at the span boundary.
- **Governance / security:** redaction enforced at the span boundary; only observable
  orchestration is emitted — consistent with FRD-002.

## Alternatives considered

- **Rely on Foundry auto-instrumentation only:** insufficient — the Copilot SDK owns the
  model loop, so agent/tool spans would be missing and the portal views would be sparse.
- **Log-only (App Insights `traces`, no GenAI spans):** keeps current logging but does
  **not** populate the portal's agent/eval/observability views. Rejected.
