# FRD-003: Destination Advice

> Priority **P0**. Traces to PRD feature **F-004**. Depends on **FRD-001**, **FRD-006**.
>
> **[UI-REVISED 2026-08-15 — PLANNED INC-8]** Destination advice moves from a hardcoded
> candidate pool to **data-driven, month-aware, personalised** recommendations: grounded in
> a **travel-guide knowledge base (Azure AI Search)** and personalised from the **Cosmos
> profile** (preferences + past destinations). Two real MCP calls
> (`travel-guide.searchByMonth`, `cosmos.getTravellerProfile`) are made via the
> `waypoint-data` MCP and the agent reasons over both. See **ADR-008**, **ADR-009**.
> The current shipped behaviour (INC-3) uses the in-process `destination-advisor` pool; the
> requirements below describe the INC-8 target.

## Overview

A custom Copilot SDK Markdown skill, **`destination-advice`**, guides the agent's
destination-discovery workflow. In the **INC-8 target**, recommendations are **grounded in a
travel-guide knowledge base** (a PDF vectorised into **Azure AI Search**) and
**personalised** from the traveller's **Cosmos profile** — preferences and **past
destinations** — so the agent can answer "where should I go in June?" with month-appropriate,
preference-aware ideas that avoid places the traveller has recently visited, each with a
short rationale drawn from the guide. It is the entry point that later drives weather
(FRD-004) and flight/hotel search (FRD-005).

> **Current (INC-3):** the `destination-advisor` tool proposes/ranks candidates from an
> in-process pool. INC-8 replaces that source with the guide + profile (same
> `destination-list` UI contract).

### Skill and Tool Responsibilities

- `destination-advice` (`SKILL.md`) contains reusable procedural instructions:
  preference gathering, clarification, tool-selection, grounding, and response guidance.
- `destination-advisor` (TypeScript tool) owns runtime validation, deterministic domain
  rules, canonical destination data, and the structured result consumed by the UI.
- The Copilot SDK loads the Markdown skill natively from an application-owned skill
  directory and preloads it for the Waypoint runtime agent.

## Personas

- **Traveller** — describes what they enjoy and asks for ideas.
- **Holiday-Planning Agent** — invokes the skill and presents suggestions conversationally.

## User Stories

- As a **Traveller**, I can describe my interests in plain language and get destination suggestions with reasons.
- As a **Traveller**, if my description is too vague, the agent asks a focused follow-up question rather than guessing.
- As a **Traveller**, I can refine ("somewhere cheaper", "beach not city") and get an updated shortlist.

## Functional Requirements

- **FR-003-1** The `destination-advice` skill turns the traveller's interests (and an optional target **month**) into a **ranked list** (3–5) of destinations, each with a one-line rationale. **[INC-8]** Candidates are grounded in the **travel-guide** knowledge base (`travel-guide.searchByMonth`) and personalised from the **Cosmos profile** (`cosmos.getTravellerProfile`); the agent reasons over both. **When a month is named, the agent does not propose its own candidates — the guide supplies them; the `destination-advisor` tool only falls back to proposing candidates (the model's, or its deterministic pool) when the guide returns no results.**
- **FR-003-2** When input is insufficient to recommend (e.g. no preferences at all), the agent asks **one** clarifying question instead of returning a list.
- **FR-003-3** The skill supports **refinement**: a follow-up message adjusts the previous shortlist rather than restarting.
- **FR-003-4** Each suggestion includes a canonical place name usable by downstream skills (geocoding in FRD-004, search in FRD-005).
- **FR-003-5** **[INC-8]** The `travel-guide.searchByMonth` and `cosmos.getTravellerProfile` calls are emitted as audit events (type `mcp`); a guide-grounded rationale cites the travel guide. **[UI-REVISED 2026-08-17]** The "Suggested destinations" card shows a footnote **"Source: Waypoint Travel Guide eBook"**. A **"tell me more about X"** reply (web research, Wikipedia) shows a footnote **"Source: Web"**.
- **FR-003-6** **[INC-8]** For a target month, suggestions reflect the guide's month-appropriate picks and **avoid destinations the traveller has recently visited** (past destinations from the Cosmos profile).

## Acceptance Criteria

**AC-003-1 — Interests to shortlist**
- **Given** the Traveller says "I love warm weather, hiking, and good seafood"
- **When** the agent responds
- **Then** it returns 3–5 destinations, each with a short rationale tied to those interests.

**AC-003-2 — Vague input triggers a question**
- **Given** the Traveller says "recommend somewhere"
- **When** the agent responds
- **Then** it asks exactly one focused clarifying question (e.g. climate, budget, or activity) and does not fabricate a shortlist.

**AC-003-3 — Refinement**
- **Given** a shortlist was returned
- **When** the Traveller says "cheaper and more beach"
- **Then** the shortlist updates to reflect the new constraints.

**AC-003-4 — Downstream-ready names**
- **Given** a shortlist is returned
- **When** the Traveller picks one
- **Then** the chosen destination is expressed as a canonical name/location the weather and search skills can consume.

**AC-003-5 — Month-aware, guide-grounded & personalised** **[INC-8]**
- **Given** the Traveller asks "where should I go in June?"
- **When** the agent responds
- **Then** it calls `travel-guide.searchByMonth` and `cosmos.getTravellerProfile` (both visible as `mcp` audit entries), returns month-appropriate destinations grounded in the guide, applies the traveller's preferences, and avoids places they have recently visited.

## Edge Cases

| Condition | Expected behaviour |
|-----------|--------------------|
| Contradictory interests ("hot and snowy beaches") | Agent acknowledges the tension and offers options for each interpretation. |
| Extremely niche request with no good match | Agent says it has no strong match and suggests the closest alternatives. |
| Non-travel input | Agent gently steers back to trip planning. |
| **[INC-8]** No target month given | Agent uses stated interests/preferences, or asks for a month if timing matters. |
| **[INC-8]** No guide passage for a month/interest | Agent falls back to preference-based suggestions and says the guide had no strong match. |

## Error Handling

| Failure mode | System behaviour | User sees |
|--------------|------------------|-----------|
| Skill throws | Emit `error` audit entry; agent apologises and asks the Traveller to rephrase | "I couldn't work that out — could you rephrase?" |

## API & Data Requirements

**Current (INC-3):** internal Markdown skill plus in-process tool (no external HTTP).
**Target (INC-8):** two MCP calls via the `waypoint-data` server — `travel-guide.searchByMonth`
(Azure AI Search vector query over the guide PDF) and `cosmos.getTravellerProfile` (Cosmos DB)
— both keyless via managed identity. The agent reasons over the results. Tool result shape
emitted to the model/UI (unchanged UI contract):

```ts
type DestinationSuggestion = {
  name: string;            // canonical, e.g. "Lisbon, Portugal"
  rationale: string;       // one line, guide-grounded + personalised
  tags: string[];          // e.g. ["warm", "coastal", "food"]
};
```

## Dependencies

- **FRD-001** (runtime), **FRD-006** (Cosmos profile). **[INC-8]** Azure AI Search travel-guide index (ADR-008) + `waypoint-data` MCP (ADR-009).

## Non-Functional Requirements

- The skill must be small and heavily commented (demo teaching moment).

## Out of Scope

- Real-time pricing/availability (that is FRD-005); booking; itineraries beyond a shortlist.

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| All | F-004 Destination advice (Destination Advisor skill) |
