import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from '@playwright/test';
import { type CustomWorld } from '../support/world';

type DeploymentTier = 'payg' | 'ptu';

interface VerificationEvidence {
  allowed?: boolean;
  reason?: string;
  model?: string;
  version?: string;
  activeDeployment?: DeploymentTier;
  paygHealthy?: boolean;
  ptuHealthy?: boolean;
  ptuCapacity?: number;
  ptuRemovable?: boolean;
  implementationUnchanged?: boolean;
  conversationSucceeded?: boolean;
  tracesCorrelated?: boolean;
  traceDeployment?: string;
  utilizationObserved?: boolean;
  priceApproved?: boolean;
  reservationPurchased?: boolean;
  changedDeployments?: number;
  failureReported?: boolean;
  throttled?: boolean;
  throttlingRecorded?: boolean;
  utilizationRetained?: boolean;
  verificationComplete?: boolean;
  waitedForTelemetry?: boolean;
  ptuDeleted?: boolean;
}

interface ScenarioState {
  fixture?: string;
  selectedDeployment?: DeploymentTier;
  model?: string;
  version?: string;
  capacity?: number;
  priceApproved?: boolean;
  evidence?: VerificationEvidence;
}

const states = new WeakMap<CustomWorld, ScenarioState>();

function stateFor(world: CustomWorld): ScenarioState {
  const existing = states.get(world);
  if (existing) return existing;
  const state: ScenarioState = {};
  states.set(world, state);
  return state;
}

function repositoryFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function runVerifier(world: CustomWorld, mode: string): VerificationEvidence {
  const state = stateFor(world);
  const args = [
    'scripts/verify-ptu-demo.mjs',
    '--json',
    '--mode',
    mode,
    ...(state.fixture ? ['--fixture', state.fixture] : []),
    ...(state.selectedDeployment ? ['--deployment', state.selectedDeployment] : []),
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PTU_MODEL: state.model ?? 'gpt-5.4-mini',
      PTU_MODEL_VERSION: state.version ?? '2026-03-17',
      PTU_CAPACITY: String(state.capacity ?? 15),
      PTU_PRICE_APPROVED: String(state.priceApproved ?? false),
    },
  });

  expect(result.status, result.stderr || result.stdout).toBe(0);
  const evidence = JSON.parse(result.stdout) as VerificationEvidence;
  state.evidence = evidence;
  return evidence;
}

Given('the model infrastructure uses its default configuration', function (this: CustomWorld) {
  const source = repositoryFile('infra/main.bicep');
  expect(source).toContain("param foundryModelDeploymentSku string = 'GlobalStandard'");
});

When('the planned model deployments are inspected', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'plan');
  expect(evidence.model).toBe('gpt-5.4-mini');
});

Then('GPT-5.4-mini uses the PAYG deployment by default', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.activeDeployment).toBe('payg');
});

Then('the embedding model remains on PAYG', function () {
  const source = repositoryFile('infra/modules/foundry.bicep');
  expect(source).toMatch(/embeddingDeployment[\s\S]*?name:\s*'GlobalStandard'/);
});

Given('GPT-5.4-mini version {string} is selected', function (this: CustomWorld, version: string) {
  const state = stateFor(this);
  state.model = 'gpt-5.4-mini';
  state.version = version;
  expect(version).toBe('2026-03-17');
});

Given('Global Provisioned is selected with {int} PTUs', function (this: CustomWorld, capacity: number) {
  const state = stateFor(this);
  state.capacity = capacity;
  state.selectedDeployment = 'ptu';
  expect(capacity).toBe(15);
});

Then('the plan contains a separate Global Provisioned deployment', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.allowed).toBe(true);
  const source = repositoryFile('infra/modules/foundry.bicep');
  expect(source).toContain('GlobalProvisionedManaged');
});

Then('its capacity is {int} PTUs', function (this: CustomWorld, capacity: number) {
  expect(stateFor(this).evidence?.ptuCapacity).toBe(capacity);
});

Given('the GPT-5.4-mini PAYG deployment is healthy', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'payg-health');
  expect(evidence.paygHealthy).toBe(true);
});

Given('the hourly price for {int} PTUs has been approved', function (this: CustomWorld, capacity: number) {
  const state = stateFor(this);
  state.capacity = capacity;
  state.priceApproved = true;
  expect(capacity).toBe(15);
});

