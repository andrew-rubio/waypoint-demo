# INC-10 — GenAI observability (ADR-011): status

## Done
- **Telemetry code** (committed `537b53e`):
  - `src/api/src/telemetry/tracing.ts` — `initTracing()` starts Azure Monitor OpenTelemetry
    from `APPLICATIONINSIGHTS_CONNECTION_STRING` (no-op if absent). Called in `server.ts`.
  - `src/api/src/telemetry/agent-spans.ts` — `traceAgentTurn()` maps the `AgentEvent` stream
    to GenAI spans: root `invoke_agent`, `chat <model>` (copilot.chat), `execute_tool <name>`
    per tool, `decision` as span events, redaction upheld. Wired into both `/api/chat` and
    `/responses` in `app.ts`.
  - Unit tests (`tests/unit/agent-spans.test.ts`, InMemory exporter) — **115/115 green**.
- **Deployed** to Foundry as `waypoint-agent` **v5** (image rebuilt + pushed). Real model reply
  + travel-guide RAG confirmed on invoke.

## Open gap — no App Insights linked to the Foundry project
- Verified: the `waypoint` project has **no AppInsights connection** (only `travel-guide-search`).
  App Insights `appi-dnszpz4hqfi7g` shows **zero** telemetry (last 45m).
- Cause: we deployed into the **existing** project and **skipped `azd provision`** — provision
  (or `azd up`) is what provisions + links App Insights and makes the platform inject
  `APPLICATIONINSIGHTS_CONNECTION_STRING`. Without the link, the container gets no connection
  string, so `initTracing()` correctly no-ops → no spans exported.

## Fix options
1. **Link App Insights to the project (recommended; Foundry-native).** Connect
   `appi-dnszpz4hqfi7g` to the `waypoint` project (portal: project → Tracing/Observability;
   or the equivalent ARM/connection op). The platform then injects the connection string on
   next container start — **no code change**. Also lights up the Foundry portal Observability
   tab (the FRD-009 goal). Redeploy or cold-start to pick it up.
2. **Explicit env fallback.** Read a non-reserved `WAYPOINT_APPINSIGHTS_CONNECTION_STRING`
   (mirroring the `WAYPOINT_MODEL_URL` pattern) set in `azure.yaml` env to `appi`'s connection
   string. Full control + proves the pipeline, but needs a code change + rebuild + redeploy and
   may not populate the portal Observability tab (which keys off the project link).

**Recommendation:** option 1. `APPLICATIONINSIGHTS_CONNECTION_STRING` is a reserved
platform-injected name, so do NOT set it directly in `azure.yaml` (use option 2's alias if
going that route).

## Progress (2026-09-04)
- Portal App Insights link + redeploy did **not** inject the connection string into the
  container, and setting `APPLICATIONINSIGHTS_CONNECTION_STRING` in `azure.yaml` is **rejected**
  (reserved, 400). → Went with option 2: driver now also reads
  **`WAYPOINT_APPINSIGHTS_CONNECTION_STRING`** (commit `ad1d4ad`); value set in the azd env
  (not committed), referenced from `azure.yaml`. Deployed **v6**.
- **Telemetry confirmed initialising** in the hosted container (log:
  `Azure Monitor OpenTelemetry initialised`), connection string = `appi-dnszpz4hqfi7g`.
- **But spans still don't appear in App Insights** after ~7 min (well past ingestion lag).

