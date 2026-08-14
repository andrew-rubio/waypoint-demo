# Component Inventory — Waypoint

> Phase 1b artifact. Canonical component names, states, and **stable `data-testid`
> selectors** consumed by E2E Generation (POM selectors), Gherkin (scenario vocabulary),
> and Implementation (React component structure). Names here are binding across phases.

## Conventions
- `data-testid` uses kebab-case; dynamic items append an index/id (e.g. `flight-option-0`).
- Every interactive element has `cursor-pointer`, a visible focus ring, and an accessible name.

## Shell components

### AppHeader
- **testid:** `app-header`
- **Contains:** `BrandMark`, `UserChip`, `NewChatButton`, `AuditToggle`
- **Screens:** all

### BrandMark
- **testid:** `brand-home`
- **Behaviour:** the top-left logo is a link that navigates to the prototype menu / home (`index.html`)
- **States:** default, hover, focus

### UserChip
- **testid:** `user-chip`
- **Props:** name, tier, points. **Content:** "John Doe · Gold Tier · 7,463 Pts"
- **States:** default (static in demo)

### AuditToggle
- **testid:** `audit-toggle`
- **Props:** `aria-pressed` (open/closed), unseen-event count badge
- **States:** default, hover, active (`scale(0.97)`), open (pressed), has-unseen (badge)
- **Screens:** all

### NewChatButton
- **testid:** `new-chat`
- **Behaviour:** starts a fresh chat (navigates to the Welcome state)
- **States:** default, hover, active (`scale(0.97)`), focus
- **Screens:** all chat screens (S1–S5)

## Chat components

### MessageList
- **testid:** `message-list`
- **Role:** `log` / `aria-live="polite"` region wrapper for streamed replies
- **Screens:** S1, S2, S3, S4, S5

### MessageBubble
- **testid:** `message-{role}-{index}` (e.g. `message-user-0`, `message-assistant-1`)
- **Props:** role (user|assistant), content
- **States:** default, streaming (with `StreamingCaret`), error
- **Screens:** S2, S3, S4, S5

### StreamingCaret
- **testid:** `streaming-caret`
- **States:** visible while streaming; removed on `done`

### ToolProgressChip (inline)
- **testid:** `tool-progress-{name}` (e.g. `tool-progress-open-meteo`)
- **Purpose:** inline "calling Open-Meteo…" indicator during a turn
- **States:** pending (spinner), ok (check), error (alert)
- **Screens:** S2, S4, S5

### Composer
- **testid:** `composer`
- **Contains:** `ComposerInput` (`composer-input`, textarea), `SendButton` (`send-button`)
- **States:** empty (send disabled), typing, submitting (send shows spinner), error
- **Behaviour:** Enter submits, Shift+Enter newline; empty/whitespace blocked
- **Screens:** all

### PromptChip
- **testid:** `prompt-chip-{index}`
- **Props:** label. **Action:** fills composer and sends
- **States:** default, hover, active
- **Screens:** S1

## In-chat card components

### DestinationCard / DestinationList
- **testid:** `destination-list`, items `destination-item-{index}`
- **Props:** name, rationale, tags[]
- **Elements:** title, rationale line, `TagPill`s, "Explore" action
- **States:** default, selected
- **Screens:** S2, S5 · **FRD-003**

### WeatherWindowCard
- **testid:** `weather-window-card`
- **Props:** place, recommendedMonths[], avoidMonths[], source
- **Elements:** month rows (recommend/avoid), temp/precip note, "Source: Open-Meteo" caption
- **States:** default, insufficient-data, error
- **Screens:** S2, S5 · **FRD-004**

### FlightOptionCard / FlightOptionList
- **testid:** `flight-options`, items `flight-option-{index}`
- **Props:** airline, flightNumber?, from, to, durationMin, stops, departTime?, arriveTime?, pricePerTraveller (GBP/EUR), best
- **Elements:** airline · flight number, route, departs/arrives times, duration, stops, price, `BestBadge`, "Select"/"Selected"
- **States:** default, best, selected (button "Selected" + highlighted border), no-results
- **Select behaviour:** adds `the {ordinal} flight (Airline FlightNo)` to the composer; appends the hotel leg when a hotel is also selected
- **Screens:** S2, S3, S5 · **FRD-005**

