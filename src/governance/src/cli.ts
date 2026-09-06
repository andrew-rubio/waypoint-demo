#!/usr/bin/env -S npx tsx
import { existsSync, appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildApprovalRecord, checkApproval } from './approval.js';
import { loadCatalogue, loadProposition } from './catalog.js';
import { buildControlContract } from './contract.js';
import { collectEvidence } from './evidence.js';
import { selectControls } from './select.js';
import { releaseDecisionMarkdown, evidenceSummaryMarkdown } from './summary.js';
import { verifyRelease } from './verify.js';
import { dossierJson, dossierMarkdown, learningMarkdown, traceMarkdown } from './dossier.js';
import { deriveLifecycle } from './lifecycle.js';
import { intakeInit, intakeValidate, intakePromote } from './intake.js';
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

function cmdIntakeInit(): number {
  const { yaml, unresolved } = intakeInit();
  writeTextFile(PATHS.propositionDraft, yaml);
  console.log(`Deterministic governance intake template written to ${PATHS.propositionDraft}`);
  console.log(`\n${unresolved.length} mandatory field(s) require human input (no value is inferred):`);
  for (const f of unresolved) console.log(`  - ${f}`);
  console.log('\nA human supplies the values, then: npm run gov:intake:validate');
  audit('proposition.intake-initialised', { summary: `Intake template created; ${unresolved.length} mandatory fields UNRESOLVED` });
  return 0;
}

function cmdIntakeValidate(): number {
  if (!existsSync(PATHS.propositionDraft)) {
    console.error(`No draft at ${PATHS.propositionDraft} — run gov:intake:init first.`);
    return 2;
  }
  const v = intakeValidate(readFileSync(PATHS.propositionDraft, 'utf8'));
  if (v.ok) {
    console.log('PROPOSITION VALIDATION PASSED — all mandatory fields resolved. Promote with gov:intake:promote.');
    return 0;
  }
  console.log('PROPOSITION VALIDATION BLOCKED\n');
  console.log(`${v.problems.length} problem(s) require human input:`);
  for (const p of v.problems) console.log(`- ${p.path}: ${p.message}`);
  console.log('\nNo controls have been selected.');
  audit('proposition.intake-validated', { summary: `Validation blocked: ${v.problems.length} problems` });
  return 1;
}

function cmdIntakePromote(): number {
  const args = parseArgs(process.argv.slice(3));
  const confirmedBy = (args['confirmed-by'] as string) ?? '';
  if (!confirmedBy) { console.error('Error: --confirmed-by "<identity>" is required.'); return 2; }
  if (!existsSync(PATHS.propositionDraft)) {
    console.error(`No draft at ${PATHS.propositionDraft} — run gov:intake:init first.`);
    return 2;
  }
  const result = intakePromote(readFileSync(PATHS.propositionDraft, 'utf8'), confirmedBy);
  if (!result.ok || !result.proposition) {
    console.error(`PROMOTION BLOCKED — ${result.reason}`);
    return 1;
  }
  writeYamlFile(PATHS.proposition, result.proposition);
  console.log(`Promoted to ${PATHS.proposition} (proposition "${result.proposition.propositionId}" v${result.proposition.version}).`);
  console.log(`  content hash: ${result.proposition.confirmation.contentHash}`);
  console.log(`  confirmed by: ${confirmedBy} (${result.proposition.confirmation.identityAssurance}, ${result.proposition.confirmation.mechanism})`);
  console.log('Deterministic control selection may now run: npm run gov:select');
  audit('proposition.promoted', { propositionHash: result.proposition.confirmation.contentHash as string, summary: `Human-confirmed intake promoted by ${confirmedBy}` });
  return 0;
}

