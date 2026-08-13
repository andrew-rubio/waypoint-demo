# FRD-006: Personalisation via Fabric IQ

> Priority **P1**. Traces to PRD feature **F-008**. Depends on **FRD-001**.
>
> **[UI-REVISED 2026-08-12]** B2C product — the corporate travel-policy dataset was
> removed and replaced with **reward points** (in the loyalty profile) and **travel
> preferences** (aisle seat, meal). No policy/governance data.

## Overview

The agent enriches its recommendations using **synthetic** traveller data served by a
**Microsoft Fabric Data Agent** (Fabric IQ) over MCP. This demonstrates "the agent knows
me" — loyalty status and **reward points**, past trips, and **travel preferences** (seat
and meal). All data is fictional for one demo traveller, **"John Doe" (Gold Tier, 7,463
points)**. The agent must **degrade gracefully** and still function if Fabric is
unavailable.

## Personas

- **Traveller** ("John Doe") — benefits from personalised, preference-aware suggestions.
- **Holiday-Planning Agent** — queries Fabric IQ and folds results into its reasoning.

## User Stories

- As a **Traveller**, the agent tailors suggestions to my loyalty status and past trips.
- As a **Traveller**, the agent applies my travel preferences (aisle seat, vegetarian meal) when presenting flights.
- As a **Demo Presenter**, I can visibly show the agent querying Fabric IQ in the audit trail.

## Functional Requirements

- **FR-006-1** The agent can query the Fabric Data Agent (MCP) for the approved MVP synthetic datasets: **loyalty profile** (incl. reward points balance), **past trip history**, and **travel preferences** (seat and meal).
- **FR-006-2** Retrieved data influences destination suggestions (FRD-003), default origin (FRD-005), which flight/cabin is pre-selected (seat + meal preference), and the loyalty points shown in the header and summary (FRD-007).
- **FR-006-3** When personalisation is used, the agent explains *why* ("Because you're Gold Tier and enjoyed coastal Portugal, and you prefer an aisle seat…").
- **FR-006-4** If Fabric is unavailable, the agent proceeds using only the live conversation and states that personalisation is unavailable.
- **FR-006-5** Every Fabric Data Agent MCP call is emitted as an audit event (type `mcp`) with a query and result summary (secrets redacted).

## Acceptance Criteria

**AC-006-1 — Personalised suggestion**
- **Given** John Doe's loyalty and trip-history data are available
- **When** the Traveller asks for destination ideas
- **Then** the agent's suggestions reference relevant profile facts (e.g. loyalty tier, past-trip similarity) and it explains the reasoning.

**AC-006-2 — Preference-aware selection**
- **Given** the traveller's saved preferences are aisle seat and vegetarian meal
- **When** flights are presented (FRD-005) or a trip is summarised (FRD-007)
- **Then** the agent notes that an aisle seat and vegetarian meal will be pre-selected.

**AC-006-3 — Graceful degradation**
- **Given** the Fabric Data Agent is unreachable
- **When** the Traveller asks for ideas
- **Then** the agent still responds using conversation context and notes that personalised data is unavailable.

**AC-006-4 — Visible in audit trail**
- **Given** the panel is open
- **When** the agent queries Fabric IQ
- **Then** an `mcp` audit entry shows the Fabric query and a redacted result summary.

## Edge Cases

| Condition | Expected behaviour |
|-----------|--------------------|
| Partial data (preferences present, history missing) | Use what's available; don't fabricate the rest. |
| Conflicting data vs. stated preference | Prefer the Traveller's live statement; note the difference. |
| Empty dataset | Behave as if personalisation is unavailable. |

## Error Handling

| Failure mode | System behaviour | User sees | Retried? |
|--------------|------------------|-----------|----------|
| Fabric MCP timeout/error | Emit `error` audit entry; degrade per AC-006-3 | "Personalised data is unavailable right now" | One retry |
| Malformed dataset | Skip that dataset; log a warning | Nothing (silent) | No |

## API & Data Requirements

**MCP:** Microsoft Fabric Data Agent (credentials from env vars). Synthetic datasets (fictional):

```ts
type LoyaltyProfile = { traveller: "John Doe"; tier: "Gold"; points: number; preferredAirlines: string[]; preferredChains: string[]; preferredCabin: string };
type PastTrip = { destination: string; dates: string; spendGBP: number; partySize: number; satisfaction: number };
type TravelPreferences = { seat: "Aisle" | "Window" | "Any"; meal: string; interests: string[]; pace: "relaxed" | "packed"; climate: string };
```

## Dependencies

- **FRD-001** (runtime). Consumed by **FRD-003, FRD-005, FRD-007**.

## Non-Functional Requirements

- All data synthetic; no real PII. Fabric credentials from env vars; redacted in audit.

## Out of Scope

- Writing back to Fabric; real user accounts; loyalty accrual; non-synthetic data sources.
- **Corporate/travel-policy data** (this is a B2C traveller product).
- Saved-companion and destination-knowledge datasets are stretch scope outside the MVP.

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| All | F-008 Personalisation via Fabric IQ |
