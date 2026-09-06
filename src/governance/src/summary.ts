import type { EvidenceManifest, ReleaseDecision } from './types.js';

/**
 * Human-readable Markdown for the PR / GitHub Actions job summary. The JSON decision is the
 * machine record; this is the at-a-glance view for reviewers. A blocked decision names the
 * failed control, the failing/missing evidence, why it blocks, and the remediation.
 */
export function releaseDecisionMarkdown(decision: ReleaseDecision): string {
  const blocking = decision.controlResults.filter((r) => r.severity === 'blocking');
  const advisory = decision.controlResults.filter((r) => r.severity === 'advisory');
  const passed = (s: string) => blocking.filter((r) => r.status === s).length;

  const lines: string[] = [];
  const verdict =
    decision.releaseDecision === 'approved'
      ? 'APPROVED'
      : decision.releaseDecision === 'demonstration-only'
        ? 'DEMONSTRATION-ONLY (not deployable)'
        : 'BLOCKED';

  lines.push(`## Release decision: ${verdict}`);
  lines.push('');
  lines.push(`- Proposition: \`${decision.propositionId}\``);
  lines.push(`- Contract: \`${decision.contractVersion}\` (${decision.contractHash})`);
  lines.push(`- Evidence mode: \`${decision.evidenceMode}\` · deployable: **${decision.deployable}**`);
  lines.push(`- Evidence set: \`${decision.evidenceSetId}\``);
  if (decision.sourceCommit) lines.push(`- Source commit: \`${decision.sourceCommit}\``);
  if (decision.certifiedArtefactDigest) lines.push(`- Certified artefact: \`${decision.certifiedArtefactDigest}\``);
  lines.push('');
  lines.push(
    `**Blocking controls:** ${passed('pass')} passed, ${passed('fail')} failed, ${passed('missing')} missing, ${passed('error')} error`,
  );
  lines.push(`**Advisory controls:** ${advisory.length} evaluated, ${decision.advisoryFindings.length} findings`);
  lines.push('');

  if (decision.blockingFailures.length) {
    lines.push('### Why release is blocked');
    for (const f of decision.blockingFailures) {
      lines.push(`- **${f.controlId}** (${f.status}) — ${f.reason}`);
      if (f.remediation) lines.push(`  - Remediation: ${f.remediation}`);
    }
    lines.push('');
  }

  lines.push(`> ${decision.rationale}`);
  return lines.join('\n');
}

export function evidenceSummaryMarkdown(manifest: EvidenceManifest): string {
  const lines: string[] = [];
  lines.push(`### Evidence set \`${manifest.evidenceSetId}\` (${manifest.evidenceMode})`);
  lines.push('');
  lines.push('| Control | Evidence | Type | Outcome | Producer |');
  lines.push('|---|---|---|---|---|');
  for (const e of manifest.entries) {
    lines.push(`| ${e.controlId} | ${e.evidenceId} | ${e.evidenceType} | ${e.outcome} | ${e.producer} |`);
  }
  return lines.join('\n');
}
