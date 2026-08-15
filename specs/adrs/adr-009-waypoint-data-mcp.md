# ADR-009: Internal data retrieval — self-hosted "waypoint-data" MCP server + direct-grounding (Shape A)

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Stakeholder + orchestrator
- **Increment:** INC-6 (Cosmos tool) and INC-8 (travel-guide tool)

## Context

ADR-007 (Cosmos profile) and ADR-008 (travel-guide AI Search index) both need to be
reached through a **real MCP call** the presenter can show in the audit trail. Two
constraints shape the design:

1. **ADR-006 finding:** the Copilot SDK preview could not surface MCP tools to the
   Foundry-BYOK model session, so the model does not autonomously select MCP tools. The
   established pattern here is **direct grounding**: the API calls the source, emits the
   `mcp` audit lifecycle, and injects the results into the prompt for the model to reason
   over (as with Open-Meteo and RouteStack).
2. The stakeholder wants the agent to **reason over both** the profile and the guide.

## Decision

Host a single small **"waypoint-data" MCP server** (Streamable HTTP, its own Container
App, scale-to-zero) exposing two retrieval tools, and use **Shape A** — retrieval tools +
agent reasoning:

- `cosmos.getTravellerProfile` → reads the profile document from Cosmos DB (INC-6).
- `travel-guide.searchByMonth(month, …)` → hybrid vector query over the AI Search index
  (INC-8).

The Express API is the **MCP client**: on a destination turn it calls both tools over the
wire (genuine MCP protocol), emits `cosmos.*` / `travel-guide.*` audit entries, then feeds
the profile + guide passages to the Foundry model, which produces the month-aware,
preference-aware, guide-grounded shortlist (avoiding recently-visited past destinations).
The reasoning stays in the agent (visible), not hidden inside the MCP.

- **Auth:** the MCP server uses the Container App managed identity for Cosmos + AI Search
  (keyless). The API↔MCP hop is internal to the Container Apps environment.
- **Allowlist / audit:** `cosmos` and `travel-guide` are added to the audit MCP classifier
  and the runtime MCP allowlist; `microsoft-fabric-data-agent` / `fabric` are removed.
- **Offline/test:** deterministic in-process fallbacks back both tools so unit/BDD/e2e run
  without Azure (same pattern as RouteStack).

## Consequences

- **Positive:** two real MCP calls in the audit; the agent visibly reasons over real data;
  one cheap MCP host; consistent with the existing direct-grounding architecture; dodges
  the SDK↔MCP surfacing blocker.
- **Positive:** replaces the hardcoded `destination-advisor` pool (INC-8) with data-driven
  recommendations while keeping the same UI contract (`destination-list`).
- **Negative / trade-off:** we operate a small MCP server (extra Container App + Bicep) and
  act as the MCP client ourselves — the model does not "choose" the tool. Documented as an
  honest demo trade-off, mirroring ADR-006.
- **Alternative rejected:** Option B (one custom RAG MCP that hides retrieval+reasoning)
  and the official Azure MCP Server (broad generic surface) — both less transparent for a
  demo than two named retrieval tools + visible agent reasoning.
