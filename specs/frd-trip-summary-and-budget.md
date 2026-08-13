# FRD-007: Trip Summary, Budget & Currency

> Priority **P1**. Traces to PRD features **F-009, F-011**. Depends on **FRD-004, FRD-005, FRD-006**.

## Overview

Once a destination, timing, flight, and hotel are chosen, the **`trip-summariser`** skill
assembles a readable itinerary card, and the **`budget-estimator`** skill totals the cost.
The summary reflects the traveller's **applied preferences** (aisle seat, meal) and
**loyalty points balance** from Fabric IQ (FRD-006). Prices are shown in **GBP by
default**, with an option to convert to **EUR** via a **Currency MCP** — chosen because the
demo audience is based in Spain.

## Personas

- **Traveller** — reviews the final trip summary and total cost.
- **Demo Presenter** — showcases GBP→EUR conversion and applied travel preferences.

## User Stories

- As a **Traveller**, I get a single, clear summary of my planned trip (destination, dates, weather note, flight, hotel).
- As a **Traveller**, I see the total estimated cost, and I can ask to see it in euros.
- As a **Traveller**, I see my applied travel preferences (aisle seat, meal) and loyalty points on the summary.

## Functional Requirements

- **FR-007-1** `trip-summariser` produces one summary containing: destination, dates, a one-line weather note (from FRD-004), the selected flight, and the selected hotel.
- **FR-007-2** `budget-estimator` calculates the estimated total in GBP as `(flight price per traveller × party size) + (nightly hotel rate × number of nights × room count)`. `number of nights` is the return date minus the outbound/check-in date. Taxes and fees are included only when the selected option explicitly marks them included; otherwise the summary labels the total as excluding unspecified taxes/fees.
- **FR-007-3** On request ("show in euros"), the agent reuses the Currency MCP conversion path introduced in FRD-005 to convert the total and each line item GBP→EUR. It displays GBP and EUR together and records the exchange rate and rate timestamp.
- **FR-007-4** The summary shows the traveller's applied preferences (aisle seat, meal) and their loyalty points balance, sourced from Fabric IQ (FRD-006). If personalisation is unavailable, these are omitted rather than guessed.
- **FR-007-5** If only partial selections exist (e.g. flight but no hotel), the summary reflects what's chosen and notes what's missing.
- **FR-007-6** Currency conversion and summary/budget skills are emitted as audit events (`mcp` for currency, `skill` for summariser/estimator).

## Acceptance Criteria

**AC-007-1 — Trip summary (happy path)**
- **Given** a destination, dates, a selected flight, and a selected hotel exist
- **When** the Traveller asks for a summary
- **Then** the agent shows one card with destination, dates, weather note, flight, hotel, party size, nights, room count, line-item calculations, and estimated total in GBP
- **And** it states whether taxes and fees are included.

**AC-007-2 — Convert to EUR**
- **Given** a GBP total is shown
- **When** the Traveller says "show that in euros"
- **Then** the agent calls the Currency MCP and displays each line item and total in EUR alongside GBP, with the rate and rate timestamp visible in the audit trail.

**AC-007-3 — Preferences & points shown**
- **Given** Fabric IQ provides an aisle-seat/vegetarian-meal preference and a 7,463-point balance
- **When** the summary is shown
- **Then** it notes the aisle seat and vegetarian meal are pre-selected and displays the points balance.

**AC-007-4 — Partial selection**
- **Given** a flight is chosen but no hotel
- **When** the Traveller asks for a summary
- **Then** the summary shows the flight and total-so-far and notes that no hotel is selected.

## Edge Cases

| Condition | Expected behaviour |
|-----------|--------------------|
| No selections yet | Agent explains there's nothing to summarise and prompts next steps. |
| Currency MCP returns stale/failed rate | Fall back to GBP only and note conversion is unavailable. |
| Preferences/points missing (FRD-006 degraded) | Show the summary without preferences or points and note personalisation is unavailable. |
| Supplier does not state taxes/fees | Label the estimate as excluding unspecified taxes/fees; do not infer an amount. |
| Room count missing | Ask for room count before producing a final estimate. |

## Error Handling

| Failure mode | System behaviour | User sees | Retried? |
|--------------|------------------|-----------|----------|
| Currency MCP timeout/error | Emit `error` audit entry; show GBP only | "Couldn't convert to EUR right now — showing GBP" | One retry |
| Summariser/estimator error | Emit `error`; ask to retry | "Couldn't build the summary — try again" | Manual |

## API & Data Requirements

**MCP:** Currency-exchange MCP (base **GBP**, target **EUR**).

```ts
type TripSummary = {
  destination: string;
  dates: { outbound: string; return: string };
  weatherNote: string;
  flight?: FlightOption;       // from FRD-005
  hotel?: HotelOption;         // from FRD-005
  partySize: number;
  nights: number;
  roomCount: number;
  totalGBP: number;
  totalEUR?: number;           // present only after conversion
  exchangeRate?: { rate: number; timestamp: string };
  taxesAndFeesIncluded: boolean;
  appliedPreferences?: { seat: string; meal: string };  // from FRD-006
  pointsBalance?: number;                                // from FRD-006
};
```

## Dependencies

- **FRD-004** (weather note), **FRD-005** (flight/hotel + prices), **FRD-006** (preferences + points).

## Non-Functional Requirements

- GBP is the default unit everywhere; EUR is on-request. Conversion rate must appear in the audit trail for transparency.

## Out of Scope

- Currencies other than GBP/EUR; tax/fees modelling; real invoicing; saving trips.

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| FR-007-1, AC-007-1, AC-007-4 | F-009 Trip summary / itinerary |
| FR-007-2..4, AC-007-2..3 | F-011 Budget estimate + currency conversion |
