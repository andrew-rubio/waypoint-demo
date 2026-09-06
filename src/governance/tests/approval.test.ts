import { describe, it, expect } from 'vitest';
import { buildApprovalRecord, checkApproval } from '../src/approval.js';
import { buildControlContract } from '../src/contract.js';
import { selectControls } from '../src/select.js';
import { sampleCatalogue, sampleProposition } from './fixtures.js';

function approvedSetup() {
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
  });
  return { prop, cat, contract, approval };
}

describe('hash-bound approval + invalidation', () => {
  it('a fresh approval is valid', () => {
    const { prop, cat, contract, approval } = approvedSetup();
    expect(checkApproval(contract, approval, prop, cat).valid).toBe(true);
  });

  it('makes no non-repudiation claim', () => {
    const { approval } = approvedSetup();
    expect(approval.nonRepudiation).toBe(false);
    expect(approval.identityAssurance).toBe('self-asserted');
  });

  it('missing approval is invalid', () => {
    const { prop, cat, contract } = approvedSetup();
    const res = checkApproval(contract, undefined, prop, cat);
    expect(res.valid).toBe(false);
  });

  it('a changed proposition invalidates approval', () => {
    const { prop, cat, contract, approval } = approvedSetup();
    prop.characteristics.autonomyLevel = 'autonomous';
    const res = checkApproval(contract, approval, prop, cat);
    expect(res.valid).toBe(false);
    expect(res.reasons.join(' ')).toMatch(/Proposition changed/);
  });

  it('a changed policy catalogue invalidates approval', () => {
    const { prop, cat, contract, approval } = approvedSetup();
    cat.controls[0].obligation = 'changed';
    const res = checkApproval(contract, approval, prop, cat);
    expect(res.valid).toBe(false);
    expect(res.reasons.join(' ')).toMatch(/catalogue changed/i);
  });

  it('a changed contract (rebuilt after a threshold change) invalidates the old approval', () => {
    const { prop, cat, approval } = approvedSetup();
    cat.controls.find((c) => c.id === 'SEC-MCP-001')!.evidenceRequirements[0].threshold = 0.95;
    const rebuilt = buildControlContract(prop, cat, selectControls(prop, cat), {
      contractVersion: '1.0.0',
      generatedAt: 'FIXED',
    });
    const res = checkApproval(rebuilt, approval, prop, cat);
    expect(res.valid).toBe(false);
  });
});
