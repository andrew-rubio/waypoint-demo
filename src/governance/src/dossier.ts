import { existsSync } from 'node:fs';
import { PATHS, readJsonIfExists, readYamlFile } from './io.js';
import type { ApprovalRecord, ControlCatalogue, ControlContract, ControlSelection, ReleaseDecision } from './types.js';

/** Control → implementation increment(s) mapping for the traceability chain. */
const CONTROL_INCREMENTS: Record<string, string[]> = {
  'RAI-HITL-001': ['INC-5', 'INC-13'],
  'RAI-OUT-001': ['INC-5', 'INC-13'],
  'SEC-MCP-001': ['INC-4', 'INC-5', 'INC-6', 'INC-8', 'INC-13'],
  'SEC-RED-001': ['INC-1', 'INC-13'],
  'SEC-REASON-001': ['INC-2', 'INC-10', 'INC-13'],
  'DATA-MIN-001': ['INC-6', 'INC-13'],
  'DATA-FRESH-001': ['INC-7', 'INC-13'],
  'EVAL-GRD-001': ['INC-8', 'INC-11', 'INC-13'],
  'EVAL-HITL-001': ['INC-5', 'INC-11', 'INC-13'],
  'OPS-TRACE-001': ['INC-10', 'INC-13'],
  'OPS-VER-001': ['INC-9', 'INC-10', 'INC-13'],
  'REL-IMM-001': ['INC-9', 'INC-13'],
  'REL-CON-001': ['INC-13'],
};

const CONTROL_TESTS: Record<string, string> = {
  'RAI-HITL-001': 'governance-runtime.test.ts (booking-approval)',
  'RAI-OUT-001': 'governance-runtime.test.ts (booking-approval)',
  'SEC-MCP-001': 'gov mcp-allowlist adapter + gov:demo-failure',
  'SEC-RED-001': 'redaction adapter (redactSecrets fixture)',
  'SEC-REASON-001': 'agent-spans.test.ts (no private reasoning)',
  'DATA-MIN-001': 'data-minimisation adapter',
  'DATA-FRESH-001': 'governance-runtime.test.ts (currency-freshness)',
  'EVAL-GRD-001': 'eval/gate.json grounding evaluators',
  'EVAL-HITL-001': 'governance-runtime.test.ts (booking-approval)',
  'OPS-TRACE-001': 'agent-spans.test.ts (gen_ai.conversation.id)',
  'OPS-VER-001': 'runtime-info.test.ts (version fields)',
  'REL-IMM-001': 'immutable-deploy adapter (digest match)',
  'REL-CON-001': 'approval adapter + verify',
};

export function loadArtefacts() {
  return {
    proposition: existsSync(PATHS.proposition) ? (readYamlFile(PATHS.proposition) as { propositionId: string; title: string; accountableOwner: string; prdRequirementIds: string[]; characteristics: Record<string, unknown> }) : undefined,
    selection: readJsonIfExists<ControlSelection>(PATHS.selection),
    contract: existsSync(PATHS.contract) ? (readYamlFile(PATHS.contract) as ControlContract) : undefined,
    approval: readJsonIfExists<ApprovalRecord>(PATHS.approval),
    decision: readJsonIfExists<ReleaseDecision>(PATHS.releaseDecision),
  };
}

export function traceMarkdown(): string {
  const { proposition, contract } = loadArtefacts();
  const lines: string[] = ['# Requirement → release traceability', ''];
  lines.push(`Proposition: **${proposition?.propositionId ?? 'n/a'}** — ${proposition?.title ?? ''}`);
  lines.push(`PRD requirements: ${(proposition?.prdRequirementIds ?? []).join(', ') || 'n/a'}`);
  lines.push('');
  lines.push('| Control | Increment(s) | Test / evaluation | Selected by |');
  lines.push('|---|---|---|---|');
  for (const c of contract?.material.controls ?? []) {
    lines.push(`| ${c.controlId} | ${(CONTROL_INCREMENTS[c.controlId] ?? ['INC-13']).join(', ')} | ${CONTROL_TESTS[c.controlId] ?? '—'} | ${c.matchedBy.join('; ')} |`);
  }
  lines.push('');
  lines.push('Chain: requirement → proposition characteristic → selected control → increment → test/evaluation → evidence entry → release decision.');
  return lines.join('\n');
}

