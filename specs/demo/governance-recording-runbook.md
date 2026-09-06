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

### Segment 1 — Requirement becomes a proposition
```bash
npm run gov:draft                 # writes specs/governance/proposition.draft.yaml
# → 6 high-impact fields left UNRESOLVED (owner, personal-data, classification,
#   autonomy, consequential-actions, financial-transactions)
npm run gov:promote-proposition   # BLOCKED while unresolved  → shows the human gate
# ...human reviews the draft, fills the high-impact fields, sets `unresolved: []`...
npm run gov:promote-proposition   # → Promoted draft to proposition.yaml
```
Message: *the idea becomes a structured proposition, but high-impact classifications
require explicit human confirmation — nothing high-risk is invented.*

### Segment 2 — Proposition becomes a control contract
```bash
npm run gov:select                # deterministic selection: 13 controls (11 blocking)
npm run gov:contract              # writes control-contract.yaml + contract hash
npm run gov:trace                 # requirement → characteristic → control → increment → evidence → decision
```
Message: *organisational standards become machine-readable release obligations, each
control linked to the proposition characteristic that selected it.*

### Segment 3 — Human approval (hash-bound)
```bash
npm run gov:approve -- --approver "you@demo"    # or: npx tsx src/governance/src/cli.ts approve --approver "you@demo"
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
