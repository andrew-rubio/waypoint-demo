#!/usr/bin/env node
// Restore demo fixtures + generated governance state WITHOUT altering committed source.
// Regenerates the deterministic governance artefacts and clears non-authoritative output.
import { execSync } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
function run(cmd) { console.log(`  $ ${cmd}`); execSync(cmd, { stdio: 'inherit' }); }

console.log('Resetting Waypoint demo state\n');

// Clear non-authoritative generated output (safe — gitignored / regenerable).
const out = resolve(root, 'specs/governance/.out');
if (existsSync(out)) { rmSync(out, { recursive: true, force: true }); console.log('  cleared specs/governance/.out'); }

// Regenerate the deterministic governance artefacts from committed inputs.
run('npx tsx src/governance/src/cli.ts select');
run('npx tsx src/governance/src/cli.ts contract');
run('npx tsx src/governance/src/cli.ts approve --approver "demo.presenter" --comment "demo reset"');
run('npx tsx src/governance/src/cli.ts evidence --mode local-demonstration');

console.log('\nDemo reset complete. Committed source is unchanged; regenerated artefacts are deterministic.');
