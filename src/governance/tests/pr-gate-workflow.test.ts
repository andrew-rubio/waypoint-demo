import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = process.cwd();
const wfPath = resolve(root, '.github/workflows/governance-pr-gate.yml');
const raw = readFileSync(wfPath, 'utf8');
const wf = parse(raw) as Record<string, unknown>;
// YAML 1.2 keeps `on` as a string key; guard against a 1.1 parser folding it to boolean true.
const on = (wf.on ?? (wf as Record<string, unknown>)['true']) as Record<string, unknown>;

describe('governance-pr-gate.yml — valid, least-privilege, non-deploying', () => {
  it('is valid YAML with the expected top-level keys', () => {
    expect(wf).toBeTypeOf('object');
    expect(on).toBeTypeOf('object');
    expect(wf.jobs).toBeTypeOf('object');
  });

  it('triggers on pull_request into the trusted branch and supports manual dispatch', () => {
    expect(raw).toMatch(/pull_request:/);
    expect(raw).toMatch(/spec2cloud\/foundry-hosted/);
    expect('workflow_dispatch' in on).toBe(true);
    const prBranches = (on.pull_request as { branches?: string[] })?.branches ?? [];
    expect(prBranches).toContain('spec2cloud/foundry-hosted');
  });

  it('exposes the stable required-check job name "Governance Contract Gate"', () => {
    const jobs = wf.jobs as Record<string, { name?: string }>;
    const names = Object.values(jobs).map((j) => j.name);
    expect(names).toContain('Governance Contract Gate');
  });

  it('grants NO deployment permissions to the PR workflow', () => {
    const perms = wf.permissions as Record<string, string>;
    expect(perms).toEqual({ contents: 'read' });
    // No elevated / deploy scopes anywhere in the file (as actual permission grants).
    expect(raw).not.toMatch(/id-token:\s*write/i);
    expect(raw).not.toMatch(/packages:\s*write/i);
    expect(raw).not.toMatch(/contents:\s*write/i);
    expect(raw).not.toMatch(/^\s*environment:/m);
    expect(raw).not.toMatch(/azd\s+deploy|az\s+containerapp|docker\s+push/i);
  });

  it('requires no model credentials (deterministic fixture mode)', () => {
    expect(raw).not.toMatch(/COPILOT_GITHUB_TOKEN|FOUNDRY_MODEL|WAYPOINT_MODEL|OPENAI_API_KEY/);
  });
});
