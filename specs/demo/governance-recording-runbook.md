# Governance recording runbook (control-selection segment)

> Branch: `spec2cloud/control-selection-demo` (governance-only; **zero change** to the
> Waypoint app, booking flow, runtime or browser). Deterministic + offline — no dependency
> on Foundry availability, external travel APIs, or live model latency. Reset between takes
> with `npm run demo:governance-reset`.
>
> **Non-claims to state on camera:** policies are **synthetic** demonstration content (not
> actual IAG policy); the local selector demonstrates the **future central-service contract**;
> approval is **hash-bound local demonstration** approval (not enterprise identity / not a
> digital signature); fixtures demonstrate **release-gate behaviour**, not a production IAG
> deployment; the surrounding Foundry / evaluation / runtime / App Insights proof is in the
> **separately-recorded segments**.

## Command sequence + expected output

> Human defines and confirms governance facts. Deterministic rules select controls.
> Automated checks verify evidence. A human approves the contract. The release gate enforces
> the decision. **No model interprets the requirement or PRD into governance values.**

### Segment 1 — Deterministic governance intake
```bash
npm run demo:governance-reset     # restore baseline, clear the draft + generated evidence
npm run gov:intake:init           # deterministic template — every governance field UNRESOLVED
npm run gov:intake:validate       # BLOCKED — lists the exact unresolved YAML paths; no controls selected
# ...an accountable human supplies the mandatory classifications + declares approvedTools...
npm run gov:intake:validate       # PASSED
npx tsx src/governance/src/cli.ts intake-promote --confirmed-by "andrew@demo"   # records content hash + self-asserted confirmation
```
> **Windows note:** the two commands that take a `--flag value` (`intake-promote`,
> `approve`) must be run via the direct `npx tsx src/governance/src/cli.ts …` form shown
> here. `npm run … -- --confirmed-by "x"` swallows the named flag (npm parses `--confirmed-by`
> as its own config), so the CLI reports the value as missing. All no-argument `npm run gov:*`
> scripts work normally.
Message: *the requirement and PRD give business context and traceability, but governance
classifications are never inferred by a model — a schema-controlled intake requires an
accountable person to supply and confirm the mandatory values, and it fails closed until they do.*

### Segment 2 — Proposition becomes a control contract
```bash
npm run gov:select                # deterministic selection: 14 controls (12 blocking) + policy findings
npm run gov:contract              # writes control-contract.yaml + contract hash
npm run gov:trace                 # requirement -> characteristic -> control -> increment -> evidence -> decision
```
Message: *deterministic rules compile the approved proposition into release obligations —
no model decides which controls apply. Intake validation only judged whether the proposition
is complete and coherent; **policy risk is separated** — an accurately-declared high-risk
proposition is valid input, then selection raises release-blocking policy findings and the
release gate blocks it until the declaration is remediated.*

### Segment 3 — Human approval (hash-bound)
```bash
npx tsx src/governance/src/cli.ts approve --approver "andrew@demo"
```
Shows the approval record binding approver + contract/proposition/catalogue hashes
(`nonRepudiation: false`). Message: *a human approves the exact contract; any material
change invalidates that approval.*

### Segment 4 — Release blocked (isolated fixtures)
```bash
npm run gov:demo-failure          # Example A: undeclared MCP tool → RELEASE BLOCKED, SEC-MCP-001
npm run eval:demo-fail            # Example B: below-threshold evaluation → RELEASE BLOCKED, EVAL-GRD-001
```
Both run against **isolated fixtures** and leave the working application untouched.
Message: *governance is executable — the pipeline refuses to promote a release that does
not satisfy its proposition-specific contract.*

### Segment 5 — Remediate and approve
```bash
npm run gov:demo-pass             # corrected tool config → RELEASE APPROVED
npm run eval:demo-pass            # passing evaluation     → RELEASE APPROVED
npm run gov:dossier               # concise proposition audit dossier (JSON + Markdown)
```
Message: *the same contract that blocked the unsafe release records the evidence used to
approve the corrected one.*

### Reset between takes
```bash
npm run demo:governance-reset     # restores proposition.yaml, clears the draft + generated
                                  # evidence, regenerates artefacts. No app source is touched.
```

## Two blocked examples (expected text)
```
RELEASE BLOCKED
Control: SEC-MCP-001
Reason: The referenced MCP tool is not approved by the current control contract.
Remediation: Register and approve the tool, or remove it from the proposition.
```
```
RELEASE BLOCKED
Control: EVAL-GRD-001
Reason: Required evaluation evidence is missing or below the approved threshold.
Remediation: Run the required evaluation and attach evidence for the current version.
```
After remediation the same contract produces `RELEASE APPROVED`.

---

## CI enforcement segment (local convenience vs authoritative boundary)

> The local commands above are **fast developer feedback**. The **authoritative enforcement
> boundary is GitHub CI**: the `Governance Contract Gate` runs independently from a clean
> checkout of the PR commit and, when required on the protected branch, a non-compliant change
> **cannot merge**. One-time manual setup: [github-enforcement-setup.md](github-enforcement-setup.md).

### Local preview (show briefly — NOT the enforcement boundary)
```bash
npm run gov:contract:check    # regenerate + integrity-check the committed contract
npm run gov:pr-gate           # the same authoritative decision CI runs, with the rich summary
```
Narration:
> These commands give fast local feedback, but they are not the enforcement boundary.

### Authoritative enforcement (record the GitHub pull request)

Prepare two governance-only commits on a demo branch cut from `spec2cloud/foundry-hosted`:
```bash
npm run demo:ci:block         # commit 1: injects the isolated SEC-MCP-001 breach (governance-only)
# open a PR into spec2cloud/foundry-hosted, then after the check fails:
npm run demo:ci:remediate     # commit 2: removes the breach
```

Record the PR showing, in order:
1. Governance files changed on the demo branch.
2. **`Governance Contract Gate`** starts automatically.
3. The fixture makes the check **fail**.
4. The PR shows **merge blocked by the required check**.
5. The Actions **job summary** names **`SEC-MCP-001`** and the remediation.
6. Push the remediation commit (`npm run demo:ci:remediate`).
7. The same check **reruns and passes**.
8. The PR becomes **eligible to merge**, subject to review.
9. The workflow graph shows deployment is **downstream** of the approved release decision
   (post-merge `release-gate.yml` / the separately-recorded Foundry clip), not the local scripts.

Narration:
> Developers may work freely in feature branches. The authoritative verifier runs independently
> in GitHub. The target branch requires the governance check, so a non-compliant change cannot
> enter the trusted release path. Local commands are convenience; the protected workflow is
> enforcement.

The PR workflow holds **`contents: read` only** — it cannot deploy. Deployment is a separate,
post-merge, environment-protected workflow gated on the approved decision.
