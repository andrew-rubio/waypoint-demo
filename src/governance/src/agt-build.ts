import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface BuildGovernanceOptions {
  repoRoot: string;
  auditPath: string;
}

export interface BuildGovernance {
  onPreToolUse(input: BuildToolInput, invocation: { sessionId: string }): Promise<BuildToolDecision | undefined>;
  status(): Record<string, unknown>;
}

interface BuildToolInput {
  toolName: string;
  toolArgs: unknown;
  workingDirectory: string;
}

interface BuildToolDecision {
  permissionDecision?: 'allow' | 'deny' | 'ask';
  permissionDecisionReason?: string;
  additionalContext?: string;
}

interface AgtPolicyModule {
  loadPolicy(options: {
    defaultPolicyPath: string;
    extensionRoot: string;
    policyPath: string;
  }): Promise<Record<string, unknown>>;
  evaluatePreToolUse(
    state: Record<string, unknown>,
    input: BuildToolInput & { cwd: string },
    invocation: { sessionId: string },
  ): Promise<BuildToolDecision | undefined>;
  getPolicyStatus(state: Record<string, unknown>): Record<string, unknown>;
}

function isAgtPolicyModule(value: unknown): value is AgtPolicyModule {
  return typeof value === 'object' && value !== null
    && 'loadPolicy' in value && typeof value.loadPolicy === 'function'
    && 'evaluatePreToolUse' in value && typeof value.evaluatePreToolUse === 'function'
    && 'getPolicyStatus' in value && typeof value.getPolicyStatus === 'function';
}

export async function createBuildGovernance(
  { repoRoot, auditPath }: BuildGovernanceOptions,
): Promise<BuildGovernance> {
  const root = resolve(repoRoot);
  const extensionRoot = join(root, '.agt', 'copilot', 'extensions', 'agt-global-policy');
  const policyPath = join(root, '.github', 'agt', 'policy.json');
  await access(policyPath);

  const agt: unknown = await import(pathToFileURL(join(extensionRoot, 'lib', 'policy.mjs')).href);
  if (!isAgtPolicyModule(agt)) {
    throw new Error('The installed AGT package does not expose the expected policy integration.');
  }

  const state = {
    ...await agt.loadPolicy({
      defaultPolicyPath: join(extensionRoot, 'config', 'default-policy.json'),
      extensionRoot,
      policyPath,
    }),
    auditPath: resolve(auditPath),
  };

  return {
    onPreToolUse: (input, invocation) => agt.evaluatePreToolUse(
      state,
      // The app's SDK names this field workingDirectory; AGT expects cwd.
      { ...input, cwd: input.workingDirectory },
      invocation,
    ),
    status: () => ({ ...agt.getPolicyStatus(state), repoRoot: root }),
  };
}
