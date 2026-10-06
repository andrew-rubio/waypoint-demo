#!/usr/bin/env node
/**
 * Read-only PAYG → PTU demonstration verifier (FRD-011, ADR-013).
 *
 * One decision engine, two evidence sources:
 *   - default: deterministic simulated evidence (fixtures) so the decision rules are
 *     testable without Azure; output is labelled `simulated: true`.
 *   - --live: real evidence from Azure Resource Manager, Azure Monitor metrics,
 *     Application Insights, the model endpoint, and the deployed Waypoint API.
 *
 * The script never creates, changes, or deletes Azure resources and never buys a
 * reservation. Provisioning, switching, and cleanup are done through azd/Bicep; this
 * script decides whether each step is safe and proves the outcome.
 *
 * Usage:
 *   node scripts/verify-ptu-demo.mjs --mode <mode> [--deployment payg|ptu] [--fixture <name>] [--live] [--azd-env] [--json]
 *   (`--mode switch` targets PTU unless --deployment payg is given.)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = resolve(import.meta.dirname, '..');
const MODES = [
  'plan', 'validate', 'preflight', 'price-gate', 'payg-health', 'ptu-health', 'deployment-health',
  'post-provision', 'switch', 'conversation', 'comparison', 'ptu-traffic', 'traces', 'utilization', 'cleanup',
];
const SUPPORTED = { model: 'gpt-5.4-mini', version: '2026-03-17', sku: 'GlobalProvisionedManaged', minimum: 15, step: 5 };
const UTILIZATION_METRIC = 'AzureOpenAIProvisionedManagedUtilizationV2';
const REPRESENTATIVE_PROMPT =
  'Plan a 7-night October trip to Lisbon from London for 2 travellers: suggest flights, a hotel, and the weather.';

class UsageError extends Error {}

// ─────────────────────────────── arguments & configuration ───────────────────────────────

function parseArgs(argv) {
  const args = { json: false, live: false, azdEnv: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
      i += 1;
      return value;
    };
    if (flag === '--json') args.json = true;
    else if (flag === '--live') args.live = true;
    else if (flag === '--azd-env') args.azdEnv = true;
    else if (flag === '--mode') args.mode = next();
    else if (flag === '--fixture') args.fixture = next();
    else if (flag === '--deployment') args.deployment = next();
    else throw new UsageError(`Unknown argument ${flag}`);
  }
  if (!MODES.includes(args.mode)) throw new UsageError(`--mode must be one of: ${MODES.join(', ')}`);
  if (args.deployment && !['payg', 'ptu'].includes(args.deployment)) throw new UsageError('--deployment must be payg or ptu');
  if (args.fixture && args.live) throw new UsageError('--fixture and --live are mutually exclusive');
  if (args.fixture && !FIXTURES[args.fixture]) throw new UsageError(`Unknown fixture ${args.fixture}`);
  return args;
}

/** Defaults come from infra/main.bicep so the verifier checks what Bicep would deploy. */
function bicepDefaults() {
  const source = readFileSync(join(ROOT, 'infra/main.bicep'), 'utf8');
  const param = (name) => source.match(new RegExp(`param ${name} \\w+ = '?([^'\\n]+)'?`))?.[1];
  return {
    model: param('foundryModelName'),
    version: param('foundryModelVersion'),
    paygName: param('foundryModelName'),
    ptuName: param('foundryPtuModelName'),
    capacity: Number(param('foundryPtuCapacity')),
    useFoundryPtu: param('useFoundryPtu') === 'true',
  };
}

function configuration(fixture) {
  const defaults = bicepDefaults();
  const env = process.env;
  return {
    model: env.PTU_MODEL ?? defaults.model,
    version: env.PTU_MODEL_VERSION ?? defaults.version,
    sku: SUPPORTED.sku,
    paygName: defaults.paygName,
    ptuName: env.PTU_DEPLOYMENT_NAME ?? defaults.ptuName,
    capacity: Number(env.PTU_CAPACITY ?? defaults.capacity),
    defaultTier: defaults.useFoundryPtu ? 'ptu' : 'payg',
    priceApproved: env.PTU_PRICE_APPROVED === 'true',
    telemetryDelaySeconds: Number(env.PTU_TELEMETRY_DELAY_SECONDS ?? 300),
    ...(fixture?.config ?? {}),
  };
}

