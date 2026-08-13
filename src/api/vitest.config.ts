import { defineConfig } from 'vitest/config';

// Runs the API slice unit + integration tests. Red until src/api/src exists.
export default defineConfig({
  test: {
    // Pin the root to this config's directory so `include` resolves to
    // src/api/tests regardless of where the command is launched from.
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
