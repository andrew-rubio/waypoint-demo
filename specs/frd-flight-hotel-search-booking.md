# FRD-005: Flight & Hotel Search + Simulated Booking

> Priority **P0** (search) / **P1** (booking). Traces to PRD features **F-006, F-007**.
> Depends on **FRD-001, FRD-003**.

## Overview

For a chosen destination and dates, the agent searches **live flights and hotels** via the
**RouteStack.ai MCP** (sandbox, which returns real cached data), preserves supplier
currency, normalises display prices to GBP through the Currency MCP, presents options, and lets
the Traveller "book" a selection. **Booking is simulated end-to-end** — a deterministic mock
confirmation is produced; no payment, no real reservation. Car rental is out of scope.

## Personas

- **Traveller** — provides destination/dates/party, reviews options, selects, "books".
- **Holiday-Planning Agent** — calls RouteStack, formats options, simulates booking.

## User Stories

- As a **Traveller**, once I've picked a destination, I can ask the agent to find flights and hotels.
- As a **Traveller**, I see a few clear options with key facts (price, times, stops / hotel name, rating, nightly rate).
- As a **Traveller**, I can pick an option and receive a mock booking confirmation.

## Functional Requirements

- **FR-005-1** The agent collects the minimum search inputs: **origin**, **destination**, **dates** (outbound/return), **party size**. Missing inputs are requested conversationally (default origin may be inferred from personalisation, FRD-006).
- **FR-005-2** The agent calls the RouteStack MCP to search **flights** and **hotels** and presents up to **3 options each**, with a "best" indicator where available.
- **FR-005-3** Flight options show airline, **flight number**, route, **departure/arrival times**, duration, stops, and whether the price is per traveller. Hotel options show name, **star rating (e.g. "5-star")**, **address**, nightly rate, and whether taxes/fees are included. `[UI-REVISED 2026-08-14]` Selecting a flight (or hotel) adds only that leg to the composer as `Book the first flight (Airline FlightNo)`, then selecting the other appends ` and the first hotel (Name)`; the chosen card shows a selected state (button reads "Selected", highlighted border).
- **FR-005-4** The backend preserves each supplier `amount` and ISO 4217 `currency`. If the supplier currency is not GBP, it calls the Currency MCP and stores the GBP amount, exchange rate, and rate timestamp before displaying the option. FRD-007 reuses this conversion path for EUR.
- **FR-005-5** Selecting an option triggers **`booking-simulator`**, which returns a deterministic mock confirmation (reference code, itinerary echo) **without** any payment or real reservation.
- **FR-005-6** The mock confirmation is clearly labelled as a simulation/demo.
- **FR-005-7** Every RouteStack MCP call and the booking simulation are emitted as audit events (`mcp` and `skill`/`api` respectively).

## Acceptance Criteria

**AC-005-1 — Flight + hotel search (happy path)**
- **Given** the Traveller has chosen "Lisbon" with valid dates and party size, and origin is known
- **When** they ask to find flights and hotels
- **Then** the agent returns up to 3 flight options and up to 3 hotel options with the required facts, prices normalised to GBP, and inclusions labelled.

**AC-005-2 — Missing input prompted**
- **Given** no origin is known
- **When** the Traveller asks to search
- **Then** the agent asks for the departure city before searching.

**AC-005-3 — Selection and simulated booking**
- **Given** options are shown
- **When** the Traveller says "book the JetBlue flight and the Hotel X"
- **Then** the agent returns a mock confirmation with a reference code and an itinerary echo, clearly marked as a demo simulation, and performs no payment.

**AC-005-4 — No availability**
- **Given** the search returns no results for the criteria
- **When** the agent responds
- **Then** it explains there's no availability and suggests adjusting dates/destination.

## Edge Cases

| Condition | Expected behaviour |
|-----------|--------------------|
| Invalid/past dates | Agent flags the issue and asks for valid dates. |
| Return before outbound | Agent detects and asks to correct. |
| Destination outside sandbox coverage | Agent explains limited demo coverage and suggests a covered city. |
| Party size > typical limits | Agent caps/clarifies and proceeds. |

## Error Handling

| Failure mode | System behaviour | User sees | Retried? |
|--------------|------------------|-----------|----------|
| RouteStack MCP timeout/error | Emit `error` audit entry | "Travel search is unavailable right now" | One retry |
| Sandbox token exhausted | Explain limit; note failed-search token refund behaviour | "Search quota reached for the demo" | No |
| Booking simulation error | Emit `error`; no confirmation issued | "Couldn't complete the (simulated) booking" | Manual retry |

## API & Data Requirements

**MCP:** RouteStack.ai (sandbox key `ROUTESTACK_API_KEY` from env). Flights + hotels only.
**MCP:** Currency exchange (base supplier currency, target GBP) when normalisation is required.

```ts
type Money = { amount: number; currency: string; includesTaxesAndFees: boolean };
type ConvertedMoney = { source: Money; amountGBP: number; rate: number; rateTimestamp: string };
type FlightOption = { airline: string; from: string; to: string; durationMin: number; stops: number; pricePerTraveller: ConvertedMoney; best?: boolean };
type HotelOption = { name: string; rating: number; nightlyRate: ConvertedMoney; best?: boolean };
type BookingConfirmation = { ref: string; simulated: true; itinerary: string; estimatedTotalGBP: number };
```

## Dependencies

- **FRD-001** (runtime), **FRD-003** (chosen destination). Optional default origin from **FRD-006**. Currency normalisation is introduced here and reused by **FRD-007**.

## Non-Functional Requirements

- Use the **sandbox** only; never enable real checkout. All secrets from env vars; keys redacted in audit.

## Out of Scope

- Real payment/reservation, seat selection, ancillaries, car rental, multi-city itineraries.

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| FR-005-1..4, AC-005-1..2, AC-005-4 | F-006 Live flight & hotel search |
| FR-005-5..6, AC-005-3 | F-007 Simulated booking |
