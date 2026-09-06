import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { mcpAllowlistAdapter } from '../src/adapters.js';
import type { EvidenceContext } from '../src/adapters.js';

const FIXTURE_REL = 'specs/governance/demo-fixtures/extra-configured-tools.json';

function tempRepo(): string {
  const root = mkdtempSync(resolve(tmpdir(), 'wp-ci-fixture-'));
  const driver = resolve(root, 'src/api/src/agent/copilot-driver.ts');
  mkdirSync(dirname(driver), { recursive: true });
  writeFileSync(driver, "const MCP_ALLOWLIST = ['routestack', 'open-meteo'];\n", 'utf8');
  return root;
}

function ctxFor(root: string): EvidenceContext {
  return { repoRoot: root, mode: 'ci-authoritative', collectedAt: 't', approvedTools: ['routestack', 'open-meteo'] };
}

describe('PR-demo MCP fixture (governance-only)', () => {
  const created: string[] = [];
  afterEach(() => {
    for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('passes when no fixture is present (baseline)', () => {
    const root = tempRepo();
    created.push(root);
    expect(mcpAllowlistAdapter(ctxFor(root)).outcome).toBe('pass');
  });

  it('BLOCKS when the fixture injects an unregistered tool', () => {
    const root = tempRepo();
    created.push(root);
    const f = resolve(root, FIXTURE_REL);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(['unregistered-booking-provider']), 'utf8');
    const r = mcpAllowlistAdapter(ctxFor(root));
    expect(r.outcome).toBe('fail');
    expect(r.detail).toMatch(/unregistered-booking-provider/);
  });

  it('passes again once the fixture is removed (remediated)', () => {
    const root = tempRepo();
    created.push(root);
    const f = resolve(root, FIXTURE_REL);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(['unregistered-booking-provider']), 'utf8');
    expect(mcpAllowlistAdapter(ctxFor(root)).outcome).toBe('fail');
    rmSync(f);
    expect(mcpAllowlistAdapter(ctxFor(root)).outcome).toBe('pass');
  });
});

describe('demo:ci fixture commands never modify application files', () => {
  const root = process.cwd();
  const node = process.execPath;
  const fixture = resolve(root, FIXTURE_REL);

  afterEach(() => {
    execFileSync(node, ['scripts/demo-ci-fixture.mjs', 'remediate'], { cwd: root });
  });

  it('block touches only the governance fixture, not src/api|web|shared', () => {
    execFileSync(node, ['scripts/demo-ci-fixture.mjs', 'block'], { cwd: root });
    expect(existsSync(fixture)).toBe(true);
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src/api', 'src/web', 'src/shared'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(dirty.trim()).toBe('');
  });

  it('remediate removes the fixture (idempotent)', () => {
    execFileSync(node, ['scripts/demo-ci-fixture.mjs', 'block'], { cwd: root });
    execFileSync(node, ['scripts/demo-ci-fixture.mjs', 'remediate'], { cwd: root });
    expect(existsSync(fixture)).toBe(false);
    // running remediate again is a no-op
    execFileSync(node, ['scripts/demo-ci-fixture.mjs', 'remediate'], { cwd: root });
    expect(existsSync(fixture)).toBe(false);
  });
});
