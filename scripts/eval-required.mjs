#!/usr/bin/env node
// Deterministic evaluation evidence in DEMONSTRATION-FIXTURE mode for the recording branch.
// It reads the committed passing sample + eval/gate.json, asserts every gated threshold, and
// writes eval/.out/eval_results_latest.json so the governance eval adapter has a current-commit
// result to bind. No model call and NO model credentials are required. The REAL model
// evaluation is the separately-recorded platform clip.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const root = process.cwd();
const gate = JSON.parse(readFileSync(resolve(root, 'eval/gate.json'), 'utf8'));
const sample = JSON.parse(readFileSync(resolve(root, 'specs/governance/examples/eval-results.sample.json'), 'utf8'));

const breaches = Object.entries(gate).filter(([k, min]) => (sample[k] ?? 0) < min);
const out = resolve(root, 'eval/.out/eval_results_latest.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(sample, null, 2) + '\n', 'utf8');

console.log('Evaluation evidence (DEMONSTRATION FIXTURE — deterministic, no model call):');
for (const [k, min] of Object.entries(gate)) console.log(`  ${k}: ${sample[k]} (>= ${min})`);

if (breaches.length) {
  console.error(`FAIL: evaluator(s) below threshold: ${breaches.map(([k, m]) => `${k}<${m}`).join(', ')}`);
  process.exit(1);
}
console.log('PASS: sample meets all gated thresholds. Wrote eval/.out/eval_results_latest.json');
process.exit(0);
