import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBuildGovernance } from '../src/agt-build.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const sessionId = 'agt-build-proof';

const cases = [
  {
    name: 'allows an ordinary source read',
    toolName: 'view',
    toolArgs: { path: 'README.md' },
    permissionDecision: undefined,
    auditDecision: 'allow',
  },
  {
    name: 'requires approval for a harmless shell command',
    toolName: 'bash',
    toolArgs: { command: 'node --version' },
    permissionDecision: 'ask',
    auditDecision: 'review',
  },
  {
    name: 'denies a protected fixture read using the host working directory',
    toolName: 'view',
    toolArgs: { path: '.github/agt/protected-proof.txt' },
    permissionDecision: 'deny',
    auditDecision: 'deny',
  },
] as const;

describe('AGT build governance (FRD-011)', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'waypoint-agt-test-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it.each(cases)('$name', async (testCase) => {
    const auditPath = join(temporaryDirectory, 'audit.json');
    const governance = await createBuildGovernance({ repoRoot, auditPath });
    const input = {
      toolName: testCase.toolName,
      toolArgs: testCase.toolArgs,
      timestamp: new Date(),
      workingDirectory: repoRoot,
      sessionId,
    };

    const result = await governance.onPreToolUse(input, { sessionId });

    expect(result?.permissionDecision).toBe(testCase.permissionDecision);
    if (testCase.permissionDecision) {
      expect(result?.permissionDecisionReason).toEqual(expect.any(String));
      expect(result?.permissionDecisionReason?.length).toBeGreaterThan(0);
    }

    const audit = JSON.parse(await readFile(auditPath, 'utf8'));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      agentId: `copilot-cli:${sessionId}`,
      action: `tool.${testCase.toolName}`,
      decision: testCase.auditDecision,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      previousHash: '0'.repeat(64),
    });
    expect(governance.status()).toMatchObject({
      mode: 'enforce',
      auditEntries: 1,
      auditValid: true,
      auditPath,
      sdkSource: 'vendored',
    });
  });
});