### HotelOptionCard / HotelOptionList
- **testid:** `hotel-options`, items `hotel-option-{index}`
- **Props:** name, rating, address?, nightlyRate (GBP/EUR), best
- **Elements:** name, `RatingStars` + "{n}-star", address, nightly rate, taxes/fees note, "Select"/"Selected"
- **States:** default, selected (button "Selected" + highlighted border), no-results
- **Select behaviour:** adds `the {ordinal} hotel (Name)` to the composer
- **Screens:** S2, S3, S5 · **FRD-005**

### PersonalisationNote
- **testid:** `personalisation-note`
- **Props:** rationale (e.g. "Because you're Gold Tier (7,463 pts) and liked coastal Portugal, I'll pre-select an aisle seat + vegetarian meal…")
- **States:** present, unavailable (degraded banner variant)
- **Screens:** S2, S3, S5 · **FRD-006**

### TripSummaryCard
- **testid:** `trip-summary-card`
- **Props:** destination, dates, partySize, nights, roomCount, weatherNote, flight, hotel,
  totalGBP, totalEUR?, taxesAndFeesIncluded, appliedPreferences?, pointsBalance?
- **Elements:** header, itinerary rows, `BudgetBreakdown`, `CurrencyToggle`, `PreferenceNote`
- **States:** complete, partial (missing hotel/room count), personalisation-unavailable
- **Screens:** S3 · **FRD-007**

### BudgetBreakdown
- **testid:** `budget-breakdown`
- **Elements:** line items (flight × party, hotel × nights × rooms), total, taxes/fees note
- **Screens:** S3 · **FRD-007**

### CurrencyToggle
- **testid:** `currency-toggle`
- **Props:** active currency (GBP default | EUR), rate, rateTimestamp
- **States:** GBP (default), EUR (shows both + rate)
- **Screens:** S3 · **FRD-007**

### BookingConfirmation
- **testid:** `booking-confirmation`
- **Props:** ref, itinerary, estimatedTotalGBP, `simulated: true`
- **Elements:** "Demo simulation" ribbon, reference code, itinerary echo
- **States:** simulated (only)
- **Screens:** S3 · **FRD-005**

## Audit components

### AuditPanel
- **testid:** `audit-panel`
- **Role:** `complementary`, accessible name "Audit trail"
- **Contains:** `AuditPanelHeader`, `AuditList` / `AuditEmptyState`
- **States:** hidden, open; mobile = bottom sheet
- **Screens:** S4 (open) · overlay on S1/S2/S3/S5 · **FRD-002**

### AuditPanelHeader
- **testid:** `audit-panel-header`
- **Contains:** title, `AuditClearButton` (`audit-clear`), `AuditExportButton` (`audit-export`, P3)

### AuditList / AuditTurnGroup
- **testid:** `audit-list`, groups `audit-turn-{turnId}`
- **Purpose:** entries grouped by turn, newest-in-order

### AuditEntry
- **testid:** `audit-entry-{id}`
- **Props:** type (decision|skill|mcp|api), name, requestSummary, responseSummary,
  durationMs, status (pending|ok|error), reason?, ts
- **Elements:** `TypeBadge`, name, `StatusPill`, duration, `ExpandToggle`, detail (request/response, redacted)
- **States:** pending, ok, error, expanded/collapsed
- **Screens:** S4, S5 · **FRD-002**

### AuditEmptyState
- **testid:** `audit-empty`
- **Content:** "No agent activity yet"

## Shared primitives

| Component | testid | States | Notes |
|-----------|--------|--------|-------|
| Button | `btn-{action}` | default/hover/active/loading/disabled | `scale(0.97)` on active |
| IconButton | `iconbtn-{action}` | default/hover/active | SVG icon, aria-label |
| TagPill | `tag-{label}` | default | destination tags |
| BestBadge | `best-badge` | — | accent colour + label "Best" |
| RatingStars | `rating-stars` | — | aria-label "N of 5" |
| PreferenceNote | `preference-note` | present/unavailable | aisle seat + meal + points; icon + label, not colour-only |
| StatusPill | `status-pill` | pending/ok/error | icon + label |
| TypeBadge | `type-badge` | decision/skill/mcp/api | audit colour accents |
| ErrorNotice | `error-notice` | — | non-fatal in-chat error |
| Spinner | `spinner` | — | linear, subtle, honours reduced-motion |
| Tooltip | `tooltip-{target}` | delayed/instant-subsequent | origin-aware |