function invalidFields(config) {
  const invalid = [];
  if (config.model !== SUPPORTED.model) invalid.push(`model=${config.model}`);
  if (config.version !== SUPPORTED.version) invalid.push(`version=${config.version}`);
  if (config.sku !== SUPPORTED.sku) invalid.push(`sku=${config.sku}`);
  if (!Number.isInteger(config.capacity) || config.capacity < SUPPORTED.minimum || config.capacity % SUPPORTED.step !== 0) {
    invalid.push(`capacity=${config.capacity}`);
  }
  return invalid;
}

/** The agent code must not know which tier it runs on: only FOUNDRY_MODEL differs. */
function implementationUnchanged() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) files.push(path);
    }
  };
  walk(join(ROOT, 'src/api/src'));
  const tierAware = files.some((file) => /\bptu\b|provisioned/i.test(readFileSync(file, 'utf8')));
  const runtime = readFileSync(join(ROOT, 'src/api/src/agent/runtime.ts'), 'utf8');
  return !tierAware && runtime.includes('process.env.FOUNDRY_MODEL');
}

// ─────────────────────────────── simulated evidence ───────────────────────────────

function healthyObservation(config) {
  const deployment = (name, sku, capacity) => ({ name, exists: true, state: 'Succeeded', sku, capacity, inference: 'ok' });
  const run = (tier, name) => ({ tier, deployment: name, status: 200, durationMs: tier === 'ptu' ? 1450 : 1900 });
  const spans = (name) => ({ operations: ['invoke_agent', 'chat', 'execute_tool'], models: [name] });
  return {
    quotaAvailable: 100,
    liveCapacity: 100,
    deployments: {
      payg: deployment(config.paygName, 'GlobalStandard', 500),
      ptu: deployment(config.ptuName, SUPPORTED.sku, config.capacity),
    },
    runs: { payg: run('payg', config.paygName), ptu: run('ptu', config.ptuName) },
    traces: { availableAfterSeconds: 0, payg: spans(config.paygName), ptu: spans(config.ptuName) },
    utilization: [{ timestamp: '2026-10-06T10:00:00Z', average: 18.4, maximum: 41.2 }],
  };
}

const FIXTURES = {
  healthy: { observe: () => {} },
  'price-awaiting-approval': { observe: (o) => Object.assign(o.deployments.ptu, { exists: false }) },
  'quota-below-minimum': { observe: (o) => { o.quotaAvailable = 10; o.deployments.ptu.exists = false; } },
  'capacity-below-minimum': { observe: (o) => { o.liveCapacity = 10; o.deployments.ptu.exists = false; } },
  'provision-failed': {
    observe: (o) => Object.assign(o.deployments.ptu, { state: 'Failed', inference: 'unavailable', error: 'Deployment provisioning failed.' }),
  },
  'ptu-unhealthy': { observe: (o) => Object.assign(o.deployments.ptu, { inference: 'error', error: 'Inference health check failed.' }) },
  throttled: {
    observe: (o) => {
      Object.assign(o.runs.ptu, { status: 429, retryAfterSeconds: 2 });
      o.utilization.push({ timestamp: '2026-10-06T10:01:00Z', average: 100, maximum: 100 });
    },
  },
  'telemetry-delayed': { observe: (o) => { o.traces.availableAfterSeconds = Number.POSITIVE_INFINITY; } },
  'trace-correlation-missing': { observe: (o) => { o.traces.ptu = { operations: ['invoke_agent'], models: [] }; } },
  'cleanup-approved': { observe: (o) => { o.deployments.ptu.exists = false; } },
  'invalid-configuration': { config: { version: '2024-07-18', sku: 'ProvisionedManaged' }, observe: () => {} },
};

function simulatedSource(config, fixtureName) {
  const observation = healthyObservation(config);
  FIXTURES[fixtureName ?? 'healthy'].observe(observation);
  return {
    name: `simulated:${fixtureName ?? 'healthy'}`,
    simulated: true,
    deployments: async () => observation.deployments,
    quota: async () => observation.quotaAvailable,
    liveCapacity: async () => observation.liveCapacity,
    activeTier: async (requested) => requested ?? config.defaultTier,
    conversation: async (tier) => observation.runs[tier],
    modelRun: async (tier) => observation.runs[tier],
    // Simulated time: no real waiting, but the same delay rule is applied.
    traces: async (delaySeconds) => {
      const waited = observation.traces.availableAfterSeconds > 0;
      if (observation.traces.availableAfterSeconds > delaySeconds) return { waited, available: false };
      return { waited, available: true, payg: observation.traces.payg, ptu: observation.traces.ptu };
    },
    utilization: async () => observation.utilization,
  };
}

