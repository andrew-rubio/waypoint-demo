import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < 22) {
  throw new Error('AGT setup requires Node 22 or newer. Select that runtime and run npm run agt:setup again.');
}

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [
  require.resolve('typescript/bin/tsc'),
  '--project',
  join(repoRoot, 'src', 'governance', 'tsconfig.agt-build.json'),
], { cwd: repoRoot, stdio: 'inherit' });

const packageRoot = dirname(require.resolve('@microsoft/agent-governance-copilot-cli/package.json'));
const { installPackage } = await import(pathToFileURL(join(packageRoot, 'lib', 'cli.mjs')).href);

const result = await installPackage({
  copilotHome: join(repoRoot, '.agt', 'copilot'),
});

process.stdout.write(`${JSON.stringify({
  scope: 'repository',
  extensionPath: result.extensionPath,
  adapterPath: join(repoRoot, '.agt', 'build', 'agt-build.js'),
  policyPath: join(repoRoot, '.github', 'agt', 'policy.json'),
  next: 'Reload the project extension in Copilot to activate the policy.',
}, null, 2)}\n`);
