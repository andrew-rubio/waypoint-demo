import { buildControlContract, contractHashOf } from './contract.js';
import { selectControls, SELECTOR_VERSION } from './select.js';
import type { ControlCatalogue, ControlContract, PropositionDeclaration } from './types.js';

/**
 * Deterministic contract-integrity check. Regenerates the expected control contract from the
 * committed proposition + pinned policy catalogue + current selector, then compares it with
 * the committed contract. It fails if the committed contract is missing, internally
 * inconsistent (its recorded hash does not match its own material — i.e. manually edited),
 * or does not equal the regenerated contract (stale, weakened, or produced from different
 * proposition/policy/selector inputs). Pure code — never an LLM.
 */

export interface ContractCheckResult {
  ok: boolean;
  committedHash?: string;
  /** Hash recomputed from the committed material — differs from committedHash if tampered. */
  recomputedHash?: string;
  expectedHash: string;
  selectorVersion: string;
  /** Controls expected but absent from the committed contract. */
  added: string[];
  /** Controls present in the committed contract but not expected. */
  removed: string[];
  reasons: string[];
}

export function checkContract(input: {
  proposition: PropositionDeclaration;
  catalogue: ControlCatalogue;
  committedContract?: ControlContract;
}): ContractCheckResult {
  const { proposition, catalogue, committedContract } = input;
  const selection = selectControls(proposition, catalogue);
  const expected = buildControlContract(proposition, catalogue, selection, {
    contractVersion: committedContract?.contractVersion ?? '1.0.0',
    generatedAt: 'compare',
  });
  const expectedHash = expected.contractHash;

  if (!committedContract) {
    return {
      ok: false,
      expectedHash,
      selectorVersion: SELECTOR_VERSION,
      added: expected.material.controls.map((c) => c.controlId),
      removed: [],
      reasons: ['Committed control-contract.yaml is missing.'],
    };
  }

  const committedHash = committedContract.contractHash;
  const recomputedHash = contractHashOf(committedContract);
  const reasons: string[] = [];

  if (recomputedHash !== committedHash) {
    reasons.push(
      'Committed contract hash does not match its own material (the contract YAML was manually edited/weakened).',
    );
  }
  if (expectedHash !== committedHash) {
    reasons.push(
      'Committed contract does not match the deterministically regenerated contract (stale, or generated from a different proposition, policy set, threshold, or selector version).',
    );
  }

  const committedIds = new Set(committedContract.material.controls.map((c) => c.controlId));
  const expectedIds = new Set(expected.material.controls.map((c) => c.controlId));
  const added = [...expectedIds].filter((i) => !committedIds.has(i)).sort();
  const removed = [...committedIds].filter((i) => !expectedIds.has(i)).sort();

  return {
    ok: reasons.length === 0,
    committedHash,
    recomputedHash,
    expectedHash,
    selectorVersion: SELECTOR_VERSION,
    added,
    removed,
    reasons,
  };
}
