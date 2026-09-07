import { describe, it, expect } from 'vitest';
import { buildControlContract, contractHashOf } from '../src/contract.js';
import { buildApprovalRecord, checkApproval } from '../src/approval.js';
import { selectControls } from '../src/select.js';
import { collectEvidence } from '../src/evidence.js';
import { verifyRelease } from '../src/verify.js';
import { sampleCatalogue, sampleProposition } from './fixtures.js';

function baseline() {
  const proposition = sampleProposition();
  const catalogue = sampleCatalogue();
  const contract = buildControlContract(proposition, catalogue, selectControls(proposition, catalogue), {
    contractVersion: '1.0.0',
    generatedAt: 'FIXED',
  });
  const approval = buildApprovalRecord(contract, proposition, catalogue, {
    approver: 'demo.presenter',
    approvalMechanism: 'local-demo',
    identityAssurance: 'self-asserted',
    approvedAt: 'FIXED',
  });
  return { proposition, catalogue, contract, approval };
}

describe('approval scope — contract approval binds proposition, policy, selector, contract hash', () => {
  it('is valid for the authentic contract', () => {
    const { proposition, catalogue, contract, approval } = baseline();
    expect(checkApproval(contract, approval, proposition, catalogue).valid).toBe(true);
  });

  it('is invalidated by a proposition change', () => {
    const { catalogue, contract, approval } = baseline();
    const changed = sampleProposition();
    changed.characteristics.financialTransactions = 'real';
    expect(checkApproval(contract, approval, changed, catalogue).valid).toBe(false);
  });

  it('is invalidated by a policy-set (catalogue) change', () => {
    const { proposition, contract, approval } = baseline();
    const changed = sampleCatalogue();
    changed.version = '9.9.9';
    expect(checkApproval(contract, approval, proposition, changed).valid).toBe(false);
  });

  it('is invalidated by a selector-version change (bound into the contract hash)', () => {
    const { proposition, catalogue, contract, approval } = baseline();
    contract.material.selectorVersion = '9.9.9';
    contract.contractHash = contractHashOf(contract);
    expect(checkApproval(contract, approval, proposition, catalogue).valid).toBe(false);
  });

  it('is invalidated by a threshold (obligation) change', () => {
    const { proposition, catalogue, contract, approval } = baseline();
    contract.material.controls.find((c) => c.controlId === 'SEC-MCP-001')!.evidenceRequirements[0].threshold = 0.1;
    contract.contractHash = contractHashOf(contract);
    expect(checkApproval(contract, approval, proposition, catalogue).valid).toBe(false);
  });
});

describe('implementation evidence binds to the source commit, not to approval', () => {
  const { proposition, catalogue, contract, approval } = baseline();
  const approvedTools = proposition.approvedTools;

  function decide(commit: string, configuredTools: string[]) {
    const manifest = collectEvidence(contract, {
      repoRoot: process.cwd(),
      mode: 'ci-authoritative',
      sourceCommit: commit,
      collectedAt: 't',
      artefactDigest: `sha256:${commit}`,
      deploymentDigest: `sha256:${commit}`,
      approvedTools,
      configuredToolsOverride: configuredTools,
    });
    const decision = verifyRelease({ proposition, catalogue, contract, approval, manifest, deploymentArtefactDigest: `sha256:${commit}` });
    return { manifest, decision };
  }

  it('blocked-fixture commit → SEC-MCP-001 fails, but the SAME contract approval stays valid', () => {
    const { manifest, decision } = decide('commitA', [...approvedTools, 'unregistered-booking-provider']);
    const sec = decision.controlResults.find((r) => r.controlId === 'SEC-MCP-001')!;
    expect(sec.status).toBe('fail');
    expect(manifest.sourceCommit).toBe('commitA');
    // The implementation change did NOT touch proposition/contract → approval is unaffected.
    expect(checkApproval(contract, approval, proposition, catalogue).valid).toBe(true);
  });

  it('remediation commit → SEC-MCP-001 passes with the SAME contract + approval (no reapproval needed)', () => {
    const before = contract.contractHash;
    const { manifest, decision } = decide('commitB', [...approvedTools]);
    const sec = decision.controlResults.find((r) => r.controlId === 'SEC-MCP-001')!;
    expect(sec.status).toBe('pass');
    expect(manifest.sourceCommit).toBe('commitB'); // evidence bound to the NEW commit
    expect(contract.contractHash).toBe(before); // contract unchanged across both commits
    expect(checkApproval(contract, approval, proposition, catalogue).valid).toBe(true);
  });
});
