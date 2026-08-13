# ADR-005: Swap agent model & auth to BYOK → Microsoft Foundry (API key)

- **Status:** Accepted — supersedes the auth decision in **ADR-002** (Copilot token). Date: 2026-08-13.
- **Deciders:** Stakeholder + orchestrator.
- **Increment:** Post-INC-2 change request.

## Context

ADR-002 chose a `COPILOT_GITHUB_TOKEN` service credential with **Copilot models**.
The stakeholder now wants an **Azure-native** posture: the model served by a
**Microsoft Foundry** deployment, with usage/billing/governance on Azure.

Verified against the official `github/copilot-sdk` (README FAQ + `docs/auth/byok.md`):

- The Copilot SDK supports **BYOK** for Microsoft Foundry. With BYOK the SDK is used
  **without GitHub authentication** — `COPILOT_GITHUB_TOKEN` is no longer required.
- **BYOK is key-based.** The built-in `apiKey`/`bearerToken` fields do not accept
  managed identity; an Entra/managed-identity token is only possible via a
  `bearerTokenProvider` callback. Per this change request we use the **API key**.
- Config surface: `provider: { type: 'openai', baseUrl: '<endpoint>/openai/v1/', apiKey, wireApi }`
  plus `model` = the **Foundry deployment name** (required with BYOK).

The rest of the agent (Copilot SDK client, permission hook, MCP allowlist, hooks,
audit-event stream) is **unchanged** — only the model source and credential change.

## Decision

**Authenticate the agent's model via BYOK → Microsoft Foundry using the Container
App's managed identity (Entra).** An API key was the initial choice, but the
subscription enforces `disableLocalAuth=true` on Cognitive Services accounts — local
(key) auth is unavailable — so the SDK's `bearerTokenProvider` + `DefaultAzureCredential`
path is used instead.

- Provision a **Microsoft Foundry v2** account (`Microsoft.CognitiveServices/accounts`
  **kind `AIServices`** + `allowProjectManagement: true` + a `waypoint` **project**) with one
  model deployment as **IaC** (`infra/modules/foundry.bicep`) and grant the Container App's
  managed identity the **Cognitive Services OpenAI User** role. **No key or secret at all.**
- The API selects the Copilot SDK driver when `FOUNDRY_MODEL_URL`, `FOUNDRY_MODEL`,
  and an auth method (`FOUNDRY_USE_MANAGED_IDENTITY=true` or `FOUNDRY_API_KEY`) are
  present; otherwise it falls back to the local driver.
- The **original GitHub-token path is kept in the codebase, commented out**, so the
  demo can show exactly what was swapped (`copilot-driver.ts`, `runtime.ts`, `main.bicep`).

## Consequences

- **Positive:** Azure-native model governance (content filters, RBAC, quota) and
  **Azure pay-as-you-go per-token** billing on the Foundry resource; no GitHub token.
- **Positive:** Zero app-code rewrite beyond the driver's `provider` block; the
  `AgentDriver` contract, audit trail, and web app are untouched.
- **Cost:** Adds a Foundry resource + per-token Azure spend (vs. ADR-002 riding the
  Copilot allowance). Requires model **quota** in the target region (Sweden Central).
- **Trade-off / limitation:** BYOK's built-in credential fields are key-based; managed
  identity is achieved via the SDK's `bearerTokenProvider` callback (used here because
  policy disables keys). This corrects ADR-002's assumption about a direct MI path.
- **Security:** No key material anywhere — the agent uses the Container App's managed
  identity (Entra) with the least-privilege **Cognitive Services OpenAI User** role.
  Provisioned entirely via Bicep.
- **Stepping stone:** This establishes the Foundry resource, deployment, RBAC, and the
  SDK BYOK `provider` wiring reused by a future move to Foundry Agent Service hosting.

## Alternatives considered

- **Keep ADR-002 (Copilot token):** simplest, but not Azure-native (rejected by request).
- **BYOK with managed identity (`bearerTokenProvider`):** keyless, better long-term, but
  more wiring; deferred in favour of the API key for this change.
- **Foundry Agent Service hosting (hosted agent):** larger change; Python/C# runtime
  support only. Documented as a future option; not chosen now.
