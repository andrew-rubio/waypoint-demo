# ADR-013: Repository-scoped AGT build governance

## Status

Accepted for the opt-in hard-denial demonstration.

## Date

2026-09-08; scope clarified by the user later the same day.

## Context

Waypoint needs to demonstrate Microsoft Agent Governance Toolkit governing the
actual Copilot session that develops this repository. The existing custom
control-selection and release engine is not the evaluator for this new surface.
The user requested direct, incremental implementation on a separate local branch,
with no remote pushes or global Copilot changes.

## Options Considered

| Option | Benefit | Trade-off |
|---|---|---|
| Load the project extension automatically | Enforces the demonstration policy as soon as it is discovered | The included review-by-default policy prompts on routine tools; failed initialization can block repair tools |
| Ship a disabled entry point and activate in a proof checkout | Keeps normal development usable while demonstrating the same real AGT decisions | Requires deliberate activation; not an organization-enforced or tamper-resistant deployment |

## Decision

Use `@microsoft/agent-governance-copilot-cli@5.0.0` and its pinned, vendored AGT SDK
through the official installer, with a repository-local Copilot home under
`.agt/copilot`. A project extension joins the existing Copilot session and calls
Microsoft's pre-tool policy integration. A small TypeScript adapter supplies the
host working directory and a local audit destination; it contains no policy rules.

Ship the entry point as `extension.mjs.disabled` and require explicit activation
in a proof checkout. A manual project script prepares the runtime but does not
activate enforcement. The first cut demonstrates ordinary reads and hard denial
of a harmless proof-file read. The policy is `.github/agt/policy.json`.

The original Bash approval mapping remains in the policy and its existing
automated contract test, but developer self-approval is not part of the recorded
governance claim. The user chose hard-denial proof rather than the approval
demonstration after experiencing prompts for routine coordination tools.

The adapter is compiled by `agt:setup` and imported as ordinary JavaScript.
Runtime TSX loading failed inside the actual Copilot host with an ENOENT for a
namespaced `node:crypto` import, preventing policy initialization and causing
the fail-closed hook to reject every tool call.

## Consequences

- Node 22+ is required for the AGT installer.
- Generated installation files and audit logs stay ignored under `.agt/`.
- No AGT unsafe SDK override or user-global installation is needed.
- The included policy still reviews Bash and unspecified tools when enabled;
  users must opt in with that limitation understood.
- Governance test commands prepare the compiled adapter and local installation
  automatically, without loading the Copilot hook.
- The setup command requires Node 22+ on PATH, not a specific developer's
  Homebrew path.
- Legacy retirement and the broader proof matrix are deferred until this slice
  works. No universal governance or deployment-readiness claim is made.

## References

- [FRD-011](../frd-agt-build-governance.md)
- [Setup, activation, and recovery](../../.github/agt/README.md)
- [GitHub Copilot app repository configuration](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/repository-configuration)
