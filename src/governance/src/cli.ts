#!/usr/bin/env -S npx tsx
import { existsSync, appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApprovalRecord, checkApproval } from './approval.js';
import { loadCatalogue, loadProposition } from './catalog.js';
import { buildControlContract } from './contract.js';
import { collectEvidence } from './evidence.js';
import { selectControls } from './select.js';
import { releaseDecisionMarkdown, evidenceSummaryMarkdown } from './summary.js';
import { verifyRelease } from './verify.js';
import { sha256Of } from './canonical.js';
import {
  PATHS,
  currentCommit,
  parseArgs,
  readJsonFile,
  readJsonIfExists,
  readYamlFile,
  writeJsonFile,
  writeTextFile,
  writeYamlFile,
  REPO_ROOT,
} from './io.js';
import type {
  ApprovalRecord,
  ControlContract,
  ControlSelection,
  EvidenceManifest,
  ReleaseDecision,
} from './types.js';
import { ControlContract as ControlContractSchema, EvidenceManifest as EvidenceManifestSchema } from './types.js';

function audit(eventType: string, fields: Record<string, unknown>): void {
  mkdirSync(dirname(PATHS.auditLog), { recursive: true });
  const record = { eventType, timestamp: new Date().toISOString(), actor: process.env.GITHUB_ACTOR ?? process.env.USERNAME ?? 'local', sourceCommit: currentCommit(), ...fields };
  appendFileSync(PATHS.auditLog, JSON.stringify(record) + '\n', 'utf8');
}

function loadInputs() {
  return { catalogue: loadCatalogue(PATHS.catalogue), proposition: loadProposition(PATHS.proposition) };
}

// ─────────────────────────────── subcommands ───────────────────────────────

function cmdSelect(): number {
  const { catalogue, proposition } = loadInputs();
  const selection = selectControls(proposition, catalogue);
  writeJsonFile(PATHS.selection, selection);
  const blocking = selection.selected.filter((s) => s.severity === 'blocking').length;
  console.log(`Selected ${selection.selected.length} control(s) (${blocking} blocking) for "${proposition.propositionId}".`);
  for (const s of selection.selected) console.log(`  - ${s.controlId} [${s.severity}] ${s.rationale}`);
  for (const f of selection.findings) console.log(`  ! ${f.code}: ${f.detail}`);
  audit('control-selection.generated', { propositionHash: sha256Of(proposition), policySetHash: sha256Of(catalogue), summary: `Selected ${selection.selected.length} controls (${blocking} blocking)` });
  return 0;
}

function cmdContract(): number {
  const { catalogue, proposition } = loadInputs();
  const selection: ControlSelection = existsSync(PATHS.selection) ? readJsonFile(PATHS.selection) : selectControls(proposition, catalogue);
  // Preserve generatedAt when the material is unchanged so re-running never invalidates approval.
  let generatedAt: string | undefined;
  if (existsSync(PATHS.contract)) {
    const prev = ControlContractSchema.parse(readYamlFile(PATHS.contract));
    const candidate = buildControlContract(proposition, catalogue, selection, { contractVersion: prev.contractVersion, generatedAt: prev.generatedAt });
    if (candidate.contractHash === prev.contractHash) generatedAt = prev.generatedAt;
  }
  const contract = buildControlContract(proposition, catalogue, selection, { contractVersion: (parseArgs(process.argv.slice(3))['version'] as string) ?? '1.0.0', generatedAt });
  writeYamlFile(PATHS.contract, contract);
  console.log(`Control contract ${contract.contractVersion} written. hash=${contract.contractHash}`);
  audit('control-contract.generated', { contractHash: contract.contractHash, propositionHash: contract.material.propositionHash, policySetHash: contract.material.policyCatalogueHash, summary: `Generated ${contract.material.controls.length} applicable controls` });
  return 0;
}

