/**
 * Pure lifecycle derivation (FRD-010 Area 13). Each stage is derived ONLY from real
 * artefact facts passed in — never from a manually-editable "status" string. Removing or
 * invalidating a required artefact regresses the corresponding stage (proven by tests).
 */
export interface LifecycleInputs {
  propositionExists: boolean;
  frdExists: boolean;
  selectionExists: boolean;
  approvalValid: boolean;
  decision?: { releaseDecision: string; deployable: boolean };
  learningArtefactCount: number;
}

export type LifecycleStage = { stage: string; complete: boolean };

export function deriveLifecycle(i: LifecycleInputs): LifecycleStage[] {
  const certified = i.decision?.releaseDecision === 'approved' || i.decision?.releaseDecision === 'demonstration-only';
  return [
    { stage: 'intake', complete: i.propositionExists },
    { stage: 'specified', complete: i.frdExists },
    { stage: 'controls-selected', complete: i.selectionExists },
    { stage: 'approved-for-build', complete: i.approvalValid },
    { stage: 'evaluated', complete: !!i.decision },
    { stage: 'certified', complete: certified },
    { stage: 'deployed', complete: i.decision?.deployable === true },
    { stage: 'incident-contained', complete: i.learningArtefactCount > 0 },
    { stage: 'learning-proposed', complete: i.learningArtefactCount > 0 },
  ];
}