// ─────────────────────────────── live evidence (read-only) ───────────────────────────────

function az(args) {
  // `az` is a .cmd shim on Windows, which Node can only start through a shell; arguments are plain identifiers.
  const result = spawnSync('az', args.map((arg) => `"${arg}"`), { encoding: 'utf8', shell: true });
  if (result.status !== 0) throw new Error(`az ${args[0]} failed: ${(result.stderr || result.stdout).trim().split('\n').pop()}`);
  return result.stdout.trim();
}

function loadAzdEnvironment() {
  const result = spawnSync('azd', ['env', 'get-values', '--output', 'json'].map((arg) => `"${arg}"`), {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
  });
  if (result.status !== 0) throw new Error('azd env get-values failed; run from an initialised azd environment.');
  for (const [key, value] of Object.entries(JSON.parse(result.stdout))) process.env[key] ??= String(value);
}

/** The deployment the Foundry-hosted agent is configured with (foundry/ azd environment). */
function hostedAgentDeployment() {
  if (process.env.PTU_HOSTED_AGENT_DEPLOYMENT) return process.env.PTU_HOSTED_AGENT_DEPLOYMENT;
  // The root azd environment name must not leak into the separate foundry/ azd project.
  const { AZURE_ENV_NAME: _rootEnvironment, ...env } = process.env;
  const environment = process.env.PTU_HOSTED_AGENT_AZD_ENV ? ['-e', process.env.PTU_HOSTED_AGENT_AZD_ENV] : [];
  const result = spawnSync('azd', ['env', 'get-value', 'AZURE_AI_MODEL_DEPLOYMENT_NAME', ...environment].map((arg) => `"${arg}"`), {
    cwd: join(ROOT, 'foundry'),
    encoding: 'utf8',
    shell: true,
    env,
  });
  const name = result.stdout.trim().split('\n')[0];
  if (result.status !== 0 || !name) throw new Error('Could not read AZURE_AI_MODEL_DEPLOYMENT_NAME from the foundry/ azd environment.');
  return name;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new UsageError(`${name} is required for --live (or pass --azd-env)`);
  return value;
}

async function request(url, { token, method = 'GET', body, timeoutMs = 60_000 } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response;
}

async function json(url, options) {
  const response = await request(url, options);
  if (!response.ok) throw new Error(`${options?.method ?? 'GET'} ${new URL(url).pathname} returned ${response.status}`);
  return response.json();
}

