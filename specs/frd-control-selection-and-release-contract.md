# FRD-010: Control Selection & Release Contract

> Priority **P1**. Branch **`spec2cloud/control-contracts`**. Formalises **INC-13**.
> Depends on **FRD-001** (agent runtime), **FRD-002** (audit stream), **FRD-008**
> (evaluation), **FRD-009** (governance/observability), **ADR-012** (this capability).
> Traces to the agentic-factory RFI **govern / assure / release** pillars.

## Overview

A lightweight, credible governance capability that turns a business requirement into a
**structured proposition → deterministic control selection → versioned, human-approved,
hash-bound control contract → source-bound evidence manifest → blocking release decision**,
enforced by a GitHub Actions gate that deployment explicitly depends on. The control
contract is the **evidence spine** across the whole delivery journey (build → assure →
run → observe → contain → learn), not a standalone subsystem.

The control-selection and release-verification logic is a **deterministic, isolated
workspace package** (`@waypoint/governance`) so it can later be extracted into a shared
package or a central control-selection service. **An LLM never decides whether a blocking
control passes** — blocking selection and release verification are pure code.

> **Synthetic & non-claim.** The policy catalogue is **synthetic demonstration content**.
> This capability does **not** implement IAG's actual policies, a Group-wide
> control-selection service, enterprise approval identity, or regulatory certification, and
> makes **no non-repudiation / digital-signature claim** (approval is *hash-bound*, not
> cryptographically signed). See `src/governance/README.md`.

## Personas

- **Proposition Owner** — accountable for the proposition; reviews and approves the contract.
- **Governance Lead** (C-level) — needs visible, deterministic, auditable controls and a release gate.
- **Engineer** — implements against control-aware increments and produces evidence.
- **Demo Presenter** — walks intent → controls → approval → evidence → release → runtime → contain → learn.

## Functional Requirements

- **FR-010-1** A **proposition declaration** captures machine-readable characteristics (LLM use, personal-data handling, autonomy, consequential actions, integrations, human-in-loop, retrieval, deployment surface) with stable IDs. Ambiguous/high-impact fields are marked `unresolved` and require human confirmation; no high-risk value is silently inferred.
- **FR-010-2** Organisational policy is represented as a **machine-readable synthetic catalogue** of controls, each carrying owner, provenance, version, effective date, status, source reference, obligation, enforcement stage, severity, applicability predicates, and required evidence.
- **FR-010-3** **Deterministic control selection** chooses applicable controls purely from proposition characteristics (declarative predicates; no LLM). Selection is order-stable and records the rationale + matching predicates per control.
- **FR-010-4** A **versioned control contract** records the selected controls and their obligations. The contract body is **canonicalised and hashed deterministically**; the generation timestamp is excluded from the hash so semantically-equivalent regeneration never invalidates approval.
- **FR-010-5** **Human, hash-bound approval** binds an approval record to the exact contract, proposition and policy-catalogue hashes, with approver identity, mechanism, and identity-assurance label. Any material change (proposition, controls, obligations, evidence, thresholds, severity) invalidates approval.
- **FR-010-6** The **increment plan incorporates the applicable controls**, mapped onto the increments where the relevant work is implemented, with a requirement → characteristic → control → increment → test/evaluation → evidence → release-decision traceability matrix.
- **FR-010-7** **Evidence adapters verify outcomes** (execute a check or inspect an authoritative result), not mere file presence, returning `pass | fail | missing | not-applicable | error`. An adapter `error` on a blocking control blocks release. Every evidence entry is **bound to the assessed source** (commit, workflow run, result-file hash, contract hash, artefact digest, producer).
- **FR-010-8** **Deterministic release verification** blocks release when the contract is unapproved/stale, any blocking control lacks passing source-bound evidence, or evidence is from a different commit. The decision distinguishes `approved | blocked | demonstration-only`; a **local fallback is never deployable** and never a production pass.
- **FR-010-9** A **GitHub Actions release gate** produces the release decision and **deployment explicitly depends on it** (`deploy needs governance-release-decision`), consuming the same certified artefact digest. Least-privilege permissions; forked PRs cannot run privileged deploy.
- **FR-010-10** A **machine-readable evidence manifest and release decision** are generated (JSON) with a human-readable **Markdown summary** published to the job summary. Example artefacts are clearly labelled illustrative; current execution evidence is CI-generated and uploaded as immutable workflow artefacts.
- **FR-010-11** An **itinerary-bound human-approval** control governs the consequential simulated booking: without an explicit approval bound to the exact itinerary, the booking does not execute and an `approval_required` event is emitted to the audit stream. The text "Book…" alone is **not** sufficient approval.
- **FR-010-12** A **runtime freshness control** deterministically detects **stale currency data** and blocks final budget/booking while keeping the service available; the model does not decide freshness. An incident/finding record is produced and a **learning artefact** is proposed for human review.
- **FR-010-13** A **proposition dossier** and **lifecycle status** are generated from real artefacts, referencing authoritative evidence rather than copying sensitive telemetry. A **runtime-metadata endpoint + UI badge** make the active execution mode unmistakable (D1 corroboration chain).

## Acceptance Criteria

**AC-010-1 — Deterministic selection**
- Given the Waypoint proposition and the synthetic catalogue
- When control selection runs
- Then the same applicable controls are selected every time, each with a rationale.

**AC-010-2 — Hash-bound approval invalidation**
- Given an approved control contract
- When the proposition, catalogue, a threshold, or a severity changes
- Then the prior approval is invalidated and `gov:verify` blocks release.

**AC-010-3 — Blocking on missing/failed/foreign evidence**
- Given an approved contract
- When a blocking control's evidence is missing, failing, errored, or from a different commit
- Then the release decision is `blocked` and names the control + remediation.

**AC-010-4 — Undeclared MCP tool blocks release**
- Given the approved allowlist
- When an undeclared tool is present in the configuration
- Then release is blocked naming `SEC-MCP-001`, and the repository is left valid.

**AC-010-5 — Itinerary-bound booking approval**
- Given a proposed itinerary with no approval bound to it
- When the agent requests simulated booking execution
- Then execution is blocked, an `approval_required` event is emitted, and the attempt is in the audit stream.
- And given an explicit approval for that exact itinerary, the simulated booking may proceed with the approval id in the audit event.

**AC-010-6 — Stale currency containment**
- Given a currency result older than the approved freshness threshold
- When a budget/booking is attempted
- Then deterministic code blocks final confirmation, the service stays available, the itinerary is preserved, an incident record is produced, and a learning artefact is proposed.

**AC-010-7 — Release eligibility vs deployment**
- Given CI-authoritative evidence with a certified digest matching the deployment
- When verification runs
- Then the decision is `approved` and deployable; a local run is `demonstration-only` and not deployable.

**AC-010-8 — Deployment depends on the decision**
- Given the release gate workflow
- When the governance-release-decision job fails
- Then the deploy job does not run.

**AC-010-9 — Runtime proof honesty**
- Given no Foundry hosting configured
- When the runtime badge is read
- Then it reports the local deterministic driver and never claims Foundry-hosted execution.

**AC-010-10 — No secrets or hidden reasoning in governance artefacts**
- Given any contract, manifest, decision, dossier, audit record, or runtime-info payload
- When inspected
- Then no secret, token, connection string, or private model reasoning is present.
