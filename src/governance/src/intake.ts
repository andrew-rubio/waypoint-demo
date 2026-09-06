import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { REPO_ROOT, repoPath } from './io.js';
import { PropositionDeclaration } from './types.js';
import { sha256Of } from './canonical.js';

/**
 * Deterministic proposition intake (FRD-010 FR-010-1). Schema-driven, human-authored, and
 * offline — NO LLM/model interprets the requirement or PRD into governance values. Intake
 * only copies exact metadata already declared in authoritative files; every governance
 * classification starts UNRESOLVED and must be supplied + confirmed by a human, then checked
 * against the schema. Control selection never runs on an unpromoted draft.
 *
 * Note: the draft uses the flat `PropositionDeclaration` field names (the shape deterministic
 * selection consumes) rather than a parallel nested schema, so a resolved draft maps 1:1 to
 * the approved proposition.
 */

export const INTAKE_SCHEMA_VERSION = '1.0';
const UNRESOLVED = 'UNRESOLVED';

/** Mandatory governance fields the human must supply (exact YAML paths for validation output). */
const MANDATORY_SCALAR = [
  'accountableOwner',
  'characteristics.usesLLM',
  'characteristics.handlesPersonalData',
  'characteristics.dataClassification',
  'characteristics.autonomyLevel',
  'characteristics.financialTransactions',
  'characteristics.humanInLoop',
  'characteristics.retrievalAugmented',
];
const MANDATORY_ARRAY = [
  'characteristics.consequentialActions',
  'characteristics.externalIntegrations',
  'characteristics.deploymentSurface',
];
const ENUMS: Record<string, string[]> = {
  'characteristics.dataClassification': ['public', 'internal', 'confidential', 'restricted'],
  'characteristics.autonomyLevel': ['assistive', 'supervised', 'autonomous'],
  'characteristics.financialTransactions': ['none', 'simulated', 'real'],
};

function packageName(): string {
  try {
    return JSON.parse(readFileSync(repoPath('package.json'), 'utf8')).name ?? 'waypoint';
  } catch {
    return 'waypoint';
  }
}

function currentCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'UNRESOLVED-not-a-git-checkout';
  }
}

/** Build a deterministic intake template. Only exact metadata is copied; all governance
 * classifications are UNRESOLVED. Byte-stable for the same repository state. */
export function intakeInit(): { yaml: string; unresolved: string[] } {
  const draft = {
    schemaVersion: INTAKE_SCHEMA_VERSION,
    // Exact metadata copied from authoritative files (no interpretation).
    propositionId: packageName(),
    title: packageName(),
    version: '1.0.0',
    sourceRequirementRef: 'specs/prd.md',
    sourceCommit: currentCommit(),
    prdRequirementIds: ['PRD-1', 'PRD-2', 'PRD-3'],
    // Human-declared — governance requires explicit entries.
    accountableOwner: UNRESOLVED,
    approvedTools: [] as string[],
    prohibitedActions: [] as string[],
    // Governance classifications — every value starts UNRESOLVED; nothing is inferred.
    characteristics: {
      usesLLM: UNRESOLVED,
      handlesPersonalData: UNRESOLVED,
      dataClassification: UNRESOLVED,
      autonomyLevel: UNRESOLVED,
      consequentialActions: UNRESOLVED,
      financialTransactions: UNRESOLVED,
      externalIntegrations: UNRESOLVED,
      humanInLoop: UNRESOLVED,
      retrievalAugmented: UNRESOLVED,
      deploymentSurface: UNRESOLVED,
    },
    sourceReferences: [
      { field: 'propositionId', source: 'package.json', extraction: 'exact-value' },
      { field: 'title', source: 'package.json', extraction: 'exact-value' },
      { field: 'sourceRequirementRef', source: 'specs/prd.md', extraction: 'explicit-reference' },
      { field: 'sourceCommit', source: 'git', extraction: 'exact-value' },
    ],
    unresolved: [...MANDATORY_SCALAR, ...MANDATORY_ARRAY, 'approvedTools'],
  };
  const header =
    '# proposition.draft.yaml — DETERMINISTIC governance intake template.\n' +
    '# No model interprets the requirement/PRD. A human must supply every UNRESOLVED value +\n' +
    '# declare approvedTools, then run gov:intake:validate and gov:intake:promote.\n';
  return { yaml: header + stringifyYaml(draft), unresolved: draft.unresolved };
}

