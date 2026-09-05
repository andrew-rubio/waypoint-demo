# Demo data & fixtures

Deterministic, resettable fixtures used by the demo (restore with `npm run demo:reset`):

| Scenario | Trigger | Expected |
|----------|---------|----------|
| Successful itinerary | web app, plan + approve exact itinerary | simulated booking with approval id |
| Missing exact-itinerary approval | `?fault=booking-no-approval` | blocked + approval-required in audit |
| Undeclared MCP tool | `npm run gov:demo-failure` | release blocked, SEC-MCP-001, repo unchanged |
| Failed evaluation threshold | eval gate below threshold (recorded) | pre-release block |
| Runtime stale currency | `?fault=stale-currency` | contained; no booking; finding recorded |
| Corrected / recovered | `npm run demo:reset` + `?fault=booking-approved` | healthy flow proceeds |

Recorded samples (clearly labelled, non-authoritative):
`specs/governance/examples/eval-results.sample.json`, `.../test-results.sample.json`.
Authoritative evidence is CI-generated and uploaded as workflow artefacts.
