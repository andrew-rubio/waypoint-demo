# ADR-006: Wire Open-Meteo as the first real MCP server (weather & timing)

- **Status:** Accepted, then **revised** — the real-MCP approach was implemented and
  deployed but did not work with this SDK preview; **superseded by the "Update"
  section below (Option C: direct Open-Meteo REST grounding).**
- **Date:** 2026-08-14
- **Deciders:** Stakeholder + orchestrator
- **Increment:** INC-4 (FRD-004 — weather & best-time-to-travel)

## Context

INC-4 adds grounded weather answers (month climate + best-time-to-travel). FRD-004 and
`specs/tech-stack.md` call for the **Open-Meteo MCP** — "the first MCP server wiring" — so
the agent geocodes a place and reads reproducible ERA5 1991–2020 climate normals rather
than guessing figures.

The stakeholder chose **Option A — a real MCP server** (over a backend HTTP client that
merely emits MCP-shaped audit entries), for maximum spec fidelity and demo value: the
whole point of the demo is to show how little wiring the Copilot SDK needs to consume a
real MCP server, with every call observable in the audit trail.

Verified against the installed SDK (`@github/copilot-sdk` 1.0.9-preview.3):

- `SessionConfig` → custom agents accept **`mcpServers`** (keyed by server name; shape
  mirrors the standard MCP `mcpServers` schema). Marked `@experimental`.
- `McpServerConfig = McpServerConfigStdio | McpServerConfigHttp` — a **stdio** subprocess
  (`command`/`args`/`env`) or a **remote HTTP/SSE** endpoint.
- The existing `onPermissionRequest` hook already inspects `request.kind === 'mcp'` and
  enforces the `MCP_ALLOWLIST` (`open-meteo` is already allow-listed); `onPreToolUse` /
  `onPostToolUse` already surface tool lifecycle to the audit stream.

Researched MCP server (via npm): **`@cyanheads/open-meteo-mcp-server`** (Apache-2.0,
keyless for non-commercial use). Relevant tools:

- `openmeteo_search_locations` — geocoding (place → ranked coordinates + country + IANA
  timezone). Fails with a `no_results` error when nothing matches; a `count`/`country`
  filter disambiguates same-named places (e.g. "Springfield").
- `openmeteo_get_historical` — **ERA5** reanalysis archive (1940–present) with daily
  `temperature_2m_max` / `temperature_2m_min` / `precipitation_sum` on the same schema as
  the forecast API. This provides the FRD's 1991–2020 climate normals.
- `openmeteo_get_forecast` — up to 16 days ahead, labelled as a forecast (FR-004-2a).

Transports offered: **stdio** (`npx -y @cyanheads/open-meteo-mcp-server`) or **Streamable
HTTP** (self-host via the published `ghcr.io/cyanheads/open-meteo-mcp-server` image, or a
public instance). Prerequisite: Node.js **v24+** or Bun 1.3+.

## Decision

**Register `@cyanheads/open-meteo-mcp-server` as a real MCP server on the Waypoint custom
agent via the SDK's `customAgents[].mcpServers` config, using the stdio transport, with
the package bundled as an `src/api` dependency** (so it is present in the container image —
no runtime npm fetch). The API runtime image is bumped from **node:22-slim → node:24-slim**
to meet the server's Node 24+ requirement (the existing `ca-certificates` install carries
over).

- **Server key:** `open-meteo` (matches the allow-list and the audit `MCP_SERVERS` prefix).
- **Tools exposed to the agent (allow-listed subset):** `openmeteo_search_locations`,
  `openmeteo_get_historical`, `openmeteo_get_forecast`. The marine / air-quality / flood /
  ensemble / climate-projection / dataframe tools are out of scope for INC-4.
- **Audit naming:** the copilot driver normalises the real tool names to the friendly
  audit names the flow-walkthrough and prototypes already use —
  `openmeteo_search_locations → open-meteo.geocoding`,
  `openmeteo_get_historical`/`openmeteo_get_forecast → open-meteo.climate`. The audit
  reducer already classifies the `open-meteo` prefix as an `mcp` entry.
- **`weather-window` skill + tool:** a preloaded SKILL.md guides the agent
  (geocode → read climate/historical → structure the recommendation → cite the source),
  and a small, pure **`weather-window` tool** validates the MCP-provided monthly figures
  and shapes them into the `WeatherResult` contract (month-weather, best-time window,
  unknown/ambiguous place, no-data). This mirrors the INC-3 destination-advisor pattern:
  the trusted tool structures data the agent supplies from the MCP; it never invents
  figures.
- **Determinism for tests/offline:** the `LocalAgentDriver` and the `weather-window` tool
  fall back to an **embedded ERA5-style climate table** (the safety net, analogous to the
  destination `POOL`) so Vitest/Cucumber/Playwright are deterministic and offline. The
  real MCP is only exercised by the production `CopilotAgentDriver`.
