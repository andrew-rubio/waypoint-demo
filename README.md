# Waypoint

An interactive **holiday‑planning and booking agent** built on the **[GitHub Copilot SDK](https://www.npmjs.com/package/@github/copilot-sdk)**. Waypoint is a deliberately small, heavily‑commented reference app whose purpose is to show **how little code it takes** to embed a real Copilot‑powered agent in a web product — with a transparent, observable audit trail of everything the agent does.

Chat with the agent to get destination ideas, weather‑aware timing, flights, hotels and a budget — all streamed live, with every decision, tool call and MCP call surfaced in an audit panel.

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

To keep the app runnable offline and in CI, a deterministic **local driver** ([`local-driver.ts`](src/api/src/agent/local-driver.ts)) implements the same event contract and is selected automatically when no `COPILOT_GITHUB_TOKEN` is present.

---

## Architecture

```
Browser ──► Next.js (web) ──► Route Handler proxy ──► Express (api) ──► Copilot SDK ──► Copilot models
   ▲            │  CSS Modules + design tokens          │ POST /api/chat (SSE)     │
   └── SSE ◄────┘  streamed chat + audit panel          └── AgentEvent stream ◄────┘  + MCP servers
```

- **Web** — Next.js 15 (App Router) + React 19, TypeScript, CSS Modules with design tokens (no Tailwind). Streams the reply via `fetch()` + `ReadableStream`. Same‑origin `/api/chat` is proxied to the API by a [Route Handler](src/web/app/api/chat/route.ts).
- **API** — Express 5 on Node 22. `POST /api/chat` returns `text/event-stream` of `AgentEvent`s. Zod validation, pino structured logging, server‑side secret redaction.
- **Agent** — one Copilot SDK session per request; a permission hook + MCP allowlist power the audit trail. MCP servers (weather, flights/hotels, currency, Fabric data) arrive in later increments.
- **Shared** — contract types in [`src/shared/types`](src/shared/types) are the single source of truth for both apps.
- **Infra** — Azure Container Apps via `azd` + Bicep ([`infra/`](infra)); Application Insights + OpenTelemetry.

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
infra/      Azure Bicep (Container Apps, ACR, Log Analytics, App Insights, managed identity)
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

Open http://localhost:3000 and start chatting. Without a Copilot token it runs in **local‑driver** mode (deterministic replies) — perfect for a quick look.

### Enable the real Copilot SDK

Set a **GitHub token for an account with a Copilot seat** (e.g. `gh auth token`). Never commit it.

```powershell
$env:COPILOT_GITHUB_TOKEN = "<your-token>"     # locally
npm run start --workspace @waypoint/api
```

The runtime auto‑switches to the Copilot driver and picks an available model via `client.listModels()` (override with `COPILOT_MODEL`).

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
azd env set COPILOT_GITHUB_TOKEN <token>   # optional: enables the real Copilot SDK
azd up
```

> **Important:** `azd provision` on its own resets the container apps to a placeholder image. Always follow provisioning with `azd deploy` — or just use `azd up` (provision + deploy).

The API image installs `ca-certificates` (the Copilot native runtime needs a system CA store for TLS). The token is stored as a Container App secret and redacted from logs and the response stream.

---

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `COPILOT_GITHUB_TOKEN` | api | GitHub token with a Copilot seat. Absent → local‑driver mode. |
| `COPILOT_MODEL` | api | Override the auto‑selected Copilot model. |
| `API_BASE_URL` | web | Upstream API base for the `/api/chat` proxy. |
| `PORT` | api | API port (default `8080`). |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | api | Telemetry (set in Azure). |

No secrets are hardcoded; nothing that looks like a credential is logged or streamed.

---

## Tech stack

TypeScript · Node 22 · Next.js 15 / React 19 · Express 5 · `@github/copilot-sdk` · Zod · pino · Vitest · Cucumber.js · Playwright · Azure Container Apps · Bicep · `azd` · Application Insights / OpenTelemetry.

## License

Demo / reference project.