function cmdApprove(): number {
  const args = parseArgs(process.argv.slice(3));
  const approver = (args['approver'] as string) ?? '';
  if (!approver) { console.error('Error: --approver "<identity>" is required.'); return 2; }
  const { catalogue, proposition } = loadInputs();
  const contract = ControlContractSchema.parse(readYamlFile(PATHS.contract));
  const mechanism = (args['mechanism'] as ApprovalRecord['approvalMechanism']) ?? 'local-demo';
  const identityAssurance = mechanism === 'local-demo' ? 'self-asserted' : mechanism;
  const approval = buildApprovalRecord(contract, proposition, catalogue, {
    approver,
    approvalMechanism: mechanism,
    identityAssurance,
    sourceCommit: currentCommit(),
    comment: args['comment'] as string | undefined,
  });
  writeJsonFile(PATHS.approval, approval);
  console.log(`Approved contract ${approval.contractVersion} by "${approver}" (${identityAssurance}, ${mechanism}). No non-repudiation claimed.`);
  audit('control-contract.approved', { contractHash: approval.contractHash, approver, approvalMechanism: mechanism, identityAssurance, summary: 'Human hash-bound approval recorded' });
  return 0;
}

interface EvidenceFlags { mode: 'ci-authoritative' | 'local-demonstration'; commit?: string; runId?: string; digest?: string; deploymentDigest?: string; configuredToolsOverride?: string[]; }

function buildManifest(contract: ControlContract, proposition: { approvedTools: string[] }, flags: EvidenceFlags): EvidenceManifest {
  return collectEvidence(contract, {
    repoRoot: REPO_ROOT,
    mode: flags.mode,
    sourceCommit: flags.commit ?? currentCommit(),
    workflowRunId: flags.runId,
    collectedAt: new Date().toISOString(),
    artefactDigest: flags.digest,
    deploymentDigest: flags.deploymentDigest,
    approvedTools: proposition.approvedTools,
    configuredToolsOverride: flags.configuredToolsOverride,
  });
}

function flagsFromArgs(args: Record<string, string | boolean>): EvidenceFlags {
  return {
    mode: (args['mode'] as EvidenceFlags['mode']) ?? 'local-demonstration',
    commit: (args['commit'] as string) ?? undefined,
    runId: (args['run-id'] as string) ?? undefined,
    digest: (args['digest'] as string) ?? undefined,
    deploymentDigest: (args['deployment-digest'] as string) ?? undefined,
  };
}

function cmdEvidence(): number {
  const args = parseArgs(process.argv.slice(3));
  const { proposition } = loadInputs();
  const contract = ControlContractSchema.parse(readYamlFile(PATHS.contract));
  const manifest = buildManifest(contract, proposition, flagsFromArgs(args));
  const out = (args['out'] as string) ?? PATHS.evidenceManifest;
  writeJsonFile(out, manifest);
  console.log(evidenceSummaryMarkdown(manifest));
  console.log(`\nEvidence set ${manifest.evidenceSetId} (${manifest.evidenceMode}) → ${out}`);
  audit('evidence.collected', { contractHash: contract.contractHash, evidenceSetId: manifest.evidenceSetId, evidenceMode: manifest.evidenceMode, summary: `Collected ${manifest.entries.length} evidence entries` });
  return 0;
}

function runVerify(args: Record<string, string | boolean>): { decision: ReleaseDecision } {
  const { catalogue, proposition } = loadInputs();
  const contract = ControlContractSchema.parse(readYamlFile(PATHS.contract));
  const approval = readJsonIfExists<ApprovalRecord>(PATHS.approval);
  const manifestPath = (args['manifest'] as string) ?? PATHS.evidenceManifest;
  const manifest = EvidenceManifestSchema.parse(readJsonFile(manifestPath));
  const decision = verifyRelease({
    proposition,
    catalogue,
    contract,
    approval,
    manifest,
    deploymentArtefactDigest: (args['deployment-digest'] as string) ?? manifest.entries.find((e) => e.artefactDigest)?.artefactDigest,
  });
  const out = (args['out'] as string) ?? PATHS.releaseDecision;
  writeJsonFile(out, decision);
  const md = releaseDecisionMarkdown(decision);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  audit('release.decided', { contractHash: decision.contractHash, evidenceSetId: decision.evidenceSetId, releaseDecision: decision.releaseDecision, deployable: decision.deployable, summary: decision.rationale });
  return { decision };
}

