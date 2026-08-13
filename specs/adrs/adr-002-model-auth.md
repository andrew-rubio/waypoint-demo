# ADR-002: Model & authentication — Copilot token (BYOK→Foundry alternative)

- **Status:** Accepted — **Option A confirmed by stakeholder (2026-08-12)**; Foundry BYOK deferred as a future option.
- **Date:** 2026-08-12
- **Deciders:** Stakeholder + orchestrator
- **Increment:** INC-1

## Context

The Copilot SDK needs credentials to reach a model. Per the SDK auth docs, the priority is:
explicit SDK token → direct Copilot API env auth → env-var GitHub tokens
(`COPILOT_GITHUB_TOKEN`/`GH_TOKEN`/`GITHUB_TOKEN`) → stored Copilot CLI creds → gh CLI.
**BYOK** is supported for OpenAI, **Azure/Microsoft Foundry**, and Anthropic, including an
**Azure managed identity** path for Foundry.

Waypoint is a single-demo-user app (no per-user login). It is presented to a
Microsoft-oriented, Azure-based audience.

## Decision

**Primary:** authenticate with a **`COPILOT_GITHUB_TOKEN`** service credential supplied as a
**Container App secret**, using **Copilot models**. This is the simplest path and keeps the
"GitHub Copilot SDK" story pure.

**Documented alternative (production/Azure-native):** **BYOK → Microsoft Foundry** using the
**user-assigned managed identity** (no key material), for a fully Azure-native posture.

## Consequences

- **Positive:** One service credential; minimal setup; on-brand Copilot model story.
- **Cost:** Option A rides your **GitHub Copilot subscription/allowance** and adds **no Azure model spend**. Option B (Foundry BYOK) adds **Azure pay-as-you-go per-token** cost plus a Foundry resource — chosen only when Azure-native billing/governance is required.
- **Positive:** Clear upgrade path to Foundry BYOK + managed identity if the client wants
  Azure-native billing/governance — no app-code rewrite, just auth config.
- **Negative / trade-offs:** The demo token maps to a Copilot subscription/allowance; a
  single shared identity (acceptable — one demo user, no multi-tenancy).
- **Security:** Token/keys never in code or client; provided via Container App secrets;
  redacted server-side before any log/stream (FR-001-10). No Entra user auth is added.
