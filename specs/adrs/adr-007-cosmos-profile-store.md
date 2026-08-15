# ADR-007: Personalisation data store — Azure Cosmos DB (serverless) over Microsoft Fabric

- **Status:** Accepted (supersedes the Microsoft Fabric Data Agent approach in FRD-006)
- **Date:** 2026-08-15
- **Deciders:** Stakeholder + orchestrator
- **Increment:** INC-6 (FRD-006 — personalisation)

## Context

FRD-006 originally called for a **Microsoft Fabric Data Agent** MCP serving the synthetic
traveller profile. INC-6 was first implemented with the profile **hardcoded in-process**
(`src/api/src/tools/fabric.ts`) — there was no real store and no real remote call, only an
`mcp`-typed audit entry. The stakeholder wants a **genuine MCP tool call retrieving the
data from a real Azure store**, without the cost and setup of a Microsoft Fabric capacity
(minimum F2 ≈ US$262.80/mo PAYG; plus workspace, Data Agent, dataset ingestion, and the
same SDK↔MCP surfacing risk seen in ADR-006).

## Decision

Store the traveller's **loyalty profile, travel preferences, and past destinations
(city + country only)** in **Azure Cosmos DB (serverless / free tier)** as a single JSON
document, and retrieve it through a real MCP call (see ADR-009).

- **Cosmos DB serverless** — pay-per-request; effectively free at demo scale (free-tier
  option: 1000 RU/s + 25 GB). One database (`waypoint`), one container (`profiles`),
  one document (`traveller: "John Doe"`).
- **Auth:** the Container App's **user-assigned managed identity** with the Cosmos DB
  built-in **Data Contributor** data-plane role — no keys. (Contributor rather than Reader
  because the MCP server seeds the document on first run — a one-time keyless upsert.)
- **Offline/test fallback:** the existing deterministic profile stays as the test/offline
  path (renamed from `fabric` to `cosmos`), mirroring the RouteStack offline-catalogue
  pattern (INC-5). The live Cosmos path activates when the store is configured.
- **Naming:** the audit entry is renamed `fabric.profile` → **`cosmos.getTravellerProfile`**;
  the UI label becomes **"Cosmos"** (Fabric is dropped).

## Consequences

- **Positive:** real Azure data, a genuine MCP retrieval in the audit trail, ~$0 cost, no
  Fabric capacity, keyless (managed identity). Past destinations enable "you've already
  been to X" reasoning downstream (INC-8).
- **Positive:** minimal rework — only the data source + naming change; the personalisation
  note, booking accrual and graceful-degradation behaviour from INC-6 are unchanged.
- **Negative / trade-off:** the profile is still **synthetic** (fabricated content), just
  now stored in a real database rather than in code. This is honest for a demo and
  documented here.
- **Superseded:** the FRD-006 "Microsoft Fabric Data Agent MCP" requirement and the
  `FABRIC_*` secrets are removed from the tech stack and infra contract.

## Deployment note — governance & network posture (2026-08-15)

The target subscription applies two management-group `modify` Azure Policies
(`mcapsgovdeploypolicies`) that force **`publicNetworkAccess = Disabled`** and
**`disableLocalAuth = true`** on every Cosmos account. With public access off and no
private endpoint, *nothing* — not the Container App, not the portal — could reach the
data plane, so the app silently ran on its offline fallback.

Resolution (keeps keyless intact):

- A **resource-group-scoped Waiver policy exemption** (`exempt-cosmos-publicnetwork-waypoint`)
  targets only the `cosmosdbpublicnetworkmodify` reference, so public access is no longer
  force-disabled for `rg-waypoint`. The keyless (`disableLocalAuth`) policy is left in force.
- `cosmos.bicep` now sets `publicNetworkAccess: 'Enabled'` with a **scoped IP firewall**:
  `0.0.0.0` (Azure datacenters only — lets Container Apps egress connect) plus the Azure
  portal Data Explorer ranges. A personal IP for portal browsing is added out-of-band via
  `az cosmosdb update` (dynamic, so not baked into Bicep).
- Portal Data Explorer additionally requires the browsing user to hold the Cosmos
  **Data Contributor** data-plane role (keyless).

A fully private alternative (VNet + private endpoint + VNet-integrated Container Apps
environment) was rejected for the demo: it requires recreating the Container Apps
environment and still leaves portal browsing blocked without a jumpbox.