### Leading hypothesis + fix
Foundry hosted-agent containers are **suspended between requests**, so the OTel
**BatchSpanProcessor** (async ~5s export timer) is frozen before it flushes — spans are created
but never exported. **Fix:** `forceFlush()` the tracer provider at the end of each turn (in
`traceAgentTurn`'s `finally`), or use a synchronous exporter, so spans are sent before the
response returns. Requires a small code change + rebuild + redeploy.

### `forceFlush` shipped, but spans still absent — infra wall (2026-09-04)
- Added `flushTracing()` (forceFlush) called per turn (commit `757966f`). **115/115 tests pass.**
- Local Docker builds produced an **identical digest** even with `--no-cache` (Docker
  Desktop/WSL2 stale build-context). Worked around it with **`az acr build`** (remote build
  from local source) → deployed the flush image.
- New container **initialises telemetry** (`Azure Monitor OpenTelemetry initialised`) and
  `forceFlush` runs with **no export/flush error** in logs.
- **But App Insights `appi-dnszpz4hqfi7g` has received ZERO data in the last 24h** (all tables)
  — nothing from the agent, the ACA app, or anything else. So exports aren't reaching it.

### Conclusion / next steps (infra, not app code)
Telemetry is correct and confirmed *initialising + flushing* in-container; the failure is in the
**data path to App Insights**. Most likely: **sandbox egress to the App Insights ingestion
endpoint is blocked** (hardened subscription — cf. keyless Cosmos/Foundry), so the exporter's
background POST fails while `forceFlush` still resolves; or the connection string is corrupted
through the azd-env → `azure.yaml` → container pipeline. To resolve:
1. Confirm the connection string arrives intact in the container (print a redacted prefix).
2. Test egress from the sandbox to the ingestion endpoint (`*.in.applicationinsights.azure.com`
   / `*.livediagnostics.monitor.azure.com`).
3. Verify `appi` ingestion is healthy (send a test event from a known-good client).

**INC-10 code is complete and correct; end-to-end trace visibility is blocked on the above
infrastructure item.**

### Root cause CONFIRMED (2026-09-04) — sandbox egress blocked
Sent a test event to `appi`'s ingestion endpoint (`https://swedencentral-0.in.applicationinsights.azure.com/v2/track`)
**from the dev machine** using the same connection string → response
**`{itemsReceived:1, itemsAccepted:1, errors:[]}`**. So:
- ✅ `appi` ingestion is healthy, the **connection string is valid**, and a normal network reaches it.
- ❌ The **Foundry hosted-agent sandbox cannot egress** to `*.in.applicationinsights.azure.com`,
  so the agent's exports (clean init + successful `forceFlush`, zero errors) never arrive.

This is a **platform egress restriction**, not an app/config bug. Options to get traces flowing:
1. **Allow sandbox egress** to the App Insights ingestion + live endpoints
   (`*.in.applicationinsights.azure.com`, `*.livediagnostics.monitor.azure.com`) — via the
   Foundry project's network/egress config, if exposed.
2. **Use the platform-native tracing path** — Foundry's own agent tracing (portal Observability)
   may route through the gateway rather than direct container egress; rely on that for the demo
   and keep our OTel spans for local/ACA where egress is open.
3. **Private Link / Azure Monitor Private Link Scope (AMPLS)** so the ingestion endpoint is
   reachable over the platform's allowed network.

The Waypoint app code (span mapping + flush) is correct and works wherever egress to App Insights
is permitted (e.g. the ACA deployment on `main`).

### ✅ CORRECTION (2026-09-04) — traces DO reach App Insights; egress is NOT blocked
The "egress blocked" conclusion above was **wrong** — caused by querying the **classic** table
names. `appi` is **workspace-based** (`ingestionMode: LogAnalytics`), so data lands in the Log
Analytics **`App*`** tables, not `dependencies`/`customEvents`.

Querying the backing workspace (`log-dnszpz4hqfi7g`, customerId `09be3e3a-…`):
```kql
union AppRequests, AppDependencies | where TimeGenerated > ago(60m) | where Name has_any ('invoke_agent','execute_tool','chat ')
```
→ **`invoke_agent`** present in **`AppRequests`** (11.4s, Success, OperationId `5c3d33c4…`). So the
hosted agent's GenAI trace **does** reach App Insights end-to-end. **INC-10 observability works.**

**Remaining refinement:** only the **root** `invoke_agent` span exports; the **child**
`execute_tool <tool>` / `chat <model>` spans don't yet appear (the join to `AppDependencies` by
OperationId is empty). Likely a child-span export/flush detail (e.g. children ended mid-turn while
the container CPU is paused, or the exporter batch only carried the root at `forceFlush`). Small
follow-up — the pipeline itself is proven.

