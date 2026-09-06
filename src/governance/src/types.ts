import { z } from 'zod';

/**
 * Governance domain schema — the single source of truth for propositions, controls,
 * contracts, evidence and release decisions. Every value crossing a module boundary
 * (CLI, adapters, CI) is validated against these Zod schemas so malformed governance
 * data fails loudly rather than silently degrading an assurance decision.
 */

// ─────────────────────────────── Proposition ───────────────────────────────

export const AutonomyLevel = z.enum(['assistive', 'supervised', 'autonomous']);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const DataClassification = z.enum(['public', 'internal', 'confidential', 'restricted']);
export type DataClassification = z.infer<typeof DataClassification>;

/** Machine-readable characteristics that deterministically drive control selection. */
export const PropositionCharacteristics = z.object({
  usesLLM: z.boolean(),
  handlesPersonalData: z.boolean(),
  dataClassification: DataClassification,
  autonomyLevel: AutonomyLevel,
  consequentialActions: z.array(z.string()).default([]),
  financialTransactions: z.enum(['none', 'simulated', 'real']),
  externalIntegrations: z.array(z.string()).default([]),
  humanInLoop: z.boolean(),
  retrievalAugmented: z.boolean(),
  deploymentSurface: z.array(z.string()).default([]),
});
export type PropositionCharacteristics = z.infer<typeof PropositionCharacteristics>;

export const PropositionDeclaration = z.object({
  schema: z.literal('waypoint.governance/proposition@1'),
  propositionId: z.string().min(1),
  title: z.string().min(1),
  version: z.string().min(1),
  accountableOwner: z.string().min(1),
  sourceRequirementRef: z.string().min(1),
  prdRequirementIds: z.array(z.string()).default([]),
  /** MCP servers/tools governance has approved for this proposition (allowlist). */
  approvedTools: z.array(z.string()).default([]),
  characteristics: PropositionCharacteristics,
  /** Governance fields left UNRESOLVED by deterministic intake, awaiting explicit human confirmation. */
  unresolved: z.array(z.string()).default([]),
});
export type PropositionDeclaration = z.infer<typeof PropositionDeclaration>;

// ───────────────────────────────── Controls ─────────────────────────────────

export const ControlSeverity = z.enum(['blocking', 'advisory']);
export type ControlSeverity = z.infer<typeof ControlSeverity>;

export const EnforcementStage = z.enum(['build', 'pre-release', 'runtime', 'release', 'deploy']);
export type EnforcementStage = z.infer<typeof EnforcementStage>;

export const EvidenceType = z.enum([
  'test-result',
  'evaluation-result',
  'config-check',
  'mcp-allowlist',
  'artefact-digest',
  'human-approval',
  'runtime-finding',
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const EvidenceRequirement = z.object({
  evidenceId: z.string().min(1),
  evidenceType: EvidenceType,
  descriptor: z.string().min(1),
  /** Optional numeric threshold the adapter must meet (e.g. an evaluation pass-rate). */
  threshold: z.number().optional(),
});
export type EvidenceRequirement = z.infer<typeof EvidenceRequirement>;

/** A declarative predicate over PropositionCharacteristics — evaluated deterministically. */
export const AppliesWhen = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'in', 'contains', 'isTrue', 'isFalse']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});
export type AppliesWhen = z.infer<typeof AppliesWhen>;

export const Control = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  policyRef: z.string().min(1),
  obligation: z.string().min(1),
  enforcementStage: EnforcementStage,
  severity: ControlSeverity,
  /** ALL predicates must hold for the control to apply (deterministic AND). */
  appliesWhen: z.array(AppliesWhen).min(1),
  rationaleTemplate: z.string().min(1),
  evidenceRequirements: z.array(EvidenceRequirement).min(1),
});
export type Control = z.infer<typeof Control>;

/** A single synthetic policy source with the RFI knowledge-layer metadata. */
export const PolicySource = z.object({
  id: z.string().min(1),
  owner: z.string().min(1),
  provenance: z.string().min(1),
  version: z.string().min(1),
  effectiveDate: z.string().min(1),
  status: z.enum(['active', 'superseded', 'draft']),
  sourceRef: z.string().min(1),
  permissionClassification: z.string().min(1),
  applicability: z.string().min(1),
});
export type PolicySource = z.infer<typeof PolicySource>;

export const ControlCatalogue = z.object({
  schema: z.literal('waypoint.governance/catalogue@1'),
  /** MUST be true — the engine refuses to load a catalogue that is not labelled synthetic. */
  synthetic: z.literal(true),
  disclaimer: z.string().min(1),
  catalogueId: z.string().min(1),
  version: z.string().min(1),
  policySources: z.array(PolicySource).min(1),
  controls: z.array(Control).min(1),
});
export type ControlCatalogue = z.infer<typeof ControlCatalogue>;

// ──────────────────────────── Selection & contract ──────────────────────────

export const SelectedControl = z.object({
  controlId: z.string().min(1),
  severity: ControlSeverity,
  enforcementStage: EnforcementStage,
  policyRef: z.string().min(1),
  /** Concise, human-readable reason — never model chain-of-thought. */
  rationale: z.string().min(1),
  /** Which characteristic predicates selected it (transparency). */
  matchedBy: z.array(z.string()).min(1),
  evidenceRequirements: z.array(EvidenceRequirement).min(1),
});
export type SelectedControl = z.infer<typeof SelectedControl>;

