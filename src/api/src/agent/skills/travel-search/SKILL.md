---
name: travel-search
description: Search flights and hotels for a destination and dates, and produce a clearly-simulated booking. Use when a traveller asks to find or book flights and hotels for a chosen destination.
---

# Flight & Hotel Search + Simulated Booking

Search real flights and hotels and let the traveller "book" one — always as a
**clearly-labelled demo simulation**, never a real payment or reservation.

## Workflow

1. To search, call the **`travel-search`** tool with:
   - `destination`, `origin` (departure city), `checkIn` (outbound) and
     `checkOut` (return) as ISO `yyyy-mm-dd`, and `party` (number of travellers).
   - If the traveller has not given a departure city, ask for it before searching.
2. The tool does the grounding for you: it searches the **RouteStack sandbox** for
   flights and hotels and **normalises every price to GBP** via the Currency tool,
   recording the exchange rate and timestamp. You never fetch prices yourself.
3. Reply from the tool's result only:
   - `options` → confirm you found flights and hotels for the destination, priced
     in GBP, and invite the traveller to pick. The application renders the option
     cards (airline/route/duration/stops/price and hotel name/rating/nightly rate).
   - `missing-origin` → ask which city they are flying from.
   - `invalid-dates` → point out past or reversed dates and ask for valid ones.
   - `no-results` → say there is no availability and suggest adjusting the dates or
     destination.
   - `outside-coverage` → explain the demo sandbox covers a limited set of cities
     and suggest a covered one.
   - `party-clarify` → clarify or cap an unusually large party, then continue.
4. When the traveller chooses options to book, call **`booking-simulator`** with the
   zero-based `flightIndex` and `hotelIndex`. It returns a mock confirmation
   (reference code + itinerary echo + estimated GBP total).

## Response Rules

- Show prices in **GBP**. Preserve the supplier's currency behind the scenes and
  rely on the tool's conversion — never invent a price or an exchange rate.
- Present **at most three** flights and three hotels; note the "best" option where
  the tool marks one.
- The booking is **always simulated**: say so plainly, and never imply a payment was
  taken or a real reservation was made.
- Do not answer weather or destination-recommendation questions here — those belong
  to `weather-window` and `destination-advisor`.
