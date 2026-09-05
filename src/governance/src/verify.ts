import { checkApproval } from './approval.js';
import type {
  ApprovalRecord,
  ControlCatalogue,
  ControlContract,
  ControlResult,
  EvidenceEntry,
  EvidenceManifest,
  PropositionDeclaration,
  ReleaseDecision,
  ReleaseOutcome,
  SelectedControl,
} from './types.js';

/**
 * Deterministic release verification. Never uses an LLM. A release is only `approved`
 * (deployable) when: the contract is validly approved, every BLOCKING control has passing
 * evidence bound to the assessed source, and the evidence set is `ci-authoritative` with a
 * certified artefact digest. Local runs degrade to `demonstration-only` (never deployable),
 * so a local fallback can never masquerade as a production release approval.
 */

export interface VerifyOptions {
  proposition: PropositionDeclaration;
  catalogue: ControlCatalogue;
  contract: ControlContract;
  approval?: ApprovalRecord;
  manifest: EvidenceManifest;
  /** The digest the deployment job will actually run; must equal the certified digest. */
  deploymentArtefactDigest?: string;
  generatedAt?: string;
}

function bestEntryFor(
  entries: EvidenceEntry[],
  controlId: string,
  evidenceId: string,
): EvidenceEntry | undefined {
  // Prefer a decisive outcome over a missing one if multiple entries exist.
  const rank: Record<string, number> = { fail: 0, error: 1, pass: 2, 'not-applicable': 3, missing: 4 };
  return entries
    .filter((e) => e.controlId === controlId && e.evidenceId === evidenceId)
    .sort((a, b) => rank[a.outcome] - rank[b.outcome])[0];
}

function evaluateControl(
  control: SelectedControl,
  manifest: EvidenceManifest,
): ControlResult {
  const problems: string[] = [];
  let sawError = false;
  let sawFail = false;
  let sawMissing = false;
  let applicableCount = 0;

  for (const req of control.evidenceRequirements) {
    const entry = bestEntryFor(manifest.entries, control.controlId, req.evidenceId);
    if (!entry) {
      sawMissing = true;
      problems.push(`missing evidence "${req.evidenceId}" (${req.descriptor})`);
      continue;
    }
    // Source binding: evidence must belong to the same commit the manifest asserts.
    if (
      manifest.sourceCommit &&
      entry.sourceCommit &&
      entry.sourceCommit !== manifest.sourceCommit
    ) {
      sawError = true;
      problems.push(`evidence "${req.evidenceId}" is from a different commit (${entry.sourceCommit})`);
      continue;
    }
    switch (entry.outcome) {
      case 'pass':
        applicableCount++;
        break;
      case 'fail':
        sawFail = true;
        problems.push(`evidence "${req.evidenceId}" failed: ${entry.detail}`);
        break;
      case 'error':
        sawError = true;
        problems.push(`evidence "${req.evidenceId}" errored: ${entry.detail}`);
        break;
      case 'missing':
        sawMissing = true;
        problems.push(`evidence "${req.evidenceId}" reported missing: ${entry.detail}`);
        break;
      case 'not-applicable':
        break;
    }
  }

  // An adapter ERROR on a blocking control blocks release (never downgraded to missing/advisory).
  let status: ControlResult['status'];
  if (sawFail) status = 'fail';
  else if (sawError) status = 'error';
  else if (sawMissing) status = 'missing';
  else if (applicableCount === 0) status = 'not-applicable';
  else status = 'pass';

  return {
    controlId: control.controlId,
    severity: control.severity,
    status,
    reason: problems.length ? problems.join('; ') : 'all required evidence present and passing',
    remediation: problems.length ? `Provide passing evidence for ${control.controlId}.` : undefined,
  };
}

export function verifyRelease(opts: VerifyOptions): ReleaseDecision {
  const { proposition, catalogue, contract, approval, manifest } = opts;
  const generatedAt = opts.generatedAt ?? new Date().toISOString();

  const controlResults = contract.material.controls
    .map((c) => evaluateControl(c, manifest))
    .sort((a, b) => a.controlId.localeCompare(b.controlId));

  const blockingFailures = controlResults.filter(
    (r) => r.severity === 'blocking' && (r.status === 'fail' || r.status === 'missing' || r.status === 'error'),
  );
  const advisoryFindings = controlResults.filter(
    (r) => r.severity === 'advisory' && (r.status === 'fail' || r.status === 'missing' || r.status === 'error'),
  );

  const approvalCheck = checkApproval(contract, approval, proposition, catalogue);
  const reasons: string[] = [];
  if (!approvalCheck.valid) reasons.push(...approvalCheck.reasons);
  if (blockingFailures.length) {
    reasons.push(`${blockingFailures.length} blocking control(s) not satisfied.`);
  }

  const digestBound =
    manifest.evidenceMode === 'ci-authoritative' &&
    !!opts.deploymentArtefactDigest &&
    manifest.entries.some(
      (e) => e.evidenceType === 'artefact-digest' && e.artefactDigest === opts.deploymentArtefactDigest,
    );

  let releaseDecision: ReleaseOutcome;
  let deployable: boolean;

  if (!approvalCheck.valid || blockingFailures.length > 0) {
    releaseDecision = 'blocked';
    deployable = false;
  } else if (manifest.evidenceMode === 'ci-authoritative' && digestBound) {
    releaseDecision = 'approved';
    deployable = true;
  } else {
    // Assurance passed but not CI-authoritative (or digest not bound): demonstration only.
    releaseDecision = 'demonstration-only';
    deployable = false;
    if (manifest.evidenceMode === 'ci-authoritative' && !digestBound) {
      reasons.push('Authoritative CI artefact digest was not bound to the deployment.');
    } else {
      reasons.push('Evidence is local-demonstration; not deployable.');
    }
  }

  const rationale =
    releaseDecision === 'approved'
      ? 'Contract approved and current; all blocking controls satisfied by CI-authoritative evidence bound to the certified artefact.'
      : reasons.join(' ');

  const certifiedArtefactDigest = manifest.entries.find(
    (e) => e.evidenceType === 'artefact-digest',
  )?.artefactDigest;

  return {
    schema: 'waypoint.governance/release@1',
    releaseDecision,
    deployable,
    evidenceMode: manifest.evidenceMode,
    propositionId: proposition.propositionId,
    contractHash: contract.contractHash,
    contractVersion: contract.contractVersion,
    evidenceSetId: manifest.evidenceSetId,
    sourceCommit: manifest.sourceCommit,
    workflowRunId: manifest.workflowRunId,
    certifiedArtefactDigest,
    blockingFailures,
    advisoryFindings,
    controlResults,
    rationale,
    generatedAt,
  };
}
