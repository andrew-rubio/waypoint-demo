# FRD-009: Governance & Observability

> Priority **P1**. Branch **`spec2cloud/foundry-hosted`**. Formalises **INC-12**.
> Depends on **FRD-001** (agent runtime), **FRD-002** (audit stream), **FRD-008**
> (evaluation), **ADR-010** (Foundry Agent Service hosting), **ADR-011** (GenAI traces).
> Traces to the agentic-factory RFI objective (the **run / observe / govern** pillars).

## Overview

The **run, observe, and govern** surfaces of the agentic factory, made demonstrable in
the Foundry portal. Every turn emits **GenAI OpenTelemetry** spans (ADR-011) to
Application Insights linked to the Foundry project, so conversation traces render in
Foundry **Observability**. **Continuous/online evaluation** samples live production
traces and scores them, giving a running quality signal. **Governance** is shown through
Azure-native controls: content-safety filters, RBAC via managed identity, immutable agent
versions per deploy, and a **CI quality gate** that blocks a deploy when evaluation scores
regress. This FRD is the C-level answer to "how do you operate and govern agents at
scale?" — without exposing hidden model reasoning.

## Personas

- **Platform Owner / Governance Lead** (C-level) — needs visible controls: access, safety, versioning, and quality gates.
- **Demo Presenter** — walks the portal: live traces, continuous eval trend, a blocked bad deploy.
- **SRE / Operator** — monitors latency, failures, and quality per agent version in production.

## User Stories

- As an **Operator**, I can see every agent turn as a conversation trace with tool spans in Foundry Observability, so I can debug production behaviour.
- As a **Governance Lead**, I can see that content-safety filters, RBAC, and immutable versioning are enforced, so the platform is auditable.
- As a **Platform Owner**, I can see agent quality scored **continuously** on real traffic, not just offline.
- As a **Platform Owner**, I can see a **bad deploy blocked** by a quality gate, so regressions don't reach production.
- As an **Operator**, I can correlate a trace → its eval result → the agent version that produced it.

## Functional Requirements

- **FR-009-1** Every turn emits **GenAI OTel spans** (agent/tool/model, per ADR-011) to Application Insights **linked to the Foundry project**; conversation traces render in Foundry **Observability**.
- **FR-009-2** **Continuous/online evaluation** samples production traces at a configurable rate and scores them with a defined evaluator set; results are visible in the portal.
- **FR-009-3** A **monitoring surface** shows eval-score trend, latency, and failure rate **per agent version**.
- **FR-009-4** **Content-safety / responsible-AI filters** are applied to model inputs and outputs at the Foundry model/project.
- **FR-009-5** Access uses **RBAC via managed identity** with least-privilege roles; no keys or secrets (consistent with ADR-005).
- **FR-009-6** Each deploy produces an **immutable agent version**; versions are **comparable** in the portal.
- **FR-009-7** A **CI quality gate** blocks a deploy when evaluation scores regress below a defined threshold.
- **FR-009-8** **Secret redaction and the no-chain-of-thought rule** (FR-002-5, FR-002-8) are upheld across traces, monitoring, and eval surfaces.
- **FR-009-9** **Lineage is correlatable**: a trace can be linked to its evaluation result and to the agent version that produced it (via response/conversation id).

## Acceptance Criteria

**AC-009-1 — Turns render as traces in the portal**
- **Given** the hosted agent processes a turn
- **When** the Operator opens Foundry Observability
- **Then** a conversation trace with agent and tool spans is visible for that turn.

**AC-009-2 — Continuous evaluation on live traffic**
- **Given** continuous evaluation is enabled with a sampling rate
- **When** live turns are processed
- **Then** sampled turns are scored and their results appear in the portal over time.

**AC-009-3 — Monitoring per version**
- **Given** two agent versions have served traffic
- **When** the monitoring surface is viewed
- **Then** eval-score trend, latency, and failure rate are attributable per agent version.

**AC-009-4 — Content safety enforced**
- **Given** an unsafe input or output
- **When** the turn is processed
- **Then** the Foundry content-safety filter acts on it, and the event is observable in governance surfaces.

**AC-009-5 — Keyless, least-privilege access**
- **Given** the deployed agent and its Azure dependencies
- **When** access is inspected
- **Then** authentication is via managed identity with least-privilege roles and no keys/secrets are present.

**AC-009-6 — Quality gate blocks a regression**
- **Given** a CI pipeline with an eval quality gate
- **When** a change lowers evaluation scores below the threshold
- **Then** the deploy is blocked and the failing scores are reported.

**AC-009-7 — Trace → eval → version lineage**
- **Given** a scored production trace
- **When** the Operator inspects it
- **Then** they can correlate the trace to its evaluation result and to the agent version that produced it.

**AC-009-8 — No secrets or hidden reasoning in surfaces**
- **Given** any trace, monitoring, or eval view
- **When** it is inspected
- **Then** secrets are redacted and no hidden model reasoning/chain-of-thought is present.
