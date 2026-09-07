#!/usr/bin/env node
// Governance-only PR-demo fixture toggler. Activates or removes ONE isolated control breach
// (an unregistered MCP tool) WITHOUT modifying any Waypoint application file. The fixture is a
// single governance-only JSON file that the mcp-allowlist adapter reads additively. Idempotent.
//
//   node scripts/demo-ci-fixture.mjs block       -> injects "unregistered-booking-provider"
//   node scripts/demo-ci-fixture.mjs remediate   -> removes the fixture (clean)
import { writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';

const mode = process.argv[2];
const root = process.cwd();
const file = resolve(root, 'specs/governance/demo-fixtures/extra-configured-tools.json');
const rel = relative(root, file).split('\\').join('/');

if (mode === 'block') {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(['unregistered-booking-provider'], null, 2) + '\n', 'utf8');
  console.log('CI demo fixture ACTIVE: injected unregistered MCP tool "unregistered-booking-provider" (governance-only).');
  console.log(`changed: ${rel}`);
  console.log('The authoritative Governance Contract Gate will now BLOCK on control SEC-MCP-001.');
} else if (mode === 'remediate') {
  if (existsSync(file)) {
    rmSync(file);
    console.log('CI demo fixture REMOVED: no unregistered tools remain (governance-only).');
    console.log(`changed: ${rel}`);
  } else {
    console.log('CI demo fixture already inactive (no fixture file present).');
    console.log('changed: (none)');
  }
  console.log('The authoritative Governance Contract Gate will now PASS the tool-allowlist control.');
} else {
  console.error('Usage: node scripts/demo-ci-fixture.mjs <block|remediate>');
  process.exit(2);
}