function cmdVerify(): number {
  const { decision } = runVerify(parseArgs(process.argv.slice(3)));
  return decision.releaseDecision === 'blocked' ? 1 : 0;
}

function cmdCertify(): number {
  const args = parseArgs(process.argv.slice(3));
  const { decision } = runVerify(args);
  if (!decision.deployable) {
    console.error(`\nCERTIFY FAILED: release is "${decision.releaseDecision}" and not deployable.`);
    return 1;
  }
  console.log(`\nCERTIFIED: ${decision.propositionId} @ ${decision.certifiedArtefactDigest} is eligible for deployment.`);
  return 0;
}

function cmdDemo(pass: boolean): number {
  const { catalogue, proposition } = loadInputs();
  const contract = ControlContractSchema.parse(readYamlFile(PATHS.contract));
  const approval = readJsonIfExists<ApprovalRecord>(PATHS.approval);
  const configured = pass ? undefined : [...proposition.approvedTools, 'unregistered-booking-provider'];
  const manifest = buildManifest(contract, proposition, { mode: 'local-demonstration', configuredToolsOverride: configured });
  const decision = verifyRelease({ proposition, catalogue, contract, approval, manifest });
  console.log(releaseDecisionMarkdown(decision));
  if (!pass) {
    const mcp = decision.blockingFailures.find((f) => f.controlId === 'SEC-MCP-001');
    console.log('\nRELEASE BLOCKED');
    console.log('Control: SEC-MCP-001');
    console.log(`Finding: ${mcp?.reason ?? 'undeclared MCP tool referenced by the agent configuration.'}`);
    console.log('Required remediation: Register and approve the tool, or remove the reference. (Fixture only — the repository is unchanged.)');
    return decision.releaseDecision === 'blocked' ? 1 : 1;
  }
  console.log('\nCorrected configuration: all tools approved.');
  return decision.releaseDecision === 'blocked' ? 1 : 0;
}

function cmdStatus(): number {
  const approval = readJsonIfExists<ApprovalRecord>(PATHS.approval);
  const decision = readJsonIfExists<ReleaseDecision>(PATHS.releaseDecision);
  const learning = existsSync(PATHS.learningDir) ? readdirSync(PATHS.learningDir).filter((f) => f.endsWith('.md')) : [];
  const stages: Array<[string, boolean]> = [
    ['intake', existsSync(PATHS.proposition)],
    ['specified', existsSync(`${REPO_ROOT}/specs/frd-control-selection-and-release-contract.md`)],
    ['controls-selected', existsSync(PATHS.selection)],
    ['approved-for-build', !!approval],
    ['certified', decision?.releaseDecision === 'approved' || decision?.releaseDecision === 'demonstration-only'],
    ['deployed', decision?.deployable === true],
    ['incident-contained', learning.length > 0],
    ['learning-proposed', learning.length > 0],
  ];
  console.log(`Proposition lifecycle — ${existsSync(PATHS.proposition) ? loadProposition(PATHS.proposition).propositionId : 'n/a'}`);
  for (const [name, done] of stages) console.log(`  [${done ? 'x' : ' '}] ${name}`);
  return 0;
}

function main(): number {
  const sub = process.argv[2];
  switch (sub) {
    case 'select': return cmdSelect();
    case 'contract': return cmdContract();
    case 'approve': return cmdApprove();
    case 'evidence': return cmdEvidence();
    case 'verify': return cmdVerify();
    case 'certify': return cmdCertify();
    case 'demo-failure': return cmdDemo(false);
    case 'demo-pass': return cmdDemo(true);
    case 'status': return cmdStatus();
    default:
      console.error('Usage: waypoint-gov <select|contract|approve|evidence|verify|certify|certify|demo-failure|demo-pass|status> [--flags]');
      return 2;
  }
}

process.exit(main());