export interface IntakeProblem { path: string; message: string; }
export interface IntakeValidation { ok: boolean; problems: IntakeProblem[]; }

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Deterministic schema validation. Never modifies the draft. Reports the exact YAML path
 * for every unresolved mandatory field, unknown enum, empty required array, or contradiction. */
export function intakeValidate(draftText: string): IntakeValidation {
  let d: Record<string, unknown>;
  try {
    d = parseYaml(draftText) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, problems: [{ path: '(root)', message: `Draft is not valid YAML: ${(err as Error).message}` }] };
  }
  const problems: IntakeProblem[] = [];

  for (const p of MANDATORY_SCALAR) {
    const v = getPath(d, p);
    if (v === undefined || v === UNRESOLVED || v === '') problems.push({ path: p, message: 'requires human input' });
  }
  for (const p of MANDATORY_ARRAY) {
    const v = getPath(d, p);
    if (v === undefined || v === UNRESOLVED) problems.push({ path: p, message: 'requires human input (list)' });
    else if (!Array.isArray(v)) problems.push({ path: p, message: 'must be a list' });
  }
  // approvedTools must be declared explicitly (policy requires entries).
  const tools = getPath(d, 'approvedTools');
  if (!Array.isArray(tools) || tools.length === 0) problems.push({ path: 'approvedTools', message: 'approved tools not declared explicitly' });
  // sourceReferences must be present.
  const refs = getPath(d, 'sourceReferences');
  if (!Array.isArray(refs) || refs.length === 0) problems.push({ path: 'sourceReferences', message: 'required source references are missing' });

  // Unknown enum values.
  for (const [p, allowed] of Object.entries(ENUMS)) {
    const v = getPath(d, p);
    if (v !== undefined && v !== UNRESOLVED && !allowed.includes(v as string)) {
      problems.push({ path: p, message: `unknown enum value "${String(v)}" (allowed: ${allowed.join(', ')})` });
    }
  }

  // Deterministic contradictions.
  const cls = getPath(d, 'characteristics.dataClassification');
  const pd = getPath(d, 'characteristics.handlesPersonalData');
  if ((cls === 'confidential' || cls === 'restricted') && pd === false) {
    problems.push({ path: 'characteristics.handlesPersonalData', message: `contradicts dataClassification=${String(cls)} (personal data likely in scope)` });
  }
  const fin = getPath(d, 'characteristics.financialTransactions');
  const hil = getPath(d, 'characteristics.humanInLoop');
  if (fin && fin !== 'none' && fin !== UNRESOLVED && hil === false) {
    problems.push({ path: 'characteristics.humanInLoop', message: `contradicts financialTransactions=${String(fin)} (human-in-the-loop required)` });
  }

  return { ok: problems.length === 0, problems };
}

export interface PromoteResult {
  ok: boolean;
  reason: string;
  proposition?: PropositionDeclaration & { confirmation: Record<string, unknown> };
}

/** Promote a validated draft to the approved proposition, recording hash + human confirmation
 * metadata. Refuses if validation fails. Never auto-resolves. */
export function intakePromote(draftText: string, confirmedBy: string): PromoteResult {
  const validation = intakeValidate(draftText);
  if (!validation.ok) {
    return { ok: false, reason: `Validation failed:\n${validation.problems.map((p) => `  - ${p.path}: ${p.message}`).join('\n')}` };
  }
  const d = parseYaml(draftText) as Record<string, unknown>;
  const candidate = {
    schema: 'waypoint.governance/proposition@1' as const,
    propositionId: d.propositionId,
    title: d.title,
    version: d.version ?? '1.0.0',
    accountableOwner: d.accountableOwner,
    sourceRequirementRef: d.sourceRequirementRef,
    prdRequirementIds: d.prdRequirementIds ?? [],
    approvedTools: d.approvedTools,
    characteristics: d.characteristics,
    unresolved: [],
  };
  const result = PropositionDeclaration.safeParse(candidate);
  if (!result.success) {
    return { ok: false, reason: `Resolved draft fails schema validation: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  }
  const confirmation = {
    schemaVersion: INTAKE_SCHEMA_VERSION,
    sourceCommit: (d.sourceCommit as string) ?? currentCommit(),
    contentHash: sha256Of(result.data),
    confirmedBy,
    confirmedAt: new Date().toISOString(),
    mechanism: 'local-demo',
    identityAssurance: 'self-asserted',
    note: 'Self-asserted local demonstration confirmation — not enterprise identity-backed; no digital signature.',
  };
  return { ok: true, reason: 'Draft validated and promoted.', proposition: { ...result.data, confirmation } };
}

export { REPO_ROOT, existsSync };
