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
  `waypoint-agent`) to that App Insights, so a live chat on the web app is fully recorded as
  a threaded conversation + audit trail. Read it in the backing Log Analytics workspace via
  the `App*` tables (`AppRequests` / `AppDependencies` / `AppTraces`), not the classic
  `dependencies`/`customEvents` names.
- **Route the front-end through the hosted agent (option C):** set
  `FOUNDRY_AGENT_RESPONSES_URL` (the agent's platform Responses endpoint) on the ACA `api`
  and `/api/chat` **proxies each turn to the Foundry-hosted agent** instead of running the
  local runtime ([`src/api/src/agent/foundry-agent-proxy.ts`](src/api/src/agent/foundry-agent-proxy.ts),
  managed-identity token for audience `https://ai.azure.com`, needs the **Azure AI User**
  role). Each web session maps to a Foundry **conversation** (`conv_…`) so turns thread and
  the platform manages history. Unset the variable to run the local Copilot SDK runtime. The
  web app is unchanged either way — the proxy maps the Responses SSE back to the `AgentEvent`
  stream.
- **Where to view it:** the reliable, complete record is the project's **Application
  Insights** — query by `gen_ai.conversation.id` (conversation list → turns → tool trail; see
  [demo-guide.md](demo-guide.md) §1c for the KQL). The Foundry portal's per-agent **Traces**
  tab is fed by the platform's own agent-server telemetry, which the hosted **sandbox drops
  when it freezes between requests**, so it's best-effort in preview.
- **Evaluate & govern:** offline golden-dataset evaluations ([FRD-008](specs/frd-agent-evaluation-and-quality.md)) and governance — RBAC/managed identity, content safety, immutable versions, CI quality gate ([FRD-009](specs/frd-governance-and-observability.md)).
- **PAYG or provisioned throughput:** the hosted agent can run on a pay-as-you-go or a PTU
  deployment of the same model with no code change. See
  [Switching the model between PAYG and PTU](#switching-the-model-between-payg-and-ptu-frd-011-adr-013).

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

The local harness starts the API and web application on available loopback ports,
then passes those endpoints to Cucumber or Playwright. Set
`WAYPOINT_TEST_API_PORT` and `WAYPOINT_TEST_WEB_PORT` only when fixed local ports
are required.

```powershell
npm run test:unit    # Vitest (API unit + integration via Supertest)
npm run test:e2e     # Playwright end-to-end with the local harness
npm run test:bdd     # Cucumber BDD with the local harness
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

## Switching the model between PAYG and PTU (FRD-011, ADR-013)

Waypoint can run GPT-5.4-mini on **pay-as-you-go (PAYG)** or **provisioned throughput (PTU)**
without any code change. Both are deployments of the same model and version in the same Foundry
account, and the app selects one **by deployment name**. PAYG is the default and is never removed,
so it is always available for comparison and rollback.

| | PAYG (default) | PTU |
|---|---|---|
| Deployment name | `gpt-5.4-mini` | `gpt-5.4-mini-ptu` |
| Deployment type (SKU) | `GlobalStandard` | `GlobalProvisionedManaged` |
| Capacity | 500 (thousands of tokens per minute) | 15 PTUs (model minimum, 5-PTU steps) |
| Model and version | `gpt-5.4-mini` `2026-03-17` | `gpt-5.4-mini` `2026-03-17` |
| Billing | Per token used | Hourly while the deployment exists, even when idle (USD 15/hour for 15 PTUs when demonstrated; confirm in the Foundry portal) |
| Created by | Bicep, always | Bicep, only when `DEPLOY_FOUNDRY_PTU=true` |

### How the switch works

Chat turns from the web app are proxied by the API to the **Foundry-hosted agent**, which calls
the model deployment. The deployment that answers is therefore chosen by the hosted agent:

```text
Browser ─► web ─► api (Container App) ─► Foundry-hosted agent ─► Foundry endpoint /openai/v1/ ─┬─► gpt-5.4-mini      (PAYG)
                  FOUNDRY_MODEL           AZURE_AI_MODEL_DEPLOYMENT_NAME                        └─► gpt-5.4-mini-ptu  (PTU)
```

| Setting | Where it lives | What it does | PAYG | PTU |
|---|---|---|---|---|
| `DEPLOY_FOUNDRY_PTU` | Root azd environment → Bicep `deployFoundryPtu` | Creates the PTU deployment beside PAYG | `false` | `true` |
| `USE_FOUNDRY_PTU` | Root azd environment → Bicep `useFoundryPtu` | Sets the API's `FOUNDRY_MODEL`; ignored unless PTU is deployed | `false` | `true` |
| `AZURE_AI_MODEL_DEPLOYMENT_NAME` | `foundry/` azd environment → hosted agent | The deployment the hosted agent calls; this serves every chat turn | `gpt-5.4-mini` | `gpt-5.4-mini-ptu` |

The API's `FOUNDRY_MODEL` labels the API's own audit spans and is the model used if the API runs the
agent in-process (when `FOUNDRY_AGENT_RESPONSES_URL` is unset). Switch both together so traces name
the deployment that actually served the turn; the verifier's `switch` check fails if they disagree.

### Impact across the application and agent

| Area | Impact | Why |
|---|---|---|
| Agent code, prompts, tools, and skills | None | The Copilot SDK driver passes the deployment name as `model`. No file in `src/api/src` knows which tier it runs on, and the verifier checks this. |
| Web app and UI | None | The web app only talks to the API. The chat stream and audit panel look identical. |
| API contracts (`/api/chat`, `/responses`) | None | Request and event shapes are unchanged. |
| Tools and data (RouteStack, Open-Meteo, currency, Wikipedia, Cosmos DB, AI Search) | None | These services never call the chat model. |
| Embeddings and travel-guide search | None | `text-embedding-3-small` stays on `GlobalStandard`. |
| Endpoint, identity, and RBAC | None | Both deployments share the account endpoint and the account-scoped **Cognitive Services OpenAI User** role. Still keyless. |
| Answer quality | None expected | Same model and version; only the capacity tier differs. |
| Latency | Low, usually better | PTU reserves capacity, so model calls avoid shared-pool queuing and are more consistent. Tool calls make up most of a full conversation, so end-to-end gains are smaller than raw model gains. |
| Throughput and throttling | Medium | PAYG is limited by its tokens-per-minute quota; PTU by its 15 reserved PTUs. At 100% utilization PTU returns HTTP 429. Interactive chat fits easily; bursty jobs such as evaluation judging should stay on PAYG. |
| Traces (Application Insights, Foundry Observability) | Low | Same spans and correlation. Only `gen_ai.request.model` changes to the PTU name, which proves PTU served the turn. Sampling stays at 20%, so run a few conversations before showing traces. |
| Monitoring | Low, adds a metric | PTU adds the Azure Monitor metric **Provisioned-Managed Utilization V2** (`AzureOpenAIProvisionedManagedUtilizationV2`), split by `ModelDeploymentName`. |
| Evaluations | Low | Replays (`npm run eval:run-agent`) call the hosted agent, so they exercise PTU while it's active. The judge model stays on PAYG; see [`eval/README.md`](eval/README.md). |
| Governance and release gate | None | The proposition and controls don't change, so the contract hash and approval stay valid. Runtime metadata reports the active deployment name, which supports version-capture lineage (OPS-VER-001). |
| Hosted agent versions | Low | Each switch publishes a new immutable agent version (version 9 for PTU and version 10 back to PAYG in the demonstration). |
| Infrastructure and deployment | Low | One optional deployment and two flags. A switch runs `azd up` (about 4 to 13 minutes) and `azd deploy waypoint-agent` (about 1 to 2 minutes). |
| Cost | High | PTU is billed every hour it exists, including idle time, and can't be paused. Delete it after use: setting `DEPLOY_FOUNDRY_PTU=false` does not delete an existing deployment. |
| Local development and tests | None | Local runs use the deterministic driver; automated PTU tests use labelled simulated evidence. |

### Results from the live demonstration (2026-10-06)

| Check | Result |
|---|---|
| Preflight | 100 PTUs of quota, 100 PTUs of live capacity in Sweden Central, 15 required |
| PTU deployment | `gpt-5.4-mini-ptu` healthy at 15 PTUs; PAYG unchanged at 500 |
| Full conversation through the app | PAYG 16.2 s, PTU 12.4 s, both HTTP 200 |
| Same prompt sent directly to each deployment | PAYG 5.7 s, PTU 1.6 s, no throttling |
| Traces | Correlated `invoke_agent`, `chat`, and `execute_tool` spans for both tiers; the PTU run names `gpt-5.4-mini-ptu` |
| Utilization | 120 one-minute data points for the PTU deployment, peaking at 7.3% |
| Cleanup | Agent and API back on PAYG, PTU deployment deleted, both flags `false` |

Latency figures are single samples and indicative only.

### Runbook

> [!CAUTION]
> A PTU deployment is billed every hour it exists, even when idle, and can't be paused.
> Create it only after confirming the hourly price in the Foundry portal, and delete it after the demo.

Before you start, sign azd in to the tenant that owns the subscription (`azd auth login --tenant-id <tenant-id>`)
and start Docker, which `azd up` needs to build the container images.

```powershell
# 1. Read-only preflight: quota, live capacity, and the price gate
node scripts/verify-ptu-demo.mjs --mode preflight --live --azd-env

# 2. After approving the portal's hourly price: create PTU beside PAYG, then verify (azd up needs Docker running)
azd env set DEPLOY_FOUNDRY_PTU true
azd up
$env:PTU_PRICE_APPROVED = 'true'
node scripts/verify-ptu-demo.mjs --mode post-provision --live --azd-env

# 3. Switch the API and the hosted agent to PTU, then prove the conversation, traces, and utilization
azd env set USE_FOUNDRY_PTU true
azd up
# The hosted agent's env references RouteStack credentials that live in the root azd environment;
# load them for this process only so the new agent version keeps live flight/hotel search.
$root = azd env get-values --output json | ConvertFrom-Json
$env:ROUTESTACK_API_KEY = $root.ROUTESTACK_API_KEY; $env:ROUTESTACK_SECRET = $root.ROUTESTACK_SECRET
Push-Location foundry; Remove-Item Env:AZURE_ENV_NAME -ErrorAction SilentlyContinue
azd env set AZURE_AI_MODEL_DEPLOYMENT_NAME gpt-5.4-mini-ptu; azd deploy waypoint-agent; Pop-Location
node scripts/verify-ptu-demo.mjs --mode switch --deployment ptu --live --azd-env
node scripts/verify-ptu-demo.mjs --mode conversation --deployment ptu --live --azd-env
node scripts/verify-ptu-demo.mjs --mode comparison --live --azd-env
node scripts/verify-ptu-demo.mjs --mode traces --live --azd-env
node scripts/verify-ptu-demo.mjs --mode utilization --live --azd-env

# 4. Roll back to PAYG, then delete PTU to stop billing (load RouteStack credentials as in step 3 first)
Push-Location foundry; Remove-Item Env:AZURE_ENV_NAME -ErrorAction SilentlyContinue
azd env set AZURE_AI_MODEL_DEPLOYMENT_NAME gpt-5.4-mini; azd deploy waypoint-agent; Pop-Location
az cognitiveservices account deployment delete -g <resource-group> -n <foundry-account> --deployment-name gpt-5.4-mini-ptu
azd env set USE_FOUNDRY_PTU false
azd env set DEPLOY_FOUNDRY_PTU false
azd up
node scripts/verify-ptu-demo.mjs --mode cleanup --deployment payg --live --azd-env
```

Rolling back the hosted agent first keeps chat working throughout, and deleting PTU before the
final `azd up` stops billing several minutes sooner. Bicep owns both deployments;
[`foundry/azure.yaml`](foundry/azure.yaml) only selects one through `AZURE_AI_MODEL_DEPLOYMENT_NAME`.
Without `--live`, the verifier uses labelled simulated evidence for automated tests.

---

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `FOUNDRY_MODEL_URL` | api | Foundry OpenAI‑compatible endpoint, e.g. `https://<resource>.openai.azure.com/openai/v1/`. |
| `FOUNDRY_MODEL` | api | Foundry **deployment name** (passed to the SDK as `model`). Set by Bicep: `gpt-5.4-mini` (PAYG) or `gpt-5.4-mini-ptu` (PTU). |
| `FOUNDRY_AGENT_RESPONSES_URL` | api | Responses endpoint of the Foundry-hosted agent. When set, `/api/chat` proxies each turn to it; Bicep preserves it from the root azd environment. |
| `DEPLOY_FOUNDRY_PTU` | azd (root) | `true` creates the `gpt-5.4-mini-ptu` deployment beside PAYG. Default `false`. Billed hourly while it exists. |
| `USE_FOUNDRY_PTU` | azd (root) | `true` points the API's `FOUNDRY_MODEL` at PTU; ignored unless PTU is deployed. Default `false`. |
| `AZURE_AI_MODEL_DEPLOYMENT_NAME` | azd (`foundry/`) | Deployment the Foundry-hosted agent calls (`gpt-5.4-mini` or `gpt-5.4-mini-ptu`). |
| `PTU_PRICE_APPROVED` | verifier | Set to `true` after confirming the hourly PTU price in the Foundry portal; the preflight blocks until then. |
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