**Query reads:** use `az monitor log-analytics query --workspace 09be3e3a-c867-4412-a410-25b8eeb2d4f6`
with `AppRequests`/`AppDependencies` (NOT the classic `az monitor app-insights query` tables), or
the Foundry portal Observability tab (same workspace).

### Richer traces shipped (2026-09-04, commit `d947b58`)
The trace now carries the **whole audit trail** (the same `AgentEvent` stream the web audit panel
uses): the **dialogue** (`waypoint.user_message` / `waypoint.assistant_reply` attributes +
`gen_ai.user.message` / `gen_ai.assistant.message` events) and **every audit item** as root span
events — `gen_ai.agent.decision`, `gen_ai.tool.call`, `gen_ai.tool.result` — each tagged with the
audit **type** (`mcp` / `skill` / `api` / model) exactly like the front-end reducer. Recorded as
**root span events** (not just child spans) so they reliably export from the hosted sandbox; child
`execute_tool`/`chat` spans remain as a bonus waterfall. 116/116 tests. Deployed; telemetry
confirmed initialising. Span events land in **`AppTraces`** linked by `OperationId`.

**Verify (after ingestion — ~15 min in this env):**
```kql
// the dialogue on the root request
AppRequests | where Name=='invoke_agent' | project TimeGenerated,
  tostring(Properties['waypoint.user_message']), tostring(Properties['waypoint.assistant_reply'])
// every audit item as trace events
AppTraces | where Message startswith 'gen_ai' | summarize count() by Message
```

### Reliable demo path — ACA emits to the Foundry-linked App Insights (2026-09-04)
Foundry hosted-agent trace delivery proved **unreliable** here (only 1 of ~10 turns landed —
the sandbox appears to freeze the container before the export POST completes). Fix for the
demo: the **ACA `api`** (not frozen) emits the *same* traces to the *same* App Insights the
Foundry project is linked to, so a live web-app chat shows in the Foundry portal Observability.
Wiring (runtime, on `ca-api-dnszpz4hqfi7g`):
```
az containerapp update -n ca-api-dnszpz4hqfi7g -g rg-waypoint \
  --image acrdnszpz4hqfi7g.azurecr.io/waypoint/waypoint-agent:inc9 \
  --set-env-vars "APPLICATIONINSIGHTS_CONNECTION_STRING=<appi cs>" "OTEL_SERVICE_NAME=waypoint-agent"
```
The `inc9` image is the branch api code (telemetry + `/responses`); the driver reads
`FOUNDRY_MODEL_URL` (already set on ACA) so the model still works. Verified: ACA `/api/chat`
streams a full real-model turn (copilot.chat + destination-advisor + travel-guide + cosmos +
personalise). Traces attribute to role **`waypoint-agent`**.

**Root cause of the initial "no ACA traces" (2026-09-04):** the first
`az containerapp update --set-env-vars "APPLICATIONINSIGHTS_CONNECTION_STRING=$CS"` ran in a
shell where `$CS` was **empty**, so the env var was set to `""`. The startup log then read
`Telemetry disabled (no APPLICATIONINSIGHTS_CONNECTION_STRING)` (the code guards on a falsy
string) and nothing was exported. Fix: re-set the var from the freshly-fetched 252-char
connection string; new revision `0000014` logs `Azure Monitor OpenTelemetry initialised`, and
a subsequent `/api/chat` turn (sessionId + message body) emits `invoke_agent` + gen_ai events
to the workspace `App*` tables. **Lesson:** always confirm the env value length on the
revision (`env[?name=='APPLICATIONINSIGHTS_CONNECTION_STRING'].value` → 252), not just that
the name is present.
