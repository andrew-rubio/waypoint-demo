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
