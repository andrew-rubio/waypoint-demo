# Waypoint

An interactive **holiday‑planning and booking agent** built on the **[GitHub Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk)**. Waypoint is a deliberately small, heavily‑commented reference app whose purpose is to show **how little code it takes** to embed a real Copilot‑powered agent in a web product — with a transparent, observable audit trail of everything the agent does.

Chat with the agent to get destination ideas, weather‑aware timing, flights, hotels and a budget — all streamed live, with every decision, tool call and MCP call surfaced in an audit panel. Destination advice is **grounded in a travel‑guide knowledge base** (Azure AI Search) and **personalised** from a traveller profile (Azure Cosmos DB); "tell me more about a place" triggers a **Wikipedia‑backed research** answer.

> Built spec‑first with the **spec2cloud** pipeline (PRD → FRD → UI → tests → contracts → implementation → deploy). See [`AGENTS.md`](AGENTS.md) and [`specs/`](specs/).

---

## Why this repo exists

The star of the show is [`src/api/src/agent/copilot-driver.ts`](src/api/src/agent/copilot-driver.ts). Wiring an agent is essentially four calls:

```ts
const client = new CopilotClient({ gitHubToken });   // 1. authenticate
await client.start();
const session = await client.createSession({ model, streaming: true /* + hooks */ }); // 2. session
await session.send({ prompt });                        // 3. ask
session.on('assistant.message_delta', e => /* stream tokens to the browser */);       // 4. stream
```

Every **permission decision**, **tool call** and **MCP call** is turned into a streamed event — that stream *is* the audit trail. The agent's private reasoning is never forwarded.

To keep the app runnable offline and in CI, a deterministic **local driver** ([`local-driver.ts`](src/api/src/agent/local-driver.ts)) implements the same event contract and is selected automatically when no Foundry model is configured.

---

## Architecture

```
Browser ──► Next.js (web) ──► Route Handler proxy ──► Express (api) ──► Copilot SDK ──► Foundry model
   ▲            │  CSS Modules + design tokens          │ POST /api/chat (SSE)     │
   └── SSE ◄────┘  streamed chat + audit panel          └── AgentEvent stream ◄────┘  + MCP servers
```

- **Web** — Next.js 15 (App Router) + React 19, TypeScript, CSS Modules with design tokens (no Tailwind). Streams the reply via `fetch()` + `ReadableStream`. Same‑origin `/api/chat` is proxied to the API by a [Route Handler](src/web/app/api/chat/route.ts).
- **API** — Express 5 on Node 22. `POST /api/chat` returns `text/event-stream` of `AgentEvent`s. Zod validation, pino structured logging, server‑side secret redaction.
- **Agent** — one Copilot SDK session per request; a permission hook + MCP allowlist power the audit trail. MCP / data calls: weather (Open-Meteo), flights/hotels (RouteStack), currency, **Wikipedia** (place research), and the **Cosmos profile + travel-guide search** via the self-hosted **`waypoint-data`** MCP. Retrieval that the SDK preview can't surface to a BYOK model is **direct-grounded** (the API calls the source, emits the audit lifecycle, and feeds results to the model — see ADR-006/009).
- **Shared** — contract types in [`src/shared/types`](src/shared/types) are the single source of truth for both apps.
- **Infra** — Azure Container Apps via `azd` + Bicep ([`infra/`](infra)); Application Insights + OpenTelemetry.

---

## Hosted on Microsoft Foundry Agent Service (+ observability)

> Branch `spec2cloud/foundry-hosted`. The **same Copilot SDK harness** also runs as a
> **Foundry hosted agent**, so the Foundry portal becomes the management plane — the
> *run / observe / govern* half of an agentic factory. See [ADR-010](specs/adrs/adr-010-foundry-agent-service-hosting.md), [ADR-011](specs/adrs/adr-011-otel-genai-traces.md).

- **`responses` protocol (INC-9):** the API exposes an OpenAI-compatible `POST /responses`
  ([`src/api/src/responses/openai-responses.ts`](src/api/src/responses/openai-responses.ts))
  that maps the `AgentEvent` stream to the Responses SSE lifecycle. `/api/chat` (SSE) is
  kept for the web app. Deployed to Foundry as an immutable agent version via `azd` from
  the separate [`foundry/azure.yaml`](foundry/azure.yaml) project (container deploy; the
  driver reads `WAYPOINT_*` model env aliases because `FOUNDRY_*` is platform-reserved).