When('the Global Provisioned deployment is created', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'post-provision');
  expect(evidence.priceApproved).toBe(true);
});

Then('the GPT-5.4-mini PTU deployment is healthy at {int} PTUs', function (this: CustomWorld, capacity: number) {
  const evidence = stateFor(this).evidence;
  expect(evidence?.ptuHealthy).toBe(true);
  expect(evidence?.ptuCapacity).toBe(capacity);
});

Then('the PAYG deployment remains healthy', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.paygHealthy).toBe(true);
});

Given('the PAYG and PTU deployments are healthy', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'deployment-health');
  expect(evidence.paygHealthy).toBe(true);
  expect(evidence.ptuHealthy).toBe(true);
});

Given('the agent is using the PAYG deployment', function (this: CustomWorld) {
  const state = stateFor(this);
  state.selectedDeployment = 'payg';
  expect(state.selectedDeployment).toBe('payg');
});

Given('the agent is using the healthy PAYG deployment', function (this: CustomWorld) {
  const state = stateFor(this);
  state.selectedDeployment = 'payg';
  const evidence = runVerifier(this, 'payg-health');
  expect(evidence.paygHealthy).toBe(true);
});

When('the presenter selects the PTU deployment', function (this: CustomWorld) {
  const state = stateFor(this);
  state.selectedDeployment = 'ptu';
  const evidence = runVerifier(this, 'switch');
  expect(evidence.activeDeployment).toBe('ptu');
});

Then('the agent completes the representative holiday-planning conversation', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'conversation');
  expect(evidence.conversationSucceeded).toBe(true);
});

Then('the agent implementation, tools, prompts, and identity are unchanged', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.implementationUnchanged).toBe(true);
});

Given('the representative conversation has run against PAYG and PTU', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'comparison');
  expect(evidence.conversationSucceeded).toBe(true);
});

When('the operator inspects Foundry Observability and Application Insights', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'traces');
  expect(evidence.verificationComplete).toBe(true);
});

Then('both runs contain correlated agent, model, and tool spans', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.tracesCorrelated).toBe(true);
});

Then('the PTU run identifies the provisioned deployment', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.traceDeployment).toBe('ptu');
});

Given('traffic has been sent to the PTU deployment', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'ptu-traffic');
  expect(evidence.activeDeployment).toBe('ptu');
});

When('the operator inspects provisioned utilization', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'utilization');
  expect(evidence.verificationComplete).toBe(true);
});

Then('utilization data is available for the PTU deployment', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.utilizationObserved).toBe(true);
});

Given('the agent is using the healthy PTU deployment', function (this: CustomWorld) {
  const state = stateFor(this);
  state.selectedDeployment = 'ptu';
  const evidence = runVerifier(this, 'ptu-health');
  expect(evidence.ptuHealthy).toBe(true);
});

When('the presenter selects the PAYG deployment', function (this: CustomWorld) {
  const state = stateFor(this);
  state.selectedDeployment = 'payg';
  const evidence = runVerifier(this, 'switch');
  expect(evidence.activeDeployment).toBe('payg');
});

Then('the PTU deployment remains independently removable', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.ptuRemovable).toBe(true);
});

Given('GPT-5.4-mini Global Provisioned is configured for {int} PTUs', function (this: CustomWorld, capacity: number) {
  const state = stateFor(this);
  state.model = 'gpt-5.4-mini';
  state.capacity = capacity;
  expect(capacity).toBe(15);
});

When('the Foundry portal displays the hourly price', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'price-awaiting-approval';
  const evidence = runVerifier(this, 'price-gate');
  expect(evidence.priceApproved).toBe(false);
});

Then('provisioning waits for explicit presenter approval', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.allowed).toBe(false);
  expect(stateFor(this).evidence?.reason).toBe('price-approval-required');
});

Then('no Azure Reservation is purchased', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.reservationPurchased).toBe(false);
});

Given('fewer than {int} Global Provisioned PTUs are available in the subscription', function (this: CustomWorld, minimum: number) {
  const state = stateFor(this);
  state.fixture = 'quota-below-minimum';
  state.capacity = minimum;
  expect(minimum).toBe(15);
});

When('the presenter prepares the PTU deployment', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'preflight');
  expect(evidence.verificationComplete).toBe(true);
});