export const ControlSelection = z.object({
  propositionId: z.string().min(1),
  propositionVersion: z.string().min(1),
  catalogueId: z.string().min(1),
  catalogueVersion: z.string().min(1),
  selected: z.array(SelectedControl),
  /** Deterministic advisories: missing classifications, conflicts, etc. */
  findings: z.array(z.object({ code: z.string(), detail: z.string() })).default([]),
});
export type ControlSelection = z.infer<typeof ControlSelection>;

/**
 * The material (hashed) body of the contract. Excludes generation timestamps and the
 * approval record so that semantically-equivalent inputs always produce the same hash.
 */
export const ContractMaterial = z.object({
  schema: z.literal('waypoint.governance/contract@1'),
  propositionId: z.string().min(1),
  propositionVersion: z.string().min(1),
  propositionHash: z.string().min(1),
  catalogueId: z.string().min(1),
  catalogueVersion: z.string().min(1),
  policyCatalogueHash: z.string().min(1),
  controls: z.array(SelectedControl),
});
export type ContractMaterial = z.infer<typeof ContractMaterial>;

export const ControlContract = z.object({
  material: ContractMaterial,
  /** sha256 of the canonicalised material — the identity approval binds to. */
  contractHash: z.string().min(1),
  contractVersion: z.string().min(1),
  /** Outside the hash: informational only. */
  generatedAt: z.string().min(1),
});
export type ControlContract = z.infer<typeof ControlContract>;

// ───────────────────────────────── Approval ─────────────────────────────────

export const ApprovalRecord = z.object({
  schema: z.literal('waypoint.governance/approval@1'),
  contractHash: z.string().min(1),
  contractVersion: z.string().min(1),
  propositionHash: z.string().min(1),
  policyCatalogueHash: z.string().min(1),
  approver: z.string().min(1),
  /** self-asserted (local-demo) vs pull-request / protected-environment provenance. */
  identityAssurance: z.enum(['self-asserted', 'pull-request', 'protected-environment']),
  approvalMechanism: z.enum(['local-demo', 'pull-request', 'protected-environment']),
  approvedAt: z.string().min(1),
  sourceCommit: z.string().optional(),
  comment: z.string().optional(),
  /** The demo explicitly does NOT claim non-repudiation or a production digital signature. */
  nonRepudiation: z.literal(false),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecord>;

// ───────────────────────────── Evidence & release ───────────────────────────

export const AdapterOutcome = z.enum(['pass', 'fail', 'missing', 'not-applicable', 'error']);
export type AdapterOutcome = z.infer<typeof AdapterOutcome>;

export const EvidenceEntry = z.object({
  controlId: z.string().min(1),
  evidenceId: z.string().min(1),
  evidenceType: EvidenceType,
  outcome: AdapterOutcome,
  producer: z.string().min(1),
  detail: z.string().min(1),
  sourceCommit: z.string().optional(),
  workflowRunId: z.string().optional(),
  testOrEvalName: z.string().optional(),
  resultFileHash: z.string().optional(),
  artefactDigest: z.string().optional(),
  collectedAt: z.string().min(1),
});
export type EvidenceEntry = z.infer<typeof EvidenceEntry>;

export const EvidenceMode = z.enum(['ci-authoritative', 'local-demonstration']);
export type EvidenceMode = z.infer<typeof EvidenceMode>;

export const EvidenceManifest = z.object({
  schema: z.literal('waypoint.governance/evidence@1'),
  evidenceSetId: z.string().min(1),
  contractHash: z.string().min(1),
  contractVersion: z.string().min(1),
  evidenceMode: EvidenceMode,
  sourceCommit: z.string().optional(),
  workflowRunId: z.string().optional(),
  environment: z.string().min(1),
  generatedAt: z.string().min(1),
  entries: z.array(EvidenceEntry),
});
export type EvidenceManifest = z.infer<typeof EvidenceManifest>;

export const ReleaseOutcome = z.enum(['approved', 'blocked', 'demonstration-only']);
export type ReleaseOutcome = z.infer<typeof ReleaseOutcome>;

export const ControlResult = z.object({
  controlId: z.string().min(1),
  severity: ControlSeverity,
  status: z.enum(['pass', 'fail', 'missing', 'error', 'not-applicable']),
  reason: z.string().min(1),
  remediation: z.string().optional(),
});
export type ControlResult = z.infer<typeof ControlResult>;

export const ReleaseDecision = z.object({
  schema: z.literal('waypoint.governance/release@1'),
  releaseDecision: ReleaseOutcome,
  deployable: z.boolean(),
  evidenceMode: EvidenceMode,
  propositionId: z.string().min(1),
  contractHash: z.string().min(1),
  contractVersion: z.string().min(1),
  evidenceSetId: z.string().min(1),
  sourceCommit: z.string().optional(),
  workflowRunId: z.string().optional(),
  certifiedArtefactDigest: z.string().optional(),
  blockingFailures: z.array(ControlResult).default([]),
  advisoryFindings: z.array(ControlResult).default([]),
  controlResults: z.array(ControlResult).default([]),
  rationale: z.string().min(1),
  generatedAt: z.string().min(1),
});
export type ReleaseDecision = z.infer<typeof ReleaseDecision>;
