import { describe, it, expect } from 'vitest';
import { buildApprovalRecord } from '../src/approval.js';
import { buildControlContract } from '../src/contract.js';
import { selectControls } from '../src/select.js';
import { verifyRelease } from '../src/verify.js';
import type { AdapterOutcome, ControlContract, EvidenceEntry, EvidenceManifest, EvidenceMode } from '../src/types.js';
import { sampleCatalogue, sampleProposition } from './fixtures.js';

const COMMIT = 'abc123';
const DIGEST = 'sha256:deadbeef';

function setup() {
  const prop = sampleProposition();
  const cat = sampleCatalogue();
  const contract = buildControlContract(prop, cat, selectControls(prop, cat), {
    contractVersion: '1.0.0',
    generatedAt: 'FIXED',
  });
  const approval = buildApprovalRecord(contract, prop, cat, {
    approver: 'demo.user',
    approvalMechanism: 'local-demo',
    identityAssurance: 'self-asserted',
    approvedAt: 'FIXED',
    sourceCommit: COMMIT,
  });
  return { prop, cat, contract, approval };
}

function entry(controlId: string, evidenceId: string, outcome: AdapterOutcome, extra: Partial<EvidenceEntry> = {}): EvidenceEntry {
  return {
    controlId,
    evidenceId,
    evidenceType: 'config-check',
    outcome,
    producer: 'test',
    detail: `${evidenceId}:${outcome}`,
    sourceCommit: COMMIT,
    collectedAt: 'FIXED',
    ...extra,
  };
}

/** A full passing manifest for every selected control + a certified artefact digest. */
function passingManifest(contract: ControlContract, mode: EvidenceMode = 'ci-authoritative'): EvidenceManifest {
  const entries: EvidenceEntry[] = [];
  for (const c of contract.material.controls) {
    for (const req of c.evidenceRequirements) {
      entries.push(entry(c.controlId, req.evidenceId, 'pass', { evidenceType: req.evidenceType }));
    }
  }
  entries.push(entry('SEC-MCP-001', 'artefact', 'pass', { evidenceType: 'artefact-digest', artefactDigest: DIGEST }));
  return {
    schema: 'waypoint.governance/evidence@1',
    evidenceSetId: 'evset-1',
    contractHash: contract.contractHash,
    contractVersion: contract.contractVersion,
    evidenceMode: mode,
    sourceCommit: COMMIT,
    workflowRunId: 'run-1',
    environment: 'ci',
    generatedAt: 'FIXED',
    entries,
  };
}

describe('deterministic release verification', () => {
  it('approved + complete CI-authoritative evidence + digest match → release/deployable', () => {
    const { prop, cat, contract, approval } = setup();
    const decision = verifyRelease({
      proposition: prop,
      catalogue: cat,
      contract,
      approval,
      manifest: passingManifest(contract),
      deploymentArtefactDigest: DIGEST,
    });
    expect(decision.releaseDecision).toBe('approved');
    expect(decision.deployable).toBe(true);
  });

  it('unapproved contract blocks release', () => {
    const { prop, cat, contract } = setup();
    const decision = verifyRelease({
      proposition: prop,
      catalogue: cat,
      contract,
      approval: undefined,
      manifest: passingManifest(contract),
      deploymentArtefactDigest: DIGEST,
    });
    expect(decision.releaseDecision).toBe('blocked');
    expect(decision.deployable).toBe(false);
  });

  it('missing blocking evidence blocks release', () => {
    const { prop, cat, contract, approval } = setup();
    const manifest = passingManifest(contract);
    manifest.entries = manifest.entries.filter((e) => e.controlId !== 'SEC-MCP-001' || e.evidenceType === 'artefact-digest');
    const decision = verifyRelease({ proposition: prop, catalogue: cat, contract, approval, manifest, deploymentArtefactDigest: DIGEST });
    expect(decision.releaseDecision).toBe('blocked');
    expect(decision.blockingFailures.some((f) => f.controlId === 'SEC-MCP-001')).toBe(true);
  });

  it('failed blocking evidence blocks release', () => {
    const { prop, cat, contract, approval } = setup();
    const manifest = passingManifest(contract);
    const target = manifest.entries.find((e) => e.controlId === 'RAI-HITL-001')!;
    target.outcome = 'fail';
    const decision = verifyRelease({ proposition: prop, catalogue: cat, contract, approval, manifest, deploymentArtefactDigest: DIGEST });
    expect(decision.releaseDecision).toBe('blocked');
  });

  it('an adapter error on a blocking control blocks release', () => {
    const { prop, cat, contract, approval } = setup();
    const manifest = passingManifest(contract);
    manifest.entries.find((e) => e.controlId === 'RAI-HITL-001')!.outcome = 'error';
    const decision = verifyRelease({ proposition: prop, catalogue: cat, contract, approval, manifest, deploymentArtefactDigest: DIGEST });
    expect(decision.releaseDecision).toBe('blocked');
    expect(decision.blockingFailures.some((f) => f.controlId === 'RAI-HITL-001' && f.status === 'error')).toBe(true);
  });

  it('advisory failure is reported but does not block', () => {
    const { prop, cat, contract, approval } = setup();
    const manifest = passingManifest(contract);
    manifest.entries.find((e) => e.controlId === 'OPS-TRACE-001')!.outcome = 'fail';
    const decision = verifyRelease({ proposition: prop, catalogue: cat, contract, approval, manifest, deploymentArtefactDigest: DIGEST });
    expect(decision.releaseDecision).toBe('approved');
    expect(decision.advisoryFindings.some((f) => f.controlId === 'OPS-TRACE-001')).toBe(true);
  });

  it('evidence from a different commit is rejected (errors the control)', () => {
    const { prop, cat, contract, approval } = setup();
    const manifest = passingManifest(contract);
    manifest.entries.find((e) => e.controlId === 'RAI-HITL-001')!.sourceCommit = 'other-commit';
    const decision = verifyRelease({ proposition: prop, catalogue: cat, contract, approval, manifest, deploymentArtefactDigest: DIGEST });
    expect(decision.releaseDecision).toBe('blocked');
  });

  it('local-demonstration evidence is never deployable', () => {
    const { prop, cat, contract, approval } = setup();
    const decision = verifyRelease({
      proposition: prop,
      catalogue: cat,
      contract,
      approval,
      manifest: passingManifest(contract, 'local-demonstration'),
    });
    expect(decision.releaseDecision).toBe('demonstration-only');
    expect(decision.deployable).toBe(false);
  });

  it('ci-authoritative without a matching deployment digest is demonstration-only', () => {
    const { prop, cat, contract, approval } = setup();
    const decision = verifyRelease({
      proposition: prop,
      catalogue: cat,
      contract,
      approval,
      manifest: passingManifest(contract),
      deploymentArtefactDigest: 'sha256:mismatch',
    });
    expect(decision.releaseDecision).toBe('demonstration-only');
    expect(decision.deployable).toBe(false);
  });
});
