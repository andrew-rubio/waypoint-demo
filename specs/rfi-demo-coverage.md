# RFI demonstration coverage — acceptance matrix

> **Branch scope note (`spec2cloud/control-selection-demo`).** This is the **governance-only
> recording cut**: it makes **zero change** to the Waypoint app, booking flow, runtime or
> browser. Rows describing application/runtime behaviour (e.g. a runtime-mode badge or a
> stale-currency fault) refer to the separate implementation branch
> (`spec2cloud/control-contracts`) and are **not present in this cut** — their proof comes
> from the **separately-recorded** app / evaluation / Foundry / observability segments. The
> governance segment here is captured per `specs/demo/governance-recording-runbook.md`.
>
> **Overall readiness: CONDITIONALLY READY.**
> The governance core is implemented and locally verified; several proofs require executed
> CI / Foundry-Azure / browser evidence that has not yet been run from a presenter
> environment. Statuses below separate **implementation** from **executed verification** and
> never claim a live/recorded proof that has not actually been produced.
>
> Dimensions per capability:
> - **impl**: implemented | partial | not-implemented
> - **verify**: local-automated | browser-e2e | github-actions | foundry-azure | not-verified
> - **demo**: live | prerecorded | fixture | narrative | not-shown
> - **ready**: ready | conditional | blocked
>
> Nothing here is claimed as an IAG production capability (see `src/governance/README.md`).

| # | Capability | impl | verify | demo | ready | Evidence / gap |
|---|---|---|---|---|---|---|
| 1 | Business proposition & intent | implemented | local-automated | live | conditional (pending rehearsal) | `npm run gov:trace` → matrix from `proposition.yaml` + `control-contract.yaml`; identifiers resolve to real controls/increments/tests. Example below. |
| 2 | Standards knowledge & control selection | implemented | local-automated | live+fixture | conditional | Executed: missing-classification + draft-policy findings (`select.test.ts`); policy/threshold change invalidates approval (`approval.test.ts`); `gov:change-impact` output. Synthetic — **not** an authoritative IAG policy repo. |
| 3 | Human/agent division & lifecycle | implemented | local-automated | live | conditional | `gov:status` derives stages from `deriveLifecycle` (pure); regression test proves removing/invalidating an artefact regresses the stage (`lifecycle.test.ts`). Approval stage needs a **valid** hash-binding, not a flag. |
| 4 | Reusable components | implemented | local-automated (structural) | fixture/structural | conditional | `reuse-inventory.yaml` proves component **boundaries + packaging conventions**, not cross-Operating-Company consumption. No reviewed recording yet. |
| 5 | Build reproducibility / ephemeral | implemented | not-verified | prerecorded (after a run) | blocked (authoritative CI) | `release-gate.yml` exists but has **not run** on the branch. Git-SHA digest is a **source** placeholder, not a built-image digest — must be replaced before any immutable-artefact certification claim. |
| 6 | Evaluations as release evidence | implemented | local-automated | live | conditional | **Executed** `npm run eval:demo-fail` (weather/guide_grounding below `eval/gate.json` → EVAL-GRD-001 **fail** → release **blocked**) and `npm run eval:demo-pass` (→ **approved**). Judge-run Foundry eval remains foundry-azure not-verified. |
| 7 | Foundry runtime proof | partial | local-automated (driver + badge build); foundry-azure not-verified | live only after execution; else narrative | blocked (Foundry-hosted claim) | Web badge (`src/web/app/RuntimeBadge.tsx` via `/api/runtime-info`) + driver-derivation built/tested; **not** yet corroborated with a real correlation-id trace + portal deployment evidence. |
| 8 | Identity & authority | partial | local config verified; foundry-azure not-verified | portal/prerecorded (after capture) | conditional | Managed-identity + MCP allowlist verified in config; deeper deployed platform identity is **external evidence not yet captured**. |
| 9 | Observability & correlation | implemented (in-process); partial (external) | in-process: local-automated; external: foundry-azure not-verified | live/prerecorded | conditional | Correlation propagation tested (`agent-spans.test.ts`, `gen_ai.conversation.id`). **One real correlation id in App Insights is not yet re-confirmed** for this branch. |
| 10 | Break / contain / recover | implemented | local-automated; browser-e2e not-verified | live only after rehearsal | conditional | `?fault=stale-currency` containment proven by `governance-runtime.test.ts`; the full **browser** journey (message → block → reset → approved booking) is not yet e2e-executed. |
| 11 | Learn & feedback | implemented | local-automated | live (fixture-provenance) | conditional | `gov:learn` writes `specs/learning/<id>.md`; the shipped example is generated from the **synthetic** stale-currency finding (fixture provenance). |
| 12 | Proposition dossier | implemented | local-automated | live | conditional | `gov:dossier` emits an **evidence-integrity** section marking unavailable/local-demonstration/absent-digest evidence; it does not fabricate success from samples. Authoritative dossier requires a CI evidence set. |
| 13 | Lifecycle status | implemented | local-automated | live | ready | `deriveLifecycle` is artefact-derived; regression test enforces that a removed/invalid artefact regresses the stage. |
| 14 | Cost attribution | not-implemented | not-verified | narrative/schema | n/a (no live proof) | `cost-manifest.yaml` is the future attribution **contract** (`illustrative-schema-only`); it is not cost attribution. No values invented. |
| 15 | Portability & federation | partial | not-verified | narrative | conditional | `federation.md` + path-loaded catalogue demonstrate **structural extraction boundaries + portable components** — not complete agent portability or an executed cross-Operating-Company deployment. |