- **GenAI traces (INC-10):** [`src/api/src/telemetry`](src/api/src/telemetry) emits
  OpenTelemetry **GenAI** spans + events that mirror the audit trail — the **dialogue**
  (`waypoint.user_message` / `waypoint.assistant_reply`) and **every audit item**
  (`gen_ai.agent.decision`, `gen_ai.tool.call`, `gen_ai.tool.result`) tagged with its
  type (mcp / skill / api / model) — to the App Insights linked to the Foundry project.
- **Same traces from ACA:** the Container Apps `api` emits the *same* traces (role
  `waypoint-agent`) to that App Insights, so a live chat on the web app shows up as a
  trace + conversation audit in the **Foundry portal → agent → Observability**. Read them
  in the backing Log Analytics workspace via the `App*` tables (`AppRequests` /
  `AppDependencies` / `AppTraces`), not the classic `dependencies`/`customEvents` names.
- **Evaluate & govern:** offline golden-dataset evaluations ([FRD-008](specs/frd-agent-evaluation-and-quality.md)) and governance — RBAC/managed identity, content safety, immutable versions, CI quality gate ([FRD-009](specs/frd-governance-and-observability.md)).

---

## What the agent can do

| Capability | How it works | Audit calls |
|---|---|---|
| **Destination advice** | Month-aware, guide-grounded, personalised shortlist that avoids recently-visited places | `travel-guide.searchByMonth` + `cosmos.getTravellerProfile` + `destination-advisor` |
| **Place research** ("tell me more about X") | A rich description grounded in a live Wikipedia summary — no shortlist | `wikipedia.summary` |
| **Weather & best time** | ERA5 1991–2020 climate normals, plain-English, source-cited | `open-meteo.geocoding` + `open-meteo.climate` + `weather-window` |
| **Flights & hotels** | RouteStack search normalised to GBP; **asks for dates first** if none are given | `routestack.flights` + `routestack.hotels` (+ `currency.convert`) |
| **Simulated booking** | Clearly-mock confirmation — no payment; applies seat/meal + simulated reward points | `booking-simulator` |
| **Trip summary & budget** | Itinerary + budget total, **GBP default / EUR on request** | `trip-summariser` + `budget-estimator` (+ `currency.convert`) |
| **Personalisation** | Gold-Tier profile (reward points, preferences, past trips) from Cosmos | `cosmos.getTravellerProfile` + `personalise` |

Every long-running step streams a **live loading status** (e.g. "Searching the travel guide for June recommendations…", "Looking up weather data for Kyoto…", "Researching more into Lisbon…"). Money defaults to **GBP**; booking is **simulated only**.

### Streaming event contract

`POST /api/chat` streams newline‑delimited JSON events (`decision`, `token`, `tool_call`, `tool_result`, `done`, `error`). A `decision` always precedes the first `token`; the stream ends with `done` (or `error`). See [`specs/contracts/api/chat-and-agent-runtime.yaml`](specs/contracts/api/chat-and-agent-runtime.yaml).

---

## Project structure

```
src/
  api/      Express backend embedding the Copilot SDK
    src/agent/   copilot-driver.ts (real) · local-driver.ts (offline) · runtime.ts (selector + faults)
  web/      Next.js chat UI (+ audit panel)
  shared/   Contract types shared by api + web
e2e/        Playwright end-to-end tests + Page Object Models
tests/      Cucumber.js BDD step definitions
infra/      Azure Bicep (Container Apps, ACR, Log Analytics, App Insights, managed identity, Cosmos DB, AI Search, waypoint-data MCP)
specs/      PRD, FRDs, Gherkin, UI design system, contracts, ADRs, increment plan
```

---

## Getting started

**Prerequisites:** Node 22 LTS, npm. (For deploy: Docker Desktop, Azure CLI, azd.)

```powershell
npm install
```

### Run locally

```powershell
# API (http://localhost:8080) and Web (http://localhost:3000) in two terminals:
npm run start --workspace @waypoint/api
npm run dev   --workspace @waypoint/web
```

Open http://localhost:3000 and start chatting. Without a Foundry model configured it runs in **local‑driver** mode (deterministic replies) — perfect for a quick look.

### Enable the real agent (BYOK → Microsoft Foundry)

The agent's model is a **Microsoft Foundry** deployment via the Copilot SDK's BYOK path (ADR-005). Auth is **managed identity** (the target subscription disables API keys). In Azure the Container App's identity is used automatically; **locally**, `DefaultAzureCredential` falls back to your `az login`:

