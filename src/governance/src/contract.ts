import { sha256Of } from './canonical.js';
import type {
  ContractMaterial,
  ControlCatalogue,
  ControlContract,
  ControlSelection,
  PropositionDeclaration,
} from './types.js';

/**
 * Build a versioned control contract from a selection. The material body is hashed
 * deterministically; `generatedAt` is stored OUTSIDE the hash so re-running the command
 * with no material change never invalidates an existing approval.
 */
export function buildControlContract(
  proposition: PropositionDeclaration,
  catalogue: ControlCatalogue,
  selection: ControlSelection,
  opts: { contractVersion: string; generatedAt?: string } = { contractVersion: '1.0.0' },
): ControlContract {
  const material: ContractMaterial = {
    schema: 'waypoint.governance/contract@1',
    propositionId: proposition.propositionId,
    propositionVersion: proposition.version,
    propositionHash: sha256Of(proposition),
    catalogueId: catalogue.catalogueId,
    catalogueVersion: catalogue.version,
    policyCatalogueHash: sha256Of(catalogue),
    controls: [...selection.selected].sort((a, b) => a.controlId.localeCompare(b.controlId)),
  };

  return {
    material,
    contractHash: sha256Of(material),
    contractVersion: opts.contractVersion,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
  };
}

/** Recompute the hash of a contract's material — used by verify to detect drift. */
export function contractHashOf(contract: ControlContract): string {
  return sha256Of(contract.material);
}
