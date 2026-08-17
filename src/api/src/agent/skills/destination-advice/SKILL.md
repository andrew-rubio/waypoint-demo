---
name: destination-advice
description: Guide destination discovery when a traveller asks where to go, requests recommendations, gives travel preferences, or refines a previous shortlist.
---

# Destination Advice

Use this workflow for destination selection and refinement.

## Workflow

1. Identify the traveller's stated climate, activity, food, budget, pace, and
   location preferences without inventing missing preferences.
2. Call `destination-advisor` for every destination recommendation, refinement,
   closest-match request, or travel-domain redirect. **If the traveller names a
   specific month, do NOT propose candidates — the travel guide supplies
   month-appropriate options; call the tool with just the interests and month.**
   Otherwise, propose three to five candidate destinations you consider a strong
   fit, each with a canonical "City, Country" name, a one-line rationale, and the
   matchedPreferences it satisfies. The tool validates, de-duplicates, and ranks
   the guide's passages (for a month) or your candidates (otherwise).
3. If the tool returns `clarification`, ask exactly one focused question using
   the tool's message. Do not show destination suggestions.
4. If the tool returns `shortlist`, ground the answer only in its suggestions
   and preserve every canonical place name exactly.
5. If the tool returns `no-match`, say there is no strong match and present the
   returned closest alternatives as tradeoffs rather than exact matches.
6. If the tool returns `redirect`, briefly steer the conversation back to trip
   planning using the returned message.
7. On a follow-up, refine the previous shortlist instead of starting over.

## Response Rules

- Keep the conversational answer concise; the application renders the full
  structured shortlist as cards.
- Explain why each recommendation fits the stated interests.
- Present no more than the destinations returned by the tool.
- Never invent prices, availability, live weather, journey times, or booking
  details. Those belong to later specialist tools.
- Do not alter canonical destination names.
