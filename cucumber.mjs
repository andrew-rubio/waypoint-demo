// Cucumber.js configuration (ESM). TypeScript is loaded via the tsx Node loader
// wired in the `test:bdd` script (NODE_OPTIONS="--import tsx").
export default {
  paths: ['specs/features/**/*.feature'],
  import: [
    'tests/features/support/world.ts',
    'tests/features/support/hooks.ts',
    'tests/features/step-definitions/**/*.ts',
  ],
  format: ['progress', ['html', 'test-results/cucumber.html']],
  worldParameters: {
    webBaseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3000',
    apiBaseURL: process.env.API_BASE_URL ?? 'http://localhost:8080',
  },
};
