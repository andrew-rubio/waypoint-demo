# ADR-012: Deterministic control-selection and release-contract governance

- **Status:** Accepted. Branch: `spec2cloud/control-contracts`. Date: 2026-09-06.
- **Deciders:** Stakeholder + orchestrator.
- **Increment:** INC-13 (new — see `specs/increment-plan.md`). Formalises **FRD-010**.

## Context

The agentic-factory RFI requires a demonstrable **govern / assure / release** story: an
intent becomes applicable standards and controls, a human approves what must be satisfied,
evidence is tied to the assessed source and artefact, and a blocking release decision gates
deployment — with synthetic demonstration policy clearly separated from a future central
enterprise service. Waypoint already had the build/run/observe/evaluate halves (FRD-001…009)
but no explicit control contract binding a proposition to the evidence that authorises release.

## Decision

Add an **isolated, deterministic** governance engine (`@waypoint/governance`) plus
repository-local synthetic artefacts and a CI release gate.

1. **Deterministic engine, not an LLM.** Control **selection** and release **verification**
   are pure TypeScript over declarative predicates and evidence outcomes. Proposition intake
   is **deterministic + human-authored**: a schema-driven template is generated, a human
   supplies + confirms every governance classification, and deterministic validation gates
   promotion. No LLM interprets the requirement/PRD into governance values, promotes a
   proposition, selects controls, approves a contract, or decides whether evidence passes.
2. **Synthetic catalogue.** The policy catalogue is labelled `synthetic: true`; the engine
   refuses to load a catalogue that is not. No regulatory citation or certification is claimed.
3. **Human-approved, HASH-BOUND approval (not cryptographic signature).** Approval binds an
   approval record to the sha256 of the canonicalised contract, proposition and catalogue.
   A content hash detects change but does not authenticate the approver, so the record sets
   `nonRepudiation: false` and the identity is labelled `self-asserted` for local demo. A
   production implementation would integrate enterprise identity, protected GitHub
   environments, Git commit signatures, or Sigstore/attestation.
4. **Deterministic canonicalisation.** The contract hash is computed over canonical JSON
   (keys sorted, arrays caller-sorted by id, timestamps and approval data excluded). Any
   material change (obligation, threshold, severity, applicable control, proposition)
   changes the hash and invalidates approval; non-material formatting does not.
5. **Evidence bound to source; verify outcomes not presence.** Adapters execute a check or
   parse an authoritative result and return `pass|fail|missing|not-applicable|error`. An
   adapter `error` on a blocking control blocks release. Each entry carries commit, run id,
   result-file hash, contract hash, artefact digest and producer. Evidence from a different
   commit is rejected.
6. **Release eligibility ≠ deployment; evidence mode is explicit.** `ci-authoritative`
   evidence with a certified immutable digest matching the deployment yields `approved`
   (deployable); anything local yields `demonstration-only` (never deployable). A local
   fallback can never become a production pass.
7. **One release gate; deployment depends on it.** `release-gate.yml` runs
   `test-and-evaluate → governance-release-decision → deploy`, where `deploy` needs the
   decision job and consumes the certified digest. To avoid duplicating expensive jobs the
   evaluation logic is invoked as a **reusable workflow** where practical; otherwise the
   gate runs the required checks directly (documented here). Least-privilege permissions;
   forked PRs cannot run privileged deploy steps.
8. **Structured audit, not a freeform log.** Governance events append to
   `specs/governance/governance-audit.jsonl` (JSON Lines: eventType, hashes, summary) —
   deviating from the AGENTS.md freeform `audit.log` because Git/PRs/workflow runs already
   provide narrative history and structured records avoid duplicating it. No secrets or
   private reasoning are recorded.
9. **Runtime proof is a corroboration chain (D1).** A `/runtime-info` endpoint + UI badge
   report the active driver derived from the real selection path; they are explicitly *not*
   the sole proof — the demo corroborates via the correlation-id trace in Application
   Insights and the Foundry/Azure portal. A local fallback never renders as Foundry-hosted.
10. **Runtime degradation = stale currency (D2).** The primary runtime-failure beat is
    deterministic stale-currency detection that contains budget/booking while keeping the
    service available; a deliberately failing evaluation remains the separate pre-release
    quality-gate beat. Neither is model-decided; neither is model rerouting.
11. **Proposition validity is separate from policy compliance.** Intake validation answers
    only *"is the proposition complete, well-typed and internally coherent?"* — it never
    rewrites a policy violation as malformed intake. Every cross-field rule is classified:
    - **Logical contradiction** (values cannot both hold *by definition*, e.g. a malformed
      boolean/enum) → **kept in intake validation** (`schemaErrors`/`consistencyErrors`).
    - **Risk/policy conflict** (values can coexist but policy requires a control/approval/
      remediation, e.g. `financialTransactions != none` + `humanInLoop = false`; or
      `dataClassification = confidential` + `handlesPersonalData = false`) → **moved to
      deterministic control selection** as a `policyFinding` (release-blocking) and/or a
      selected control; enforced by the release gate, not intake.
    - **Missing information** (a required fact is absent) → **kept as unresolved, fail closed.**
    `gov:intake:validate` fails only on `schemaErrors | unresolvedFields | consistencyErrors`;
    `policyFindings` are produced by `gov:select`. An accurately-declared high-risk
    proposition is valid input, then blocked at release until remediated (which changes the
    proposition hash and requires re-approval).

## Consequences

- **Positive:** a credible, deterministic, auditable release contract; the same engine can
  be extracted to a shared package/service; the demo tells the full RFI story with honest
  demo-vs-production boundaries.
- **Negative / limits:** synthetic policy only; hash-bound (not signed) approval; effective
  packaged runtime tool inventory is not fully enumerated in the demo; deeper platform
  identity is shown as external portal evidence, not repo-queried.
- **Deviations documented:** structured JSONL audit instead of freeform `audit.log`; module
  README at `src/governance/README.md` rather than a top-level `governance/`.
