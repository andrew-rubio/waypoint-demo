# Demo runbook — Waypoint agentic-factory governance

> Focused, reliable presenter path. Live where safe; prerecorded where latency/external
> APIs/long CI would make it fragile (see `demo-recovery.md`). Run `npm run demo:preflight`
> first; `npm run demo:reset` restores deterministic state between runs.

| # | Beat | Command / view | Say | Live/recorded |
|---|------|----------------|-----|---------------|
| 1 | Set the proposition | Waypoint web app | "A holiday-planning agent that books trips." | live |
| 2 | Intent → structured | `specs/prd.md`, `specs/governance/proposition.yaml` | "The requirement becomes a machine-readable proposition." | live |
| 3 | Compile controls | `npm run gov:select` | "Deterministic code selects applicable controls from synthetic policy." | live |
| 4 | Human accountability | `gov:contract` then `... approve --approver you` | "A human approves; approval is hash-bound to the exact contract." | live |
| 5 | Build via reuse | `specs/governance/reuse-inventory.yaml`, `.github/skills` | "Reusable skills, MCPs, evals, control schemas." | live |
| 6 | Deliberately fail | `npm run gov:demo-failure` | "An undeclared MCP tool blocks release, naming SEC-MCP-001." | live |
| 7 | Remediate & certify | `gov:demo-pass`; CI `gov:certify` | "Corrected, evidence valid, artefact certified." | live + recorded |
| 8 | Prove the runtime | `GET /runtime-info` badge + App Insights correlation trace + Foundry portal | "Badge + correlation trace + portal corroborate Foundry hosting." | live + recorded |
| 9 | Use the app | web app: plan a trip, then approve the exact itinerary | "Booking needs explicit itinerary-bound approval." | live |
| 10 | Break safely | `?fault=stale-currency` | "Stale rate data — the service stays up but the budget is contained." | live |
| 11 | Contain & recover | audit stream + `demo:reset` | "Deterministic containment; no unapproved booking; state preserved." | live |
| 12 | Dossier | `npm run gov:dossier` | "One proposition-level audit dossier." | live |
| 13 | Learn | `npm run gov:learn` | "The incident proposes an evaluation/backlog update for human review." | live |
| 14 | Reuse & federation | `specs/governance/federation.md` | "How this extracts to a central factory — with honest non-claims." | narrative |

Do not walk every schema field or all 13 controls; keep the catalogue for questions.
Duration guide: ~12–15 minutes. Safe pause points: after beats 4, 8, 11.
