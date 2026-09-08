#!/usr/bin/env node
// Deterministic failing/passing evaluation → release decision (FRD-010 Area 6 acceptance).
// Runs a REAL evaluation result through the eval adapter, maps it to EVAL-GRD-001, enters
// the evidence manifest, and blocks/clears certification. Usage: node scripts/eval-demo.mjs <fail|pass>
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mode = process.argv[2] === 'fail' ? 'fail' : 'pass';
const root = process.cwd();
const fixture = resolve(root, mode === 'fail'
  ? 'specs/governance/examples/eval-results.fail.sample.json'
  : 'specs/governance/examples/eval-results.sample.json');
const manifest = resolve(root, 'specs/governance/.out/eval-demo-manifest.json');
const decisionPath = resolve(root, 'specs/governance/.out/eval-demo-decision.json');
const digest = 'sha256:eval-demo-digest';

const env = { ...process.env, WAYPOINT_EVAL_RESULTS: fixture };
const cli = (args) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/governance/src/cli.ts', ...args], { env, encoding: 'utf8' });
  if (r.error) throw r.error;
  return r;
};

console.log(`Evaluation demo (${mode}) — results: ${fixture}\n`);
cli(['evidence', '--mode', 'ci-authoritative', '--digest', digest, '--out', manifest]);
cli(['verify', '--manifest', manifest, '--deployment-digest', digest, '--out', decisionPath]);

const decision = JSON.parse(readFileSync(decisionPath, 'utf8'));
const evalResult = decision.controlResults.find((r) => r.controlId === 'EVAL-GRD-001');
console.log(`EVAL-GRD-001: ${evalResult?.status} — ${evalResult?.reason}`);
console.log(`Release decision: ${decision.releaseDecision} (deployable: ${decision.deployable})`);

if (mode === 'fail') {
  const ok = decision.releaseDecision === 'blocked' && evalResult?.status === 'fail';
  console.log(ok ? '\nPASS: failing evaluation blocked certification.' : '\nUNEXPECTED: fail path did not block.');
  process.exit(ok ? 0 : 1);
} else {
  const ok = decision.releaseDecision === 'approved' && evalResult?.status === 'pass';
  console.log(ok ? '\nPASS: passing evaluation cleared certification.' : '\nUNEXPECTED: pass path not approved.');
  process.exit(ok ? 0 : 1);
}
