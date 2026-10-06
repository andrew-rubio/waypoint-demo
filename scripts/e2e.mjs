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
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const children = [];

// Ports that fetch() and browsers refuse to connect to (WHATWG Fetch "bad ports", >= 1024).
const BLOCKED_PORTS = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

async function reservePort(requested) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: requested ?? 0 }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not resolve the reserved test port.')));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function availablePort(requested) {
  if (requested !== undefined) {
    if (BLOCKED_PORTS.has(requested)) throw new Error(`Port ${requested} is blocked by browsers and fetch; choose another.`);
    return reservePort(requested);
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await reservePort();
    if (!BLOCKED_PORTS.has(port)) return port;
  }
  throw new Error('Could not reserve a browser-safe test port.');
}

function start(command, args, opts = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...opts });
  children.push(child);
  return child;
}

async function waitFor(url, label, tries = 120) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      await fetch(url);
      process.stdout.write(`[e2e] ${label} is up: ${url}\n`);
      return;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }
  throw new Error(`[e2e] timed out waiting for ${label} at ${url}`, { cause: lastError });
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

const webPort = await availablePort(
  process.env.WAYPOINT_TEST_WEB_PORT ? Number(process.env.WAYPOINT_TEST_WEB_PORT) : undefined,
);
const apiPort = await availablePort(
  process.env.WAYPOINT_TEST_API_PORT ? Number(process.env.WAYPOINT_TEST_API_PORT) : undefined,
);
if (webPort === apiPort) {
  throw new Error('Web and API test ports must be different.');
}

const WEB = `http://127.0.0.1:${webPort}`;
const API = `http://127.0.0.1:${apiPort}`;
const env = { ...process.env, WEB_BASE_URL: WEB, API_BASE_URL: API };

start('node', ['--import', 'tsx', 'src/server.ts'], {
  cwd: 'src/api',
  // Test mode pins the deterministic local driver and removes simulated loading delays.
  env: { ...env, PORT: String(apiPort), NODE_ENV: 'test' },
});
start('node', ['../../node_modules/next/dist/bin/next', 'dev', '-p', String(webPort)], {
  cwd: 'src/web',
  env,
});

await waitFor(`${API}/health`, 'API');
await waitFor(WEB, 'Web');

const mode = process.argv[2] ?? 'e2e';
const extraArgs = process.argv.slice(3);
const runner =
  mode === 'bdd'
    ? start(process.execPath, ['node_modules/@cucumber/cucumber/bin/cucumber.js', ...extraArgs], {
        env: { ...env, NODE_OPTIONS: '--import tsx' },
      })
    : start(
        process.execPath,
        ['node_modules/@playwright/test/cli.js', 'test', '--config', 'e2e/playwright.config.ts', ...extraArgs],
        { env },
      );

runner.on('exit', (code) => {
  cleanup();
  process.exit(code ?? 0);
});
