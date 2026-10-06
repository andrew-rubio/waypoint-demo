---
title: "ADR-013: Use Global Provisioned Throughput for the PTU demonstration"
description: "Decision to add an hourly GPT-5.4-mini Global Provisioned deployment beside PAYG"
author: Waypoint team
ms.date: 2026-10-05
ms.topic: architecture-decision
---

## Status

Accepted

## Date

2026-10-05

## Context

Waypoint currently invokes GPT-5.4-mini version `2026-03-17` through a
`GlobalStandard` Microsoft Foundry deployment. The agent authenticates with
managed identity and exports GenAI OpenTelemetry spans to Application Insights
linked to the Foundry project.

The demonstration must show a move from pay-as-you-go inference to provisioned
throughput while retaining the existing agent, tools, authentication,
observability, and evaluation capabilities.

Read-only discovery on 2026-10-05 established:

* The target subscription is `c7233dbc-6a6d-40da-83a7-738e54ffedef`.
* The existing Foundry account and workload are in Sweden Central.
* GPT-5.4-mini `2026-03-17` supports `GlobalProvisionedManaged`.
* The minimum deployment size is 15 PTUs, with increments of 5.
* The subscription has 100 unused Global Provisioned PTUs.
* The model-capacities API reported 100 PTUs of live Sweden Central capacity.
* Hourly billing starts when the deployment exists and stops when it is deleted.
* The Azure retail pricing API did not return this meter, so the Foundry portal
  confirmation is the authoritative price gate before provisioning.

## Options Considered

### Create the PTU deployment manually in the Foundry portal

The portal would create and manage the demonstration deployment.

* Pros: It exposes live capacity and the hourly price before confirmation.
* Cons: It creates configuration drift and is not reproducible from the
  repository.
* Risk: Cleanup and future recreation depend on manual steps.
* Cost: Low implementation effort, with the same hourly PTU runtime cost.

### Replace the existing PAYG deployment through infrastructure as code

The existing deployment would change from `GlobalStandard` to
`GlobalProvisionedManaged`.

* Pros: It keeps one deployment name and a small resource footprint.
* Cons: It removes the immediate PAYG comparison and rollback target.
* Risk: A failed replacement could interrupt the working demonstration.
* Cost: Low implementation effort, with 15 PTUs billed while deployed.

### Add a side-by-side PTU deployment through infrastructure as code

Bicep would retain PAYG and add a separately named PTU deployment. The active
deployment would be selected through configuration.

* Pros: It is repeatable, reviewable, supports direct comparison, and preserves
  rollback.
* Cons: Both deployments exist during the demonstration, and the model
  configuration needs explicit selection.
* Risk: PTU capacity may no longer be available when provisioning runs.
* Cost: Moderate implementation effort, with 15 PTUs billed hourly while the PTU
  deployment exists.

## Decision

We will add a separately named GPT-5.4-mini `2026-03-17`
`GlobalProvisionedManaged` deployment at the 15 PTU minimum through Bicep. The
deployment will use hourly billing and will exist beside the current
`GlobalStandard` deployment.

The Foundry portal remains the mandatory pre-deployment price confirmation. No
Azure Reservation will be purchased. The application will select PAYG or PTU by
deployment name while retaining the same endpoint, managed identity, agent
implementation, and telemetry path.

## Consequences

### Positive

* PAYG remains an immediate rollback and comparison target.
* The capacity choice is version controlled and reproducible.
* The demo isolates the commercial and capacity change from the agent code.
* Foundry traces, evaluations, and Application Insights remain on the same data
  path.

### Negative

* The PTU deployment incurs hourly charges whenever it exists, even when idle.
* Capacity availability can change between planning and deployment.
* Two deployment definitions must remain unambiguous across Bicep and the
  Foundry hosted-agent configuration.

### Neutral

* The embedding deployment remains `GlobalStandard`.
* The existing managed identity and Cognitive Services OpenAI User role remain
  unchanged.
* Cleanup deletes only the PTU deployment and does not affect PAYG.

## Implementation Notes

Added during EXT-PRE-001 on 2026-10-06.

* The live API proxies chat turns to the Foundry-hosted agent through
  `FOUNDRY_AGENT_RESPONSES_URL`. The hosted agent therefore selects the serving
  deployment through `AZURE_AI_MODEL_DEPLOYMENT_NAME` in the `foundry/` azd
  environment. The API's `FOUNDRY_MODEL` labels its own audit spans. A switch
  changes both values together so traces stay consistent.
* `foundry/azure.yaml` no longer declares model deployments, so Bicep is the
  single owner of the PAYG and PTU deployments.
* Bicep now sets the PAYG capacity to the live value (500) and preserves
  `FOUNDRY_AGENT_RESPONSES_URL` and `OTEL_SERVICE_NAME`. Root provisioning
  previously would have reduced PAYG to 20 and disconnected the hosted agent.
* `scripts/verify-ptu-demo.mjs` provides read-only evidence. Simulated evidence
  backs the automated tests; `--live` queries Azure, metrics, Application
  Insights, and the deployed API.

## References

* [FRD-011](../frd-provisioned-model-capacity.md)
* [ADR-005](./adr-005-byok-foundry-model.md)
* [ADR-011](./adr-011-otel-genai-traces.md)
* [Provisioned throughput for Foundry Models](https://learn.microsoft.com/azure/foundry/openai/concepts/provisioned-throughput)
* [Operate provisioned throughput deployments](https://learn.microsoft.com/azure/foundry/openai/how-to/provisioned-get-started)
* [Foundry deployment types](https://learn.microsoft.com/azure/foundry/openai/how-to/deployment-types)

