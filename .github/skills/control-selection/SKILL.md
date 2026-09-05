---
name: control-selection
description: >-
  Deterministic control selection and release-contract governance for spec2cloud. Turn a
  business proposition into a human-approved, hash-bound control contract, collect
  source-bound evidence, and produce a blocking release decision that deployment depends on.
  USE FOR: classify a proposition, select applicable controls, generate/approve a control
  contract, collect evidence, verify/certify a release, run the undeclared-MCP negative demo,
  generate a dossier/lifecycle status/learning artefact. Blocking selection and release
  verification are DETERMINISTIC CODE — never an LLM. Policies are SYNTHETIC demonstration
  content; no regulatory or IAG-policy claim.
---

# Control selection & release contract

## When to use
Any time a proposition needs governance: selecting controls, producing/approving a control
contract, collecting evidence, or gating a release. The engine lives in
`@waypoint/governance` (`src/governance`).

## Golden rules
- **Deterministic, not LLM.** Blocking control selection and release verification are pure
  code. An LLM may only draft a proposition, explain a control, or flag unresolved fields.
- **Synthetic policy.** The catalogue (`specs/governance/controls.yaml`) is labelled
  `synthetic: true`; the engine refuses any catalogue that is not. Never claim it is IAG
  policy or a certification.
- **Hash-bound, not signed.** Approval binds to content hashes and sets
  `nonRepudiation: false`. Any material change invalidates approval. Do not describe it as a
  cryptographic signature.
- **Evidence verifies outcomes.** Adapters execute a check or parse an authoritative result
  and return `pass|fail|missing|not-applicable|error`; an `error` on a blocking control
  blocks release. Evidence is bound to the assessed commit/artefact.
- **Local ≠ deployable.** `local-demonstration` evidence yields `demonstration-only` and is
  never deployable; only `ci-authoritative` evidence with a matching certified digest can be
  `approved`.
- **Ambiguity → human.** Mark ambiguous/high-impact proposition fields `unresolved`; never
  silently infer a high-risk value.

## Workflow
1. `npm run gov:select` — deterministic control selection from `proposition.yaml` + `controls.yaml`.
2. `npm run gov:contract` — versioned, hash-bound control contract (deterministic hash).
3. `npx tsx src/governance/src/cli.ts approve --approver "<id>"` — human hash-bound approval.
4. `npm run gov:evidence -- --mode ci-authoritative --digest <d>` — collect source-bound evidence.
5. `npm run gov:verify` / `npm run gov:certify` — blocking release decision / deployability.
6. `npm run gov:dossier` · `gov:trace` · `gov:status` · `gov:learn` — dossier, traceability, lifecycle, learning.
7. `npm run gov:demo-failure` / `gov:demo-pass` — undeclared-MCP negative/positive demonstration.

## Human gates
Contract approval is a human gate. The itinerary-bound booking approval and the release
decision are enforced deterministically. See FRD-010 and ADR-012.