function liveSource(config) {
  const subscription = requireEnv('AZURE_SUBSCRIPTION_ID');
  const resourceGroup = requireEnv('AZURE_RESOURCE_GROUP');
  const apiBase = (process.env.API_BASE_URL ?? requireEnv('SERVICE_API_ENDPOINT_URL')).replace(/\/$/, '');
  const arm = 'https://management.azure.com';
  const tokens = new Map();
  const token = (resource) => {
    if (!tokens.has(resource)) {
      tokens.set(resource, az(['account', 'get-access-token', '--resource', resource, '--subscription', subscription, '--query', 'accessToken', '-o', 'tsv']));
    }
    return tokens.get(resource);
  };
  const armGet = (path, query) => json(`${arm}${path}?${new URLSearchParams(query)}`, { token: token(`${arm}/`) });
  const rgPath = `/subscriptions/${subscription}/resourceGroups/${resourceGroup}`;

  let account;
  const foundryAccount = async () => {
    account ??= (await armGet(`${rgPath}/providers/Microsoft.CognitiveServices/accounts`, { 'api-version': '2024-10-01' })).value
      .find((item) => item.kind === 'AIServices' && (!process.env.FOUNDRY_ACCOUNT_NAME || item.name === process.env.FOUNDRY_ACCOUNT_NAME));
    if (!account) throw new Error(`No Foundry (AIServices) account found in ${resourceGroup}.`);
    return account;
  };

  const inference = async (name) => {
    const { name: accountName } = await foundryAccount();
    const started = Date.now();
    const response = await request(`https://${accountName}.openai.azure.com/openai/v1/responses`, {
      method: 'POST',
      token: token('https://cognitiveservices.azure.com'),
      body: { model: name, input: REPRESENTATIVE_PROMPT, max_output_tokens: 64 },
    });
    return {
      deployment: name,
      status: response.status,
      durationMs: Date.now() - started,
      retryAfterSeconds: response.headers.get('retry-after') ? Number(response.headers.get('retry-after')) : undefined,
    };
  };

  const tierOf = (name) => (name === config.ptuName ? 'ptu' : name === config.paygName ? 'payg' : undefined);
  // When the API proxies to the Foundry-hosted agent, that agent's deployment serves the model calls;
  // the API's own FOUNDRY_MODEL still labels its audit spans, so both must agree for consistent traces.
  const serving = async () => {
    const info = await json(`${apiBase}/runtime-info`);
    const hosted = info.runtimeMode === 'foundry-hosted-agent';
    const deployment = hosted ? hostedAgentDeployment() : info.modelDeploymentId;
    const tier = tierOf(deployment);
    if (!tier) throw new Error(`The serving model deployment is unexpected: ${deployment ?? 'none'}.`);
    return { tier, deployment, via: info.runtimeMode, apiDeployment: info.modelDeploymentId, consistent: deployment === info.modelDeploymentId };
  };

  const source = {
    name: 'live',
    simulated: false,
    deployments: async () => {
      const { id } = await foundryAccount();
      const items = (await armGet(`${id}/deployments`, { 'api-version': '2024-10-01' })).value;
      const describe = async (name) => {
        const item = items.find((deployment) => deployment.name === name);
        if (!item) return { name, exists: false };
        const state = item.properties?.provisioningState;
        const probe = state === 'Succeeded' ? await inference(name) : undefined;
        return {
          name,
          exists: true,
          state,
          sku: item.sku?.name,
          capacity: item.sku?.capacity,
          inference: probe?.status === 200 ? 'ok' : probe?.status === 429 ? 'throttled' : 'error',
          error: probe && probe.status !== 200 ? `Inference returned ${probe.status}.` : undefined,
        };
      };
      return { payg: await describe(config.paygName), ptu: await describe(config.ptuName) };
    },
    quota: async () => {
      const { location } = await foundryAccount();
      const usages = (await armGet(`/subscriptions/${subscription}/providers/Microsoft.CognitiveServices/locations/${location}/usages`, {
        'api-version': '2024-10-01',
      })).value;
      const usage = usages.find((item) => item.name?.value === `OpenAI.${SUPPORTED.sku}`);
      return usage ? usage.limit - usage.currentValue : 0;
    },
    liveCapacity: async () => {
      const { location } = await foundryAccount();
      const capacities = (await armGet(`/subscriptions/${subscription}/providers/Microsoft.CognitiveServices/modelCapacities`, {
        'api-version': '2024-10-01',
        modelFormat: 'OpenAI',
        modelName: config.model,
        modelVersion: config.version,
      })).value;
      const match = capacities.find(
        (item) => item.location?.toLowerCase() === location.toLowerCase() && item.properties?.skuName === SUPPORTED.sku,
      );
      return match?.properties?.availableCapacity ?? 0;
    },
    activeTier: async () => {
      source.serving = await serving();
      return source.serving.tier;
    },
    conversation: async (tier) => {
      const servedBy = await serving();
      source.serving = servedBy;
      const started = Date.now();
      const response = await request(`${apiBase}/api/chat`, {
        method: 'POST',
        body: { sessionId: `ptu-verify-${tier}-${started}`, message: REPRESENTATIVE_PROMPT },
        timeoutMs: 180_000,
      });
      const text = await response.text();
      const events = text.split('\n').filter((line) => line.startsWith('data:')).map((line) => JSON.parse(line.slice(5)));
      const failure = events.find((event) => event.type === 'error');
      return {
        tier,
        deployment: servedBy.deployment,
        status: failure ? (/429|rate|throttl/i.test(`${failure.code} ${failure.message}`) ? 429 : 500) : response.status,
        durationMs: Date.now() - started,
        completed: events.some((event) => event.type === 'done'),
      };
    },
    modelRun: async (tier) => ({ tier, ...(await inference(tier === 'ptu' ? config.ptuName : config.paygName)) }),
    traces: async (delaySeconds) => {
      const component = (await armGet(`${rgPath}/providers/Microsoft.Insights/components`, { 'api-version': '2020-02-02' })).value[0];
      if (!component) throw new Error(`No Application Insights component found in ${resourceGroup}.`);
      const query = `union requests, dependencies
        | where timestamp > ago(2h)
        | extend op = tostring(customDimensions['gen_ai.operation.name']), model = tostring(customDimensions['gen_ai.request.model'])
        | where isnotempty(op)
        | summarize operations = make_set(op), models = make_set_if(model, isnotempty(model)) by operation_Id`;
      const deadline = Date.now() + delaySeconds * 1000;
      let waited = false;
      for (;;) {
        const result = await json(`https://api.applicationinsights.io/v1/apps/${component.properties.AppId}/query`, {
          method: 'POST',
          token: token('https://api.applicationinsights.io'),
          body: { query },
        });
        // The query API returns dynamic (make_set) columns as JSON strings.
        const list = (value) => (typeof value === 'string' ? JSON.parse(value) : value ?? []);
        const rows = result.tables[0].rows.map(([, operations, models]) => ({ operations: list(operations), models: list(models) }));
        const forTier = (name) => {
          const matching = rows.filter((row) => row.models.includes(name));
          return matching.find(correlated) ?? matching[0];
        };
        const payg = forTier(config.paygName);
        const ptu = forTier(config.ptuName);
        if (payg && ptu) return { waited, available: true, payg, ptu };
        if (Date.now() >= deadline) return { waited, available: false };
        waited = true;
        await sleep(30_000);
      }
    },
    utilization: async () => {
      const { id } = await foundryAccount();
      const metrics = await armGet(`${id}/providers/Microsoft.Insights/metrics`, {
        'api-version': '2023-10-01',
        metricnames: UTILIZATION_METRIC,
        aggregation: 'Average,Maximum',
        interval: 'PT1M',
        timespan: 'PT2H',
        $filter: `ModelDeploymentName eq '${config.ptuName}'`,
      });
      return (metrics.value[0]?.timeseries ?? [])
        .flatMap((series) => series.data)
        .filter((point) => point.average !== undefined || point.maximum !== undefined)
        .map(({ timeStamp, average, maximum }) => ({ timestamp: timeStamp, average, maximum }));
    },
  };
  return source;
}

