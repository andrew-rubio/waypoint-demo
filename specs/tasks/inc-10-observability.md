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
