# AGT build governance - first cut

This is governance of the Copilot session developing Waypoint, not governance of
the holiday-planning agent. Microsoft AGT makes the policy decisions; the
Copilot app supplies the tool-execution hook. The demo focuses on an ordinary
read succeeding and a prohibited read being denied before execution, with no
approval override for the denied operation.

## Setup

Use Node 22 or newer on the PATH used by Copilot and its project scripts:

```sh
npm ci
npm run agt:setup
```

The Copilot app's project settings also expose a manual **AGT setup (Node 22+)**
script, saved in `.github/github-app.yml`. It runs `npm run agt:setup`, without a
machine-specific runtime path. Setup fails explicitly if Node is older than 22.
It has no automatic creation or archive trigger and does not activate a hook.
Review and accept the repository configuration when the app prompts for trust.

Setup compiles the TypeScript adapter to plain JavaScript under `.agt/build`
and uses the official pinned AGT installer with a local Copilot home under
`.agt/copilot`. Run setup again after changing the adapter. The extension does
not install a runtime TypeScript loader in the Copilot host.
Setup does not change `~/.copilot`, enable global extensions, or
modify the user's settings. The project extension reads
`.github/agt/policy.json`; the installer's generated baseline policy is not the
policy for this project.

## Explicit activation and recovery

The integration ships with the entry point named
`extension.mjs.disabled`, so ordinary authoring does not trigger AGT review
prompts. In a dedicated proof checkout, restore that file's name to
`.github/extensions/agt-build/extension.mjs` before loading the extension.
Run setup before activating it. Do not enable it in a repair session merely to
reproduce the video.

Reload extensions in the proof checkout's Copilot session after setup.
`/agt-build` or the `agt_build_status` tool shows the loaded policy, vendored SDK,
audit location, and whether initialization succeeded. If initialization fails, the extension
denies tool calls with an explicit error. Repair the local installation from a
human terminal and reload the extension.

To return a proof checkout to ordinary authoring, rename `extension.mjs` back to
`extension.mjs.disabled` and reload extensions. Keep this recovery step outside
the recorded proof. It changes whether the demo extension is loaded, not the
policy evaluator's allow/deny decision.

**Before activation:** the included policy requests review for Bash, PowerShell,
and unspecified tools, including coordination tools. Those prompts are separate
from the hard-denial proof; do not turn this into a default policy for every
developer session.

## Hard-denial demonstration

The recorded walkthrough focuses on the allowed read and hard denial. It does
not present developer self-approval as a governance control.

| Request in the Copilot app | Expected behaviour |
|---|---|
| View `README.md` | AGT allows the read; ordinary Copilot permissions still apply |
| View `.github/agt/protected-proof.txt` | AGT denies the read with a policy explanation |

The protected file is an intentionally harmless fixture, not a real secret.
Do not retry a denied operation through a different tool during this first-cut
demonstration.

AGT's native audit records stay under `.agt/audit/`, one file per extension
instance. They record attempts and policy decisions, not proof that the
underlying command succeeded. Show the actual tool result or rejection beside
the audit record in the video. The existing narrated walkthrough is an edited
presentation of genuine settings, source, and recorded denial/audit evidence,
not an uninterrupted native-app recording.

## Automated contract

```sh
npm run test:gov
```

Both `npm run test:gov` and `npm test --workspace @waypoint/governance` run
`agt:setup` first, so a fresh checkout does not depend on ignored files left by
a previous demo. This preparation does not enable the Copilot extension.

These tests use Microsoft's installed integration and audit logger, not mocked
allow/deny responses. They exercise the hook contract and load the built adapter
in a plain Node process with TypeScript hooks disabled. They do not constitute
a recording of the desktop approval UI. An additional unchanged contract test
checks that Bash maps AGT's `review` decision to the hook's `ask` result. That
does not establish that a human rejected or approved a command, and is not a
required step in the hard-denial demonstration.

## Boundaries

This deliberately small policy reviews unknown tools; it is not a universal
developer-protection policy. Full alternative-tool coverage, MCP proof cases,
cloud telemetry export, and retirement of the old release engine are deferred.
The existing travel app and legacy release workflow are unchanged by this slice.
Recordings and generated installation/audit files remain local.
