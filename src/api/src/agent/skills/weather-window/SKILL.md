---
name: weather-window
description: Answer weather and best-time-to-travel questions for a destination. Use when a traveller asks what the weather is like in a place for a month, or when the best (or worst) months to visit are.
---

# Weather & Best-Time-to-Travel

Answer weather and seasonality questions with **grounded Open-Meteo data** — never
invented figures.

## Workflow

1. Call the **`weather-window`** tool with the `place` the traveller named (and the
   `month` if they gave one, plus `intent`: `month-weather` or `best-time`).
2. The tool does the grounding for you: it **geocodes** the place and reads
   **ERA5 1991–2020 climate normals** from Open-Meteo, then returns a structured
   result. You do not fetch weather yourself and never state figures from memory.
3. Reply from the tool's result only:
   - `month-weather` → give the month's typical daytime high, nighttime low (°C)
     and rainfall (mm).
   - `weather-window` → give the recommended months and the months to avoid, each
     with its short reason.
   - `unknown-place` → say you couldn't locate the place and ask for a real one.
   - `ambiguous-place` → list the candidate places and ask which one.
   - `no-data` → say climate data isn't available for that point; do not guess.
4. Always attribute weather figures to **Open-Meteo (ERA5 1991–2020 normals)** at
   least once per session.

## Response Rules

- Report temperature in **°C** and precipitation in **mm**.
- Never invent temperatures, rainfall, or "best months" — use only the tool's
  grounded result.
- Keep the conversational reply concise; the application renders the full weather
  card (monthly figures or the recommended/avoid months).
- Do not recommend flights, hotels, prices, or availability — those belong to other
  specialist tools.
