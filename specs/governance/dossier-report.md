# Waypoint — AI Governance Assurance Dossier

_Generated 2026-09-09 16:26 UTC from version-controlled governance artefacts._

## Assurance status

| Assurance check | Status |
|---|---|
| **Certification status** | 🟢 **Certified — compliant** |
| **Required controls evidenced** | ✓ 11 / 11 blocking controls satisfied |
| **Lifecycle record complete** | ✓ 5 / 5 stages (declare → select → approve → evidence → certify) |

**Waypoint** — current status: **Certified**

- ✓ Applicable controls satisfied — 13 selected, 11 blocking
- ✓ Evaluations passed — grounding and human-approval eval gates
- ✓ Human approvals recorded — demo.presenter (local-demo)
- ✓ Deployed version and agent identity — `sha256:demo0000000000000000000000000000000000000000000000000000000000000`
- ✓ Runtime policy decisions captured — referenced from Application Insights and the agent audit trail
- ✓ Evidence record complete — ci-authoritative, set `evset-b34b29ee-5d3f-4ddc-90cd-3bcebdb989b6`

> **What this is.** A plain-English audit trail for the Waypoint AI agent. It shows the
> business proposition being governed, the governance controls it must satisfy and *why*
> each one applies, the frozen set of obligations that was approved, and the current
> go/no-go release decision. Every item below is derived **deterministically** from
> declared facts and version-controlled files — not from model opinion.
>
> ⚠️ **Demonstration content.** The policy catalogue is **synthetic** (illustrative). It is
> not any organisation’s actual policy and makes no regulatory or compliance-certification claim.

## At a glance

| Field | Value |
|---|---|
| Proposition | **waypoint** — Waypoint holiday-planning and booking agent |
| Accountable owner | Proposition Owner (placeholder — demo) |
| Control contract | 1.0.0 (`sha256:f692def9bfd729fed5bc4143368c5b49060689fef38b7f9ddc07e31adf47d355`) |
| Approval | demo.presenter (self-asserted, non-repudiation: no) |
| Release decision | **approved** · deployable: yes · mode: ci-authoritative |
| Controls selected | 13 |

### Selected controls

| Control | Severity | Policy source | Implemented in |
|---|---|---|---|
| `DATA-FRESH-001` | blocking | `SYN-POL-DATA` | INC-7, INC-13 |
| `DATA-MIN-001` | blocking | `SYN-POL-DATA` | INC-6, INC-13 |
| `EVAL-GRD-001` | blocking | `SYN-POL-EVAL` | INC-8, INC-11, INC-13 |
| `EVAL-HITL-001` | blocking | `SYN-POL-EVAL` | INC-5, INC-11, INC-13 |
| `OPS-TRACE-001` | advisory | `SYN-POL-OPS` | INC-10, INC-13 |
| `OPS-VER-001` | advisory | `SYN-POL-OPS` | INC-9, INC-10, INC-13 |
| `RAI-HITL-001` | blocking | `SYN-POL-RAI` | INC-5, INC-13 |
| `RAI-OUT-001` | blocking | `SYN-POL-RAI` | INC-5, INC-13 |
| `REL-CON-001` | blocking | `SYN-POL-REL` | INC-13 |
| `REL-IMM-001` | blocking | `SYN-POL-REL` | INC-9, INC-13 |
| `SEC-MCP-001` | blocking | `SYN-POL-SEC` | INC-4, INC-5, INC-6, INC-8, INC-13 |
| `SEC-REASON-001` | blocking | `SYN-POL-SEC` | INC-2, INC-10, INC-13 |
| `SEC-RED-001` | blocking | `SYN-POL-SEC` | INC-1, INC-13 |

_Full explanations of every field, control and code below._

---

## 1. The proposition being governed

This is the thing under assessment — the product/capability whose declared characteristics drive everything else.

- **Proposition ID:** `waypoint` — the internal identifier for this capability.
- **Title:** Waypoint holiday-planning and booking agent
- **Accountable owner:** Proposition Owner (placeholder — demo) — the person answerable for it.
- **Source requirements:** `PRD-1`, `PRD-2`, `PRD-3` — the product requirements this traces back to.
- **Approved tools:** `routestack`, `open-meteo`, `currency`, `cosmos`, `travel-guide` — the only external tools governance has allow-listed.

### Declared characteristics

These declared facts are what the control-selection engine reads. Nothing high-risk is inferred — it is stated up front.

