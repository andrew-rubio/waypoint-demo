# FRD-006: Personalisation via Cosmos DB

> Priority **P1**. Traces to PRD feature **F-008**. Depends on **FRD-001**.
>
> **[UI-REVISED 2026-08-12]** B2C product — the corporate travel-policy dataset was
> removed and replaced with **reward points** (in the loyalty profile) and **travel
> preferences** (aisle seat, meal). No policy/governance data.
>
> **[UI-REVISED 2026-08-15]** The synthetic profile now lives in **Azure Cosmos DB**
> (serverless), retrieved through the self-hosted **`waypoint-data` MCP**
> (`cosmos.getTravellerProfile`). Microsoft Fabric was dropped — see **ADR-007** and
> **ADR-009**. Past trip history is reduced to **past destinations (city + country)**.

## Overview

The agent enriches its recommendations using a **synthetic** traveller profile stored in
**Azure Cosmos DB** (serverless) and retrieved over MCP via the self-hosted
**`waypoint-data`** server. This demonstrates "the agent knows me" — loyalty status and
**reward points**, **past destinations** (city + country), and **travel preferences** (seat
and meal). All data is fictional for one demo traveller, **"John Doe" (Gold Tier, 7,463
points)**. The agent must **degrade gracefully** and still function if the store is
unavailable.

## Personas

- **Traveller** ("John Doe") — benefits from personalised, preference-aware suggestions.
- **Holiday-Planning Agent** — queries the Cosmos profile and folds results into its reasoning.

## User Stories

- As a **Traveller**, the agent tailors suggestions to my loyalty status and past destinations.
- As a **Traveller**, the agent applies my travel preferences (aisle seat, vegetarian meal) at booking.
- As a **Demo Presenter**, I can visibly show the agent querying the Cosmos profile in the audit trail.

## Functional Requirements

- **FR-006-1** The agent can query the Cosmos profile (via the `waypoint-data` MCP, `cosmos.getTravellerProfile`) for the synthetic profile: **loyalty profile** (reward-programme membership number, tier, and reward points balance), **past destinations** (city + country), and **travel preferences** (seat — aisle/window/middle — and dietary requirement).
- **FR-006-2** Retrieved data influences destination suggestions (FRD-003 — including avoiding recently-visited past destinations), default origin (FRD-005), the applied seat + meal **at simulated booking** (FR-006-6), and the reward points shown in the header and summary (FRD-007). At **flight search** (FRD-005) the results are silently **ranked by the traveller's preferred airlines** (preferred first, backfilled with others to fill up to three), and each preferred flight is labelled **"Your Preferred"** — no chat note is shown at this step. **[UI-REVISED 2026-08-15]**
- **FR-006-3** When personalisation is used, the agent explains *why* ("Because you're Gold Tier and enjoyed Lisbon, Portugal before, and you prefer an aisle seat…").
- **FR-006-4** If the Cosmos profile is unavailable, the agent proceeds using only the live conversation and states that personalisation is unavailable.
- **FR-006-5** Every Cosmos MCP call (`cosmos.getTravellerProfile`) is emitted as an audit event (type `mcp`) with a query and result summary (secrets redacted).
- **FR-006-6** At **simulated booking** (FRD-005) the confirmation echoes the applied **seat assignment** (e.g. aisle seat 23C) and **in-flight meal** from saved preferences, states they can be **amended up to 30 days before departure**, and shows the **reward points earned** on this trip against the saved **membership number** with the **updated balance**. This accrual is **simulated for display only** and is never written back to Cosmos. **[UI-REVISED 2026-08-15]**

## Acceptance Criteria

**AC-006-1 — Personalised suggestion**
- **Given** John Doe's loyalty and past-destination data are available
- **When** the Traveller asks for destination ideas
- **Then** the agent's suggestions reference relevant profile facts (e.g. loyalty tier, a past destination) and it explains the reasoning.

