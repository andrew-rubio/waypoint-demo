#!/usr/bin/env node
// Governance-only reset. Restores the committed proposition, clears the draft + generated
// evidence, and regenerates the deterministic governance artefacts. It NEVER touches
// application source, runtime configuration, deployed resources, or the booking flow.
import { execFileSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const node = process.execPath;
function cli(args) { execFileSync(node, ['--import', 'tsx', 'src/governance/src/cli.ts', ...args], { stdio: 'inherit' }); }

console.log('Governance-only reset (no application source is modified)\n');

// Restore the committed canonical proposition (in case a promote overwrote it).
try {
  execFileSync('git', ['checkout', '--', 'specs/governance/proposition.yaml'], { cwd: root, stdio: 'ignore' });
  console.log('  restored specs/governance/proposition.yaml (committed)');
} catch { /* not a git checkout — leave as-is */ }

// Remove the draft + non-authoritative generated output (safe / regenerable).
for (const p of ['specs/governance/proposition.draft.yaml', 'specs/governance/.out']) {
  const abs = resolve(root, p);
  if (existsSync(abs)) { rmSync(abs, { recursive: true, force: true }); console.log(`  cleared ${p}`); }
}

// Regenerate the deterministic governance artefacts from committed inputs.
cli(['select']);
cli(['contract']);
cli(['approve', '--approver', 'demo.presenter', '--comment', 'governance demo reset']);
cli(['evidence', '--mode', 'local-demonstration']);

console.log('\nGovernance reset complete. Application source, config and booking flow are untouched.');