- **Degradation (FR-004 error handling):** MCP geocoding/weather failures surface a
  non-fatal chat notice **and** an `error`-status `open-meteo` audit entry — never a crash
  (one retry then give up, per the FRD).

## Consequences

- **Positive:** A genuine MCP server, consumed with a few lines of SDK config — exactly the
  demo's thesis. Real, reproducible Open-Meteo ERA5 data; every geocoding/climate call is
  observable and redaction-safe in the audit trail.
- **Positive:** No new Azure resource — the MCP runs in-process to the API container as a
  stdio subprocess managed by the SDK runtime; `azd down` needs no change.
- **Cost:** ~£0 — Open-Meteo is free/keyless for non-commercial use; no new secret.
- **Trade-off / risk:** adds a bundled dependency + a Node major-version bump (22→24) to the
  API image, and a subprocess at agent runtime (cold-start + memory). The `mcpServers`
  field is `@experimental`. Validated at INC-4 Step 4 (deploy) before ship; fallback options
  below de-risk it.
- **Security:** `open-meteo` stays on the MCP allow-list; keyless (no secret to leak); tool
  results are HTML-sanitised/markdown-filtered and summaries redacted at the SSE boundary.
- **Spec touch-ups:** none material — FRD-004 and tech-stack already specify the Open-Meteo
  MCP; this ADR records the concrete package, transport, tool subset, and audit naming.

## Alternatives considered

- **Option B — backend HTTP client emitting `open-meteo.*` audit entries:** most robust and
  simplest to deploy, but not a *real* MCP server — rejected by the stakeholder for weaker
  spec fidelity / demo value.
- **Self-hosted Streamable-HTTP MCP as its own Container App** (`ghcr.io/cyanheads/...`):
  avoids the Node-version bump and the subprocess, and is a "real microservice" story, but
  adds a third Azure resource + infra-contract change. Kept as the **fallback** if the
  stdio subprocess proves unreliable in Container Apps at Step 4.
- **Public hosted instance** (`https://open-meteo.caseyjhand.com/mcp`): zero-install, but a
  third-party personal endpoint is an unacceptable reliability/trust dependency for a live
  demo — rejected.
- **stdio via `npx` fetching at runtime:** avoided — bundling the package as a dependency
  keeps startup offline and deterministic.

## Update (2026-08-14): pivot to Option C — direct Open-Meteo REST grounding

**What we tried and observed.** The real-MCP approach was fully implemented and deployed,
including the self-hosted fallback:

1. `@cyanheads/open-meteo-mcp-server` bundled as a stdio subprocess via
   `customAgents[].mcpServers` (API image bumped to node:24) — no MCP calls; the model said
   Open-Meteo was "not available" and reached for a built-in `sql`/todos tool.
2. Self-hosted as its **own internal Container App** (`ca-openmeteo`, Streamable HTTP) and
   wired three ways: `customAgents[].mcpServers`, **session-level `mcpServers`**, and the
   runtime **`client.mcp.config.add` + `enable`** API — plus a forceful "you MUST call the
   MCP first, never answer from memory" system prompt.
3. Repointed at the **public** `open-meteo.caseyjhand.com/mcp` instance.

In every case the MCP server received **zero requests** and the model never invoked the
`openmeteo_*` tools. Conclusion: **`@github/copilot-sdk` 1.0.9-preview.3 does not surface
programmatically-registered MCP tools to a Microsoft Foundry BYOK session** in this setup —
independent of MCP transport or hosting.

**Decision (Option C).** Ground weather via a **direct Open-Meteo REST client**
(`src/api/src/tools/open-meteo.ts`) called from the `weather-window` tool handler in the
Copilot driver. It performs real geocoding (`geocoding-api.open-meteo.com`) and reads real
**ERA5 1991–2020** normals (`archive-api.open-meteo.com`, aggregated to monthly °C/mm), and
emits the same observable **`open-meteo.geocoding` + `open-meteo.climate`** audit entries —
so the live-grounding-in-the-audit demo value is delivered **reliably**, without depending
on the broken SDK↔MCP bridge. It uses the same free, keyless Open-Meteo API the MCP wrapped,
so the data is identical.

**Consequences of the pivot.**
- Removed the `ca-openmeteo` Container App (Bicep module + `OPEN_METEO_MCP_URL`), reverted
  the API image to **node:22-slim**, and dropped the `@cyanheads/open-meteo-mcp-server`
  dependency. Simpler, cheaper (one fewer container), no `@experimental` SDK surface.
- Restricted the agent to our own tools (`availableTools: ['custom:*']`), which also removed
  the SDK's built-in `sql`/todos tool leak observed during the MCP attempts.
- Trade-off: not a *separately-running* MCP server — the "look how easy MCP wiring is" flourish
  is deferred until the SDK's MCP support stabilises. The audit trail still shows real,
  observable, redaction-safe Open-Meteo calls.
- Deterministic local/test path is unchanged (embedded ERA5-style model; the real REST calls
  run only in the deployed Copilot/Foundry driver).