| Characteristic | Declared value | What it means |
|---|---|---|
| Uses a large language model | Yes | The proposition relies on a generative AI model to produce responses. |
| Handles personal data | Yes | The proposition processes information about identifiable people. |
| Data classification | `confidential` | The sensitivity tier of the data the proposition handles. |
| Autonomy level | `supervised` | How much the agent can act on its own — assistive, supervised, or autonomous. |
| Consequential actions | `simulated-booking` | Actions with real-world impact (here, a simulated booking) that need extra control. |
| Financial transactions | `simulated` | Whether the proposition moves money — none, simulated, or real. |
| External integrations / tools | `mcp`, `currency`, `weather`, `flights`, `profile`, `travel-guide` | Outside services and tools the agent can call (via MCP and APIs). |
| Human-in-the-loop | Yes | A person must approve before a consequential action proceeds. |
| Retrieval-augmented (RAG) | Yes | The agent grounds answers in retrieved data rather than model memory alone. |
| Deployment surface | `azure-container-apps`, `foundry-agent-service` | Where the proposition runs in production. |

## 2. How controls were selected

Each control in the catalogue carries an *"applies when"* rule written over the declared
characteristics above. A control is included **only if its rule matches** — a transparent,
repeatable decision with no model judgement involved. The matched rule is shown against each control.

## 3. Selected controls — the obligations Waypoint must meet

13 control(s) were selected for this proposition.

### DATA-FRESH-001 — Currency/rate data freshness enforced before budget confirmation

Stale exchange-rate data must be detected deterministically and must not confirm a budget or booking.

- **Category:** data
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `runtime` — enforced live, on every request, while the agent runs
- **Policy source:** `SYN-POL-DATA` — Synthetic Data Governance (demonstration); applies to: Propositions handling personal data
- **Why it applies:** externalIntegrations contains "currency"
- **What it requires:** A currency result older than the approved freshness threshold blocks final budget/booking; the model does not decide freshness.
- **Evidence required:** stale-currency detection + containment test (the outcome of an automated test)
- **Implemented in:** INC-7, INC-13 · verified by governance-runtime.test.ts (currency-freshness)

### DATA-MIN-001 — Personal-data use declared and minimised

The proposition declares personal-data use and minimises what it collects.

- **Category:** data
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `build` — enforced when the application is built/packaged
- **Policy source:** `SYN-POL-DATA` — Synthetic Data Governance (demonstration); applies to: Propositions handling personal data
- **Why it applies:** handlesPersonalData is true
- **What it requires:** Personal-data handling is declared; only necessary fields are collected.
- **Evidence required:** personal-data declaration + minimisation (a check of the application configuration)
- **Implemented in:** INC-6, INC-13 · verified by data-minimisation adapter

### EVAL-GRD-001 — Grounded tool-use evaluation meets its threshold

Retrieval/tool answers must be grounded above a defined evaluation threshold.

- **Category:** evaluation
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `pre-release` — checked by automated evaluations before promotion
- **Policy source:** `SYN-POL-EVAL` — Synthetic Quality Assurance (demonstration); applies to: LLM propositions with retrieval or tool use
- **Why it applies:** retrievalAugmented is true
- **What it requires:** Gated grounding evaluators must meet their thresholds.
- **Evidence required:** eval gate thresholds (the score from an automated quality evaluation)
- **Implemented in:** INC-8, INC-11, INC-13 · verified by eval/gate.json grounding evaluators

### EVAL-HITL-001 — Human-approval compliance meets the required threshold

The agent's compliance with the human-approval requirement is verified.

- **Category:** evaluation
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `pre-release` — checked by automated evaluations before promotion
- **Policy source:** `SYN-POL-EVAL` — Synthetic Quality Assurance (demonstration); applies to: LLM propositions with retrieval or tool use
- **Why it applies:** humanInLoop is true
- **What it requires:** The human-approval behavioural test must pass.
- **Evidence required:** human-approval compliance (the outcome of an automated test)
- **Implemented in:** INC-5, INC-11, INC-13 · verified by governance-runtime.test.ts (booking-approval)

### OPS-TRACE-001 — Runtime activity carries a correlation identifier

Every runtime turn is correlated for observability.

- **Category:** operations
- **Severity:** Advisory — recorded and reviewed, but does not by itself block a release.
- **Enforced at:** `runtime` — enforced live, on every request, while the agent runs
- **Policy source:** `SYN-POL-OPS` — Synthetic Operations Standards (demonstration); applies to: All deployed propositions
- **Why it applies:** usesLLM is true
- **What it requires:** Telemetry tags activity with a correlation id.
- **Evidence required:** correlation id in telemetry (a check of the application configuration)
- **Implemented in:** INC-10, INC-13 · verified by agent-spans.test.ts (gen_ai.conversation.id)

### OPS-VER-001 — Model, agent and artefact versions are captured

