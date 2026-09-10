import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Validates FRD-011: the repository extension can initialize the real AGT policy.
it('loads the built AGT adapter in plain Node without a TypeScript loader', () => {
  const output = execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `
      import { createBuildGovernance } from './.agt/build/agt-build.js';
      const governance = await createBuildGovernance({
        repoRoot: process.cwd(),
        auditPath: '.agt/audit/loader-regression.json',
      });
      process.stdout.write(JSON.stringify(governance.status()));
    `,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' },
    timeout: 10_000,
  });

  expect(JSON.parse(output)).toMatchObject({
    mode: 'enforce',
    sdkSource: 'vendored',
  });
});
