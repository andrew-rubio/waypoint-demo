# INC-9 spike — Foundry hosted-agent protocol & adapter

> Research spike for **INC-9** (ADR-010). Read-only: no `azd provision`/`deploy` (those
> need auth + create cloud resources). Grounded in the `microsoft-foundry` skill
> (`invoke`, `invocations-ws`, `create-hosted`, `azd-ai-cli`, `local-run`) on 2026-09-03
> and the current API (`src/api`).

## Objective

Confirm which Foundry hosted-agent **protocol** Waypoint should expose, the **deploy
mode**, and the shape of the **adapter** over `runAgent()` — before writing code.

## Findings

### 1. Protocol → `responses` (OpenAI-compatible)
| Protocol | Fit for Waypoint |
|----------|------------------|
| **`responses`** | ✅ **Chosen.** "Best for: chat"; HTTPS + OpenAI-compatible JSON with `stream: true` (SSE) — maps directly onto our existing SSE. Platform-managed history via `conversationId`. Native `azd ai agent invoke`, `sessions`, `monitor`, and **eval** tooling. |
| `invocations` | Raw bytes, developer-defined, single req/resp. Works, but loses the native chat/eval affordances. |
| `invocations_ws` | WebSocket duplex for **voice/real-time** — overkill; more infra, no chat/eval benefit. |

### 2. Deploy mode → container (BYO), reuse existing image
- `azure.yaml` service block `host: azure.ai.agent`, `kind: hosted`, `protocols: [{ protocol: responses, version: 1.0.0 }]`, container deploy of the existing [src/api/Dockerfile](../../src/api/Dockerfile) (Node 22, tsx). Bump `container.resources` from the scaffold default `0.25 cpu / 0.5Gi`.
- Model deployment via `services.ai-project.deployments[]`; agent references it through `environmentVariables` (our `FOUNDRY_MODEL_URL` / `FOUNDRY_MODEL` map onto `AZURE_AI_MODEL_DEPLOYMENT_NAME` + project endpoint).

### 3. Adapter shape (additive; keeps `/api/chat` for Web)
- Add an **OpenAI-compatible `responses` HTTP route** + a **readiness endpoint** alongside the existing [POST /api/chat](../../src/api/src/app.ts) SSE handler.
- Map request `input`/`messages` → `runAgent({ message, history, sessionId })`, keying history off the platform `conversationId`.
- Map the `AgentEvent` stream → the `responses` streaming envelope: `token` → output-text delta; `tool_call`/`tool_result` → function/tool-call items (so `tool_call_accuracy` eval can read them); `done` → completed; `error` → error. Reuse `redactSecrets` at the boundary (FR-001-10).

### 4. Auth & secrets
- The **container does not receive the `Authorization` header** (APIM/Agents service strip it after validation) — do not depend on it. Model auth stays **managed identity** (ADR-005); no secrets in the image; all env from the azd environment.

### 5. Observability / eval
- Traces via **ADR-011** (GenAI OTel spans) → App Insights linked to the project.
- Native `azd ai agent eval generate/run`, `monitor`, and `sessions` become available once deployed (FRD-008 / FRD-009).

## Remaining validation (needs an azd scaffold or auth — do at INC-9 kickoff)
1. **Exact `responses` wire contract for a BYO *Node* container** — the route path, request/response JSON schema, streaming event names, and the **readiness probe path/port** the host expects. (The `azure-ai-agentserver-*` host auto-provides these for Python; a Node BYO container implements them.) Confirm by `azd ai agent init` of a `responses` sample and inspecting, or from current docs.
2. **Tool-call surfacing** — best representation of `tool_call`/`tool_result` in the `responses` envelope so `tool_call_accuracy` scores correctly (function-call items vs annotations).
3. **`conversationId` reconciliation** — platform-managed conversation vs our in-memory session store; pick one as source of truth (lean on platform `conversationId`).

## Outcome
- Refines **ADR-010**: protocol = **`responses`**; open item narrowed to the three items above.
- No blocker found — hosting the existing Node/Copilot-SDK image as a `responses` hosted agent is feasible; the adapter is additive and small.
