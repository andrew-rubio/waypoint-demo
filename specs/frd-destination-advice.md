# FRD-003: Destination Advice

> Priority **P0**. Traces to PRD feature **F-004**. Depends on **FRD-001**.

## Overview

A custom Copilot SDK skill, **`destination-advisor`**, that turns free-text interests
("warm, walkable, great food, not too touristy") into a ranked shortlist of destinations
with a short rationale for each. It optionally consults personalisation data (FRD-006) but
functions without it. It is the entry point that later drives weather (FRD-004) and
flight/hotel search (FRD-005).

## Personas

- **Traveller** — describes what they enjoy and asks for ideas.
- **Holiday-Planning Agent** — invokes the skill and presents suggestions conversationally.

## User Stories

- As a **Traveller**, I can describe my interests in plain language and get destination suggestions with reasons.
- As a **Traveller**, if my description is too vague, the agent asks a focused follow-up question rather than guessing.
- As a **Traveller**, I can refine ("somewhere cheaper", "beach not city") and get an updated shortlist.

## Functional Requirements

- **FR-003-1** The `destination-advisor` skill accepts the traveller's stated interests/constraints and returns a **ranked list** (3–5) of destinations, each with a one-line rationale.
- **FR-003-2** When input is insufficient to recommend (e.g. no preferences at all), the agent asks **one** clarifying question instead of returning a list.
- **FR-003-3** The skill supports **refinement**: a follow-up message adjusts the previous shortlist rather than restarting.
- **FR-003-4** Each suggestion includes a canonical place name usable by downstream skills (geocoding in FRD-004, search in FRD-005).
- **FR-003-5** The skill invocation and its result are emitted as audit events (type `skill`).

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

## Edge Cases

| Condition | Expected behaviour |
|-----------|--------------------|
| Contradictory interests ("hot and snowy beaches") | Agent acknowledges the tension and offers options for each interpretation. |
| Extremely niche request with no good match | Agent says it has no strong match and suggests the closest alternatives. |
| Non-travel input | Agent gently steers back to trip planning. |

## Error Handling

| Failure mode | System behaviour | User sees |
|--------------|------------------|-----------|
| Skill throws | Emit `error` audit entry; agent apologises and asks the Traveller to rephrase | "I couldn't work that out — could you rephrase?" |

## API & Data Requirements

Internal skill (no external HTTP). Suggested shape emitted to the model/UI:

```ts
type DestinationSuggestion = {
  name: string;            // canonical, e.g. "Lisbon, Portugal"
  rationale: string;       // one line tied to stated interests
  tags: string[];          // e.g. ["warm", "coastal", "food"]
};
```

## Dependencies

- **FRD-001** (runtime). Optional enrichment from **FRD-006** (personalisation).

## Non-Functional Requirements

- The skill must be small and heavily commented (demo teaching moment).

## Out of Scope

- Real-time pricing/availability (that is FRD-005); booking; itineraries beyond a shortlist.

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| All | F-004 Destination advice (Destination Advisor skill) |
