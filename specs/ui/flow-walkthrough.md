# Flow Walkthrough — Waypoint

> Phase 1b artifact and the **source of truth for e2e test flows** (Phase 2). Each flow
> maps to FRD acceptance criteria and the prototype states in [screen-map.md](screen-map.md).
> Prototypes are wireframes with realistic placeholder data (traveller: John Doe, Gold Tier, 7,463 pts).

## How to view
Serve the prototypes and browse from the hub:
```bash
npx serve specs/ui/prototypes --listen 3333
# open http://localhost:3333
```
Or open [walkthrough.html](walkthrough.html) for a replayable click-through.

---

## Flow 1 — First message (FRD-001)
**Screens:** [welcome.html](prototypes/welcome.html) → [conversation.html](prototypes/conversation.html)

1. The traveller lands on the **Welcome** state: greeting "Where shall we go, John?", four
   prompt chips, and the composer. Send is **disabled** until the input is non-empty.
2. They click a prompt chip (or type) → the message is sent and the app transitions to the
   **conversation**, where the assistant reply streams in (streaming caret).
3. **Decision point:** empty/whitespace input never sends (AC-001-2). Enter sends;
   Shift+Enter inserts a newline.

Covers: AC-001-1 (send & stream), AC-001-2 (empty rejected), AC-001-3 (ordering).

---

## Flow 2 — Destination advice, personalised (FRD-003, FRD-006)
**Screen:** [conversation.html](prototypes/conversation.html)

1. User: *"Somewhere warm in October — I love hiking, good seafood, and a relaxed pace."*
2. An inline **tool chip** shows "Checked your profile · Fabric IQ", then a
   **personalisation note**: *"Because you're Gold Tier (7,463 pts) and rated your coastal Portugal trip 5/5, I'll pre-select an aisle seat + vegetarian meal…"*
3. A **destination card** lists 3 ranked options (Lisbon, Palermo, Crete) with rationale + tags.
4. **Edge cases** (documented, shown in S5/other states): vague input → the agent asks one
   clarifying question; contradictory interests → it offers options per interpretation.

Covers: AC-003-1 (interests→shortlist), AC-003-2 (vague→question), AC-006-1 (personalised),
AC-006-3 (graceful degradation — see Flow 6).

---

## Flow 3 — Weather & best-time-to-travel (FRD-004)
**Screen:** [conversation.html](prototypes/conversation.html)

1. User picks Lisbon and asks about October weather.
2. Tool chips show **Open-Meteo · climate**. A **weather-window card** reports Ideal
   (May–Oct, 22°C/14°C, ~70mm) vs Avoid (Dec–Feb), captioned **"Source: Open-Meteo
   (ERA5 1991–2020 normals)"**.
3. **Edge cases:** unknown place → "couldn't locate"; ambiguous name → candidate list.

Covers: AC-004-1 (month weather), AC-004-2 (best time), AC-004-3 (data-grounded, source shown).

---

## Flow 4 — Flight & hotel search (FRD-005, FRD-006 preferences)
**Screen:** [conversation.html](prototypes/conversation.html)

1. In the same reply, tool chips show **RouteStack · flights + hotels**.
2. **Flight options** (≤3): TAP £128 (Best badge), BA £146, easyJet £97 — each "per traveller",
   **GBP-normalised**. The agent notes an **aisle seat + vegetarian meal** will be pre-selected
   from the traveller's preferences.
3. **Hotel options** (≤3): Memmo Alfama £175 (Best), Bairro Alto £320, Lisbon Wine £142.
4. Selecting a flight or hotel advances to the trip summary.

Covers: AC-005-1 (search happy path), AC-005-2 (missing origin prompt — asked earlier),
AC-006-2 (preference-aware — aisle seat + meal applied).

---

## Flow 5 — Trip summary, budget, currency & simulated booking (FRD-007, FRD-005)
**Screen:** [trip-summary.html](prototypes/trip-summary.html)

1. The **trip summary card** shows destination, dates (14–21 Oct), 2 travellers, 7 nights,
   1 room, weather note, chosen flight and hotel.
2. **Budget breakdown** shows the maths: `Flights £128 × 2 = £256`, `Hotel £175 × 7 × 1 =
   £1,225`, **Estimated total £1,481**, "Excludes taxes & fees (not specified by supplier)".
3. **Currency toggle** defaults to **GBP**; selecting **EUR** reveals `≈ €1,733` and the rate
   line (`1 GBP = 1.170 EUR · as of 12 Aug 2026`).
4. **Preference & points note**: aisle seat + vegetarian meal pre-selected; Gold Tier balance 7,463 pts.
5. **Booking confirmation** with a "Demo simulation" ribbon, success check, and reference
   `WAY-LIS-4X9K2` — explicitly *no payment, no real booking*.
6. Buttons: **Show the audit trail** (opens panel) and **Start over** (→ Welcome).

Covers: AC-007-1 (summary), AC-007-2 (EUR conversion + rate in audit), AC-007-3 (preferences + points shown),
AC-005-3 (simulated booking).

---

## Flow 6 — The audit trail (FRD-002) — the hero demo
**Screen:** [audit-panel.html](prototypes/audit-panel.html) (open by default) · toggle on every screen

1. The presenter clicks **Audit trail** in the header (`aria-pressed` flips; panel slides in
   from the right using the drawer easing). The header button turns slate to signal the
   developer surface.
2. Entries are **grouped by turn**, newest-in-order. Each shows a **type badge**
   (decision/skill/mcp/api), the tool **name** (mono), a **request/response summary**,
   **duration**, and **status** (pending/ok/error).
3. A **live `pending`** hotel-search entry (spinner) resolves to **ok** with a duration —
   demonstrating real-time streaming.
4. Clicking an entry **expands** it to show request/response, with **secrets redacted**
   (`apiKey: ***redacted***`) and a note that **no hidden model reasoning is captured**.
5. **Clear** empties the trail between demo runs; **Export** (P3) copies it.

Covers: AC-002-1 (toggle), AC-002-2 (live tool entry pending→ok), AC-002-3 (decision entries),
AC-002-4 (redaction), AC-002-5 (clear), AC-002-6 (error entry, not crash).

---

## Flow 7 — Degraded & error paths (FRD-004/005/006/007)
**Screen:** [error-states.html](prototypes/error-states.html)

1. **Weather MCP down** → non-fatal error notice + **Retry** button; audit shows
   `open-meteo.climate · error: timeout`.
2. **No availability** → warn notice suggesting date shifts; audit shows `0 results`.
3. **Sandbox quota reached** → explains failed searches don't cost a token.
4. **Fabric unavailable** → "personalisation unavailable" banner; the agent continues
   without the "knows me" tailoring (AC-006-3).
5. **Currency fallback** → shows GBP only when no live rate; audit shows `currency.convert ·
   error` (AC-007 edge case).

Each failure surfaces **both** in the chat and as an `error`-status audit entry — never a crash.

---

## UX questions for review
- **Q1:** On mobile the audit panel becomes a full-height overlay sheet — acceptable, or
  prefer a bottom sheet?
- **Q2:** Should selecting a flight/hotel auto-scroll to the summary, or require an explicit
  "Build my trip" action (current prototype uses the explicit button)?
- **Q3:** Is the "Demo simulation" ribbon prominent enough to avoid any impression of a real
  booking during a live demo?
