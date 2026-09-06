# GitHub enforcement setup (manual repository configuration)

The `Governance PR gate` workflow ([.github/workflows/governance-pr-gate.yml](../../.github/workflows/governance-pr-gate.yml))
is the authoritative verifier, but a workflow file **cannot** make itself required. Branch and
ruleset configuration is **external repository state** and cannot be proven by workflow YAML
alone. Configure the following manually (repo → Settings), then it is enforced for everyone.

## 0. Branch-targeting scope (read first)

- `spec2cloud/foundry-hosted` is the **protected integration branch for this demo** — the target
  the recorded pull request merges into.
- The workflow protects **only pull requests whose target branch matches the configured trigger**
  (`on.pull_request.branches: [spec2cloud/foundry-hosted]`). It does not govern any other branch.
- In a real enterprise setup you **must require the same gate on the actual trusted release
  branch** — normally `main` or an organisation-defined release branch — by adding that branch to
  the trigger and to branch protection.
- **Protecting this demo branch alone does not protect an ungoverned route into `main`.** If code
  can reach `main` without this required check, the gate is not an enforcement boundary for
  production; it only demonstrates the mechanism on the integration branch.

## 1. Protect the trusted branch `spec2cloud/foundry-hosted`

Settings → Branches → Branch protection rules (or Settings → Rules → Rulesets) → target
`spec2cloud/foundry-hosted`:

- ✅ **Require a pull request before merging.**
- ✅ **Require status checks to pass before merging** → add the required check named exactly:
  - **`Governance Contract Gate`**  *(this is the job `name:` in the PR-gate workflow)*
- ✅ **Require branches to be up to date before merging** *(optional for the demo; ensures the
  check ran against the latest target).* 
- ✅ **Dismiss stale pull-request approvals when new commits are pushed.**
- ✅ **Do not allow force pushes**; **do not allow deletions** of the protected branch.
- ✅ **Include administrators** (apply the rules to admins) for the demonstration, if safe.
- 🔒 **Restrict who can bypass** — leave empty, or document the break-glass group explicitly.
- ⏸ **Require review from Code Owners** — enable **only after** a valid owner is set in
  [.github/CODEOWNERS](../../.github/CODEOWNERS) (currently placeholders; see below).

## 2. CODEOWNERS

[.github/CODEOWNERS](../../.github/CODEOWNERS) ships with **commented placeholders** so it cannot
break review routing. Before enabling "Require review from Code Owners":

1. Replace `@REPLACE-WITH-VALID-OWNER` with a real GitHub user or team (e.g. `@your-org/governance`).
2. Uncomment the lines.
3. Then enable the Code Owners requirement in branch protection.

## 3. Keep deployment separate and downstream

- The PR-gate workflow has **`permissions: contents: read` only** — no `id-token`, no package or
  environment write, no deployment credentials. It **cannot deploy**.
- Deployment stays in the post-merge release workflow
  ([.github/workflows/release-gate.yml](../../.github/workflows/release-gate.yml)) and runs only
  after merge to the trusted branch, gated on the approved release decision.
- Protect the **`production` environment** separately (Settings → Environments → `production`):
  required reviewers, and restrict which branches can deploy. Never expose deployment
  credentials to ordinary pull-request workflows (forked PRs must not obtain deploy secrets).

## 4. Conceptual deployment dependency (shown, not run here)

```text
build immutable artefact -> image digest -> required evidence for that digest
  -> governance release decision -> protected-environment approval -> deploy the certified digest
```

For this scoped recording the dependency is shown; the live Foundry deployment is the separately
recorded clip. The PR gate proves a non-compliant change cannot enter the trusted release path.

## 5. Non-production assurance

Approval in this demo is **hash-bound, self-asserted, `local-demo`** (`nonRepudiation: false`) —
it is not enterprise identity and not a digital signature. Policies are **synthetic** demonstration
content, not actual organisational/IAG policy.
