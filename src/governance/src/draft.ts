import { existsSync, readFileSync } from 'node:fs';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { REPO_ROOT, repoPath } from './io.js';
import { PropositionDeclaration } from './types.js';

/**
 * Proposition drafting (FRD-010 FR-010-1). Deterministic + offline so the recording never
 * depends on model latency. An LLM/Copilot skill MAY pre-fill the draft, but this command
 * NEVER silently invents high-impact classifications — they are left `unresolved` and must be
 * confirmed by a human before promotion. Control selection does not run on a draft.
 */

const HIGH_IMPACT_FIELDS = [
  'accountableOwner',
  'characteristics.handlesPersonalData',
  'characteristics.dataClassification',
  'characteristics.autonomyLevel',
  'characteristics.consequentialActions',
  'characteristics.financialTransactions',
];

function readAllowlistTools(): string[] {
  const driver = repoPath('src/api/src/agent/copilot-driver.ts');
  if (!existsSync(driver)) return [];
  const m = readFileSync(driver, 'utf8').match(/const\s+MCP_ALLOWLIST\s*=\s*\[([^\]]*)\]/);
  return m ? [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]) : [];
}

function prdTitle(): string {
  const prd = repoPath('specs/prd.md');
  if (!existsSync(prd)) return 'Waypoint proposition';
  const line = readFileSync(prd, 'utf8').split('\n').find((l) => l.startsWith('# '));
  return line ? line.replace(/^#\s*/, '').trim() : 'Waypoint proposition';
}

/** Build a review-ready draft. Low-risk facts are inferred + source-referenced; high-impact
 * classifications are UNRESOLVED. Returns the YAML text and the unresolved list. */
export function draftProposition(): { yaml: string; unresolved: string[] } {
  const tools = readAllowlistTools();
  const draft = {
    schema: 'waypoint.governance/proposition@1',
    propositionId: 'waypoint',
    title: prdTitle(),
    version: '0.1.0-draft',
    // High-impact — must be confirmed by a human, never invented.
    accountableOwner: 'UNRESOLVED — assign an accountable owner',
    sourceRequirementRef: 'specs/prd.md',
    prdRequirementIds: ['PRD-1', 'PRD-2', 'PRD-3'],
    approvedTools: tools,
    characteristics: {
      usesLLM: true,
      handlesPersonalData: 'UNRESOLVED',
      dataClassification: 'UNRESOLVED',
      autonomyLevel: 'UNRESOLVED',
      consequentialActions: 'UNRESOLVED',
      financialTransactions: 'UNRESOLVED',
      externalIntegrations: ['mcp', ...tools.map((t) => (t === 'open-meteo' ? 'weather' : t === 'routestack' ? 'flights' : t === 'cosmos' ? 'profile' : t))],
      humanInLoop: true,
      retrievalAugmented: true,
      deploymentSurface: ['azure-container-apps', 'foundry-agent-service'],
    },
    unresolved: HIGH_IMPACT_FIELDS,
    sources: {
      usesLLM: 'specs/prd.md — an LLM agent is described',
      approvedTools: 'src/api/src/agent/copilot-driver.ts MCP_ALLOWLIST',
      externalIntegrations: 'src/api/src/agent/copilot-driver.ts MCP_ALLOWLIST',
      humanInLoop: 'specs/prd.md — booking requires a human decision',
      retrievalAugmented: 'specs/prd.md — travel-guide + profile retrieval',
      deploymentSurface: 'specs/tech-stack.md — ACA + Foundry Agent Service',
      _highImpact: 'left UNRESOLVED — require explicit human confirmation (no silent inference)',
    },
  };
  const header =
    '# proposition.draft.yaml — DRAFT for human review.\n' +
    '# High-impact classifications are UNRESOLVED and must be confirmed by a human.\n' +
    '# Control selection does NOT run until `unresolved` is empty and the draft is promoted.\n';
  return { yaml: header + stringifyYaml(draft), unresolved: HIGH_IMPACT_FIELDS };
}

export interface PromoteResult {
  ok: boolean;
  reason: string;
  proposition?: PropositionDeclaration;
}

/** Promote a resolved draft to the approved proposition. Refuses while any field is unresolved
 * or if the (resolved) draft fails schema validation. Never auto-resolves. */
export function promoteProposition(draftText: string): PromoteResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseYaml(draftText) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: `Draft is not valid YAML: ${(err as Error).message}` };
  }
  const unresolved = (parsed.unresolved as string[] | undefined) ?? [];
  if (unresolved.length) {
    return { ok: false, reason: `Cannot promote — ${unresolved.length} field(s) still require human confirmation: ${unresolved.join(', ')}` };
  }
  // Strip draft-only keys before validating against the strict schema.
  const { sources: _sources, ...candidate } = parsed;
  const result = PropositionDeclaration.safeParse(candidate);
  if (!result.success) {
    return { ok: false, reason: `Resolved draft fails schema validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  }
  return { ok: true, reason: 'Draft resolved and valid.', proposition: result.data };
}

export { REPO_ROOT };
