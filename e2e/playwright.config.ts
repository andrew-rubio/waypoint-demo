import { defineConfig, devices } from '@playwright/test';

// E2E runs against the Aspire-orchestrated Web app. Set WEB_BASE_URL in CI/Aspire.
const baseURL = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

// When no external stack is provided, Playwright boots the API + Web itself so
// the e2e suite is self-contained. In Aspire/CI set WEB_BASE_URL to skip this.
const selfHosted = !process.env.WEB_BASE_URL;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    // Waypoint honours prefers-reduced-motion; keep e2e deterministic.
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(selfHosted
    ? {
        webServer: [
          {
            command: 'node --import tsx src/server.ts',
            cwd: '../src/api',
            url: 'http://localhost:8080/health',
            reuseExistingServer: true,
            timeout: 60_000,
          },
          {
            command: 'npm run dev --workspace @waypoint/web',
            url: 'http://localhost:3000',
            cwd: '..',
            reuseExistingServer: true,
            timeout: 120_000,
            env: { API_BASE_URL: 'http://127.0.0.1:8080' },
          },
        ],
      }
    : {}),
});

