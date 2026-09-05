import { activeDriverKind } from './agent/runtime.js';
import { foundryAgentUrl } from './agent/foundry-agent-proxy.js';

/**
 * Non-sensitive runtime metadata for the D1 "runtime proof" corroboration chain
 * (FRD-010 / ADR-012). This endpoint and the UI badge are application-controlled
 * assertions and are deliberately NOT the sole proof of Foundry-hosted execution — the
 * demo also corroborates via the correlation-id trace in Application Insights and the
 * Foundry/Azure portal. Exposes only safe operational metadata; never credentials,
 * connection strings, tokens, prompts or private reasoning.
 */

export type RuntimeMode = 'foundry-hosted-agent' | 'foundry-model-sdk' | 'local-deterministic';
export type DriverLabel = 'Foundry hosted agent' | 'Local deterministic driver' | 'Unknown or unavailable';

const AGENT_VERSION = process.env.WAYPOINT_AGENT_VERSION ?? 'waypoint-agent@1.0.0';
const ARTEFACT_VERSION = process.env.WAYPOINT_ARTEFACT_DIGEST ?? process.env.WAYPOINT_ARTEFACT_VERSION ?? 'local-build';
const SOURCE_COMMIT = process.env.WAYPOINT_SOURCE_COMMIT ?? 'unknown';
const APPROVED_TOOL_IDS = ['routestack', 'open-meteo', 'currency', 'cosmos', 'travel-guide'];

let lastCorrelationId: string | undefined;
export function setLastCorrelationId(id: string): void {
  lastCorrelationId = id;
}

/** Resolve the ACTUAL runtime mode from the selected path (not a lone env var). */
export function resolveRuntimeMode(): RuntimeMode {
  if (foundryAgentUrl()) return 'foundry-hosted-agent';
  return activeDriverKind() === 'foundry-model-sdk' ? 'foundry-model-sdk' : 'local-deterministic';
}

/**
 * Badge label. Only the hosted-agent path claims "Foundry hosted agent"; the local
 * fallback is unmistakable; the SDK-with-model path is reported as unverified because the
 * hosted-agent boundary is what the demo independently corroborates.
 */
export function driverLabel(mode: RuntimeMode = resolveRuntimeMode()): DriverLabel {
  if (mode === 'foundry-hosted-agent') return 'Foundry hosted agent';
  if (mode === 'local-deterministic') return 'Local deterministic driver';
  return 'Unknown or unavailable';
}

export interface RuntimeInfo {
  propositionId: string;
  runtimeMode: RuntimeMode;
  driverLabel: DriverLabel;
  agentVersion: string;
  artefactVersion: string;
  sourceCommit: string;
  environment: string;
  evidenceMode: 'ci-authoritative' | 'local-demonstration';
  approvedToolIds: string[];
  correlationId?: string;
  modelDeploymentId?: string;
  foundryProject?: string;
  runtimeProofNote: string;
}

export function getRuntimeInfo(): RuntimeInfo {
  const mode = resolveRuntimeMode();
  const model = process.env.FOUNDRY_MODEL ?? process.env.WAYPOINT_MODEL ?? process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME;
  const projectEndpoint = process.env.FOUNDRY_PROJECT_ENDPOINT ?? process.env.AZURE_AI_PROJECT_ENDPOINT;
  const foundryProject = projectEndpoint ? new URL(projectEndpoint).pathname.split('/').filter(Boolean).pop() : undefined;
  return {
    propositionId: 'waypoint',
    runtimeMode: mode,
    driverLabel: driverLabel(mode),
    agentVersion: AGENT_VERSION,
    artefactVersion: ARTEFACT_VERSION,
    sourceCommit: SOURCE_COMMIT,
    environment: process.env.WAYPOINT_ENVIRONMENT ?? (process.env.NODE_ENV ?? 'development'),
    evidenceMode: process.env.GITHUB_ACTIONS ? 'ci-authoritative' : 'local-demonstration',
    approvedToolIds: APPROVED_TOOL_IDS,
    correlationId: lastCorrelationId,
    modelDeploymentId: model,
    foundryProject,
    runtimeProofNote:
      mode === 'foundry-hosted-agent'
        ? 'Turns are proxied to the Foundry-hosted agent. Corroborate via the correlation-id trace in Application Insights and the Foundry portal.'
        : mode === 'local-deterministic'
          ? 'Local deterministic driver active — this is NOT the Foundry-hosted agent.'
          : 'A Foundry model is configured via the SDK, but the hosted-agent boundary is not independently verified for this execution.',
  };
}
