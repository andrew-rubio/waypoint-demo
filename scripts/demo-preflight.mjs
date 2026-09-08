#!/usr/bin/env node
// Non-destructive demo preflight (FRD-010 demo-operability). Verifies readiness WITHOUT
// printing any secret values. Exits non-zero if a hard check fails.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
let hardFail = false;
const ok = (m) => console.log(`  [ok]   ${m}`);
const warn = (m) => console.log(`  [warn] ${m}`);
const fail = (m) => { console.log(`  [FAIL] ${m}`); hardFail = true; };

function sh(cmd) { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } }

console.log('Waypoint demo preflight\n');

const branch = sh('git rev-parse --abbrev-ref HEAD');
branch ? ok(`git branch: ${branch}`) : warn('not a git checkout');
const dirty = sh('git status --porcelain');
dirty ? warn('working tree has uncommitted changes') : ok('working tree clean');

const node = process.versions.node.split('.')[0];
Number(node) >= 22 ? ok(`node ${process.versions.node}`) : fail(`node ${process.versions.node} (<22)`);

existsSync(resolve(root, 'node_modules/.package-lock.json')) || existsSync(resolve(root, 'node_modules')) ? ok('dependencies installed') : fail('run npm ci');

// Required env var NAMES only — never print values.
for (const name of ['FOUNDRY_MODEL_URL', 'FOUNDRY_MODEL']) {
  process.env[name] ? ok(`env ${name} present`) : warn(`env ${name} not set (local-driver mode)`);
}
process.env.FOUNDRY_MODEL_URL ? ok('runtime mode: Foundry model configured') : ok('runtime mode: LOCAL deterministic driver (badge will say so)');

// No real payment/booking endpoint may be configured.
process.env.REAL_BOOKING_ENDPOINT ? fail('REAL_BOOKING_ENDPOINT is set — booking must remain simulated') : ok('no real booking/payment endpoint configured');

for (const f of ['specs/governance/controls.yaml', 'specs/governance/proposition.yaml', 'specs/governance/control-contract.yaml', 'specs/governance/approval-record.json', 'eval/gate.json', 'specs/governance/examples/eval-results.sample.json', 'specs/governance/examples/test-results.sample.json']) {
  existsSync(resolve(root, f)) ? ok(`artefact ${f}`) : (f.includes('approval-record') || f.includes('control-contract') ? warn(`${f} not yet generated (run gov:contract / gov:approve)`) : fail(`missing ${f}`));
}

console.log(`\nBackup recording path: specs/demo/demo-recovery.md lists prerecorded fallbacks.`);
console.log(hardFail ? '\nPreflight: FAIL' : '\nPreflight: PASS');
process.exit(hardFail ? 1 : 0);