Runtime metadata captures the versions that produced a transaction.

- **Category:** operations
- **Severity:** Advisory — recorded and reviewed, but does not by itself block a release.
- **Enforced at:** `build` — enforced when the application is built/packaged
- **Policy source:** `SYN-POL-OPS` — Synthetic Operations Standards (demonstration); applies to: All deployed propositions
- **Why it applies:** usesLLM is true
- **What it requires:** Runtime metadata exposes agent + artefact version identifiers.
- **Evidence required:** runtime metadata version fields (a check of the application configuration)
- **Implemented in:** INC-9, INC-10, INC-13 · verified by runtime-info.test.ts (version fields)

### RAI-HITL-001 — Explicit approval before a consequential booking or payment

A consequential action must not execute without explicit human approval bound to the exact proposal.

- **Category:** responsible-ai
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `runtime` — enforced live, on every request, while the agent runs
- **Policy source:** `SYN-POL-RAI` — Synthetic Responsible-AI Board (demonstration); applies to: AI propositions taking consequential actions or using LLMs
- **Why it applies:** humanInLoop is true
- **What it requires:** The simulated booking must require an itinerary-bound approval record before execution.
- **Evidence required:** itinerary-bound booking-approval behavioural test (the outcome of an automated test)
- **Implemented in:** INC-5, INC-13 · verified by governance-runtime.test.ts (booking-approval)

### RAI-OUT-001 — No representation that an unapproved booking is complete

The agent must not state a booking is complete when no approval exists.

- **Category:** responsible-ai
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `runtime` — enforced live, on every request, while the agent runs
- **Policy source:** `SYN-POL-RAI` — Synthetic Responsible-AI Board (demonstration); applies to: AI propositions taking consequential actions or using LLMs
- **Why it applies:** consequentialActions contains "simulated-booking"
- **What it requires:** Without an approval, the response must be a safe approval-required message, never a confirmation.
- **Evidence required:** approval-required outcome asserted (the outcome of an automated test)
- **Implemented in:** INC-5, INC-13 · verified by governance-runtime.test.ts (booking-approval)

### REL-CON-001 — Approved control contract and complete blocking evidence required

A release requires an approved, current control contract and complete blocking evidence.

- **Category:** release
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `release` — checked at the go/no-go gate before deployment
- **Policy source:** `SYN-POL-REL` — Synthetic Release Governance (demonstration); applies to: All propositions promoted to a runtime
- **Why it applies:** usesLLM is true
- **What it requires:** A valid hash-bound approval must exist for the released contract.
- **Evidence required:** approved control contract present (a recorded human sign-off)
- **Implemented in:** INC-13 · verified by approval adapter + verify

### REL-IMM-001 — Release uses an immutable artefact identifier

A release must reference an immutable artefact digest, not a mutable tag.

- **Category:** release
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `release` — checked at the go/no-go gate before deployment
- **Policy source:** `SYN-POL-REL` — Synthetic Release Governance (demonstration); applies to: All propositions promoted to a runtime
- **Why it applies:** deploymentSurface contains "azure-container-apps"
- **What it requires:** CI-authoritative evidence must bind the certified immutable digest to the deployment.
- **Evidence required:** certified immutable artefact digest (the immutable fingerprint of the deployed build)
- **Implemented in:** INC-9, INC-13 · verified by immutable-deploy adapter (digest match)

### SEC-MCP-001 — All MCP tools declared and allowlisted

Every tool the agent can call is declared and present in the approved allowlist.

- **Category:** security
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `release` — checked at the go/no-go gate before deployment
- **Policy source:** `SYN-POL-SEC` — Synthetic Security Standards (demonstration); applies to: Propositions integrating external tools or handling secrets
- **Why it applies:** externalIntegrations contains "mcp"
- **What it requires:** No configured or effective tool may be outside the approved allowlist.
- **Evidence required:** configured vs approved tool comparison (a comparison of configured tools against the approved allowlist)
- **Implemented in:** INC-4, INC-5, INC-6, INC-8, INC-13 · verified by gov mcp-allowlist adapter + gov:demo-failure

### SEC-REASON-001 — Private model reasoning is not exposed

Chain-of-thought / private reasoning must never be forwarded to clients or telemetry.

- **Category:** security
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `runtime` — enforced live, on every request, while the agent runs
- **Policy source:** `SYN-POL-SEC` — Synthetic Security Standards (demonstration); applies to: Propositions integrating external tools or handling secrets
- **Why it applies:** usesLLM is true
- **What it requires:** Only decisions, tool calls and results are surfaced.
- **Evidence required:** telemetry emits no private reasoning (a check of the application configuration)
- **Implemented in:** INC-2, INC-10, INC-13 · verified by agent-spans.test.ts (no private reasoning)

