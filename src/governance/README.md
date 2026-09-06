# @waypoint/governance

Deterministic **control-selection and release-contract** engine — the governance core of the
spec2cloud pipeline. It turns a business proposition into a human-approved, hash-bound
**control contract**, collects **source-bound evidence**, and produces a **blocking release
decision** that deployment depends on. Selection and verification are pure code — **an LLM
never decides whether a blocking control passes**.

The package is intentionally isolated (clean interfaces in `src/index.ts`) so it can later
be extracted into a shared package or a central control-selection service.

> **Roles are separated and no model is in the authoritative path:**
> ```
> Human defines and confirms governance facts.
> Deterministic rules select controls.
> Automated checks verify evidence.
> Human approves the contract.
> The release gate enforces the decision.
> ```

## Commands

```bash
npm run gov:intake:init   # deterministic intake template (every governance field UNRESOLVED)
npm run gov:intake:validate                          # schema validation; fails closed
npm run gov:intake:promote -- --confirmed-by "you"   # human-confirmed → proposition.yaml (+ content hash)
npm run gov:select        # deterministic control selection → control-selection.json
npm run gov:contract      # versioned, hash-bound control contract → control-contract.yaml
npx tsx src/governance/src/cli.ts approve --approver "you" --comment "..."   # hash-bound approval
npm run gov:evidence -- --mode local-demonstration      # collect evidence (or ci-authoritative)
npm run gov:verify        # release decision (blocked | demonstration-only | approved)
npm run gov:certify       # assert deployable (CI-authoritative + digest match)
npm run gov:demo-failure  # undeclared-MCP negative demo (blocks SEC-MCP-001; repo unchanged)
npm run gov:demo-pass     # positive counterpart
npm run gov:status        # lifecycle status derived from real artefacts
npm run test:gov          # engine unit tests
```

Proposition intake is **deterministic and human-authored** — `gov:intake:init` only copies
exact metadata (id/name from `package.json`, PRD reference, source commit); every governance
classification starts `UNRESOLVED` and must be supplied + confirmed by a human. No model
infers a governance value from prose.

## Hash-bound approval (not a digital signature)

Approval binds an approval record to the sha256 of the canonicalised contract, proposition
and catalogue. A content hash **detects change** but does **not authenticate the approver**,
so the record sets `nonRepudiation: false` and the local identity is `self-asserted`. Any
material change (obligation, threshold, severity, applicable control, proposition) changes
the contract hash and **invalidates approval**. A production implementation would integrate
enterprise identity, protected GitHub environments, Git commit signatures, or attestation.

## Evidence mode

- `ci-authoritative` — requires a certified immutable artefact digest matching the
  deployment; can yield `approved` (deployable).
- `local-demonstration` — a local/last-known identifier; the decision is
  `demonstration-only` and **never deployable**. A local fallback is never a production pass.

## Demo vs production boundary

**Demonstrated now (repository-local):** synthetic policy catalogue · deterministic selector
package · repository-based contract · hash-bound repository/PR approval · GitHub Actions
release gate · application tests and evaluations · CI evidence manifest · CI release decision.

**Proposed extraction later (future central factory):** centrally-governed policy repository ·
shared control-selection package/API · reusable organisation-level workflow · enterprise
approval + identity integration · central evidence index · factory control plane.

**Not claimed:** IAG's actual policies · a Group-wide control-selection service · enterprise
approval identity · production cross-cloud portability of complete agents · automatic
cross-provider model rerouting · full cost attribution · regulatory certification.

> **Limitation statement.** This repository demonstrates the contract, selection, evidence,
> and release-gating pattern using **synthetic policies and repository-local components**. It
> does not implement IAG's actual policies, a Group-wide control-selection service,
> enterprise approval identity, or regulatory certification. Those capabilities are
> represented as the future central-factory boundary.
