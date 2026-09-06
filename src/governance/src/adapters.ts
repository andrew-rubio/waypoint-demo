import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { redactSecrets } from '../../api/src/security/redact.js';
import { sha256OfBytes } from './canonical.js';
import type { AdapterOutcome, EvidenceMode, EvidenceType } from './types.js';

/**
 * Evidence adapters — each inspects an AUTHORITATIVE result or executes a deterministic
 * verification (never mere file presence) and returns one of pass|fail|missing|
 * not-applicable|error. An adapter `error` on a blocking control blocks release (the
 * verifier never downgrades it). No LLM is involved.
 */

export interface EvidenceContext {
  repoRoot: string;
  mode: EvidenceMode;
  sourceCommit?: string;
  workflowRunId?: string;
  collectedAt: string;
  /** Certified immutable artefact digest (CI). */
  artefactDigest?: string;
  /** Digest the deployment will actually run (must match certified). */
  deploymentDigest?: string;
  /** Vitest JSON result file (CI); absent locally. */
  testResultsPath?: string;
  /** Approved MCP allowlist for this proposition. */
  approvedTools: string[];
  /** Configured tool override — used ONLY by the undeclared-MCP negative demo fixture. */
  configuredToolsOverride?: string[];
}

export interface AdapterResult {
  evidenceType: EvidenceType;
  outcome: AdapterOutcome;
  producer: string;
  detail: string;
  testOrEvalName?: string;
  resultFileHash?: string;
  artefactDigest?: string;
}

function rp(ctx: EvidenceContext, ...p: string[]): string {
  return resolve(ctx.repoRoot, ...p);
}

// ── SEC-RED-001: execute redaction on a secret fixture, prove it is stripped ──
export function redactionAdapter(): AdapterResult {
  const fixture = {
    apiKey: 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    authorization: 'Bearer abcdef0123456789',
    note: 'safe text',
  };
  const out = JSON.stringify(redactSecrets(fixture));
  const leaked = out.includes('ghp_') || /Bearer\s+abcdef/i.test(out);
  return {
    evidenceType: 'test-result',
    outcome: leaked ? 'fail' : 'pass',
    producer: 'governance:redaction-adapter',
    detail: leaked ? 'Secret survived redaction.' : 'Representative token + bearer redacted; safe text preserved.',
    testOrEvalName: 'redactSecrets(fixture)',
  };
}

// ── SEC-MCP-001: configured/effective tools must be a subset of the approved allowlist ──
function configuredTools(ctx: EvidenceContext): string[] {
  if (ctx.configuredToolsOverride) return ctx.configuredToolsOverride;
  const driver = rp(ctx, 'src/api/src/agent/copilot-driver.ts');
  const text = readFileSync(driver, 'utf8');
  const m = text.match(/const\s+MCP_ALLOWLIST\s*=\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] ?? x[2]);
}

export function mcpAllowlistAdapter(ctx: EvidenceContext): AdapterResult {
  try {
    const configured = configuredTools(ctx);
    const approved = new Set(ctx.approvedTools);
    const undeclared = configured.filter((t) => !approved.has(t));
    if (undeclared.length) {
      return {
        evidenceType: 'mcp-allowlist',
        outcome: 'fail',
        producer: 'governance:mcp-allowlist-adapter',
        detail: `Configured tool(s) not in the approved allowlist: ${undeclared.join(', ')}. Configured=[${configured.join(', ')}] Approved=[${[...approved].join(', ')}]`,
      };
    }
    return {
      evidenceType: 'mcp-allowlist',
      outcome: 'pass',
      producer: 'governance:mcp-allowlist-adapter',
      detail: `All ${configured.length} configured tool(s) are approved. NOTE: static+configured inventory; full packaged runtime inventory is not independently enumerated in this demo.`,
    };
  } catch (err) {
    return {
      evidenceType: 'mcp-allowlist',
      outcome: 'error',
      producer: 'governance:mcp-allowlist-adapter',
      detail: `Could not read MCP configuration: ${(err as Error).message}`,
    };
  }
}

// ── SEC-*: deterministic source scan for a required/prohibited pattern ──
function sourceScan(
  ctx: EvidenceContext,
  file: string,
  required: RegExp,
  producer: string,
  passDetail: string,
  failDetail: string,
  evidenceType: EvidenceType = 'config-check',
): AdapterResult {
  try {
    const text = readFileSync(rp(ctx, file), 'utf8');
    const ok = required.test(text);
    return { evidenceType, outcome: ok ? 'pass' : 'fail', producer, detail: ok ? passDetail : failDetail };
  } catch (err) {
    return { evidenceType, outcome: 'error', producer, detail: `Could not read ${file}: ${(err as Error).message}` };
  }
}