### SEC-RED-001 — Secrets and sensitive values redacted from events

Secrets must be redacted from any streamed or logged event.

- **Category:** security
- **Severity:** Blocking — a release cannot proceed until this control is satisfied.
- **Enforced at:** `build` — enforced when the application is built/packaged
- **Policy source:** `SYN-POL-SEC` — Synthetic Security Standards (demonstration); applies to: Propositions integrating external tools or handling secrets
- **Why it applies:** usesLLM is true
- **What it requires:** The redaction boundary must strip tokens and bearer credentials.
- **Evidence required:** redaction executed on a secret fixture (the outcome of an automated test)
- **Implemented in:** INC-1, INC-13 · verified by redaction adapter (redactSecrets fixture)

## 4. Policy sources referenced

The controls above trace to these (synthetic) policy sources. In a real deployment these
would come from an authoritative, centrally-versioned policy catalogue.

| Policy ID | Owner | Governs |
|---|---|---|
| `SYN-POL-DATA` | Synthetic Data Governance (demonstration) | Propositions handling personal data |
| `SYN-POL-EVAL` | Synthetic Quality Assurance (demonstration) | LLM propositions with retrieval or tool use |
| `SYN-POL-OPS` | Synthetic Operations Standards (demonstration) | All deployed propositions |
| `SYN-POL-RAI` | Synthetic Responsible-AI Board (demonstration) | AI propositions taking consequential actions or using LLMs |
| `SYN-POL-REL` | Synthetic Release Governance (demonstration) | All propositions promoted to a runtime |
| `SYN-POL-SEC` | Synthetic Security Standards (demonstration) | Propositions integrating external tools or handling secrets |

## 5. The approved control contract

The selected controls are frozen into a **control contract** and hashed. The hash is a
tamper-evident fingerprint: if any obligation changed, the hash would change and the
existing approval would no longer match.

- **Contract version:** `1.0.0`
- **Contract hash:** `sha256:f692def9bfd729fed5bc4143368c5b49060689fef38b7f9ddc07e31adf47d355` — the fingerprint the approval is bound to.
- **Approved by:** demo.presenter
- **Identity assurance:** `self-asserted` — the approver identified themselves locally (demo only — no verified identity).
- **Approval mechanism:** `local-demo`.
- **Non-repudiation:** No — this demo does **not** claim a cryptographic signature.
- **Approved at commit:** `00bafe2a8e6b31498dca836d7cc7e110b558d5cd`.

## 6. Release decision

The go/no-go outcome. A release is only deployable when every **blocking** control has passing evidence.

- **Decision:** **approved**
- **Deployable:** Yes
- **Evidence mode:** `ci-authoritative` — Authoritative — evidence produced by the CI pipeline on a specific commit.
- **Evidence set:** `evset-b34b29ee-5d3f-4ddc-90cd-3bcebdb989b6`
- **Certified artefact digest:** `sha256:demo0000000000000000000000000000000000000000000000000000000000000` — the immutable build fingerprint the decision certifies.
- **Assessed commit:** `e31a37f6d303781734cedf3e8b0ebd58cb0d85f6`

## 7. Evidence integrity

An honest self-check: this dossier flags anything missing or non-authoritative rather than implying success.

- all referenced artefacts present

## 8. Limitations & non-claims

- Synthetic policy catalogue; not IAG actual policy.
- Approval is hash-bound, not a cryptographic signature (no non-repudiation claim).
- Effective packaged runtime tool inventory not fully enumerated in this demo.
- Runtime/portal identity evidence is external; referenced, not copied here.

> Authoritative, source-bound evidence is the CI workflow artefact "governance-evidence-<run-id>". A local dossier is demonstration-only.

## Glossary

- **Blocking vs advisory** — blocking controls stop a release until satisfied; advisory controls are reviewed but non-blocking.
- **Enforcement stage** — *when* a control is checked: build, pre-release (evaluations), runtime (live), release (go/no-go gate), or deploy.
- **Evidence** — the proof a control is met: a test result, evaluation score, config check, allowlist comparison, artefact digest, or human sign-off.
- **Contract hash** — a tamper-evident fingerprint of the exact approved control set; any change invalidates the prior approval.
- **Artefact digest** — the immutable fingerprint of the built container image, so the release is pinned to an exact build (not a moving tag).
- **Evidence mode** — *ci-authoritative* (produced by CI on a commit) vs *local-demonstration* (produced locally, for illustration only).
- **Non-repudiation** — a cryptographic guarantee the approver cannot later deny signing. This demo does **not** claim it.