export function dossierJson() {
  const a = loadArtefacts();
  const decisionMode = a.decision?.evidenceMode;
  const integrity: string[] = [];
  if (!a.contract) integrity.push('control contract unavailable');
  if (!a.approval) integrity.push('approval record unavailable');
  if (!a.decision) integrity.push('release decision unavailable — run gov:verify');
  if (decisionMode && decisionMode !== 'ci-authoritative') integrity.push(`release decision is ${decisionMode} (not authoritative CI evidence)`);
  if (a.decision && !a.decision.certifiedArtefactDigest) integrity.push('no certified immutable artefact digest present');
  return {
    schema: 'waypoint.governance/dossier@1',
    generatedAt: new Date().toISOString(),
    integrity: integrity.length ? integrity : ['all referenced artefacts present'],
    intent: { propositionId: a.proposition?.propositionId, title: a.proposition?.title, accountableOwner: a.proposition?.accountableOwner },
    classification: a.proposition?.characteristics ?? 'unavailable',
    selectedControls: (a.contract?.material.controls ?? []).map((c) => ({ id: c.controlId, severity: c.severity, policyRef: c.policyRef, increments: CONTROL_INCREMENTS[c.controlId] ?? ['INC-13'] })),
    contract: a.contract ? { version: a.contract.contractVersion, hash: a.contract.contractHash } : 'unavailable',
    approval: a.approval ? { approver: a.approval.approver, mechanism: a.approval.approvalMechanism, identityAssurance: a.approval.identityAssurance, nonRepudiation: a.approval.nonRepudiation, sourceCommit: a.approval.sourceCommit ?? 'unavailable' } : 'unavailable',
    releaseDecision: a.decision ? { decision: a.decision.releaseDecision, deployable: a.decision.deployable, evidenceMode: a.decision.evidenceMode, evidenceSetId: a.decision.evidenceSetId, certifiedArtefactDigest: a.decision.certifiedArtefactDigest ?? 'unavailable', sourceCommit: a.decision.sourceCommit ?? 'unavailable', workflowRunId: a.decision.workflowRunId ?? 'unavailable' } : 'unavailable',
    runtimeEvidence: 'external — see Application Insights (gen_ai.conversation.id) + Foundry portal; referenced, not copied here',
    limitations: [
      'Synthetic policy catalogue; not IAG actual policy.',
      'Approval is hash-bound, not a cryptographic signature (no non-repudiation claim).',
      'Effective packaged runtime tool inventory not fully enumerated in this demo.',
      'Runtime/portal identity evidence is external; referenced, not copied here.',
    ],
    evidenceReference: 'Authoritative, source-bound evidence is the CI workflow artefact "governance-evidence-<run-id>". A local dossier is demonstration-only.',
  };
}

export function dossierMarkdown(): string {
  const d = dossierJson();
  const lines: string[] = ['# Proposition audit dossier', ''];
  lines.push(`- Proposition: **${d.intent.propositionId}** — ${d.intent.title}`);
  lines.push(`- Accountable owner: ${d.intent.accountableOwner}`);
  const contract = typeof d.contract === 'string' ? 'unavailable' : `${d.contract.version} (${d.contract.hash})`;
  lines.push(`- Contract: ${contract}`);
  if (typeof d.approval !== 'string') lines.push(`- Approval: ${d.approval.approver} (${d.approval.identityAssurance}, non-repudiation: ${d.approval.nonRepudiation})`);
  else lines.push('- Approval: unavailable');
  if (typeof d.releaseDecision !== 'string') lines.push(`- Release decision: **${d.releaseDecision.decision}** · deployable: ${d.releaseDecision.deployable} · mode: ${d.releaseDecision.evidenceMode} · digest: ${d.releaseDecision.certifiedArtefactDigest}`);
  else lines.push('- Release decision: unavailable — run gov:verify');
  lines.push('');
  lines.push('## Evidence integrity');
  for (const i of d.integrity) lines.push(`- ${i}`);
  lines.push('');
  lines.push('## Selected controls');
  for (const c of d.selectedControls) lines.push(`- ${c.id} [${c.severity}] ← ${c.policyRef} → ${c.increments.join(', ')}`);
  lines.push('');
  lines.push('## Limitations & non-claims');
  for (const l of d.limitations) lines.push(`- ${l}`);
  lines.push('');
  lines.push(`> ${d.evidenceReference}`);
  return lines.join('\n');
}

