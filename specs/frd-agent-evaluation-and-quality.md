# FRD-008: Agent Evaluation & Quality

> Priority **P1**. Branch **`spec2cloud/foundry-hosted`**. Formalises **INC-11**.
> Depends on **FRD-001** (agent runtime), **FRD-002** (audit stream), **ADR-010**
> (Foundry Agent Service hosting), **ADR-011** (GenAI traces). Traces to the
> agentic-factory RFI objective (the **evaluate** pillar).

## Overview

Offline, repeatable **evaluation** of the deployed Waypoint agent, run through
Microsoft Foundry so results render in the portal **Evaluations** tab. A **golden
dataset** is derived from the app's *existing* scenarios (Gherkin, Playwright e2e, and
the deterministic `local-driver` turns), so evaluation reuses assets the team already
trusts. Evaluators cover three families: **agent behaviour** (did it resolve intent,
adhere to the task, call the right tool), **answer quality** (relevance, coherence,
fluency), and **RAG grounding** (groundedness/retrieval for the INC-8 travel-guide
answers). The judge is the same **Foundry model deployment** (ADR-005). This FRD makes
"how do you know the agent is good, and prove it?" a first-class, demonstrable surface.

## Personas

- **Platform Owner** (C-level evaluator) — wants objective, repeatable quality evidence and a portal to see it.
- **Demo Presenter** — runs an eval live and narrates scores + failures in the Foundry portal.
- **Quality Engineer** — maintains the golden dataset and evaluator set, investigates regressions.

## User Stories

- As a **Platform Owner**, I can see agent quality scored by a defined evaluator set in the Foundry portal, so quality is objective, not anecdotal.
- As a **Demo Presenter**, I can run one command to evaluate the deployed agent and open the results in the portal.
- As a **Quality Engineer**, I can build the evaluation dataset from our existing scenarios, so evals stay aligned with the specs.
- As a **Quality Engineer**, I can inspect a failing row (query, response, tool calls, score, reason) to know *why* it failed.
- As a **Platform Owner**, I can trust that the agent picks the **right tool** for a turn — evaluated explicitly, not assumed.

## Functional Requirements

- **FR-008-1** A **versioned golden dataset** is derived from the existing Gherkin scenarios, e2e flows, and `local-driver` turns. Each row carries a `query`, optional `context`/`ground_truth`, and an `expected_behavior` rubric; artifacts are persisted in-repo for lineage.
- **FR-008-2** An **evaluation suite runs against the deployed hosted agent** (agent-target batch evaluation), producing per-row and aggregate scores.
- **FR-008-3** The evaluator set includes **agent evaluators** (`intent_resolution`, `task_adherence`, `tool_call_accuracy`), **quality evaluators** (`relevance`, `coherence`, `fluency`), and **RAG evaluators** (`groundedness`, `retrieval`) for guide-grounded destination answers.
- **FR-008-4** The **judge model is the Foundry model deployment** (ADR-005), configured via environment/managed identity; no secrets are hardcoded or committed.
- **FR-008-5** Results are **published to the Foundry project** and visible in the portal **Evaluations** tab, with per-row failures inspectable (query, response, tool calls, score, reason).
- **FR-008-6** Evaluation **artifacts (dataset, evaluators, results) are versioned and persisted** in the repo (e.g. `.foundry/` / `eval/`) so runs are traceable over time.
- **FR-008-7** An evaluation run is **reproducible from a single documented command** wired into the repo tooling.
- **FR-008-8** **Tool-call evaluation** asserts, for representative turns, that the agent selected the correct MCP/skill with correct arguments — aligned with the `tool_call`/`tool_result` audit events (FRD-002).
- **FR-008-9** Datasets and results contain **no secrets or PII**; server-side redaction (FR-002-5) is upheld for any captured request/response text.

## Acceptance Criteria

**AC-008-1 — Golden dataset evaluates the deployed agent**
- **Given** the agent is deployed as a Foundry agent version (INC-9)
- **When** the evaluation suite is run against the golden dataset
- **Then** each row is scored by the configured evaluators and an aggregate result is produced.

**AC-008-2 — Agent evaluators score behaviour**
- **Given** an evaluation run completes
- **When** results are viewed
- **Then** `intent_resolution`, `task_adherence`, and `tool_call_accuracy` scores are present per row.

**AC-008-3 — Tool selection is evaluated**
- **Given** a weather turn and a flight-search turn in the dataset
- **When** `tool_call_accuracy` is evaluated
- **Then** a turn that should call Open-Meteo (weather) vs RouteStack (flights) is scored on whether the correct tool was chosen with correct arguments.

**AC-008-4 — RAG grounding is evaluated**
- **Given** a month-aware destination question grounded in the travel-guide (INC-8)
- **When** `groundedness`/`retrieval` are evaluated
- **Then** the answer is scored for grounding against the retrieved guide passages.

**AC-008-5 — Results visible in the portal**
- **Given** an evaluation run has completed
- **When** the Presenter opens the Foundry portal Evaluations tab
- **Then** the run, its scores, and per-row failures are visible and inspectable.

**AC-008-6 — Reproducible run**
- **Given** the repo tooling
- **When** the documented evaluation command is run again
- **Then** the suite re-runs against the same dataset and produces a comparable result set.

**AC-008-7 — No secrets or PII in eval artifacts**
- **Given** a dataset or results file
- **When** it is inspected
- **Then** no API keys, tokens, or auth material are present; redaction is applied to any captured text.
