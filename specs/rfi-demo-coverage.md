# RFI demonstration coverage

> Honest status of the agentic-factory RFI story in this repository. Statuses:
> `implemented` · `automatically-tested` · `demonstrable-live` · `demonstrable-recorded` ·
> `represented-by-fixture` · `narrative-only` · `not-covered`.
>
> The control contract is the **evidence spine** across the journey; nothing below is
> claimed as an IAG production capability (see `src/governance/README.md` limitation).

| # | Capability | Repo artefact | Status | Proof | Priority | Limitation / non-claim |
|---|---|---|---|---|---|---|
| 1 | Business proposition & intent | `specs/governance/proposition.yaml`, `specs/prd.md`, `gov:trace` | implemented, automatically-tested | live (trace) | P1 | Stable-id chain is repo-local |
| 2 | Standards knowledge & control selection | `specs/governance/controls.yaml` (synthetic, policy metadata), `src/governance/src/select.ts` | implemented, automatically-tested | live + fixture | P1 | Synthetic catalogue, not authoritative IAG policy |
| 3 | Human/agent division & lifecycle | `.spec2cloud/state.json`, `gov:status`, `governance-audit.jsonl` | implemented | live (status) | P1 | Extends existing state; not a new control plane |
| 4 | Reusable components | `specs/governance/reuse-inventory.yaml` | implemented | recorded | P2 | No unchanged whole-agent cross-cloud copy |
| 5 | Build reproducibility / ephemeral | `.github/workflows/release-gate.yml` (npm ci, build-from-commit, digest) | implemented | recorded | P2/P3 | Full cloud ephemeral env is narrative-only |
| 6 | Evaluations as release evidence | `eval/`, `eval/gate.json`, failing-eval represented | implemented, automatically-tested | live/recorded | P1 | Judge variance; recorded sample for local |
| 7 | Foundry runtime proof | `/runtime-info` endpoint + UI badge + correlation trace + portal | implemented, automatically-tested | live + recorded | P1 | Badge is corroborated, not sole proof |
| 8 | Identity & authority | managed identity, MCP allowlist, `runtime-info` | implemented | recorded/portal | P2 | Deeper platform identity is external evidence |
| 9 | Observability & correlation | `agent-spans.ts` (`gen_ai.conversation.id`), audit panel | implemented, automatically-tested | live/recorded | P1 | UI audit = runtime-evidence subset |
| 10 | Break / contain / recover | `?fault=stale-currency` (+ existing faults), `governance-runtime.test.ts` | implemented, automatically-tested | live | P1 | Durable multi-day orchestration is narrative-only |
| 11 | Learn & feedback | `gov:learn` → `specs/learning/<id>.md` | implemented | live | P2 | Proposes only; never auto-changes code/controls |
| 12 | Proposition dossier | `gov:dossier` (JSON + Markdown) | implemented | live | P1 | References external evidence, not raw telemetry |
| 13 | Lifecycle status | `gov:status` derived from artefacts | implemented | live | P1 | CLI/Markdown; no new frontend |
| 14 | Cost attribution | `specs/governance/cost-manifest.yaml` | represented-by-fixture | schema | P3 | `illustrative-schema-only`; no invented values |
| 15 | Portability & federation | `specs/governance/federation.md`, importable catalogue path | narrative-only + structural | narrative | P2/P3 | No full runtime portability promised |

## Four proof moments
- **Build proof** — requirement → PRD → proposition → controls → increments → tests/evals (`gov:trace`).
- **Assurance proof** — `gov:demo-failure` (undeclared MCP) / failing eval → deterministic block → remediate → certify (`gov:certify`).
- **Runtime proof** — `/runtime-info` badge + correlation-id trace + Foundry portal corroboration.
- **Operational proof** — `?fault=stale-currency` → available but contained → preserved state → incident → recovery → dossier → learning.
