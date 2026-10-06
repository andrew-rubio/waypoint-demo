---
title: "FRD-011: Provisioned Model Capacity"
description: "Requirements for switching Waypoint between PAYG and Global Provisioned Foundry model deployments"
author: Waypoint team
ms.date: 2026-10-05
ms.topic: concept
---

## Overview

Waypoint must demonstrate that its existing GitHub Copilot SDK agent can move from
a pay-as-you-go Microsoft Foundry model deployment to hourly Global Provisioned
Throughput without changing the agent implementation or losing Foundry
observability. The demonstration uses GPT-5.4-mini version `2026-03-17` in Sweden
Central and retains the current PAYG deployment as an immediate rollback target.

The provisioned deployment uses `GlobalProvisionedManaged` with the model minimum
of 15 provisioned throughput units (PTUs). It is billed hourly, with no Azure
Reservation. The deployment must not be created until the presenter confirms the
hourly price shown by the Foundry portal.

## User Stories

* As a Demo Presenter, I want to switch the agent from PAYG to PTU through
  configuration so that I can show that the application code is unchanged.
* As an Operator, I want the same Foundry and Application Insights traces from
  both deployments so that I can compare operational behavior.
* As a Platform Owner, I want PAYG and PTU deployments side by side so that the
  demonstration has a low-risk rollback path.
* As a Cost Owner, I want an explicit price gate and cleanup procedure so that
  hourly PTU spend is intentional and bounded.

## Integration Points

* [FRD-001](./frd-chat-and-agent-runtime.md) continues to select the Foundry
  deployment through `FOUNDRY_MODEL`; the Copilot SDK provider and managed
  identity authentication remain unchanged.
* [FRD-009](./frd-governance-and-observability.md) continues to emit GenAI
  OpenTelemetry spans to the same Application Insights resource linked to the
  Foundry project.
* [ADR-005](./adrs/adr-005-byok-foundry-model.md) remains the model endpoint and
  authentication decision.
* [ADR-011](./adrs/adr-011-otel-genai-traces.md) remains the tracing decision.
* `infra/modules/foundry.bicep` becomes the source of truth for both PAYG and PTU
  model deployments.
* `foundry/azure.yaml` must reference the selected deployment without creating a
  conflicting PAYG deployment.

## Functional Requirements

* **FR-011-1** Infrastructure as code preserves the existing GPT-5.4-mini
  `GlobalStandard` deployment and adds a separately named GPT-5.4-mini
  `GlobalProvisionedManaged` deployment.
* **FR-011-2** The provisioned deployment uses model version `2026-03-17` and
  capacity 15 PTUs in Sweden Central.
* **FR-011-3** The deployment uses hourly billing only. No Azure Reservation is
  purchased or required by the implementation.
* **FR-011-4** The active model deployment is selected through configuration.
  Switching deployments does not change the agent, tool, prompt, identity, or
  API implementation.
* **FR-011-5** Both deployments use the same Foundry account, project, managed
  identity, RBAC assignment, and Application Insights connection.
* **FR-011-6** An identical evaluation or prompt set is run against PAYG and PTU,
  recording response success, latency, throttling, and trace correlation.
* **FR-011-7** PTU verification includes the Azure Monitor
  `Provisioned-Managed Utilization V2` metric.
* **FR-011-8** Provisioning is blocked until quota and live capacity are
  sufficient and the presenter approves the portal-displayed hourly price.
* **FR-011-9** Cleanup deletes the PTU deployment when the demonstration no
  longer needs it, because PTU billing continues while the deployment exists.

## Acceptance Criteria

### AC-011-1 Provision PTU without replacing PAYG

* Given the current GPT-5.4-mini PAYG deployment exists
* When the approved infrastructure deployment runs
* Then a separate GPT-5.4-mini `GlobalProvisionedManaged` deployment exists at
  15 PTUs
* And the PAYG deployment remains available.

### AC-011-2 Switch through configuration

* Given both model deployments are healthy
* When the active deployment name changes from PAYG to PTU
* Then the agent completes the same representative conversation
* And no agent implementation change is required.

### AC-011-3 Preserve observability

* Given the representative conversation is run against each deployment
* When the Operator opens Foundry Observability and Application Insights
* Then both runs contain correlated agent, model, and tool spans
* And the PTU run identifies the provisioned deployment name.

### AC-011-4 Show provisioned utilization

* Given traffic has been sent to the PTU deployment
* When the Operator opens Azure Monitor metrics
* Then `Provisioned-Managed Utilization V2` contains data for the deployment.

### AC-011-5 Roll back safely

* Given the PTU deployment is active
* When the active deployment name changes back to PAYG
* Then the agent resumes using PAYG without infrastructure recreation
* And the PTU deployment can be deleted independently.

### AC-011-6 Enforce the cost gate

* Given quota and live capacity are available
* When the portal displays the hourly price for 15 PTUs
* Then provisioning proceeds only after explicit presenter approval
* And no reservation is purchased.

## Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| PTU quota is below 15 | Provisioning is blocked and reports the required quota |
| Live capacity falls below 15 | Provisioning is blocked; PAYG remains active |
| PTU deployment creation fails | PAYG remains active and no app configuration changes |
| PTU returns throttling | The run records the response and utilization metrics |
| Trace ingestion is delayed | Verification waits for telemetry before concluding |
| Deployment is no longer needed | The PTU deployment is deleted to stop hourly billing |

## Error Handling

| Failure | System behavior |
|---------|-----------------|
| Invalid SKU or model version | Bicep validation or Azure deployment fails explicitly |
| Insufficient quota or capacity | Deployment stops before the app is switched |
| PTU health check fails | The app remains on PAYG |
| Trace correlation fails | The observability acceptance criterion remains blocked |
| Cleanup fails | The operator receives the deployment identifier and deletion command |

## Non-Functional Requirements

* Performance comparisons use the same prompt or evaluation set and report at
  least successful completion, duration, and throttling.
* Security remains keyless through the existing managed identity and
  least-privilege model-inference role.
* Reliability preserves PAYG until PTU has passed inference and telemetry smoke
  tests.
* Cost control requires explicit hourly-price approval and a documented deletion
  step.
* Trace data continues to follow the existing redaction and no-chain-of-thought
  rules.

