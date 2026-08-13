# ADR-003: Hosting on Azure Container Apps via azd + Bicep

- **Status:** Accepted
- **Date:** 2026-08-12
- **Deciders:** Stakeholder + orchestrator
- **Increment:** INC-1

## Context

Waypoint has two long-running Node services: an **Express API** (embedding the Copilot SDK
+ bundled Copilot CLI subprocess) and a **Next.js web** app. It streams SSE, calls outbound
MCP servers, and needs telemetry. It is a single-user demo — no autoscaling or HA needs —
but should deploy cleanly to Azure with `azd`.

Options considered: **Azure Container Apps**, Azure App Service, Azure Static Web Apps
(+ Functions), AKS.

## Decision

Host both services on **Azure Container Apps** (Consumption), provisioned and deployed with
**azd** and **Bicep** (`infra/`). Supporting resources: Container Registry, Log Analytics,
Application Insights, and a **user-assigned managed identity** (ACR pull, App Insights,
optional Foundry BYOK). Secrets live as **Container App secrets** (Key Vault optional).

## Consequences

- **Positive:** Container Apps suits always-on Node processes with a bundled CLI subprocess
  and long-lived SSE connections (unlike Static Web Apps/Functions); simple `azd up`; scales
  to zero for a cheap demo; managed identity avoids key sprawl.
- **Positive:** Aspire orchestrates the same two services locally, matching production.
- **Negative / trade-offs:** Two container images to build/push; AKS-level control not
  available (not needed here).
- **Follow-ups:** `infra/main.bicep` is generated at INC-1 to match
  `specs/contracts/infra/resources.yaml`; the azure-deployment skill validates parity.