## One complete requirement → release example (Area 1)
```
PRD-2 (personalised, budgeted trip)
  -> proposition characteristic: handlesPersonalData=true, externalIntegrations includes currency
  -> selected control: DATA-MIN-001 (blocking) + DATA-FRESH-001 (blocking)
  -> increment: INC-6 / INC-7 (+ INC-13)
  -> test/eval: data-minimisation adapter · governance-runtime.test.ts (currency-freshness)
  -> evidence entry: DATA-MIN-001/data-minimisation=pass · DATA-FRESH-001/currency-freshness-test=pass
  -> release decision: gov:verify -> (ci-authoritative + digest) approved / (local) demonstration-only
```
Command: `npm run gov:trace` (matrix) · output: stdout (+ `specs/governance/.out/*` for manifest/decision).

## Executed locally in this pass
`npm run eval:demo-fail` (blocked) · `npm run eval:demo-pass` (approved) · `npm run gov:demo-failure`
(SEC-MCP-001 block) · `npm run gov:change-impact` · `npm run gov:dossier` (integrity section) ·
`npm run gov:status` · `npm run test:gov` (32) · `npm run test:unit` (126) · `npm run build --workspace @waypoint/web`.

## NOT yet verified (required before READY)
1. GitHub Actions release-gate executed on the pushed branch (github-actions).
2. Immutable **image** digest (not Git SHA) certified and deployed (github-actions/foundry-azure).
3. Browser exact-itinerary approval + visible runtime badge (browser-e2e).
4. Foundry runtime corroboration chain: badge + metadata + correlation trace + portal + identity (foundry-azure).
5. End-to-end stale-currency containment + recovery in the browser (browser-e2e).

These are environment/rehearsal steps (push, CI, deploy, portal, browser) that cannot be
executed from this authoring environment; they are the remaining acceptance actions.

## Four proof moments
- **Build proof** — `gov:trace` (requirement -> release). *verify: local-automated.*
- **Assurance proof** — `eval:demo-fail` / `gov:demo-failure` -> block -> remediate -> `certify`. *verify: local-automated; github-actions not-verified.*
- **Runtime proof** — badge + correlation trace + Foundry portal. *verify: local-automated (badge); foundry-azure not-verified.*
- **Operational proof** — `?fault=stale-currency` contain -> recover -> dossier -> learn. *verify: local-automated; browser-e2e not-verified.*
