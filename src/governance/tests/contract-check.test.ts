import { describe, it, expect } from 'vitest';
import { buildControlContract, contractHashOf } from '../src/contract.js';
import { buildApprovalRecord, checkApproval } from '../src/approval.js';
import { selectControls } from '../src/select.js';
import { checkContract } from '../src/contract-check.js';
import { sampleCatalogue, sampleProposition } from './fixtures.js';

function committedContract() {
  const proposition = sampleProposition();
  const catalogue = sampleCatalogue();
  const selection = selectControls(proposition, catalogue);
  const contract = buildControlContract(proposition, catalogue, selection, {
    contractVersion: '1.0.0',
    generatedAt: 'FIXED',
  });
  return { proposition, catalogue, contract };
}

describe('gov:contract:check — deterministic contract integrity', () => {
  it('passes for an authentic, current committed contract', () => {
    const { proposition, catalogue, contract } = committedContract();
    const r = checkContract({ proposition, catalogue, committedContract: contract });
    expect(r.ok).toBe(true);
    expect(r.committedHash).toBe(r.expectedHash);
  });

  it('fails when the committed contract is missing', () => {
    const { proposition, catalogue } = committedContract();
    const r = checkContract({ proposition, catalogue, committedContract: undefined });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/missing/i);
  });

  it('fails when a selected control is manually removed (stale hash = tamper)', () => {
    const { proposition, catalogue, contract } = committedContract();
    contract.material.controls.pop(); // remove a control, leave the old hash in place
    const r = checkContract({ proposition, catalogue, committedContract: contract });
    expect(r.ok).toBe(false);
    expect(r.recomputedHash).not.toBe(r.committedHash);
  });

  it('fails when a blocking threshold is weakened even if the hash is regenerated', () => {
    const { proposition, catalogue, contract } = committedContract();
    const sec = contract.material.controls.find((c) => c.controlId === 'SEC-MCP-001')!;
    sec.evidenceRequirements[0].threshold = 0.1;
    contract.contractHash = contractHashOf(contract); // attacker makes it self-consistent
    const r = checkContract({ proposition, catalogue, committedContract: contract });
    expect(r.ok).toBe(false);
    expect(r.recomputedHash).toBe(r.committedHash); // internally consistent...
    expect(r.expectedHash).not.toBe(r.committedHash); // ...but not what the pinned inputs produce
  });

  it('fails when the proposition changes', () => {
    const { catalogue, contract } = committedContract();
    const changed = sampleProposition();
    changed.characteristics.financialTransactions = 'real';
    const r = checkContract({ proposition: changed, catalogue, committedContract: contract });
    expect(r.ok).toBe(false);
  });

  it('fails when the policy set (catalogue) changes', () => {
    const { proposition, contract } = committedContract();
    const changed = sampleCatalogue();
    changed.version = '9.9.9';
    const r = checkContract({ proposition, catalogue: changed, committedContract: contract });
    expect(r.ok).toBe(false);
  });

  it('surfaces a stable selector version', () => {
    const { proposition, catalogue, contract } = committedContract();
    const r = checkContract({ proposition, catalogue, committedContract: contract });
    expect(r.selectorVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('approval binding', () => {
  it('approval validation fails when the contract hash changes', () => {
    const { proposition, catalogue, contract } = committedContract();
    const approval = buildApprovalRecord(contract, proposition, catalogue, {
      approver: 'demo.presenter',
      approvalMechanism: 'local-demo',
      identityAssurance: 'self-asserted',
      approvedAt: 'FIXED',
    });
    expect(checkApproval(contract, approval, proposition, catalogue).valid).toBe(true);
    contract.material.controls.pop();
    contract.contractHash = contractHashOf(contract);
    expect(checkApproval(contract, approval, proposition, catalogue).valid).toBe(false);
  });
});
