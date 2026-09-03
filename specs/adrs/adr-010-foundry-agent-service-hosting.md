# ADR-010: Host the Copilot SDK harness on Microsoft Foundry Agent Service

- **Status:** Proposed — extends **ADR-001** (Copilot SDK runtime) and **ADR-005**
  (BYOK → Microsoft Foundry model). Branch: `spec2cloud/foundry-hosted`. Date: 2026-09-03.
- **Deciders:** Stakeholder + orchestrator.
- **Increment:** INC-9 (new — see `specs/increment-plan.md`).

## Context

The RFI audience is **C-level**. The decision they are judging is whether this is a
credible **organisational agentic factory** — how agents and AI apps are **planned,
built, run, observed, and governed at scale**. The stakeholder wants two things held
together:

1. Keep the **GitHub Copilot SDK** as the agent harness (the ADR-001 thesis — the SDK
   *is* the demo subject, with its permission hook and observable audit stream).
2. **Host the app on Foundry Agent Service** so the native Foundry portal surfaces —
   evaluations, observability, governance, version/deployment management — are
   demonstrable as the "manage agents at scale" management plane.

These are **not** mutually exclusive. Validated against the `microsoft-foundry` skill
(`create-hosted`, `azd-ai-cli`, `local-run`, `observe`, `trace`) on 2026-09-03:

- A hosted agent is defined as an **`azure.yaml` service block** (`host: azure.ai.agent`).
  `azd deploy` packages it and registers a **new immutable agent version**; `azd provision`
  creates the Foundry project + model deployments (`services.ai-project.deployments[]`) via
  Bicep.
- **Runtime detection supports Python, .NET, *and* Node.js**, and the service block
  supports **container (`docker` / `image`) deploy** or **code deploy**, plus a
  `startupCommand`. ⇒ the existing **Node/Express + Copilot SDK** image can be hosted
  **as-is**. This **corrects ADR-005's "Python/C# runtime support only" note**.
- A hosted agent must speak a Foundry **agent protocol** (**Responses** / **Invocations** /
  Activity). A streaming chat agent maps to the Responses/Invocations protocol.
- Native evaluation + observability are **trace-driven** (see **ADR-011**) and are
  complemented by `azd ai agent eval …` and the Foundry `observe` MCP tools.

## Decision

**Package the existing Express + Copilot SDK API (`src/api`) as a Foundry hosted agent
using a container deploy service block**, keeping the Copilot SDK as the in-process
harness and the ADR-005 Foundry model deployment as the model.

- Add an `azure.yaml` service block `host: azure.ai.agent` that deploys the **existing
  `src/api/Dockerfile` image** (container deploy mode), linked to `services.ai-project`
  for the model deployment. The Copilot SDK, permission hook, MCP allowlist, and
  `AgentDriver` contract are **unchanged**.
- Implement a thin **protocol adapter** so the hosted agent speaks the Foundry
  **Invocations** (and/or Responses) protocol: a single invocations endpoint maps an
  incoming agent request → `runAgent()` → streams events back in the protocol's envelope.
  The existing `/api/chat` **SSE contract is retained** for the Web app; the invocations
  endpoint is an **additional** surface, not a replacement.
- Provision via `azd`: reuse the **ADR-005 Foundry project + model deployment + managed
  identity**, add **Application Insights** linked to the project (ADR-011) and the
  agent-service RBAC roles. The Web Container App continues to front the experience and
  calls the hosted agent.
- **`main` (ACA-only, ADR-003) stays intact as the comparison exhibit;** this hosting
  lives on the `spec2cloud/foundry-hosted` branch.

## Consequences

- **Positive:** the native Foundry portal becomes the management plane — versioning,
  deployments, RBAC, content filters, sessions, monitoring, and evaluation — while the
  Copilot SDK is preserved as the harness. It also proves the platform can **govern agents
  built with any harness**, which is a stronger RFI message than a Foundry-native-only
  agent.
- **Positive:** reuses the ADR-005 resource, model deployment, and managed identity —
  **incremental, not a rewrite**; the `AgentDriver` contract, audit trail, and Web app are
  untouched.
- **Cost / trade-off:** a protocol adapter + `azure.yaml` agent service + provisioning
  wiring; **two invocation surfaces** (SSE for Web, Invocations for Foundry) to keep in
  sync. Container deploy mode is chosen to avoid re-homing the TS monorepo into a
  code-mode runtime layout.
- **Governance:** immutable agent version per `azd deploy`; RBAC + content safety at the
  Foundry project; **no secrets** (managed identity, per ADR-005).
- **Open validation item (INC-9 spike):** the exact **Invocations/Responses protocol
  schema + streaming envelope** must be confirmed against the current `azd ai agent`
  extension before the adapter is finalised.

## Alternatives considered

- **Code deploy mode (`python_3_13` / `dotnet_10` scaffold):** the idiomatic `azd ai agent
  init` sample path, but it would force re-homing the Node harness or adding a
  Python/.NET shim that proxies to Node — more moving parts. Rejected in favour of
  container deploy of the existing image.
- **Stay ACA-only + BYO-target evals (the earlier recommendation):** least rework, but the
  native portal governance/observability **management-plane** story (the actual RFI ask) is
  weaker. **Retained on `main`** as the side-by-side comparison.
- **Rebuild as a Foundry prompt / native agent (drop the Copilot SDK):** abandons the
  ADR-001 thesis and the audit-trail hero feature. Rejected.
