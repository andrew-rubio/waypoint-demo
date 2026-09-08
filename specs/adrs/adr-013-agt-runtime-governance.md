# ADR-013: Runtime tool-authority governance via the Agent Governance Toolkit (AGT)

- **Status:** Accepted. Branch: `spec2cloud/agt-runtime-governance`. Date: 2026-09-08.
- **Deciders:** Stakeholder + orchestrator.
- **Relates to:** ADR-012 (deterministic release-contract governance), FRD-010, the
  `RAI-HITL-001` control ("a consequential action must not execute without explicit human
  approval bound to the exact proposal").

## Context

ADR-012 added a **design-time / release-time** governance gate: an unapproved MCP tool
cannot enter the trusted release path (`SEC-MCP-001`, enforced by the GitHub gate). That
gate cannot decide **runtime** questions that only exist while the agent is acting — who
initiated the action, whether it is read-only or consequential, whether human approval has
been given, or whether an approved tool is being used outside the agent's authority.

Today the `RAI-HITL-001` approval obligation is met **probabilistically**: the system prompt
instructs the model to ask for approval before a booking, and a behavioural test
(`booking-approval-test`) asserts it does. That is a prompt-level control, not an
enforcement surface. The single runtime seam — `onPermissionRequest` in
[copilot-driver.ts](../../src/api/src/agent/copilot-driver.ts) — currently applies only a
hardcoded MCP allowlist and always approves everything else.

## Decision

Adopt Microsoft's **Agent Governance Toolkit** (`@microsoft/agent-governance-sdk`,
**v5.0.0, Public Preview, MIT**) to enforce **per-action authority at runtime**, deterministically,
in application code before a tool call reaches the wire — complementing (not replacing) the
ADR-012 release gate.

1. **Deterministic PDP, not an LLM.** The AGT `PolicyEngine` evaluates a declarative YAML
   policy (`src/api/src/agent/governance/policy.yaml`). Decisions are `allow | deny |
   require_approval`. No model is on the authoritative path — same principle as ADR-012.
2. **Three-outcome authority model.** Approved connectivity ≠ unrestricted authority:
   read-only search is **allowed**, a consequential booking is **require_approval**
   (enforcing `RAI-HITL-001` at runtime, not just via prompt+test), and an out-of-scope
   operation (a synthetic, simulated `issueRefund`) is **denied** before execution.
3. **Single enforcement seam.** The gate is called from `onPermissionRequest`; `allow` →
   `approve-once`, `deny` → `reject`, `require_approval` → **pause** for an explicit,
   itinerary-bound human approval. The permission callback is `async` and awaits a pending
   approval (`src/api/src/agent/governance/pending-approvals.ts`); the traveller resolves it
   out-of-band via `POST /api/chat/approve`, after which the callback returns `approve-once`
   (proceed) or `reject` (decline). The same pause is mirrored deterministically in the
   local driver's booking path so the control is testable and demoable without a live model.
   No prompt-level trust.
4. **Fail-closed.** If the policy cannot be evaluated, the gate denies; an unknown/expired
   approval resolves to `denied`. Matches AGT's design and ADR-012's "adapter error blocks
   release" posture.
5. **Observable, not hidden.** Every decision — including `approval_request` /
   `approval_resolved` — becomes an `AgentEvent` on the existing audit stream and an
   OpenTelemetry span (correlation-id bound), so runtime decisions correlate with Foundry /
   Application Insights — never the model's private reasoning.

## Implementation

- Policy: `src/api/src/agent/governance/policy.yaml` (search → allow, booking-simulator →
  require_approval, issueRefund → deny; `default_action: allow`).
- PDP wrapper: `gate.ts` (`evaluateToolCall`); HITL store: `pending-approvals.ts`.
- Enforcement: `copilot-driver.ts` `onPermissionRequest` (live path) + `local-driver.ts`
  `runBooking` (deterministic path); DENY demonstrated by a synthetic `issueRefund` tool.
- Contract: `approval_request` / `approval_resolved` events + `POST /api/chat/approve`
  (`src/shared/types/chat-and-agent-runtime.ts`, `app.ts`); web approval card in
  `page.tsx` / `useChat.ts`.
- Tests: `governance-gate`, `governance-deny`, `governance-approval` (store + approve/deny),
  and the `/api/chat/approve` endpoint test; e2e/BDD booking flows click Approve, with a
  Deny scenario. 140 API tests green.

## Consequences

- **Positive:** closes a real gap named by our own contract — an approved agent still cannot
  exceed its authority at runtime; the `RAI-HITL-001` obligation moves from "ask the model
  nicely + test" to deterministic, fail-closed interception; three distinct, complementary
  proofs (design-time block, runtime authority, correlated evidence).
- **Negative / limits (honest boundaries):**
  - AGT is **Public Preview** with a documented v4→v5 breaking policy-language change; the
    dependency is **version-pinned** and the gate is isolated behind one module so an API
    shift touches only `gate.ts`.
  - Enforcement is **application-layer** (same process as the agent), **not** an OS/kernel
    boundary; container isolation remains the deployment boundary.
  - The approval UI is a **demonstration mechanism**, not enterprise-identity-backed
    non-repudiation (same honesty caveat as ADR-012's hash-bound approval).
  - The runtime gate applies to the **in-process Copilot-SDK driver path**; the
    Foundry-hosted proxy path is out of scope for this increment.
- **No claim** that AGT replaces IAG's policy catalogue, the ADR-012 control-selection
  process, or is a GA/contractually-supported Microsoft service.