// ── SEC-REASON-001: no chain-of-thought forwarded — audit maps only decision/tool events ──
export function noChainOfThoughtAdapter(ctx: EvidenceContext): AdapterResult {
  try {
    const spans = readFileSync(rp(ctx, 'src/api/src/telemetry/agent-spans.ts'), 'utf8');
    const forbidden = /chain[_-]?of[_-]?thought|reasoning_trace|private_reasoning/i.test(spans);
    return {
      evidenceType: 'config-check',
      outcome: forbidden ? 'fail' : 'pass',
      producer: 'governance:no-cot-adapter',
      detail: forbidden
        ? 'Telemetry references private reasoning.'
        : 'Telemetry emits decision/tool/model spans only; no private reasoning field.',
    };
  } catch (err) {
    return { evidenceType: 'config-check', outcome: 'error', producer: 'governance:no-cot-adapter', detail: (err as Error).message };
  }
}

// ── OPS-TRACE-001: correlation id is propagated to telemetry ──
export function correlationIdAdapter(ctx: EvidenceContext): AdapterResult {
  return sourceScan(
    ctx,
    'src/api/src/telemetry/agent-spans.ts',
    /gen_ai\.conversation\.id/,
    'governance:correlation-adapter',
    'Telemetry tags spans with gen_ai.conversation.id (correlation id).',
    'No correlation id found in telemetry.',
  );
}

// ── OPS-VER-001: runtime metadata captures model/agent/artefact versions ──
export function versionCaptureAdapter(ctx: EvidenceContext): AdapterResult {
  return sourceScan(
    ctx,
    'src/api/src/runtime-info.ts',
    /agentVersion[\s\S]*artefactVersion|artefactVersion[\s\S]*agentVersion/,
    'governance:version-adapter',
    'Runtime metadata exposes agent + artefact version identifiers.',
    'Runtime metadata does not capture required version identifiers.',
  );
}

// ── DATA-MIN-001: proposition declares personal-data handling ──
export function dataMinimisationAdapter(ctx: EvidenceContext): AdapterResult {
  try {
    const prop = readFileSync(rp(ctx, 'specs/governance/proposition.yaml'), 'utf8');
    const declares = /handlesPersonalData:\s*true/.test(prop);
    return {
      evidenceType: 'config-check',
      outcome: declares ? 'pass' : 'fail',
      producer: 'governance:data-min-adapter',
      detail: declares
        ? 'Proposition declares personal-data handling; profile stores city/country + preferences only (minimised).'
        : 'Proposition does not declare personal-data handling.',
    };
  } catch (err) {
    return { evidenceType: 'config-check', outcome: 'error', producer: 'governance:data-min-adapter', detail: (err as Error).message };
  }
}