/** Explanatory lookups so a non-technical reader understands every coded value. */
function loadCatalogue(): ControlCatalogue | undefined {
  return existsSync(PATHS.catalogue) ? (readYamlFile(PATHS.catalogue) as ControlCatalogue) : undefined;
}

const CHARACTERISTIC_LABELS: Record<string, { label: string; explain: string }> = {
  usesLLM: { label: 'Uses a large language model', explain: 'The proposition relies on a generative AI model to produce responses.' },
  handlesPersonalData: { label: 'Handles personal data', explain: 'The proposition processes information about identifiable people.' },
  dataClassification: { label: 'Data classification', explain: 'The sensitivity tier of the data the proposition handles.' },
  autonomyLevel: { label: 'Autonomy level', explain: 'How much the agent can act on its own — assistive, supervised, or autonomous.' },
  consequentialActions: { label: 'Consequential actions', explain: 'Actions with real-world impact (here, a simulated booking) that need extra control.' },
  financialTransactions: { label: 'Financial transactions', explain: 'Whether the proposition moves money — none, simulated, or real.' },
  externalIntegrations: { label: 'External integrations / tools', explain: 'Outside services and tools the agent can call (via MCP and APIs).' },
  humanInLoop: { label: 'Human-in-the-loop', explain: 'A person must approve before a consequential action proceeds.' },
  retrievalAugmented: { label: 'Retrieval-augmented (RAG)', explain: 'The agent grounds answers in retrieved data rather than model memory alone.' },
  deploymentSurface: { label: 'Deployment surface', explain: 'Where the proposition runs in production.' },
};

const SEVERITY_EXPLAIN: Record<string, string> = {
  blocking: 'Blocking — a release cannot proceed until this control is satisfied.',
  advisory: 'Advisory — recorded and reviewed, but does not by itself block a release.',
};

const STAGE_EXPLAIN: Record<string, string> = {
  build: 'enforced when the application is built/packaged',
  'pre-release': 'checked by automated evaluations before promotion',
  runtime: 'enforced live, on every request, while the agent runs',
  release: 'checked at the go/no-go gate before deployment',
  deploy: 'enforced during the deployment step',
};

const EVIDENCE_TYPE_EXPLAIN: Record<string, string> = {
  'test-result': 'the outcome of an automated test',
  'evaluation-result': 'the score from an automated quality evaluation',
  'config-check': 'a check of the application configuration',
  'mcp-allowlist': 'a comparison of configured tools against the approved allowlist',
  'artefact-digest': 'the immutable fingerprint of the deployed build',
  'human-approval': 'a recorded human sign-off',
  'runtime-finding': 'an observation captured from live runtime telemetry',
};

const IDENTITY_ASSURANCE_EXPLAIN: Record<string, string> = {
  'self-asserted': 'the approver identified themselves locally (demo only — no verified identity)',
  'pull-request': 'approval captured through a reviewed GitHub pull request',
  'protected-environment': 'approval captured inside a protected CI environment',
};

const EVIDENCE_MODE_EXPLAIN: Record<string, string> = {
  'ci-authoritative': 'Authoritative — evidence produced by the CI pipeline on a specific commit',
  'local-demonstration': 'Demonstration only — evidence produced locally, not from an authoritative CI run',
};

const fmtValue = (v: unknown): string => {
  if (Array.isArray(v)) return v.length ? v.map((x) => `\`${x}\``).join(', ') : '_none_';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return `\`${String(v)}\``;
};

/**
 * A rich, plain-English version of the dossier intended to be opened as a file and
 * shown to a non-technical governance audience. Every coded value (policy ids,
 * control ids, severities, stages) is accompanied by supporting text.
 */
