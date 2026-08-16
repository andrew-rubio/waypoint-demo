# ADR-008: Travel-guide knowledge base — Azure AI Search (Free tier) vector index via Foundry

- **Status:** Accepted
- **Date:** 2026-08-15
- **Deciders:** Stakeholder + orchestrator
- **Increment:** INC-8 (reworks FRD-003 — destination advice)

## Context

Destination advice (FRD-003) currently returns a shortlist from a **hardcoded pool** in
`destination-advisor.ts`. The stakeholder wants recommendations grounded in **real
content** — a supplied travel-guide PDF ("Where To Go When — Unforgettable Trips For Every
Month", `src/assets/`) that suggests the best places to visit for **each month of the
year** — and to reason over it together with the traveller's profile (ADR-007) to suggest
destinations for a chosen month and preferences.

## Decision

Vectorise the travel-guide PDF into an **Azure AI Search** index and manage it as a
**knowledge index within the existing Foundry project**.

- **Azure AI Search — Free tier** (50 MB, 3 indexes, vector search): $0, ample for one
  small PDF. Upgradeable to Basic (~US$75/mo) only if we outgrow it.
- **Ingestion:** the PDF is chunked and embedded via a Foundry **embedding deployment**
  (`text-embedding-3-small` — cents one-time; negligible per query) and written to an AI
  Search index (`travel-guide`). Foundry manages the index/connection; AI Search stores
  the vectors.
- **Foundry project connection:** the Search service is attached to the existing `waypoint`
  Foundry project as a **connection** (`Microsoft.CognitiveServices/accounts/projects/connections`,
  category `CognitiveSearch`, Entra auth via the project's system-assigned identity — local
  auth is disabled). This is what makes the index visible **inside the Foundry project** at
  `ai.azure.com` (Management center → Connected resources; the `travel-guide` index under
  Data + indexes → Indexes), rather than only as a standalone Search resource in the resource
  group. The connection is additive: the `waypoint-data` MCP still queries the index directly.
- **Retrieval:** hybrid (vector + keyword) query filtered/oriented by **month**, returning
  the guide passages for that month. Exposed as an MCP tool (see ADR-009).
- **Auth:** managed identity — the MCP server reads AI Search via the Container App
  identity (Search Index Data Reader); the ingestion identity holds Search Index Data
  Contributor + Search Service Contributor to create and seed the index; no keys.

## Consequences

- **Positive:** recommendations are grounded in **actual content** the stakeholder owns,
  month-aware, and citable ("per the travel guide, for June…"); a second genuine MCP call
  appears in the audit trail. Cost ~$0 on the Free tier.
- **Positive:** the Search index is a **connected resource inside the Foundry project**, so
  the stakeholder can browse the `travel-guide` index in `ai.azure.com` alongside the model
  deployments — the knowledge base is a first-class, visible project asset (not a detached
  Search service).
- **Positive:** replaces the hardcoded pool with data-driven results — a stronger RAG
  story for the demo.
- **Negative / trade-off:** RAG output is **non-deterministic**, so several FRD-003
  Gherkin scenarios and tests that assert the deterministic pool behaviour must be revised
  and re-approved (tracked in INC-8). Ingestion adds a one-time build step.
- **Dependency:** requires the embedding deployment and the AI Search resource to exist
  before INC-8 retrieval works; both are added to the infra contract.
