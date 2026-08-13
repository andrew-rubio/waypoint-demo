# FRD-004: Weather & Best-Time-to-Travel

> Priority **P0**. Traces to PRD feature **F-005**. Depends on **FRD-001**.

## Overview

The **`weather-window`** skill plus the **Open-Meteo MCP** let the agent answer "what's the
weather like there in June?" and "when is the best time to go?". The agent geocodes a place,
retrieves reproducible monthly climate aggregates and/or a forecast, and translates the numbers into a
plain-English recommendation of ideal (and poor) travel months.

## Personas

- **Traveller** — asks about weather/seasonality for a destination.
- **Holiday-Planning Agent** — calls the Open-Meteo MCP and interprets results.

## User Stories

- As a **Traveller**, I can ask what the weather is like in a place for a given month and get a clear answer.
- As a **Traveller**, I can ask "when's the best time to visit X?" and get recommended months with reasons.
- As a **Traveller**, weather guidance is grounded in real data, not guessed.

## Functional Requirements

- **FR-004-1** The agent resolves a place name to coordinates via the Open-Meteo **geocoding** endpoint before requesting weather.
- **FR-004-2** For a specific month outside the reliable forecast horizon, the agent uses Open-Meteo ERA5 historical data for the **1991–2020** baseline, aggregates daily minimum/maximum temperature and precipitation by calendar month, and reports temperature in **°C** and precipitation in **mm**. At least 90% of expected daily observations must be present; otherwise the answer is marked insufficient-data.
- **FR-004-2a** For dates within the reliable forecast horizon, the agent uses the forecast endpoint and labels the result as a forecast rather than a climate typical.
- **FR-004-3** For "best time to visit", the `weather-window` skill evaluates monthly data and returns recommended months and months to avoid, each with a short reason.
- **FR-004-4** Weather answers cite that data comes from Open-Meteo (attribution) at least once per session.
- **FR-004-5** Every Open-Meteo MCP call (geocoding + weather) is emitted as an audit event (type `mcp`) with request/response summaries.

## Acceptance Criteria

**AC-004-1 — Month weather (happy path)**
- **Given** the Traveller asks "What's the weather like in Lisbon in June?"
- **When** the agent responds
- **Then** it geocodes Lisbon, retrieves June data for the 1991–2020 ERA5 baseline, and reports the monthly aggregate daily temperature range in °C and precipitation in mm in plain English.

**AC-004-2 — Best time to visit**
- **Given** the Traveller asks "When's the best time to visit Iceland?"
- **When** the agent responds
- **Then** it returns recommended months and months to avoid, each with a brief weather-based reason.

**AC-004-3 — Data-grounded**
- **Given** any weather answer
- **When** it is produced
- **Then** it is derived from an Open-Meteo response visible in the audit trail (no fabricated figures).

**AC-004-4 — Unknown place**
- **Given** the Traveller asks about "Wakanda"
- **When** geocoding returns no match
- **Then** the agent says it couldn't locate the place and asks for a real destination.

## Edge Cases

| Condition | Expected behaviour |
|-----------|--------------------|
| Ambiguous name ("Springfield") | Agent lists candidate matches and asks which one. |
| Open-ocean / no land data | Agent explains data isn't available for that point. |
| Far-future/relative date ("next winter") | Agent maps it to month(s) and uses climate normals. |
| Less than 90% baseline completeness | Agent does not calculate a typical; it reports insufficient climate data. |

## Error Handling

| Failure mode | System behaviour | User sees | Retried? |
|--------------|------------------|-----------|----------|
| Geocoding MCP timeout | Emit `error` audit entry | "I couldn't look that place up just now" | One retry, then give up |
| Weather MCP failure | Emit `error` audit entry | "Weather data is unavailable right now" | One retry |
| Free-tier rate limit hit | Degrade gracefully, explain | "Weather service is busy — try again shortly" | No |

## API & Data Requirements

**MCP:** Open-Meteo MCP wrapping the free Open-Meteo endpoints:
- Geocoding: place → `{ latitude, longitude, name, country }`.
- Weather: forecast or ERA5 historical daily series → temperature and precipitation series.
- Climate aggregation: 1991–2020 inclusive; group by calendar month; require >=90% daily completeness; output °C and mm.

```ts
type WeatherWindow = {
  place: string;
  recommendedMonths: { month: string; reason: string }[];
  avoidMonths: { month: string; reason: string }[];
  source: "open-meteo";
};
```

## Dependencies

- **FRD-001** (runtime). Open-Meteo MCP server configured (no API key required).

## Non-Functional Requirements

- Open-Meteo attribution respected (CC BY 4.0). Calls must be resilient to free-tier limits.

## Out of Scope

- Long-range daily forecasts beyond model limits; severe-weather alerting; marine/air-quality data.

## Traceability

| Requirement | PRD Source |
|-------------|-----------|
| All | F-005 Weather & best-time-to-travel (Open-Meteo MCP) |