export function dossierReportMarkdown(): string {
  const a = loadArtefacts();
  const cat = loadCatalogue();
  const controlById = new Map((cat?.controls ?? []).map((c) => [c.id, c] as const));
  const policyById = new Map((cat?.policySources ?? []).map((p) => [p.id, p] as const));
  const d = dossierJson();
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  // Derived assurance status — reflects the real artefacts, never hard-coded.
  const decision = a.decision;
  const controls = a.contract?.material.controls ?? [];
  const blockingControls = controls.filter((c) => c.severity === 'blocking');
  const approved = decision?.releaseDecision === 'approved' && decision.deployable === true;
  const certified = approved && !!decision?.certifiedArtefactDigest && decision?.evidenceMode === 'ci-authoritative';
  const blockingSatisfied = approved && (decision?.blockingFailures?.length ?? 0) === 0;
  const lifecycleStages = [!!a.proposition, controls.length > 0, !!a.approval, !!decision, certified];
  const lifecycleComplete = lifecycleStages.every(Boolean);
  const lifecycleDone = lifecycleStages.filter(Boolean).length;
  const mark = (b: boolean) => (b ? '✓' : '—');
  const statusLabel = certified
    ? '🟢 **Certified — compliant**'
    : approved
      ? '🟡 **Approved — demonstration evidence (not yet CI-certified)**'
      : decision?.releaseDecision === 'blocked'
        ? '🔴 **Blocked — a required control is not satisfied**'
        : decision?.releaseDecision === 'demonstration-only'
          ? '🟡 **Demonstration only — not certified**'
          : '⚪ **Pending verification** — run `npm run gov:verify` then `gov:certify`';
  const L: string[] = [];

  L.push('# Waypoint — AI Governance Assurance Dossier');
  L.push('');
  L.push(`_Generated ${generated} from version-controlled governance artefacts._`);
  L.push('');
  L.push('## Assurance status');
  L.push('');
  L.push('| Assurance check | Status |');
  L.push('|---|---|');
  L.push(`| **Certification status** | ${statusLabel} |`);
  L.push(`| **Required controls evidenced** | ${mark(blockingSatisfied)} ${blockingControls.length ? `${blockingSatisfied ? blockingControls.length : 0} / ${blockingControls.length} blocking controls satisfied` : 'no contract generated yet'} |`);
  L.push(`| **Lifecycle record complete** | ${mark(lifecycleComplete)} ${lifecycleDone} / ${lifecycleStages.length} stages (declare → select → approve → evidence → certify) |`);
  L.push('');
  const statusWord = certified ? '**Certified**' : approved ? '**Approved (demonstration)**' : decision?.releaseDecision === 'blocked' ? '**Blocked**' : '**Pending**';
  L.push(`**Waypoint** — current status: ${statusWord}`);
  L.push('');
  L.push(`- ${mark(blockingSatisfied)} Applicable controls satisfied${controls.length ? ` — ${controls.length} selected, ${blockingControls.length} blocking` : ''}`);
  L.push(`- ${mark(approved)} Evaluations passed — grounding and human-approval eval gates`);
  L.push(`- ${mark(!!a.approval)} Human approvals recorded${a.approval ? ` — ${a.approval.approver} (${a.approval.approvalMechanism})` : ''}`);
  const certDigest = decision?.certifiedArtefactDigest;
  L.push(`- ${mark(!!certDigest)} Deployed version and agent identity${certDigest ? ` — \`${certDigest}\`` : ' — pending certification'}`);
  L.push(`- ${mark(!!decision)} Runtime policy decisions captured — referenced from Application Insights and the agent audit trail`);
  const evidenceComplete = !!decision && decision.evidenceMode === 'ci-authoritative';
  L.push(`- ${mark(evidenceComplete)} Evidence record complete${decision ? ` — ${decision.evidenceMode}${decision.evidenceSetId ? `, set \`${decision.evidenceSetId}\`` : ''}` : ''}`);
  L.push('');
  L.push('> **What this is.** A plain-English audit trail for the Waypoint AI agent. It shows the');
  L.push('> business proposition being governed, the governance controls it must satisfy and *why*');
  L.push('> each one applies, the frozen set of obligations that was approved, and the current');
  L.push('> go/no-go release decision. Every item below is derived **deterministically** from');
  L.push('> declared facts and version-controlled files — not from model opinion.');
  L.push('>');
  L.push('> ⚠️ **Demonstration content.** The policy catalogue is **synthetic** (illustrative). It is');
  L.push('> not any organisation\u2019s actual policy and makes no regulatory or compliance-certification claim.');
  L.push('');

  // At-a-glance summary (the compact snapshot, before the detailed sections).
  const contractSummary = typeof d.contract === 'string' ? '_unavailable_' : `${d.contract.version} (\`${d.contract.hash}\`)`;
  const approvalSummary = typeof d.approval === 'string'
    ? '_unavailable_'
    : `${d.approval.approver} (${d.approval.identityAssurance}, non-repudiation: ${d.approval.nonRepudiation ? 'yes' : 'no'})`;
  const releaseSummary = typeof d.releaseDecision === 'string'
    ? '_not yet produced — run `npm run gov:verify`_'
    : `**${d.releaseDecision.decision}** · deployable: ${d.releaseDecision.deployable ? 'yes' : 'no'} · mode: ${d.releaseDecision.evidenceMode}`;
  L.push('## At a glance');
  L.push('');
  L.push('| Field | Value |');
  L.push('|---|---|');
  L.push(`| Proposition | **${d.intent.propositionId}** — ${d.intent.title} |`);
  L.push(`| Accountable owner | ${d.intent.accountableOwner} |`);
  L.push(`| Control contract | ${contractSummary} |`);
  L.push(`| Approval | ${approvalSummary} |`);
  L.push(`| Release decision | ${releaseSummary} |`);
  L.push(`| Controls selected | ${d.selectedControls.length} |`);
  L.push('');
  L.push('### Selected controls');
  L.push('');
  L.push('| Control | Severity | Policy source | Implemented in |');
  L.push('|---|---|---|---|');
  for (const c of d.selectedControls) {
    L.push(`| \`${c.id}\` | ${c.severity} | \`${c.policyRef}\` | ${c.increments.join(', ')} |`);
  }
  L.push('');
  L.push('_Full explanations of every field, control and code below._');
  L.push('');
  L.push('---');
  L.push('');

  // 1. Proposition
  L.push('## 1. The proposition being governed');
  L.push('');
  L.push('This is the thing under assessment — the product/capability whose declared characteristics drive everything else.');
  L.push('');
  L.push(`- **Proposition ID:** \`${d.intent.propositionId}\` — the internal identifier for this capability.`);
  L.push(`- **Title:** ${d.intent.title}`);
  L.push(`- **Accountable owner:** ${d.intent.accountableOwner} — the person answerable for it.`);
  if (a.proposition) {
    L.push(`- **Source requirements:** ${(a.proposition.prdRequirementIds ?? []).map((r) => `\`${r}\``).join(', ') || '_n/a_'} — the product requirements this traces back to.`);
    L.push(`- **Approved tools:** ${((a.proposition as { approvedTools?: string[] }).approvedTools ?? []).map((t) => `\`${t}\``).join(', ') || '_none_'} — the only external tools governance has allow-listed.`);
  }
  L.push('');
  if (a.proposition && typeof d.classification === 'object') {
    L.push('### Declared characteristics');
    L.push('');
    L.push('These declared facts are what the control-selection engine reads. Nothing high-risk is inferred — it is stated up front.');
    L.push('');
    L.push('| Characteristic | Declared value | What it means |');
    L.push('|---|---|---|');
    const chars = d.classification as Record<string, unknown>;
    for (const [key, meta] of Object.entries(CHARACTERISTIC_LABELS)) {
      if (!(key in chars)) continue;
      L.push(`| ${meta.label} | ${fmtValue(chars[key])} | ${meta.explain} |`);
    }
    L.push('');
  }

  // 2. How controls are selected
  L.push('## 2. How controls were selected');
  L.push('');
  L.push('Each control in the catalogue carries an *"applies when"* rule written over the declared');
  L.push('characteristics above. A control is included **only if its rule matches** — a transparent,');
  L.push('repeatable decision with no model judgement involved. The matched rule is shown against each control.');
  L.push('');

  // 3. Selected controls
  L.push('## 3. Selected controls — the obligations Waypoint must meet');
  L.push('');
  L.push(`${d.selectedControls.length} control(s) were selected for this proposition.`);
  L.push('');
  for (const sc of d.selectedControls) {
    const full = controlById.get(sc.id);
    const contractControl = a.contract?.material.controls.find((c) => c.controlId === sc.id);
    const title = full?.title ?? sc.id;
    L.push(`### ${sc.id} — ${title}`);
    L.push('');
    if (full?.description) L.push(`${full.description}`);
    L.push('');
    if (full?.category) L.push(`- **Category:** ${full.category}`);
    L.push(`- **Severity:** ${SEVERITY_EXPLAIN[sc.severity] ?? sc.severity}`);
    if (full?.enforcementStage) L.push(`- **Enforced at:** \`${full.enforcementStage}\` — ${STAGE_EXPLAIN[full.enforcementStage] ?? ''}`);
    const pol = policyById.get(sc.policyRef);
    L.push(`- **Policy source:** \`${sc.policyRef}\`${pol ? ` — ${pol.owner}; applies to: ${pol.applicability}` : ''}`);
    if (contractControl?.matchedBy?.length) L.push(`- **Why it applies:** ${contractControl.matchedBy.join('; ')}`);
    else if (contractControl?.rationale) L.push(`- **Why it applies:** ${contractControl.rationale}`);
    if (full?.obligation) L.push(`- **What it requires:** ${full.obligation}`);
    const evReqs = contractControl?.evidenceRequirements ?? full?.evidenceRequirements ?? [];
    if (evReqs.length) {
      const ev = evReqs.map((e) => `${e.descriptor} (${EVIDENCE_TYPE_EXPLAIN[e.evidenceType] ?? e.evidenceType})`).join('; ');
      L.push(`- **Evidence required:** ${ev}`);
    }
    L.push(`- **Implemented in:** ${sc.increments.join(', ')}${CONTROL_TESTS[sc.id] ? ` · verified by ${CONTROL_TESTS[sc.id]}` : ''}`);
    L.push('');
  }

  // 4. Policy sources
  const usedPolicies = [...new Set(d.selectedControls.map((c) => c.policyRef))];
  if (usedPolicies.length) {
    L.push('## 4. Policy sources referenced');
    L.push('');
    L.push('The controls above trace to these (synthetic) policy sources. In a real deployment these');
    L.push('would come from an authoritative, centrally-versioned policy catalogue.');
    L.push('');
    L.push('| Policy ID | Owner | Governs |');
    L.push('|---|---|---|');
    for (const pid of usedPolicies) {
      const p = policyById.get(pid);
      L.push(`| \`${pid}\` | ${p?.owner ?? '_unknown_'} | ${p?.applicability ?? '_unknown_'} |`);
    }
    L.push('');
  }

  // 5. Control contract & approval
  L.push('## 5. The approved control contract');
  L.push('');
  L.push('The selected controls are frozen into a **control contract** and hashed. The hash is a');
  L.push('tamper-evident fingerprint: if any obligation changed, the hash would change and the');
  L.push('existing approval would no longer match.');
  L.push('');
  if (typeof d.contract !== 'string') {
    L.push(`- **Contract version:** \`${d.contract.version}\``);
    L.push(`- **Contract hash:** \`${d.contract.hash}\` — the fingerprint the approval is bound to.`);
  } else {
    L.push('- **Contract:** _unavailable — run `npm run gov:contract`._');
  }
  if (typeof d.approval !== 'string') {
    L.push(`- **Approved by:** ${d.approval.approver}`);
    L.push(`- **Identity assurance:** \`${d.approval.identityAssurance}\` — ${IDENTITY_ASSURANCE_EXPLAIN[d.approval.identityAssurance] ?? ''}.`);
    L.push(`- **Approval mechanism:** \`${d.approval.mechanism}\`.`);
    L.push(`- **Non-repudiation:** ${d.approval.nonRepudiation ? 'Yes' : 'No'} — this demo does **not** claim a cryptographic signature.`);
    if (d.approval.sourceCommit) L.push(`- **Approved at commit:** \`${d.approval.sourceCommit}\`.`);
  } else {
    L.push('- **Approval:** _unavailable — run `npm run gov:approve`._');
  }
  L.push('');

  // 6. Release decision
  L.push('## 6. Release decision');
  L.push('');
  L.push('The go/no-go outcome. A release is only deployable when every **blocking** control has passing evidence.');
  L.push('');
  if (typeof d.releaseDecision !== 'string') {
    const rd = d.releaseDecision;
    L.push(`- **Decision:** **${rd.decision}**`);
    L.push(`- **Deployable:** ${rd.deployable ? 'Yes' : 'No'}`);
    L.push(`- **Evidence mode:** \`${rd.evidenceMode}\` — ${EVIDENCE_MODE_EXPLAIN[rd.evidenceMode] ?? ''}.`);
    L.push(`- **Evidence set:** \`${rd.evidenceSetId}\``);
    L.push(`- **Certified artefact digest:** \`${rd.certifiedArtefactDigest}\` — the immutable build fingerprint the decision certifies.`);
    if (rd.sourceCommit && rd.sourceCommit !== 'unavailable') L.push(`- **Assessed commit:** \`${rd.sourceCommit}\``);
  } else {
    L.push('- **No release decision has been produced yet.** Run `npm run gov:verify` to evaluate the');
    L.push('  evidence and generate a decision. Until then the proposition is treated as **not deployable**.');
  }
  L.push('');

  // 7. Evidence integrity
  L.push('## 7. Evidence integrity');
  L.push('');
  L.push('An honest self-check: this dossier flags anything missing or non-authoritative rather than implying success.');
  L.push('');
  for (const i of d.integrity) L.push(`- ${i}`);
  L.push('');

  // 8. Limitations
  L.push('## 8. Limitations & non-claims');
  L.push('');
  for (const l of d.limitations) L.push(`- ${l}`);
  L.push('');
  L.push(`> ${d.evidenceReference}`);
  L.push('');

  // Glossary
  L.push('## Glossary');
  L.push('');
  L.push('- **Blocking vs advisory** — blocking controls stop a release until satisfied; advisory controls are reviewed but non-blocking.');
  L.push('- **Enforcement stage** — *when* a control is checked: build, pre-release (evaluations), runtime (live), release (go/no-go gate), or deploy.');
  L.push('- **Evidence** — the proof a control is met: a test result, evaluation score, config check, allowlist comparison, artefact digest, or human sign-off.');
  L.push('- **Contract hash** — a tamper-evident fingerprint of the exact approved control set; any change invalidates the prior approval.');
  L.push('- **Artefact digest** — the immutable fingerprint of the built container image, so the release is pinned to an exact build (not a moving tag).');
  L.push('- **Evidence mode** — *ci-authoritative* (produced by CI on a commit) vs *local-demonstration* (produced locally, for illustration only).');
  L.push('- **Non-repudiation** — a cryptographic guarantee the approver cannot later deny signing. This demo does **not** claim it.');
  L.push('');

  return L.join('\n');
}

export function learningMarkdown(opts: { incidentId: string; finding: string; control: string; proposition: string }): string {
  return [
    `# Learning artefact — ${opts.incidentId}`,
    '',
    '> Proposed for HUMAN REVIEW. The runtime does not automatically change production code, controls, or evaluations.',
    '',
    `- Correlated incident/finding: ${opts.incidentId}`,
    `- Affected proposition: ${opts.proposition}`,
    `- Applicable control: ${opts.control}`,
    `- Observed failure: ${opts.finding}`,
    '',
    '## Proposed new/updated evaluation case',
    `- Add a scenario asserting containment for: ${opts.finding}`,
    '',
    '## Proposed backlog item',
    `- Investigate and harden the path that produced "${opts.finding}" (control ${opts.control}).`,
    '',
    '## Human review status',
    '- [ ] Reviewed  - [ ] Accepted  - [ ] Rejected',
    '',
    '## Evidence references',
    '- See the governance evidence manifest + release decision for the assessed commit.',
    '',
  ].join('\n');
}
