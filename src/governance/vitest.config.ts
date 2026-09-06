import { defineConfig } from 'vitest/config';

// Deterministic governance-engine unit tests (selection, hashing, approval, verify, catalog).
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: false,
  },
});
