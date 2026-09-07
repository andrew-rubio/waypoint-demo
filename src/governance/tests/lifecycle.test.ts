import { describe, it, expect } from 'vitest';
import { deriveLifecycle, type LifecycleInputs } from '../src/lifecycle.js';

const complete: LifecycleInputs = {
  propositionExists: true,
  frdExists: true,
  selectionExists: true,
  approvalValid: true,
  decision: { releaseDecision: 'approved', deployable: true },
  learningArtefactCount: 1,
};

function stage(inputs: LifecycleInputs, name: string): boolean {
  return deriveLifecycle(inputs).find((s) => s.stage === name)!.complete;
}

/** FRD-010 Area 13 — lifecycle must be derived from artefacts, and regress when one is removed. */
describe('lifecycle derivation', () => {
  it('marks every stage complete when all artefacts are present and valid', () => {
    expect(deriveLifecycle(complete).every((s) => s.complete)).toBe(true);
  });

  it('regresses approved-for-build when the approval is invalid (not merely present)', () => {
    expect(stage({ ...complete, approvalValid: false }, 'approved-for-build')).toBe(false);
  });

  it('regresses controls-selected when the selection artefact is removed', () => {
    expect(stage({ ...complete, selectionExists: false }, 'controls-selected')).toBe(false);
  });

  it('regresses certified and deployed when there is no release decision', () => {
    const s = deriveLifecycle({ ...complete, decision: undefined });
    expect(s.find((x) => x.stage === 'certified')!.complete).toBe(false);
    expect(s.find((x) => x.stage === 'deployed')!.complete).toBe(false);
  });

  it('marks deployed incomplete for a demonstration-only (non-deployable) decision', () => {
    expect(stage({ ...complete, decision: { releaseDecision: 'demonstration-only', deployable: false } }, 'deployed')).toBe(false);
  });

  it('regresses learning stages when no learning artefact exists', () => {
    expect(stage({ ...complete, learningArtefactCount: 0 }, 'learning-proposed')).toBe(false);
  });
});
