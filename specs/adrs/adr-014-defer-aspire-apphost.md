---
title: "ADR-014: Defer Aspire AppHost adoption"
description: "Decision to retain and isolate the existing Node test harness before the PTU demonstration"
author: Waypoint team
ms.date: 2026-10-06
ms.topic: architecture-decision
---

## Status

Accepted

## Date

2026-10-06

## Context

The repository instructions describe Aspire as the local orchestration layer,
but no AppHost exists on `main`, the inspected feature branches, or the searched
Git history. Local Cucumber and Playwright execution has instead used
`scripts/e2e.mjs` to start the API and web application.

The existing harness fixed the services to ports 8080 and 3000. Shared local
processes already occupied both ports, so the baseline could not start safely.
Adding an AppHost was considered while repairing the baseline, but Aspire's
TypeScript initializer could not restore through the managed environment because
its internal restore required a direct `api.nuget.org` TLS connection.

Aspire adoption is independent of the GPT-5.4-mini provisioned-throughput
demonstration. Making it a prerequisite would expand the feature scope without
changing the PAYG or PTU runtime behavior.

## Decision

We will defer Aspire AppHost adoption. Local integration and end-to-end tests
will use the existing Node harness, which now reserves available loopback ports
and passes the resulting API and web endpoints to Cucumber and Playwright.

Fixed ports remain available through `WAYPOINT_TEST_API_PORT` and
`WAYPOINT_TEST_WEB_PORT` when a developer requires them. The harness must not
terminate unrelated processes to claim a preferred port.

## Consequences

### Positive

* PTU work remains focused on Foundry capacity and observability.
* Test runs no longer collide with unrelated processes on ports 3000 or 8080.
* The existing repository workflow remains available without new runtime
  dependencies.
* API and web processes are isolated to each test run.

### Negative

* Local services do not appear in the Aspire dashboard.
* Aspire service discovery and orchestration telemetry remain unavailable.
* Project instructions that assume an AppHost remain aspirational until a
  separate adoption increment is approved.

## Follow-up

Aspire can be reconsidered as a separate infrastructure increment after the
managed package-feed path supports its TypeScript code-generation restore.
