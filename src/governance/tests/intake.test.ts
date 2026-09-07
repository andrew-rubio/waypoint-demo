import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { intakeInit, intakeValidate, intakePromote } from '../src/intake.js';
import { PropositionDeclaration } from '../src/types.js';

/** Resolve the deterministic template with valid demonstration values (as a human would). */
function resolvedDraftText(mutate?: (d: Record<string, unknown>) => void): string {
  const d = parseYaml(intakeInit().yaml) as Record<string, unknown>;
  d.accountableOwner = 'Owner';
  d.approvedTools = ['routestack', 'currency'];
  const c = d.characteristics as Record<string, unknown>;
  c.usesLLM = true;
  c.handlesPersonalData = true;
  c.dataClassification = 'confidential';
  c.autonomyLevel = 'supervised';
  c.consequentialActions = ['simulated-booking'];
  c.financialTransactions = 'simulated';
  c.externalIntegrations = ['mcp', 'currency'];
  c.humanInLoop = true;
  c.retrievalAugmented = true;
  c.deploymentSurface = ['azure-container-apps'];
  mutate?.(d);
  return stringifyYaml(d);
}

describe('deterministic governance intake', () => {
  it('is byte-stable for the same repository state', () => {
    expect(intakeInit().yaml).toEqual(intakeInit().yaml);
  });

  it('never infers governance values — all classifications start UNRESOLVED, tools empty', () => {
    const d = parseYaml(intakeInit().yaml) as Record<string, unknown>;
    const c = d.characteristics as Record<string, unknown>;
    for (const k of ['usesLLM', 'handlesPersonalData', 'dataClassification', 'autonomyLevel', 'consequentialActions', 'financialTransactions', 'externalIntegrations', 'humanInLoop', 'retrievalAugmented', 'deploymentSurface']) {
      expect(c[k]).toBe('UNRESOLVED');
    }
    expect(d.accountableOwner).toBe('UNRESOLVED');
    expect(d.approvedTools).toEqual([]);
  });

  it('only copies exact metadata (id/title from package.json, PRD ref)', () => {
    const d = parseYaml(intakeInit().yaml) as Record<string, unknown>;
    expect(d.propositionId).toBe('waypoint');
    expect(d.sourceRequirementRef).toBe('specs/prd.md');
    expect(Array.isArray(d.sourceReferences)).toBe(true);
  });

  it('unresolved fields block validation with exact paths (categorised)', () => {
    const v = intakeValidate(intakeInit().yaml);
    expect(v.ok).toBe(false);
    const unresolved = v.unresolvedFields.map((p) => p.path);
    expect(unresolved).toContain('accountableOwner');
    expect(unresolved).toContain('characteristics.dataClassification');
    // approvedTools empty is a structural (schema) error, not a policy risk.
    expect(v.schemaErrors.map((p) => p.path)).toContain('approvedTools');
    // No policy-risk combination is ever reported as a consistency error.
    expect(v.consistencyErrors).toEqual([]);
  });

  it('unresolved fields block promotion', () => {
    expect(intakePromote(intakeInit().yaml, 'x@demo').ok).toBe(false);
  });

  it('a resolved draft validates and promotes', () => {
    expect(intakeValidate(resolvedDraftText()).ok).toBe(true);
    expect(intakePromote(resolvedDraftText(), 'andrew@demo').ok).toBe(true);
  });

  it('an unknown enum value blocks promotion', () => {
    const r = intakePromote(resolvedDraftText((d) => { (d.characteristics as Record<string, unknown>).dataClassification = 'ultra-secret'; }), 'x@demo');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown enum/);
  });

  it('confidential, non-personal data is a VALID declaration (policy risk is not a schema error)', () => {
    const r = intakePromote(resolvedDraftText((d) => {
      const c = d.characteristics as Record<string, unknown>;
      c.dataClassification = 'confidential';
      c.handlesPersonalData = false;
    }), 'x@demo');
    expect(r.ok).toBe(true);
  });

  it('financial transactions without human-in-loop is a VALID declaration (blocked later by policy, not intake)', () => {
    const r = intakePromote(resolvedDraftText((d) => {
      const c = d.characteristics as Record<string, unknown>;
      c.financialTransactions = 'real';
      c.humanInLoop = false;
    }), 'x@demo');
    expect(r.ok).toBe(true);
  });

  it('empty approvedTools blocks promotion (tools must be declared explicitly)', () => {
    const r = intakePromote(resolvedDraftText((d) => { d.approvedTools = []; }), 'x@demo');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/approved tools/);
  });

  it('promotion records the content hash + self-asserted human confirmation metadata', () => {
    const r = intakePromote(resolvedDraftText(), 'andrew@demo');
    expect(r.ok).toBe(true);
    const conf = r.proposition!.confirmation;
    expect(conf.confirmedBy).toBe('andrew@demo');
    expect(conf.mechanism).toBe('local-demo');
    expect(conf.identityAssurance).toBe('self-asserted');
    expect(String(conf.contentHash)).toMatch(/^sha256:/);
    expect(conf.schemaVersion).toBe('1.0');
  });

  it('control selection is fail-closed: an unresolved proposition object is schema-invalid', () => {
    const candidate = parseYaml(intakeInit().yaml) as Record<string, unknown>;
    expect(PropositionDeclaration.safeParse(candidate).success).toBe(false);
  });
});

describe('no model in the authoritative governance path', () => {
  it('no governance source imports an LLM/model client or requires model credentials', () => {
    const dir = resolve(import.meta.dirname, '..', 'src');
    const forbidden = /copilot-sdk|openai|anthropic|@azure\/openai|chat\.completions|COPILOT_GITHUB_TOKEN|FOUNDRY_MODEL|WAYPOINT_MODEL/i;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const text = readFileSync(resolve(dir, f), 'utf8');
      expect(forbidden.test(text), `${f} must not reference a model client/credential`).toBe(false);
    }
  });
});
