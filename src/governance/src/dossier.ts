import { existsSync } from 'node:fs';
import { PATHS, readJsonIfExists, readYamlFile } from './io.js';
import type { ApprovalRecord, ControlContract, ControlSelection, ReleaseDecision } from './types.js';

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
  return {
    schema: 'waypoint.governance/dossier@1',
    generatedAt: new Date().toISOString(),
    intent: { propositionId: a.proposition?.propositionId, title: a.proposition?.title, accountableOwner: a.proposition?.accountableOwner },
    classification: a.proposition?.characteristics,
    selectedControls: (a.contract?.material.controls ?? []).map((c) => ({ id: c.controlId, severity: c.severity, policyRef: c.policyRef, increments: CONTROL_INCREMENTS[c.controlId] ?? ['INC-13'] })),
    contract: a.contract ? { version: a.contract.contractVersion, hash: a.contract.contractHash } : undefined,
    approval: a.approval ? { approver: a.approval.approver, mechanism: a.approval.approvalMechanism, identityAssurance: a.approval.identityAssurance, nonRepudiation: a.approval.nonRepudiation } : undefined,
    releaseDecision: a.decision ? { decision: a.decision.releaseDecision, deployable: a.decision.deployable, evidenceMode: a.decision.evidenceMode, evidenceSetId: a.decision.evidenceSetId, certifiedArtefactDigest: a.decision.certifiedArtefactDigest, sourceCommit: a.decision.sourceCommit, workflowRunId: a.decision.workflowRunId } : undefined,
    limitations: [
      'Synthetic policy catalogue; not IAG actual policy.',
      'Approval is hash-bound, not a cryptographic signature (no non-repudiation claim).',
      'Effective packaged runtime tool inventory not fully enumerated in this demo.',
      'Runtime/portal identity evidence is external; referenced, not copied here.',
    ],
    evidenceReference: 'See uploaded CI workflow artefact "governance-evidence-<run-id>" for authoritative, source-bound evidence.',
  };
}

export function dossierMarkdown(): string {
  const d = dossierJson();
  const lines: string[] = ['# Proposition audit dossier', ''];
  lines.push(`- Proposition: **${d.intent.propositionId}** — ${d.intent.title}`);
  lines.push(`- Accountable owner: ${d.intent.accountableOwner}`);
  lines.push(`- Contract: ${d.contract ? `${d.contract.version} (${d.contract.hash})` : 'n/a'}`);
  if (d.approval) lines.push(`- Approval: ${d.approval.approver} (${d.approval.identityAssurance}, non-repudiation: ${d.approval.nonRepudiation})`);
  if (d.releaseDecision) lines.push(`- Release decision: **${d.releaseDecision.decision}** · deployable: ${d.releaseDecision.deployable} · mode: ${d.releaseDecision.evidenceMode}`);
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
