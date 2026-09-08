import { sha256Of } from './canonical.js';
import { contractHashOf } from './contract.js';
import type { ApprovalRecord, ControlContract, PropositionDeclaration, ControlCatalogue } from './types.js';

/**
 * Human-approved, HASH-BOUND approval. A SHA-256 content hash detects change but does not
 * authenticate the approver — the demo therefore records `nonRepudiation: false` and makes
 * no digital-signature or non-repudiation claim (see ADR-012). Approval is invalidated
 * automatically whenever the contract, proposition or policy catalogue hash changes.
 */

export interface ApproveOptions {
  approver: string;
  approvalMechanism: ApprovalRecord['approvalMechanism'];
  identityAssurance: ApprovalRecord['identityAssurance'];
  sourceCommit?: string;
  comment?: string;
  approvedAt?: string;
}

export function buildApprovalRecord(
  contract: ControlContract,
  proposition: PropositionDeclaration,
  catalogue: ControlCatalogue,
  opts: ApproveOptions,
): ApprovalRecord {
  return {
    schema: 'waypoint.governance/approval@1',
    contractHash: contract.contractHash,
    contractVersion: contract.contractVersion,
    propositionHash: sha256Of(proposition),
    policyCatalogueHash: sha256Of(catalogue),
    approver: opts.approver,
    identityAssurance: opts.identityAssurance,
    approvalMechanism: opts.approvalMechanism,
    approvedAt: opts.approvedAt ?? new Date().toISOString(),
    sourceCommit: opts.sourceCommit,
    comment: opts.comment,
    nonRepudiation: false,
  };
}

export interface ApprovalCheck {
  valid: boolean;
  reasons: string[];
}

/**
 * Deterministic approval validity: the current contract hash must equal the approved hash,
 * and the proposition + policy hashes recorded at approval must still match. Any material
 * drift invalidates approval.
 */
export function checkApproval(
  contract: ControlContract,
  approval: ApprovalRecord | undefined,
  proposition: PropositionDeclaration,
  catalogue: ControlCatalogue,
): ApprovalCheck {
  const reasons: string[] = [];
  if (!approval) return { valid: false, reasons: ['No approval record present.'] };

  const currentContractHash = contractHashOf(contract);
  if (currentContractHash !== contract.contractHash) {
    reasons.push('Contract hash does not match its own material (contract tampered).');
  }
  if (approval.contractHash !== currentContractHash) {
    reasons.push('Approved contract hash does not match the current contract (contract changed since approval).');
  }
  if (approval.propositionHash !== sha256Of(proposition)) {
    reasons.push('Proposition changed since approval.');
  }
  if (approval.policyCatalogueHash !== sha256Of(catalogue)) {
    reasons.push('Policy catalogue changed since approval.');
  }
  return { valid: reasons.length === 0, reasons };
}
