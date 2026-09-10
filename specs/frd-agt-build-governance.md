# FRD-011: AGT Build Governance - First Cut

The first-cut scope was approved on 2026-09-08 and clarified later that day:
demonstrate an allowed ordinary read and a policy-enforced denial in the actual
GitHub Copilot app. Developer self-approval is not the governance claim.

## Scope

- Use Microsoft's Agent Governance Toolkit as the policy evaluator, not the
  existing `src/governance` selection and release engine.
- Attach to the current Copilot session through a repository-scoped extension.
- Install AGT's packaged integration into a repository-local, ignored Copilot
  home. Do not change the user's global Copilot installation or settings.
- Adapt the host's `workingDirectory` field to the AGT integration's `cwd` field.
- Keep AGT audit output local, with the native decision and session identifier.
- Ship the extension disabled by default; activation is explicit in a dedicated
  proof checkout. Setup alone must not govern ordinary authoring sessions.
- Do not modify the travel agent, booking flow, or deployed Azure resources.

## Acceptance Scenarios

```gherkin
Scenario: Read ordinary source
  Given the repository's AGT build policy is active
  When Copilot requests to view README.md
  Then AGT allows the request
  And its audit record contains the allow decision

Scenario: Deny a protected proof-file read
  Given the repository's AGT build policy is active
  And .github/agt/protected-proof.txt is a harmless demonstration fixture
  When Copilot requests to view that file using a repository-relative path
  Then AGT denies the request with an explanation
  And its audit record contains the deny decision
```

## Additional Contract Coverage

The original review scenario is retained as additional coverage, not as a
required live-demo step. Its automated test establishes the AGT-to-hook mapping;
it does not prove the desktop user's approval or rejection. The policy still
requests review for Bash and unspecified tools when explicitly enabled.

```gherkin
Scenario: Review a harmless shell command
  Given the repository's AGT build policy is active
  When Copilot requests to run node --version through bash
  Then AGT returns review and the Copilot hook returns ask
  And the command waits for the user's approval
  And its audit record contains the review decision
```

## Proof Boundary

Automated tests exercise the real AGT integration and its audit logger, without
mocking policy decisions. They prove the hook contract, not the desktop UI.
Live proof must show the actual Copilot app: an allowed result and an AGT-denied
operation that does not execute or offer an approval override. The narrated
video is an edited walkthrough of real settings and recorded tool/audit evidence,
not a fresh live replay. Recordings remain separate from source control and must
not use recreated Copilot UI or expose credentials.

Setup is a manual project script in `.github/github-app.yml`, requiring Node
22+ on PATH. It compiles the adapter and installs the local AGT runtime; explicit
extension activation and reload are separate steps. The governance test commands
perform setup automatically to avoid relying on a previous local installation.
See [ADR-013](adrs/adr-013-agt-build-governance.md).

## Deferred

The wider proof matrix, legacy governance retirement, cloud telemetry export,
and protection across alternative tools and subagents follow this first cut.
This slice does not claim universal developer governance or OS-level isolation.
