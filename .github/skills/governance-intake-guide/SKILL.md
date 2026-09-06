---
name: governance-intake-guide
description: >-
  NON-AUTHORITATIVE operator guide for the deterministic control-selection and
  release-contract governance in spec2cloud. It ONLY explains the schema, points to the
  files and commands, surfaces validation output already produced by deterministic code, and
  explains controls AFTER deterministic selection has run. It MUST NOT write, alter, promote,
  select, approve, or verify governance artefacts, and it MUST NOT infer any governance value
  from prose. USE FOR: understanding the intake schema, finding the right command, reading a
  validation block. Policies are SYNTHETIC demonstration content.
---

# Governance intake guide (non-authoritative helper)

> This guide is **not** part of the authoritative governance path. Deterministic code —
> never an LLM or this guide — performs intake validation, control selection, evidence
> verification, and release decisions.
>
> ```
> Human defines and confirms governance facts.
> Deterministic rules select controls.
> Automated checks verify evidence.
> Human approves the contract.
> The release gate enforces the decision.
> ```

## What this guide may do
- Explain the proposition intake schema and each mandatory field.
- Point to the files (`specs/governance/proposition.yaml`, `controls.yaml`) and the commands.
- Display the unresolved fields **already reported** by `gov:intake:validate`.
- Explain why a control was selected **after** deterministic `gov:select` has produced the result.

## What this guide must NOT do
- It must not infer, classify, or populate any governance-relevant value from free-form text.
- It must not write, alter, or promote a proposition; select controls; approve a contract; or
  decide whether evidence passes or a release is approved.

## The authoritative, deterministic path
```bash
npm run gov:intake:init          # deterministic template — every governance field UNRESOLVED
# a human supplies the mandatory classifications + declares approvedTools
npm run gov:intake:validate      # schema validation; fails closed on any unresolved/invalid field
npm run gov:intake:promote -- --confirmed-by "you@demo"   # records content hash + human confirmation
npm run gov:select               # deterministic control selection (no model)
npm run gov:contract             # versioned, hash-bound control contract
npm run gov:approve -- --approver "you@demo"              # human hash-bound approval
npm run gov:demo-failure         # SEC-MCP-001 undeclared-tool block (isolated fixture)
npm run eval:demo-fail           # EVAL-GRD-001 below-threshold block (isolated fixture)
npm run gov:demo-pass            # corrected -> RELEASE APPROVED
npm run gov:trace                # requirement -> control -> evidence -> decision
npm run gov:dossier              # proposition audit dossier
```

Selection reads the approved `proposition.yaml` + the synthetic catalogue + explicit PRD
references only. If a control depends on a value not explicitly present in `proposition.yaml`,
selection **fails with a missing-classification message** rather than infer it from prose.