```powershell
az login
$env:FOUNDRY_MODEL_URL             = "https://<resource>.openai.azure.com/openai/v1/"
$env:FOUNDRY_MODEL                 = "gpt-5.4-mini"   # your Foundry deployment name
$env:FOUNDRY_USE_MANAGED_IDENTITY  = "true"           # or set FOUNDRY_API_KEY if your resource allows keys
npm run start --workspace @waypoint/api
```

The runtime auto‑switches to the Copilot SDK driver with `provider: { type: 'openai', baseUrl: FOUNDRY_MODEL_URL, bearerTokenProvider, wireApi: 'responses' }` (or `apiKey` when keys are used). The **original `COPILOT_GITHUB_TOKEN` path is kept commented** in [`copilot-driver.ts`](src/api/src/agent/copilot-driver.ts) / [`runtime.ts`](src/api/src/agent/runtime.ts) to show what was swapped.

---

## Tests

All suites run against the app (Cucumber/Playwright expect a running web + api; the harness [`scripts/e2e.mjs`](scripts/e2e.mjs) boots both).

```powershell
npm run test:unit    # Vitest (API unit + integration via Supertest)
node scripts/e2e.mjs e2e    # Playwright end-to-end
node scripts/e2e.mjs bdd    # Cucumber BDD
```

---

## Deploy to Azure

Container Apps via `azd` (Bicep in [`infra/`](infra)):

```powershell
azd auth login
azd env set AZURE_SUBSCRIPTION_ID <sub-id>
azd env set AZURE_LOCATION <region>
# Foundry (BYOK) is provisioned by Bicep and the key is auto-wired — no secret to set.
# Override the model/version if needed: azd env set FOUNDRY_MODEL_NAME gpt-5.4-mini
azd up
```

> **Important:** `azd provision` on its own resets the container apps to a placeholder image. Always follow provisioning with `azd deploy` — or just use `azd up` (provision + deploy).

The API image installs `ca-certificates` (the Copilot native runtime needs a system CA store for TLS). Auth is **managed identity** — the Container App identity is granted **Cognitive Services OpenAI User** on the Foundry resource, plus **Cosmos DB Data Reader** and **Search Index Data Reader**; there is no key or secret to store. Cosmos DB (serverless) and Azure AI Search (Free tier) are provisioned by Bicep, along with a Foundry **`text-embedding-3-small`** deployment (embeds the travel-guide) and a **Foundry project connection** to AI Search so the `travel-guide` index is visible inside the Foundry project (ADR-008). After provisioning, the guide index is seeded by [`scripts/ingest-guide.mjs`](scripts/ingest-guide.mjs).

---

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `FOUNDRY_MODEL_URL` | api | Foundry OpenAI‑compatible endpoint, e.g. `https://<resource>.openai.azure.com/openai/v1/`. |
| `FOUNDRY_MODEL` | api | Foundry **deployment name** (passed to the SDK as `model`). |
| `FOUNDRY_USE_MANAGED_IDENTITY` | api | `true` → authenticate with the managed identity (Entra). |
| `AZURE_CLIENT_ID` | api | Client ID of the user‑assigned identity (selects it for `DefaultAzureCredential`). |
| `FOUNDRY_API_KEY` | api | Alternative to managed identity (only if the resource allows keys). All auth absent → local‑driver mode. |
| `FOUNDRY_WIRE_API` | api | `responses` (default) or `completions`. |
| `API_BASE_URL` | web | Upstream API base for the `/api/chat` proxy. |
| `WAYPOINT_DATA_MCP_URL` | api | Internal URL of the self-hosted `waypoint-data` MCP (Cosmos profile + travel-guide search). Cosmos + AI Search are reached **keyless via managed identity** — no secret. |
| `SEARCH_ENDPOINT` / `SEARCH_INDEX` | mcp | Azure AI Search endpoint + index (`travel-guide`) for the guide RAG; absent → deterministic offline guide. |
| `PORT` | api | API port (default `8080`). |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | api | Telemetry (set in Azure). |
| `COPILOT_GITHUB_TOKEN` | api | *(Superseded by ADR-005; kept commented for the demo.)* GitHub token for the original Copilot‑models path. |

No secrets are hardcoded; nothing that looks like a credential is logged or streamed.

---

## Tech stack

TypeScript · Node 22 · Next.js 15 / React 19 · Express 5 · `@github/copilot-sdk` · Zod · pino · Vitest · Cucumber.js · Playwright · Azure Cosmos DB · Azure AI Search · Azure Container Apps · Bicep · `azd` · Application Insights / OpenTelemetry.

## License

Demo / reference project.
