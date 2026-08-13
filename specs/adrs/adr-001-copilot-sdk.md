# ADR-001: GitHub Copilot SDK as the core agent runtime

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Stakeholder + orchestrator
- **Increment:** INC-1 (foundational)

## Context

Waypoint is a demo whose explicit purpose is to showcase how easily a capable AI agent
can be built on the **GitHub Copilot SDK**. The app is an interactive holiday-planning
agent that must plan turns, stream responses, invoke custom skills, call MCP servers, and
expose an audit trail of its decisions.

Alternatives considered for the agent runtime:
- **GitHub Copilot SDK** (`@github/copilot-sdk`) — production-tested agent runtime behind Copilot CLI.
- **LangGraph.js** — build a bespoke stateful graph and call a model directly.
- **Direct model SDK** (e.g. Azure OpenAI SDK) with a hand-rolled tool/planning loop.

## Decision

Use the **GitHub Copilot SDK (Node/TypeScript)** as the agent runtime. It is the subject
of the demo and provides, out of the box: agent planning + streaming, custom skills, tool
invocation, MCP server integration, and a **per-tool permission handler** that is the
natural hook for the audit trail (FRD-002). The Node SDK bundles the Copilot CLI and runs
it headless.

## Consequences

- **Positive:** Minimal orchestration code (on-brand for the demo); native MCP + skills +
  permission/telemetry hook; less bespoke code to explain on stage.
- **Positive:** The permission handler gives observable, auditable tool execution.
- **Negative / trade-offs:** Runtime depends on the bundled Copilot CLI subprocess (container
  must include Node + the bundled CLI); model choice is mediated by Copilot auth/BYOK
  (see ADR-002); we do not control the internal planning loop.
- **Follow-ups:** ADR-002 (model + auth), ADR-003 (hosting). Do not expose hidden model
  reasoning; never disable the permission handler.
