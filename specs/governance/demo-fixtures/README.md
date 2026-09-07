# PR-demo governance fixtures

Governance-only fixtures for the CI recording. They **never** modify Waypoint application code.

## `extra-configured-tools.json` (absent by default)

A JSON array of extra "configured" MCP tool ids that the `mcp-allowlist` evidence adapter reads
**additively** on top of the real (read-only) driver allowlist. It lets the recording inject an
isolated `SEC-MCP-001` breach without touching `src/api/**`.

- Baseline: the file is **absent** → the tool-allowlist control passes.
- `npm run demo:ci:block` writes `["unregistered-booking-provider"]` → the gate BLOCKS.
- `npm run demo:ci:remediate` removes the file → the gate PASSES.

`npm run demo:governance-reset` also removes this file so the baseline stays clean.
