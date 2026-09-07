import { randomUUID } from 'node:crypto';
import {
  approvedContractAdapter,
  correlationIdAdapter,
  dataMinimisationAdapter,
  evaluationAdapter,
  immutableDeployAdapter,
  keylessInfraAdapter,
  mcpAllowlistAdapter,
  noChainOfThoughtAdapter,
  redactionAdapter,
  testResultAdapter,
  versionCaptureAdapter,
  type AdapterResult,
  type EvidenceContext,
} from './adapters.js';
import type { ControlContract, EvidenceEntry, EvidenceManifest } from './types.js';

/** evidenceId → adapter. The contract's evidenceRequirements reference these ids. */
const REGISTRY: Record<string, (ctx: EvidenceContext) => AdapterResult> = {
  'redaction-test': redactionAdapter,
  'mcp-allowlist': mcpAllowlistAdapter,
  'no-chain-of-thought': noChainOfThoughtAdapter,
  'correlation-id': correlationIdAdapter,
  'version-capture': versionCaptureAdapter,
  'data-minimisation': dataMinimisationAdapter,
  'keyless-infra': keylessInfraAdapter,
  'eval-grounding': evaluationAdapter,
  'artefact-digest': immutableDeployAdapter,
  'approved-contract': approvedContractAdapter,
  'booking-approval-test': (ctx) => testResultAdapter(ctx, 'booking-approval', 'booking-approval'),
  'currency-freshness-test': (ctx) => testResultAdapter(ctx, 'currency-freshness', 'currency-freshness'),
};

export function collectEvidence(contract: ControlContract, ctx: EvidenceContext): EvidenceManifest {
  const entries: EvidenceEntry[] = [];
  const seen = new Set<string>();

  for (const control of contract.material.controls) {
    for (const req of control.evidenceRequirements) {
      const key = `${control.controlId}::${req.evidenceId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const adapter = REGISTRY[req.evidenceId];
      const result: AdapterResult = adapter
        ? adapter(ctx)
        : {
            evidenceType: req.evidenceType,
            outcome: 'missing',
            producer: 'governance:evidence-collector',
            detail: `No adapter registered for evidence id "${req.evidenceId}".`,
          };

      entries.push({
        controlId: control.controlId,
        evidenceId: req.evidenceId,
        evidenceType: result.evidenceType,
        outcome: result.outcome,
        producer: result.producer,
        detail: result.detail,
        sourceCommit: ctx.sourceCommit,
        workflowRunId: ctx.workflowRunId,
        testOrEvalName: result.testOrEvalName,
        resultFileHash: result.resultFileHash,
        artefactDigest: result.artefactDigest,
        collectedAt: ctx.collectedAt,
      });
    }
  }

  return {
    schema: 'waypoint.governance/evidence@1',
    evidenceSetId: `evset-${randomUUID()}`,
    contractHash: contract.contractHash,
    contractVersion: contract.contractVersion,
    evidenceMode: ctx.mode,
    sourceCommit: ctx.sourceCommit,
    workflowRunId: ctx.workflowRunId,
    environment: ctx.mode === 'ci-authoritative' ? 'ci' : 'local',
    generatedAt: ctx.collectedAt,
    entries: entries.sort((a, b) => (a.controlId + a.evidenceId).localeCompare(b.controlId + b.evidenceId)),
  };
}
