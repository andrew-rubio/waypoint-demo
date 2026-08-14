/**
 * Integration test harness for INC-1. Starts the API and Web as children of a
 * single process, waits for both to be ready, then runs the chosen test suite
 * (Playwright e2e or Cucumber BDD) against them, and tears everything down.
 *
 * Why a script instead of Playwright's `webServer`? So the whole stack lives
 * for exactly one command — start → wait → test → stop — which is robust in
 * constrained/CI environments.
 *
 * Usage:  node scripts/e2e.mjs [e2e|bdd]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const WEB = 'http://127.0.0.1:3000';
const API = 'http://127.0.0.1:8080';
const children = [];

function start(command, args, opts = {}) {
  const child = spawn(command, args, { stdio: 'inherit', shell: true, ...opts });
  children.push(child);
  return child;
}

async function waitFor(url, label, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(url);
      console.log(`[e2e] ${label} is up: ${url}`);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`[e2e] timed out waiting for ${label} at ${url}`);
}

function cleanup() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});

const env = { ...process.env, WEB_BASE_URL: WEB, API_BASE_URL: API };

start('node', ['--import', 'tsx', 'src/server.ts'], { cwd: 'src/api', env });
start('node', ['../../node_modules/next/dist/bin/next', 'dev', '-p', '3000'], { cwd: 'src/web', env });

await waitFor(`${API}/health`, 'API');
await waitFor(WEB, 'Web');

const mode = process.argv[2] ?? 'e2e';
const runner =
  mode === 'bdd'
    ? start('npx', ['cucumber-js'], { env: { ...env, NODE_OPTIONS: '--import tsx' } })
    : start('npx', ['playwright', 'test', '--config', 'e2e/playwright.config.ts'], { env });

runner.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