// ─────────────────────────────── decision engine ───────────────────────────────

const healthy = (deployment, sku) => Boolean(deployment?.exists && deployment.state === 'Succeeded' && deployment.inference === 'ok' && deployment.sku === sku);
const correlated = (spans) => ['invoke_agent', 'chat', 'execute_tool'].every((op) => spans?.operations.includes(op));

async function verify(mode, requested, config, source) {
  const evidence = {
    mode,
    source: source.name,
    simulated: source.simulated,
    model: config.model,
    version: config.version,
    ptuCapacity: config.capacity,
    priceApproved: config.priceApproved,
    reservationPurchased: false,
    changedDeployments: 0,
  };
  const block = (reason, extra = {}) => Object.assign(evidence, { allowed: false, reason, ...extra });
  const deploymentsOnce = (() => {
    let cache;
    return async () => (cache ??= await source.deployments());
  })();
  const health = async () => {
    const deployments = await deploymentsOnce();
    Object.assign(evidence, {
      paygHealthy: healthy(deployments.payg, 'GlobalStandard'),
      ptuHealthy: healthy(deployments.ptu, SUPPORTED.sku),
      ptuRemovable: Boolean(deployments.ptu.exists),
      deployments,
    });
    if (deployments.ptu.exists && deployments.ptu.capacity !== undefined) evidence.ptuCapacity = deployments.ptu.capacity;
    return deployments;
  };
  const resolveTier = async (wanted) => {
    const tier = wanted ?? (await source.activeTier(requested));
    if (tier === 'ptu' && !evidence.ptuHealthy) return 'payg';
    return tier;
  };

  switch (mode) {
    case 'plan':
    case 'validate': {
      const invalid = invalidFields(config);
      Object.assign(evidence, { activeDeployment: requested ?? config.defaultTier, invalid, verificationComplete: true });
      if (invalid.length) block('invalid-configuration');
      else evidence.allowed = true;
      break;
    }
    case 'preflight':
    case 'price-gate': {
      evidence.activeDeployment = 'payg';
      const invalid = invalidFields(config);
      const [quota, capacity] = [await source.quota(), await source.liveCapacity()];
      Object.assign(evidence, { quotaAvailable: quota, liveCapacity: capacity, requiredPtus: config.capacity, verificationComplete: true });
      if (invalid.length) block('invalid-configuration', { invalid });
      else if (quota < config.capacity) block('insufficient-quota');
      else if (capacity < config.capacity) block('insufficient-live-capacity');
      else if (!config.priceApproved) {
        block('price-approval-required', {
          nextStep: 'Confirm the hourly price for the deployment in the Foundry portal, then set PTU_PRICE_APPROVED=true.',
        });
      } else evidence.allowed = true;
      break;
    }
    case 'payg-health':
    case 'ptu-health':
    case 'deployment-health': {
      await health();
      evidence.activeDeployment = await resolveTier(requested);
      evidence.allowed = mode === 'payg-health' ? evidence.paygHealthy : mode === 'ptu-health' ? evidence.ptuHealthy : evidence.paygHealthy && evidence.ptuHealthy;
      evidence.verificationComplete = true;
      break;
    }
    case 'post-provision': {
      const deployments = await health();
      evidence.activeDeployment = 'payg';
      evidence.verificationComplete = true;
      if (deployments.ptu.exists && deployments.ptu.state !== 'Succeeded') {
        block('provisioning-failed', { failureReported: true, error: deployments.ptu.error ?? `Provisioning state ${deployments.ptu.state}.` });
      } else if (!config.priceApproved) block('price-approval-required');
      else if (!evidence.ptuHealthy) block('ptu-unhealthy', { failureReported: true, error: deployments.ptu.error });
      else if (!evidence.paygHealthy) block('payg-unhealthy');
      else evidence.allowed = true;
      break;
    }
    case 'switch': {
      await health();
      // A bare `switch` is the demonstration's PAYG → PTU move; rollback passes --deployment payg.
      const target = requested ?? 'ptu';
      evidence.verificationComplete = true;
      if (target === 'ptu' && !evidence.ptuHealthy) {
        block('ptu-unhealthy', { activeDeployment: 'payg' });
      } else if (target === 'payg' && !evidence.paygHealthy) {
        block('payg-unhealthy', { activeDeployment: await source.activeTier(requested) });
      } else {
        const actual = await source.activeTier(target);
        const consistent = source.serving?.consistent !== false;
        Object.assign(evidence, { allowed: actual === target && consistent, activeDeployment: actual, serving: source.serving });
        if (actual !== target || !consistent) {
          const name = target === 'ptu' ? config.ptuName : config.paygName;
          evidence.reason = actual !== target ? 'configuration-not-applied' : 'api-and-hosted-agent-differ';
          evidence.nextStep =
            `Hosted agent: (cd foundry) azd env set AZURE_AI_MODEL_DEPLOYMENT_NAME ${name} && azd deploy waypoint-agent; ` +
            `API: azd env set USE_FOUNDRY_PTU ${target === 'ptu'} && azd up`;
        }
      }
      break;
    }
    case 'conversation':
    case 'ptu-traffic': {
      await health();
      const tier = await resolveTier(mode === 'ptu-traffic' ? 'ptu' : requested);
      const run = await source.conversation(tier);
      const expected = tier === 'ptu' ? config.ptuName : config.paygName;
      Object.assign(evidence, {
        activeDeployment: tier,
        run,
        ...(source.serving ? { serving: source.serving } : {}),
        conversationSucceeded: run.status === 200 && run.completed !== false && run.deployment === expected,
        implementationUnchanged: implementationUnchanged(),
        verificationComplete: true,
      });
      evidence.ptuRemovable = evidence.ptuRemovable && tier !== 'ptu';
      evidence.allowed = evidence.conversationSucceeded && (mode !== 'ptu-traffic' || tier === 'ptu');
      if (mode === 'ptu-traffic' && tier !== 'ptu') evidence.reason = 'ptu-unhealthy';
      break;
    }
    case 'comparison': {
      const results = [await source.modelRun('payg'), await source.modelRun('ptu')];
      const throttled = results.filter((result) => result.status === 429);
      const utilization = await source.utilization();
      Object.assign(evidence, {
        activeDeployment: requested ?? 'payg',
        results,
        conversationSucceeded: results.every((result) => result.status === 200),
        throttled: throttled.length > 0,
        throttlingRecorded: throttled.every((result) => results.includes(result)),
        utilizationRetained: utilization.length > 0,
        utilization,
        verificationComplete: true,
      });
      evidence.allowed = evidence.conversationSucceeded;
      if (!evidence.allowed) evidence.reason = evidence.throttled ? 'throttled' : 'model-run-failed';
      break;
    }
    case 'traces': {
      const traces = await source.traces(config.telemetryDelaySeconds);
      evidence.waitedForTelemetry = traces.waited || !traces.available;
      if (!traces.available) {
        Object.assign(evidence, { tracesCorrelated: false, verificationComplete: false });
        block('telemetry-not-ingested', { telemetryDelaySeconds: config.telemetryDelaySeconds });
        break;
      }
      const ptuIdentified = traces.ptu.models.includes(config.ptuName);
      Object.assign(evidence, {
        tracesCorrelated: correlated(traces.payg) && correlated(traces.ptu),
        traceDeployment: ptuIdentified ? 'ptu' : traces.ptu.models.includes(config.paygName) ? 'payg' : undefined,
        spans: { payg: traces.payg, ptu: traces.ptu },
      });
      evidence.verificationComplete = evidence.tracesCorrelated && ptuIdentified;
      if (evidence.verificationComplete) evidence.allowed = true;
      else block(evidence.tracesCorrelated ? 'ptu-deployment-not-identified' : 'trace-correlation-missing');
      break;
    }
    case 'utilization': {
      const utilization = await source.utilization();
      Object.assign(evidence, {
        metric: UTILIZATION_METRIC,
        utilization,
        utilizationObserved: utilization.length > 0,
        verificationComplete: true,
      });
      evidence.allowed = evidence.utilizationObserved;
      break;
    }
    case 'cleanup': {
      const deployments = await health();
      const active = await source.activeTier(requested);
      Object.assign(evidence, { activeDeployment: active, ptuDeleted: !deployments.ptu.exists, verificationComplete: true });
      if (deployments.ptu.exists) {
        block(active === 'ptu' ? 'ptu-still-active' : 'ptu-still-deployed', {
          nextStep:
            'Switch to PAYG first, then set DEPLOY_FOUNDRY_PTU=false and delete the deployment: ' +
            `az cognitiveservices account deployment delete -g <resource-group> -n <foundry-account> --deployment-name ${config.ptuName}`,
        });
      } else evidence.allowed = evidence.paygHealthy;
      break;
    }
    default:
      throw new UsageError(`Unsupported mode ${mode}`);
  }
  return evidence;
}