Then('provisioning is blocked with the required quota', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.allowed).toBe(false);
  expect(stateFor(this).evidence?.reason).toBe('insufficient-quota');
});

Then('the agent remains on PAYG', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.activeDeployment).toBe('payg');
});

Given('the subscription has sufficient PTU quota', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'capacity-below-minimum';
  expect(state.fixture).toBe('capacity-below-minimum');
});

Given('fewer than {int} GPT-5.4-mini PTUs are currently deployable', function (this: CustomWorld, minimum: number) {
  const state = stateFor(this);
  state.capacity = minimum;
  expect(minimum).toBe(15);
});

Then('provisioning is blocked because live capacity is unavailable', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.allowed).toBe(false);
  expect(stateFor(this).evidence?.reason).toBe('insufficient-live-capacity');
});

When('creation of the PTU deployment fails', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'provision-failed';
  const evidence = runVerifier(this, 'post-provision');
  expect(evidence.allowed).toBe(false);
});

Then('the failure is reported explicitly', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.failureReported).toBe(true);
});

Given('the agent is using the PTU deployment', function (this: CustomWorld) {
  const state = stateFor(this);
  state.selectedDeployment = 'ptu';
  expect(state.selectedDeployment).toBe('ptu');
});

When('the representative workload receives a throttled response', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'throttled';
  const evidence = runVerifier(this, 'comparison');
  expect(evidence.throttled).toBe(true);
});

Then('the throttled response is recorded in the comparison results', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.throttlingRecorded).toBe(true);
});

Then('the provisioned utilization for that period is retained', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.utilizationRetained).toBe(true);
});

Given('the representative PTU conversation has completed', function (this: CustomWorld) {
  const state = stateFor(this);
  state.selectedDeployment = 'ptu';
  const evidence = runVerifier(this, 'conversation');
  expect(evidence.conversationSucceeded).toBe(true);
});

Given('its trace has not appeared yet', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'telemetry-delayed';
  expect(state.fixture).toBe('telemetry-delayed');
});

When('observability verification runs', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'traces');
  expect(evidence.waitedForTelemetry).toBe(true);
});

Then('verification waits for the configured telemetry delay', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.waitedForTelemetry).toBe(true);
});

Then('does not report observability success prematurely', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.verificationComplete).toBe(false);
});

Given('the agent has been switched back to PAYG', function (this: CustomWorld) {
  const state = stateFor(this);
  state.selectedDeployment = 'payg';
  const evidence = runVerifier(this, 'deployment-health');
  expect(evidence.activeDeployment).toBe('payg');
});

Given('the PTU deployment is no longer required', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'cleanup-approved';
  expect(state.fixture).toBe('cleanup-approved');
});

When('the operator performs the approved cleanup', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'cleanup');
  expect(evidence.verificationComplete).toBe(true);
});

Then('the PTU deployment is deleted', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.ptuDeleted).toBe(true);
});

Given('an unsupported model version or deployment type is configured', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'invalid-configuration';
  expect(state.fixture).toBe('invalid-configuration');
});

When('the model infrastructure is validated', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'validate');
  expect(evidence.verificationComplete).toBe(true);
});

Then('validation fails with the invalid configuration identified', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.allowed).toBe(false);
  expect(stateFor(this).evidence?.reason).toBe('invalid-configuration');
});

Then('no model deployment is changed', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.changedDeployments).toBe(0);
});

Given('the PTU deployment was created but fails its health check', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'ptu-unhealthy';
  expect(state.fixture).toBe('ptu-unhealthy');
});

When('the presenter attempts to select it', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'switch');
  expect(evidence.ptuHealthy).toBe(false);
});

Then('the selection is blocked', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.allowed).toBe(false);
});

Given('its telemetry ingestion delay has elapsed', function (this: CustomWorld) {
  const state = stateFor(this);
  state.fixture = 'trace-correlation-missing';
  expect(state.fixture).toBe('trace-correlation-missing');
});

When('the operator cannot correlate its agent, model, and tool spans', function (this: CustomWorld) {
  const evidence = runVerifier(this, 'traces');
  expect(evidence.tracesCorrelated).toBe(false);
});

Then('the observability verification fails', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.verificationComplete).toBe(false);
});

Then('the PTU demonstration is not marked complete', function (this: CustomWorld) {
  expect(stateFor(this).evidence?.allowed).toBe(false);
});
