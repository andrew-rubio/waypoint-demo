# Demo recovery & prerecorded fallbacks

The live presentation may use selected live interactions but must NOT depend on unpredictable
model latency, external travel APIs, or long CI runs. Keep prerecorded backups for:

- The agentic specification/build sequence (spec2cloud → tests → contracts → implementation).
- The GitHub Actions release gate (`release-gate.yml`) run showing the blocking decision.
- The Foundry deployment proof (portal view: deployed agent version + identity).
- A runtime telemetry trace (App Insights, one `gen_ai.conversation.id`).
- The failure + recovery sequence (`?fault=stale-currency` → containment → `demo:reset`).

Recovery steps if a live beat fails:
- Governance beats are deterministic and local — re-run the exact command; `npm run demo:reset`
  restores state without touching committed source.
- If the hosted agent is cold/unavailable, switch to the local-driver (the badge will honestly
  say "Local deterministic driver") and use the prerecorded Foundry proof.
- If evaluations are slow, show the recorded eval result and `eval/gate.json` thresholds.