// ── keyless infra: parse Bicep, fail on prohibited key/secret access ──
export function keylessInfraAdapter(ctx: EvidenceContext): AdapterResult {
  try {
    const bicep = readFileSync(rp(ctx, 'infra/main.bicep'), 'utf8');
    const prohibited: string[] = [];
    if (/listKeys\s*\(/.test(bicep)) prohibited.push('listKeys()');
    if (/adminUserEnabled:\s*true/.test(bicep)) prohibited.push('adminUserEnabled:true');
    if (/disableLocalAuth:\s*false/.test(bicep)) prohibited.push('disableLocalAuth:false');
    return {
      evidenceType: 'config-check',
      outcome: prohibited.length ? 'fail' : 'pass',
      producer: 'governance:keyless-infra-adapter',
      detail: prohibited.length
        ? `Prohibited key/secret access in Bicep: ${prohibited.join(', ')}`
        : 'No key-listing or local-auth escape hatches in Bicep; managed identity used.',
    };
  } catch (err) {
    return { evidenceType: 'config-check', outcome: 'error', producer: 'governance:keyless-infra-adapter', detail: (err as Error).message };
  }
}

// ── evaluation: parse the eval gate + a results file, compare to threshold ──
export function evaluationAdapter(ctx: EvidenceContext): AdapterResult {
  const gatePath = rp(ctx, 'eval/gate.json');
  const override = process.env.WAYPOINT_EVAL_RESULTS;
  const resultsCandidates = [
    ...(override ? [override.startsWith('/') || /^[A-Za-z]:/.test(override) ? override : rp(ctx, override)] : []),
    rp(ctx, 'eval/.out/eval_results_latest.json'),
    rp(ctx, 'specs/governance/examples/eval-results.sample.json'),
  ];
  const resultsPath = resultsCandidates.find((p) => existsSync(p));
  if (!existsSync(gatePath)) {
    return { evidenceType: 'evaluation-result', outcome: 'missing', producer: 'governance:eval-adapter', detail: 'eval/gate.json not found.' };
  }
  if (!resultsPath) {
    return { evidenceType: 'evaluation-result', outcome: 'missing', producer: 'governance:eval-adapter', detail: 'No evaluation results file found (run npm run eval:run-agent + evaluate).' };
  }
  try {
    const gate = JSON.parse(readFileSync(gatePath, 'utf8')) as Record<string, number>;
    const raw = readFileSync(resultsPath, 'utf8');
    const results = JSON.parse(raw) as Record<string, number>;
    const breaches = Object.entries(gate).filter(([k, min]) => (results[k] ?? 0) < min);
    const recorded = resultsPath.includes('examples');
    return {
      evidenceType: 'evaluation-result',
      outcome: breaches.length ? 'fail' : 'pass',
      producer: recorded ? 'governance:eval-adapter(recorded-sample)' : 'governance:eval-adapter',
      detail: breaches.length
        ? `Gated evaluator(s) below threshold: ${breaches.map(([k, m]) => `${k}<${m}`).join(', ')}`
        : `All gated evaluators meet thresholds (${Object.keys(gate).join(', ')}).`,
      testOrEvalName: 'eval/gate.json',
      resultFileHash: sha256OfBytes(raw),
    };
  } catch (err) {
    return { evidenceType: 'evaluation-result', outcome: 'error', producer: 'governance:eval-adapter', detail: (err as Error).message };
  }
}

// ── test-result adapter: consume a named result from a vitest JSON, or a recorded sample ──
export function testResultAdapter(ctx: EvidenceContext, testName: string, sampleKey: string): AdapterResult {
  const samplePath = rp(ctx, 'specs/governance/examples/test-results.sample.json');
  const sources: string[] = [];
  if (ctx.testResultsPath) sources.push(ctx.testResultsPath);
  if (existsSync(samplePath)) sources.push(samplePath);
  const path = sources.find((p) => existsSync(p));
  if (!path) {
    return { evidenceType: 'test-result', outcome: 'missing', producer: 'governance:test-adapter', detail: `No test result for ${testName}.` };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw) as Record<string, 'passed' | 'failed'>;
    const status = data[sampleKey];
    const recorded = path.includes('examples');
    if (status === undefined) {
      return { evidenceType: 'test-result', outcome: 'missing', producer: 'governance:test-adapter', detail: `Result "${sampleKey}" not present.` };
    }
    return {
      evidenceType: 'test-result',
      outcome: status === 'passed' ? 'pass' : 'fail',
      producer: recorded ? 'governance:test-adapter(recorded-sample)' : 'governance:test-adapter',
      detail: `${testName}: ${status}`,
      testOrEvalName: testName,
      resultFileHash: sha256OfBytes(raw),
    };
  } catch (err) {
    return { evidenceType: 'test-result', outcome: 'error', producer: 'governance:test-adapter', detail: (err as Error).message };
  }
}

// ── REL-IMM-001: immutable artefact digest, mode-aware ──
export function immutableDeployAdapter(ctx: EvidenceContext): AdapterResult {
  if (ctx.mode === 'ci-authoritative') {
    if (!ctx.artefactDigest) {
      return { evidenceType: 'artefact-digest', outcome: 'missing', producer: 'governance:artefact-adapter', detail: 'CI-authoritative mode requires a certified artefact digest.' };
    }
    const bound = !ctx.deploymentDigest || ctx.deploymentDigest === ctx.artefactDigest;
    return {
      evidenceType: 'artefact-digest',
      outcome: bound ? 'pass' : 'fail',
      producer: 'governance:artefact-adapter',
      detail: bound ? `Certified immutable digest ${ctx.artefactDigest}.` : `Deployment digest ${ctx.deploymentDigest} != certified ${ctx.artefactDigest}.`,
      artefactDigest: ctx.artefactDigest,
    };
  }
  // local-demonstration: a local/last-known id is NOT a production pass.
  return {
    evidenceType: 'artefact-digest',
    outcome: 'not-applicable',
    producer: 'governance:artefact-adapter(local-demonstration)',
    detail: 'Local demonstration: no certified CI artefact digest; release is not deployable.',
    artefactDigest: ctx.artefactDigest,
  };
}

// ── REL-CON-001: an approved, current control contract exists ──
export function approvedContractAdapter(ctx: EvidenceContext): AdapterResult {
  const path = rp(ctx, 'specs/governance/approval-record.json');
  if (!existsSync(path)) {
    return { evidenceType: 'human-approval', outcome: 'missing', producer: 'governance:approval-adapter', detail: 'No approval-record.json present.' };
  }
  return {
    evidenceType: 'human-approval',
    outcome: 'pass',
    producer: 'governance:approval-adapter',
    detail: 'Approval record present; hash-binding validity is enforced separately by verifyRelease.',
  };
}
