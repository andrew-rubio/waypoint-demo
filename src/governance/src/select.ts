import type {
  AppliesWhen,
  Control,
  ControlCatalogue,
  ControlSelection,
  PropositionCharacteristics,
  PropositionDeclaration,
  SelectedControl,
} from './types.js';

/**
 * Deterministic control selection. Given a proposition's declared characteristics and a
 * synthetic catalogue, decide which controls apply — using pure code, never an LLM. The
 * same inputs always yield the same selection (controls sorted by id).
 */

/** Deterministic selector version. Bump when the selection logic changes; surfaced by
 *  gov:contract:check so a selector change is a first-class, visible contract input. */
export const SELECTOR_VERSION = '1.0.0';

function resolveField(chars: PropositionCharacteristics, field: string): unknown {
  return (chars as unknown as Record<string, unknown>)[field];
}

function predicateHolds(chars: PropositionCharacteristics, p: AppliesWhen): boolean {
  const actual = resolveField(chars, p.field);
  switch (p.op) {
    case 'isTrue':
      return actual === true;
    case 'isFalse':
      return actual === false;
    case 'eq':
      return actual === p.value;
    case 'neq':
      return actual !== p.value;
    case 'in':
      return Array.isArray(p.value) && p.value.includes(actual as string);
    case 'contains':
      return Array.isArray(actual) && actual.includes(p.value as string);
    default:
      return false;
  }
}

function describePredicate(p: AppliesWhen): string {
  if (p.op === 'isTrue') return `${p.field} is true`;
  if (p.op === 'isFalse') return `${p.field} is false`;
  if (p.op === 'contains') return `${p.field} contains "${String(p.value)}"`;
  if (p.op === 'in') return `${p.field} in [${(p.value as string[]).join(', ')}]`;
  return `${p.field} ${p.op} ${String(p.value)}`;
}

function applies(chars: PropositionCharacteristics, control: Control): boolean {
  return control.appliesWhen.every((p) => predicateHolds(chars, p));
}

function toSelected(chars: PropositionCharacteristics, control: Control): SelectedControl {
  const matchedBy = control.appliesWhen.map(describePredicate);
  const rationale = control.rationaleTemplate.replaceAll('{matched}', matchedBy.join('; '));
  return {
    controlId: control.id,
    severity: control.severity,
    enforcementStage: control.enforcementStage,
    policyRef: control.policyRef,
    rationale,
    matchedBy,
    evidenceRequirements: [...control.evidenceRequirements].sort((a, b) =>
      a.evidenceId.localeCompare(b.evidenceId),
    ),
  };
}

/**
 * Deterministic conflict / gap detection (RFI knowledge-layer behaviour): flag a
 * restricted/confidential classification that does not declare personal-data handling,
 * and any catalogue policy source marked draft that still selected a blocking control.
 */
function deterministicFindings(
  proposition: PropositionDeclaration,
  catalogue: ControlCatalogue,
  selected: SelectedControl[],
): ControlSelection['findings'] {
  const findings: ControlSelection['findings'] = [];
  const chars = proposition.characteristics;

  if (
    (chars.dataClassification === 'restricted' || chars.dataClassification === 'confidential') &&
    !chars.handlesPersonalData
  ) {
    findings.push({
      code: 'missing-classification',
      detail: `dataClassification=${chars.dataClassification} but handlesPersonalData=false — confirm whether personal data is in scope.`,
    });
  }

  if (proposition.unresolved.length > 0) {
    findings.push({
      code: 'unresolved-characteristics',
      detail: `Human confirmation required for: ${proposition.unresolved.join(', ')}.`,
    });
  }

  const draftSources = new Set(
    catalogue.policySources.filter((s) => s.status === 'draft').map((s) => s.id),
  );
  for (const sc of selected) {
    if (sc.severity === 'blocking' && draftSources.has(sc.policyRef)) {
      findings.push({
        code: 'blocking-from-draft-policy',
        detail: `Blocking control ${sc.controlId} derives from draft policy ${sc.policyRef}.`,
      });
    }
  }

  return findings.sort((a, b) => (a.code + a.detail).localeCompare(b.code + b.detail));
}

export function selectControls(
  proposition: PropositionDeclaration,
  catalogue: ControlCatalogue,
): ControlSelection {
  const chars = proposition.characteristics;
  const selected = catalogue.controls
    .filter((c) => applies(chars, c))
    .map((c) => toSelected(chars, c))
    .sort((a, b) => a.controlId.localeCompare(b.controlId));

  return {
    propositionId: proposition.propositionId,
    propositionVersion: proposition.version,
    catalogueId: catalogue.catalogueId,
    catalogueVersion: catalogue.version,
    selected,
    findings: deterministicFindings(proposition, catalogue, selected),
    policyFindings: deterministicPolicyFindings(proposition),
  };
}

/**
 * Deterministic POLICY findings from the (valid) declared proposition. These are risk/policy
 * conflicts — the declaration is legitimate, but policy requires a control or remediation, so
 * a `release-blocking` finding blocks the release gate until the proposition is remediated.
 * No LLM is involved; the release gate enforces these, intake validation does not.
 */
function deterministicPolicyFindings(proposition: PropositionDeclaration): ControlSelection['policyFindings'] {
  const c = proposition.characteristics;
  const out: ControlSelection['policyFindings'] = [];
  // Consequential/financial authority without human oversight → human-approval obligation unmet.
  if (c.financialTransactions !== 'none' && c.humanInLoop === false) {
    out.push({
      controlId: 'RAI-HITL-001',
      severity: 'release-blocking',
      reason: 'The proposition declares financial or consequential actions without a required human-approval mechanism (humanInLoop=false).',
      remediation: 'Declare an approved human-approval mechanism (humanInLoop=true) or remove the consequential/financial authority, then re-select and re-approve.',
      selectedBy: 'financialTransactions != none AND humanInLoop = false',
    });
  }
  return out.sort((a, b) => a.controlId.localeCompare(b.controlId));
}