function summary(evidence) {
  const lines = [`PTU verification (${evidence.mode}) — ${evidence.simulated ? 'SIMULATED evidence, not Azure' : 'live Azure evidence'}`];
  lines.push(`Result: ${evidence.allowed ? 'PASS' : `BLOCKED${evidence.reason ? ` (${evidence.reason})` : ''}`}`);
  for (const key of ['activeDeployment', 'quotaAvailable', 'liveCapacity', 'requiredPtus', 'paygHealthy', 'ptuHealthy', 'ptuCapacity', 'priceApproved', 'tracesCorrelated', 'utilizationObserved', 'ptuDeleted']) {
    if (evidence[key] !== undefined) lines.push(`  ${key}: ${evidence[key]}`);
  }
  if (evidence.nextStep) lines.push(`Next step: ${evidence.nextStep}`);
  return `${lines.join('\n')}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.azdEnv) loadAzdEnvironment();
  const fixture = FIXTURES[args.fixture ?? 'healthy'];
  const config = configuration(fixture);
  const source = args.live ? liveSource(config) : simulatedSource(config, args.fixture);
  const evidence = await verify(args.mode, args.deployment, config, source);
  process.stdout.write(args.json ? `${JSON.stringify(evidence, (_key, value) => (value === Number.POSITIVE_INFINITY ? 'Infinity' : value), 2)}\n` : summary(evidence));
}

main().catch((error) => {
  process.stderr.write(`verify-ptu-demo: ${error.message}\n`);
  process.exit(error instanceof UsageError ? 64 : 2);
});