function cmdSelect(): number {
  let inputs;
  try {
    inputs = loadInputs();
  } catch (err) {
    console.error('CONTROL SELECTION REFUSED — the approved proposition is missing or has unresolved/invalid required classifications.');
    console.error('Run the deterministic intake first (gov:intake:init → validate → promote). Selection never infers values from prose.');
    console.error(`Detail: ${(err as Error).message.split('\n')[0]}`);
    return 1;
  }
  const { catalogue, proposition } = inputs;
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

function cmdDossier(): number {
  writeJsonFile(PATHS.dossierJson, dossierJson());
  writeTextFile(PATHS.dossierMd, dossierMarkdown());
  console.log(dossierMarkdown());
  console.log(`\nDossier → ${PATHS.dossierJson} + ${PATHS.dossierMd}`);
  audit('dossier.generated', { summary: 'Proposition audit dossier generated' });
  return 0;
}

function cmdTrace(): number {
  console.log(traceMarkdown());
  return 0;
}

function cmdChangeImpact(): number {
  const { catalogue, proposition } = loadInputs();
  const fresh = buildControlContract(proposition, catalogue, selectControls(proposition, catalogue), { contractVersion: '1.0.0', generatedAt: 'compare' });
  if (!existsSync(PATHS.contract)) {
    console.log('No stored contract to compare — run gov:contract first.');
    return 0;
  }
  const stored = ControlContractSchema.parse(readYamlFile(PATHS.contract));
  const storedIds = new Set(stored.material.controls.map((c) => c.controlId));
  const freshIds = new Set(fresh.material.controls.map((c) => c.controlId));
  const added = [...freshIds].filter((i) => !storedIds.has(i));
  const removed = [...storedIds].filter((i) => !freshIds.has(i));
  const changed = fresh.contractHash !== stored.contractHash;
  const approval = readJsonIfExists<ApprovalRecord>(PATHS.approval);
  const approvalValid = approval ? checkApproval(stored, approval, proposition, catalogue).valid : false;

  console.log('# Change-impact report');
  console.log(`Stored contract hash:  ${stored.contractHash}`);
  console.log(`Recomputed hash:       ${fresh.contractHash}`);
  console.log(`Material change:       ${changed ? 'YES' : 'no'}`);
  console.log(`Controls added:        ${added.length ? added.join(', ') : 'none'}`);
  console.log(`Controls removed:      ${removed.length ? removed.join(', ') : 'none'}`);
  console.log(`Affected proposition:  ${proposition.propositionId} (v${proposition.version})`);
  console.log(`Approval still valid:  ${approvalValid ? 'yes' : 'NO — re-approval required'}`);
  audit('change-impact.reported', { contractHash: fresh.contractHash, summary: `material change=${changed}; +${added.length}/-${removed.length} controls; approvalValid=${approvalValid}` });
  return changed && !approvalValid ? 3 : 0;
}

function cmdLearn(): number {
  const args = parseArgs(process.argv.slice(3));
  const incidentId = (args['incident'] as string) ?? `incident-${Date.now()}`;
  const md = learningMarkdown({
    incidentId,
    finding: (args['finding'] as string) ?? 'stale currency data blocked a budget confirmation',
    control: (args['control'] as string) ?? 'DATA-FRESH-001',
    proposition: (args['proposition'] as string) ?? 'waypoint',
  });
  const out = `${PATHS.learningDir}/${incidentId}.md`;
  writeTextFile(out, md);
  console.log(md);
  console.log(`\nLearning artefact (for human review) → ${out}`);
  audit('learning.proposed', { summary: `Learning artefact ${incidentId} proposed for human review` });
  return 0;
}

function cmdStatus(): number {
  const approval = readJsonIfExists<ApprovalRecord>(PATHS.approval);
  const decision = readJsonIfExists<ReleaseDecision>(PATHS.releaseDecision);
  const learning = existsSync(PATHS.learningDir) ? readdirSync(PATHS.learningDir).filter((f) => f.endsWith('.md')) : [];
  // Approval is only "valid" if it still hash-binds the current contract + proposition + catalogue.
  let approvalValid = false;
  if (approval && existsSync(PATHS.contract)) {
    const { catalogue, proposition } = loadInputs();
    const contract = ControlContractSchema.parse(readYamlFile(PATHS.contract));
    approvalValid = checkApproval(contract, approval, proposition, catalogue).valid;
  }
  const stages = deriveLifecycle({
    propositionExists: existsSync(PATHS.proposition),
    frdExists: existsSync(`${REPO_ROOT}/specs/frd-control-selection-and-release-contract.md`),
    selectionExists: existsSync(PATHS.selection),
    approvalValid,
    decision: decision ? { releaseDecision: decision.releaseDecision, deployable: decision.deployable } : undefined,
    learningArtefactCount: learning.length,
  });
  console.log(`Proposition lifecycle — ${existsSync(PATHS.proposition) ? loadProposition(PATHS.proposition).propositionId : 'n/a'}`);
  for (const s of stages) console.log(`  [${s.complete ? 'x' : ' '}] ${s.stage}`);
  return 0;
}

function main(): number {
  const sub = process.argv[2];
  switch (sub) {
    case 'intake-init': return cmdIntakeInit();
    case 'intake-validate': return cmdIntakeValidate();
    case 'intake-promote': return cmdIntakePromote();
    case 'select': return cmdSelect();
    case 'contract': return cmdContract();
    case 'approve': return cmdApprove();
    case 'evidence': return cmdEvidence();
    case 'verify': return cmdVerify();
    case 'certify': return cmdCertify();
    case 'demo-failure': return cmdDemo(false);
    case 'demo-pass': return cmdDemo(true);
    case 'dossier': return cmdDossier();
    case 'trace': return cmdTrace();
    case 'change-impact': return cmdChangeImpact();
    case 'learn': return cmdLearn();
    case 'status': return cmdStatus();
    default:
      console.error('Usage: waypoint-gov <intake-init|intake-validate|intake-promote|select|contract|approve|evidence|verify|certify|demo-failure|demo-pass|dossier|trace|change-impact|learn|status> [--flags]');
      return 2;
  }
}

process.exit(main());