**AC-006-2 — Preference-aware selection** **[UI-REVISED 2026-08-15]**
- **Given** the traveller's saved preferences are aisle seat and vegetarian meal
- **When** destination ideas are given (FRD-003)
- **Then** the agent notes that the saved aisle seat and vegetarian meal will be applied when the trip is booked
- **And** at the flight-search step (FRD-005) the flights are ranked by the traveller's preferred airlines (Vueling, British Airways), preferred flights are labelled "Your Preferred", and no chat note is shown.

**AC-006-3 — Graceful degradation**
- **Given** the Cosmos profile store is unreachable
- **When** the Traveller asks for ideas
- **Then** the agent still responds using conversation context and notes that personalised data is unavailable.

**AC-006-4 — Visible in audit trail**
- **Given** the panel is open
- **When** the agent queries the Cosmos profile
- **Then** an `mcp` audit entry shows the `cosmos.getTravellerProfile` query and a redacted result summary.

**AC-006-5 — Booking echoes applied personalisation** **[UI-REVISED 2026-08-15]**
- **Given** saved preferences (aisle seat, vegetarian meal) and reward membership 39302492
- **When** a booking is simulated (FRD-005)
- **Then** the confirmation notes the assigned aisle seat (e.g. 23C) and vegetarian in-flight meal
- **And** it states the preferences can be amended up to 30 days before departure
- **And** it shows the reward points earned on this trip and the updated balance against the membership number.

## Edge Cases

| Condition | Expected behaviour |
|-----------|--------------------|
| Partial data (preferences present, history missing) | Use what's available; don't fabricate the rest. |
| Conflicting data vs. stated preference | Prefer the Traveller's live statement; note the difference. |
| Empty dataset | Behave as if personalisation is unavailable. |

## Error Handling

| Failure mode | System behaviour | User sees | Retried? |
|--------------|------------------|-----------|----------|
| Cosmos MCP timeout/error | Emit `error` audit entry; degrade per AC-006-3 | "Personalised data is unavailable right now" | One retry |
| Malformed dataset | Skip that dataset; log a warning | Nothing (silent) | No |

## API & Data Requirements

**MCP:** `waypoint-data` (self-hosted) — `cosmos.getTravellerProfile` reads the profile from
**Azure Cosmos DB** (serverless) using the Container App's **managed identity** (keyless).
Synthetic document (fictional):

```ts
type LoyaltyProfile = {
  traveller: "John Doe";
  programme: "Waypoint Skyward";
  membershipNumber: "39302492";
  tier: "Gold";
  rewardPoints: number;                    // balance shown in header + summary (7,463)
  preferredAirlines: string[];
  preferredCabin: "Economy" | "Premium" | "Business";
};
type PastDestination = { city: string; country: string };   // city + country only
type TravelPreferences = {
  seat: "Aisle" | "Window" | "Middle" | "Any";
  dietary: "Vegetarian" | "Vegan" | "Halal" | "Kosher" | "Gluten-free" | "None";
  allergies?: string[];
};
// Simulated at booking time (FRD-005) — display only, never written back to Cosmos.
type BookingPersonalisation = {
  seatAssignment: string;   // consistent with seat pref: Aisle→C/D, Window→A/F, Middle→B/E (e.g. "23C")
  mealRequested: string;    // derived from `dietary`, e.g. "Vegetarian"
  pointsEarned: number;     // simulated reward-points accrual for this trip, e.g. 121
  newBalance: number;       // rewardPoints + pointsEarned (display only)
};
```

## Dependencies

- **FRD-001** (runtime). Consumed by **FRD-003, FRD-005, FRD-007**.

## Non-Functional Requirements

- All data synthetic; no real PII. Cosmos is reached via **managed identity** (keyless); any credentials are redacted in the audit.

## Out of Scope

- Writing back to Cosmos; real user accounts; **real** loyalty accrual (the booking confirmation shows a *simulated* reward-points accrual for display only — never persisted or sent to Cosmos); non-synthetic data sources.
- **Corporate/travel-policy data** (this is a B2C traveller product).
- Saved-companion datasets are stretch scope outside the MVP. *(The travel-guide knowledge base that grounds destination advice is covered by FRD-003 / INC-8.)*

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| All | F-008 Personalisation via Cosmos DB |
