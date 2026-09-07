import { describe, it, expect } from 'vitest';
import { loadCatalogue } from '../src/catalog.js';
import { selectControls } from '../src/select.js';
import { buildControlContract } from '../src/contract.js';
import { verifyRelease } from '../src/verify.js';
import { PATHS } from '../src/io.js';
import type { AdapterOutcome, ControlContract, EvidenceEntry, EvidenceManifest, PropositionDeclaration } from '../src/types.js';

const catalogue = loadCatalogue(PATHS.catalogue);
const COMMIT = 'commit1';
const DIGEST = 'sha256:digest1';

function proposition(over: Partial<PropositionDeclaration['characteristics']> = {}): PropositionDeclaration {
  return {
    schema: 'waypoint.governance/proposition@1',
    propositionId: 'waypoint',
    title: 'Waypoint',
    version: '1.0.0',
    accountableOwner: 'Owner',
    sourceRequirementRef: 'specs/prd.md',
    prdRequirementIds: ['PRD-1'],
    approvedTools: ['routestack', 'currency'],
    characteristics: {
      usesLLM: true,
      handlesPersonalData: true,
      dataClassification: 'confidential',
      autonomyLevel: 'supervised',
      consequentialActions: ['simulated-booking'],
      financialTransactions: 'simulated',
      externalIntegrations: ['mcp', 'currency'],
      humanInLoop: true,
      retrievalAugmented: true,
      deploymentSurface: ['azure-container-apps'],
      ...over,
    },
    unresolved: [],
  };
}

function selectedIds(p: PropositionDeclaration): string[] {
  return selectControls(p, catalogue).selected.map((s) => s.controlId);
}

/** Passing manifest for every selected control's evidence + a certified digest. */
function passingManifest(contract: ControlContract): EvidenceManifest {
  const entries: EvidenceEntry[] = [];
  const entry = (controlId: string, evidenceId: string, outcome: AdapterOutcome, extra: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
    controlId, evidenceId, evidenceType: 'config-check', outcome, producer: 'test', detail: 'x', sourceCommit: COMMIT, collectedAt: 'FIXED', ...extra,
  });
  for (const c of contract.material.controls) for (const req of c.evidenceRequirements) entries.push(entry(c.controlId, req.evidenceId, 'pass'));
  entries.push(entry('REL-IMM-001', 'artefact', 'pass', { evidenceType: 'artefact-digest', artefactDigest: DIGEST }));
  return {
    schema: 'waypoint.governance/evidence@1', evidenceSetId: 'ev1', contractHash: contract.contractHash, contractVersion: contract.contractVersion,
    evidenceMode: 'ci-authoritative', sourceCommit: COMMIT, workflowRunId: 'run1', environment: 'ci', generatedAt: 'FIXED', entries,
  };
}

describe('policy separation: data classification', () => {
  it('personal data selects the personal-data control (DATA-MIN-001)', () => {
    expect(selectedIds(proposition({ handlesPersonalData: true }))).toContain('DATA-MIN-001');
  });

  it('confidential non-personal data selects confidentiality controls but NOT personal-data controls', () => {
    const ids = selectedIds(proposition({ dataClassification: 'confidential', handlesPersonalData: false }));
    expect(ids).toContain('DATA-CONF-001');
    expect(ids).not.toContain('DATA-MIN-001');
  });
});

describe('policy separation: financial authority without human oversight', () => {
  it('selects the blocking human-approval control + a release-blocking policy finding', () => {
    const sel = selectControls(proposition({ financialTransactions: 'real', humanInLoop: false }), catalogue);
    expect(sel.selected.map((s) => s.controlId)).toContain('RAI-HITL-001');
    const pf = sel.policyFindings.find((f) => f.controlId === 'RAI-HITL-001');
    expect(pf?.severity).toBe('release-blocking');
  });

  it('the release decision blocks until the obligation is remediated', () => {
    // Declared without human oversight → valid input, but release-blocked by policy.
    const risky = proposition({ financialTransactions: 'real', humanInLoop: false });
    const contractR = buildControlContract(risky, catalogue, selectControls(risky, catalogue), { contractVersion: '1.0.0', generatedAt: 'FIXED' });
    const decisionR = verifyRelease({ proposition: risky, catalogue, contract: contractR, approval: undefined, manifest: passingManifest(contractR), deploymentArtefactDigest: DIGEST });
    expect(decisionR.releaseDecision).toBe('blocked');
    expect(decisionR.blockingFailures.some((f) => f.controlId === 'RAI-HITL-001')).toBe(true);

    // Remediate the declaration (add human oversight) → the policy finding is gone.
    const fixed = proposition({ financialTransactions: 'real', humanInLoop: true });
    const sel = selectControls(fixed, catalogue);
    expect(sel.policyFindings.some((f) => f.controlId === 'RAI-HITL-001')).toBe(false);
  });

  it('adding human approval deterministically changes the finding (present → absent)', () => {
    const before = selectControls(proposition({ humanInLoop: false }), catalogue).policyFindings.length;
    const after = selectControls(proposition({ humanInLoop: true }), catalogue).policyFindings.length;
    expect(before).toBeGreaterThan(after);
  });
});
