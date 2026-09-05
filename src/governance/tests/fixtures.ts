import type { ControlCatalogue, PropositionDeclaration } from '../src/types.js';

/** Minimal synthetic catalogue + proposition used by the engine unit tests. */
export function sampleCatalogue(): ControlCatalogue {
  return {
    schema: 'waypoint.governance/catalogue@1',
    synthetic: true,
    disclaimer: 'Synthetic demonstration content. Not actual organisational policy.',
    catalogueId: 'waypoint-synthetic',
    version: '1.0.0',
    policySources: [
      {
        id: 'SYN-POL-SEC',
        owner: 'Demo Governance (synthetic)',
        provenance: 'repository-local synthetic policy',
        version: '1.0.0',
        effectiveDate: '2026-01-01',
        status: 'active',
        sourceRef: 'synthetic://policies/security',
        permissionClassification: 'internal-demo',
        applicability: 'AI propositions using LLMs',
      },
      {
        id: 'SYN-POL-DRAFT',
        owner: 'Demo Governance (synthetic)',
        provenance: 'repository-local synthetic policy',
        version: '0.1.0',
        effectiveDate: '2026-06-01',
        status: 'draft',
        sourceRef: 'synthetic://policies/draft',
        permissionClassification: 'internal-demo',
        applicability: 'draft rules',
      },
    ],
    controls: [
      {
        id: 'SEC-MCP-001',
        title: 'MCP tools declared and allowlisted',
        category: 'security',
        description: 'All MCP tools the agent can call are declared and allowlisted.',
        policyRef: 'SYN-POL-SEC',
        obligation: 'Every configured/effective tool must be in the approved allowlist.',
        enforcementStage: 'release',
        severity: 'blocking',
        appliesWhen: [{ field: 'externalIntegrations', op: 'contains', value: 'mcp' }],
        rationaleTemplate: 'Applies because {matched}.',
        evidenceRequirements: [
          { evidenceId: 'mcp-allowlist', evidenceType: 'mcp-allowlist', descriptor: 'configured vs approved tools' },
        ],
      },
      {
        id: 'RAI-HITL-001',
        title: 'Explicit approval before consequential action',
        category: 'responsible-ai',
        description: 'Consequential actions require explicit human approval.',
        policyRef: 'SYN-POL-SEC',
        obligation: 'A consequential action must not execute without an approval bound to it.',
        enforcementStage: 'runtime',
        severity: 'blocking',
        appliesWhen: [{ field: 'humanInLoop', op: 'isTrue' }],
        rationaleTemplate: 'Applies because {matched}.',
        evidenceRequirements: [
          { evidenceId: 'booking-approval-test', evidenceType: 'test-result', descriptor: 'human-approval behavioural test' },
        ],
      },
      {
        id: 'OPS-TRACE-001',
        title: 'Runtime activity carries a correlation id',
        category: 'operations',
        description: 'Runtime activity is correlated for observability.',
        policyRef: 'SYN-POL-SEC',
        obligation: 'Each turn carries a correlation id.',
        enforcementStage: 'runtime',
        severity: 'advisory',
        appliesWhen: [{ field: 'usesLLM', op: 'isTrue' }],
        rationaleTemplate: 'Applies because {matched}.',
        evidenceRequirements: [
          { evidenceId: 'trace-check', evidenceType: 'config-check', descriptor: 'correlation id present' },
        ],
      },
      {
        id: 'DATA-MIN-001',
        title: 'Personal-data minimisation declared',
        category: 'data',
        description: 'Personal-data use is declared and minimised.',
        policyRef: 'SYN-POL-SEC',
        obligation: 'Proposition declares personal-data handling and minimises collection.',
        enforcementStage: 'build',
        severity: 'blocking',
        appliesWhen: [{ field: 'handlesPersonalData', op: 'isTrue' }],
        rationaleTemplate: 'Applies because {matched}.',
        evidenceRequirements: [
          { evidenceId: 'data-min-check', evidenceType: 'config-check', descriptor: 'data minimisation' },
        ],
      },
    ],
  };
}

export function sampleProposition(): PropositionDeclaration {
  return {
    schema: 'waypoint.governance/proposition@1',
    propositionId: 'waypoint',
    title: 'Waypoint holiday-planning agent',
    version: '1.0.0',
    accountableOwner: 'Demo Proposition Owner (placeholder)',
    sourceRequirementRef: 'specs/prd.md',
    prdRequirementIds: ['PRD-1'],
    approvedTools: ['routestack', 'open-meteo', 'currency', 'cosmos', 'travel-guide'],
    characteristics: {
      usesLLM: true,
      handlesPersonalData: true,
      dataClassification: 'confidential',
      autonomyLevel: 'supervised',
      consequentialActions: ['simulated-booking'],
      financialTransactions: 'simulated',
      externalIntegrations: ['mcp'],
      humanInLoop: true,
      retrievalAugmented: true,
      deploymentSurface: ['azure-container-apps', 'foundry-agent-service'],
    },
    unresolved: [],
  };
}
