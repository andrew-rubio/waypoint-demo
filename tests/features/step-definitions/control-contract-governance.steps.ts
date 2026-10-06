import { Given, Then, When } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApprovalRecord, checkApproval, type ApprovalCheck } from '../../../src/governance/src/approval.js';
import { mcpAllowlistAdapter, type AdapterResult } from '../../../src/governance/src/adapters.js';
import { buildControlContract } from '../../../src/governance/src/contract.js';
import { selectControls } from '../../../src/governance/src/select.js';
import type {
  AdapterOutcome,
  ApprovalRecord,
  ControlCatalogue,
  ControlContract,
  ControlSelection,
  EvidenceEntry,
  EvidenceManifest,
  PropositionDeclaration,
  ReleaseDecision,
} from '../../../src/governance/src/types.js';
import { verifyRelease } from '../../../src/governance/src/verify.js';
import { sampleCatalogue, sampleProposition } from '../../../src/governance/tests/fixtures.js';
import { runAgent } from '../../../src/api/src/agent/runtime.js';
import { getRuntimeInfo, type RuntimeInfo } from '../../../src/api/src/runtime-info.js';
import type { AgentEvent } from '../../../src/shared/types/chat-and-agent-runtime.js';
import type { CustomWorld } from '../support/world.js';

const SOURCE_COMMIT = 'bdd-governance';
const ARTEFACT_DIGEST = 'sha256:bdd-governance';
const CONFIG_PATH = resolve('src/api/src/agent/copilot-driver.ts');

interface GovernanceState {
  proposition?: PropositionDeclaration;
  catalogue?: ControlCatalogue;
  selectionRuns?: ControlSelection[];
  contract?: ControlContract;
  approval?: ApprovalRecord;
  changedContracts?: ControlContract[];
  changedApprovalChecks?: ApprovalCheck[];
  releaseDecisions?: ReleaseDecision[];
  mcpResult?: AdapterResult;
  configurationBefore?: string;
  events?: AgentEvent[];
  bookingApproved?: boolean;
  runtimeInfo?: RuntimeInfo;
}

type GovernanceWorld = CustomWorld & { governance?: GovernanceState };

function state(world: GovernanceWorld): GovernanceState {
  world.governance ??= {};
  return world.governance;
}

function approvedContract() {
  const proposition = sampleProposition();
  const catalogue = sampleCatalogue();
  const contract = buildControlContract(proposition, catalogue, selectControls(proposition, catalogue), {
    contractVersion: '1.0.0',
    generatedAt: 'FIXED',
  });
  const approval = buildApprovalRecord(contract, proposition, catalogue, {
    approver: 'bdd.user',
    approvalMechanism: 'local-demo',
    identityAssurance: 'self-asserted',
    approvedAt: 'FIXED',
    sourceCommit: SOURCE_COMMIT,
  });
  return { proposition, catalogue, contract, approval };
}

function evidenceEntry(
  controlId: string,
  evidenceId: string,
  outcome: AdapterOutcome,
  extra: Partial<EvidenceEntry> = {},
): EvidenceEntry {
  return {
    controlId,
    evidenceId,
    evidenceType: 'config-check',
    outcome,
    producer: 'cucumber-governance',
    detail: `${evidenceId}:${outcome}`,
    sourceCommit: SOURCE_COMMIT,
    collectedAt: 'FIXED',
    ...extra,
  };
}

function passingManifest(
  contract: ControlContract,
  evidenceMode: EvidenceManifest['evidenceMode'] = 'ci-authoritative',
): EvidenceManifest {
  const entries = contract.material.controls.flatMap((control) =>
    control.evidenceRequirements.map((requirement) =>
      evidenceEntry(control.controlId, requirement.evidenceId, 'pass', {
        evidenceType: requirement.evidenceType,
      }),
    ),
  );
  entries.push(
    evidenceEntry('SEC-MCP-001', 'artefact', 'pass', {
      evidenceType: 'artefact-digest',
      artefactDigest: ARTEFACT_DIGEST,
    }),
  );
  return {
    schema: 'waypoint.governance/evidence@1',
    evidenceSetId: 'bdd-evidence',
    contractHash: contract.contractHash,
    contractVersion: contract.contractVersion,
    evidenceMode,
    sourceCommit: SOURCE_COMMIT,
    environment: 'cucumber',
    generatedAt: 'FIXED',
    entries,
  };
}

async function collectAgentEvents(fault: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runAgent({
    sessionId: 'bdd-governance-session',
    message: 'Book the proposed itinerary',
    history: [],
    fault,
  })) {
    events.push(event);
  }
  return events;
}

function toolResult(events: AgentEvent[], name: string) {
  return events.find(
    (event): event is Extract<AgentEvent, { type: 'tool_result' }> =>
      event.type === 'tool_result' && event.name === name,
  );
}

Given('the Waypoint proposition and the synthetic control catalogue', function (this: GovernanceWorld) {
  const context = state(this);
  context.proposition = sampleProposition();
  context.catalogue = sampleCatalogue();
});

When('control selection runs', function (this: GovernanceWorld) {
  const context = state(this);
  assert(context.proposition && context.catalogue);
  context.selectionRuns = [
    selectControls(context.proposition, context.catalogue),
    selectControls(context.proposition, context.catalogue),
  ];
});

Then('the same applicable controls are selected every time', function (this: GovernanceWorld) {
  const selections = state(this).selectionRuns;
  assert(selections);
  assert.deepEqual(selections[0].selected, selections[1].selected);
  assert.deepEqual(
    selections[0].selected.map((control) => control.controlId),
    ['DATA-MIN-001', 'OPS-TRACE-001', 'RAI-HITL-001', 'SEC-MCP-001'],
  );
});

Then('each selected control records its rationale and matching predicates', function (this: GovernanceWorld) {
  const selection = state(this).selectionRuns?.[0];
  assert(selection);
  assert(selection.selected.every((control) => control.rationale.length > 0));
  assert(selection.selected.every((control) => control.matchedBy.length > 0));
});

Given('an approved control contract', function (this: GovernanceWorld) {
  Object.assign(state(this), approvedContract());
});

Given('an approved contract', function (this: GovernanceWorld) {
  Object.assign(state(this), approvedContract());
});

When(
  'a control obligation, threshold, severity or the proposition changes',
  function (this: GovernanceWorld) {
    const context = state(this);
    assert(context.proposition && context.catalogue && context.approval);

    const changes: Array<{
      proposition: PropositionDeclaration;
      catalogue: ControlCatalogue;
    }> = [];

    const obligationProposition = structuredClone(context.proposition);
    const obligationCatalogue = structuredClone(context.catalogue);
    obligationCatalogue.controls[0].obligation = 'A materially changed obligation.';
    changes.push({ proposition: obligationProposition, catalogue: obligationCatalogue });

    const thresholdProposition = structuredClone(context.proposition);
    const thresholdCatalogue = structuredClone(context.catalogue);
    thresholdCatalogue.controls.find((control) => control.id === 'SEC-MCP-001')!
      .evidenceRequirements[0].threshold = 0.95;
    changes.push({ proposition: thresholdProposition, catalogue: thresholdCatalogue });

    const severityProposition = structuredClone(context.proposition);
    const severityCatalogue = structuredClone(context.catalogue);
    severityCatalogue.controls.find((control) => control.id === 'SEC-MCP-001')!.severity = 'advisory';
    changes.push({ proposition: severityProposition, catalogue: severityCatalogue });

    const changedProposition = structuredClone(context.proposition);
    changedProposition.characteristics.autonomyLevel = 'autonomous';
    changes.push({ proposition: changedProposition, catalogue: structuredClone(context.catalogue) });

    context.changedContracts = changes.map(({ proposition, catalogue }) =>
      buildControlContract(proposition, catalogue, selectControls(proposition, catalogue), {
        contractVersion: '1.0.0',
        generatedAt: 'FIXED',
      }),
    );
    context.changedApprovalChecks = context.changedContracts.map((contract, index) =>
      checkApproval(contract, context.approval, changes[index].proposition, changes[index].catalogue),
    );
  },
);

Then('the contract hash changes', function (this: GovernanceWorld) {
  const context = state(this);
  assert(context.contract && context.changedContracts);
  assert(context.changedContracts.every((contract) => contract.contractHash !== context.contract!.contractHash));
});

Then('the prior approval is no longer valid', function (this: GovernanceWorld) {
  const checks = state(this).changedApprovalChecks;
  assert(checks);
  assert(checks.every((check) => !check.valid));
});

When(
  'a blocking control has missing, failing, errored or foreign-commit evidence',
  function (this: GovernanceWorld) {
    const context = state(this);
    assert(context.proposition && context.catalogue && context.contract && context.approval);

    const target = context.contract.material.controls.find(
      (control) => control.controlId === 'RAI-HITL-001',
    );
    assert(target);
    const evidenceId = target.evidenceRequirements[0].evidenceId;

    const missing = passingManifest(context.contract);
    missing.entries = missing.entries.filter(
      (entry) => !(entry.controlId === target.controlId && entry.evidenceId === evidenceId),
    );

    const failing = passingManifest(context.contract);
    failing.entries.find(
      (entry) => entry.controlId === target.controlId && entry.evidenceId === evidenceId,
    )!.outcome = 'fail';

    const errored = passingManifest(context.contract);
    errored.entries.find(
      (entry) => entry.controlId === target.controlId && entry.evidenceId === evidenceId,
    )!.outcome = 'error';

    const foreignCommit = passingManifest(context.contract);
    foreignCommit.entries.find(
      (entry) => entry.controlId === target.controlId && entry.evidenceId === evidenceId,
    )!.sourceCommit = 'another-commit';

    context.releaseDecisions = [missing, failing, errored, foreignCommit].map((manifest) =>
      verifyRelease({
        proposition: context.proposition!,
        catalogue: context.catalogue!,
        contract: context.contract!,
        approval: context.approval,
        manifest,
        deploymentArtefactDigest: ARTEFACT_DIGEST,
        generatedAt: 'FIXED',
      }),
    );
  },
);

Then('the release decision is blocked', function (this: GovernanceWorld) {
  const decisions = state(this).releaseDecisions;
  assert(decisions);
  assert(decisions.every((decision) => decision.releaseDecision === 'blocked'));
  assert(decisions.every((decision) => !decision.deployable));
});

Then('the failed control and remediation are named', function (this: GovernanceWorld) {
  const decisions = state(this).releaseDecisions;
  assert(decisions);
  assert(
    decisions.every((decision) =>
      decision.blockingFailures.some(
        (failure) => failure.controlId === 'RAI-HITL-001' && Boolean(failure.remediation),
      ),
    ),
  );
});

Given('the approved MCP allowlist', function (this: GovernanceWorld) {
  const context = state(this);
  Object.assign(context, approvedContract());
  context.configurationBefore = readFileSync(CONFIG_PATH, 'utf8');
});

When('an undeclared tool appears in the configuration', function (this: GovernanceWorld) {
  const context = state(this);
  assert(context.proposition && context.catalogue && context.contract && context.approval);
  context.mcpResult = mcpAllowlistAdapter({
    repoRoot: process.cwd(),
    mode: 'local-demonstration',
    sourceCommit: SOURCE_COMMIT,
    collectedAt: 'FIXED',
    approvedTools: context.proposition.approvedTools,
    configuredToolsOverride: [...context.proposition.approvedTools, 'unregistered-booking-provider'],
  });

  const manifest = passingManifest(context.contract);
  const mcpEvidence = manifest.entries.find(
    (entry) => entry.controlId === 'SEC-MCP-001' && entry.evidenceId === 'mcp-allowlist',
  );
  assert(mcpEvidence);
  mcpEvidence.outcome = context.mcpResult.outcome;
  mcpEvidence.detail = context.mcpResult.detail;
  context.releaseDecisions = [
    verifyRelease({
      proposition: context.proposition,
      catalogue: context.catalogue,
      contract: context.contract,
      approval: context.approval,
      manifest,
      deploymentArtefactDigest: ARTEFACT_DIGEST,
      generatedAt: 'FIXED',
    }),
  ];
});

Then('release is blocked naming SEC-MCP-001', function (this: GovernanceWorld) {
  const decision = state(this).releaseDecisions?.[0];
  assert.equal(decision?.releaseDecision, 'blocked');
  assert(decision.blockingFailures.some((failure) => failure.controlId === 'SEC-MCP-001'));
});

Then('the repository is left in a valid state', function (this: GovernanceWorld) {
  const context = state(this);
  assert.equal(context.mcpResult?.outcome, 'fail');
  assert.equal(readFileSync(CONFIG_PATH, 'utf8'), context.configurationBefore);
});

Given(
  'all blocking controls pass with local-demonstration evidence',
  function (this: GovernanceWorld) {
    Object.assign(state(this), approvedContract());
  },
);

When('verification runs', function (this: GovernanceWorld) {
  const context = state(this);
  assert(context.proposition && context.catalogue && context.contract && context.approval);
  context.releaseDecisions = [
    verifyRelease({
      proposition: context.proposition,
      catalogue: context.catalogue,
      contract: context.contract,
      approval: context.approval,
      manifest: passingManifest(context.contract, 'local-demonstration'),
      generatedAt: 'FIXED',
    }),
  ];
});

Then('the decision is demonstration-only', function (this: GovernanceWorld) {
  assert.equal(state(this).releaseDecisions?.[0].releaseDecision, 'demonstration-only');
});

Then('it is not deployable', function (this: GovernanceWorld) {
  assert.equal(state(this).releaseDecisions?.[0].deployable, false);
});

Given('an itinerary has been proposed', function (this: GovernanceWorld) {
  state(this).events = [];
});

Given('no approval exists for that itinerary', function (this: GovernanceWorld) {
  assert.deepEqual(state(this).events, []);
  state(this).bookingApproved = false;
});

Given('the user explicitly approves that exact itinerary', function (this: GovernanceWorld) {
  assert.deepEqual(state(this).events, []);
  state(this).bookingApproved = true;
});

When('the agent requests simulated booking execution', async function (this: GovernanceWorld) {
  const context = state(this);
  context.events = await collectAgentEvents(
    context.bookingApproved ? 'booking-approved' : 'booking-no-approval',
  );
});

Then('execution is blocked', function (this: GovernanceWorld) {
  const events = state(this).events;
  assert(events);
  assert.equal(toolResult(events, 'booking-approval-check')?.ok, false);
  assert.equal(toolResult(events, 'booking-simulator'), undefined);
});

Then(
  'an approval-required outcome is emitted to the audit stream',
  function (this: GovernanceWorld) {
    const events = state(this).events;
    assert(events);
    const result = toolResult(events, 'booking-approval-check')?.result as
      | { status?: string }
      | undefined;
    assert.equal(result?.status, 'approval_required');
  },
);

Then('the response does not claim the booking is complete', function (this: GovernanceWorld) {
  const text = state(this).events
    ?.filter((event): event is Extract<AgentEvent, { type: 'token' }> => event.type === 'token')
    .map((event) => event.value)
    .join('');
  assert(!text?.toLowerCase().includes('confirmed'));
});

Then('the simulated booking proceeds', function (this: GovernanceWorld) {
  const events = state(this).events;
  assert(events);
  assert.equal(toolResult(events, 'booking-approval-check')?.ok, true);
  const booking = toolResult(events, 'booking-simulator');
  assert.equal(booking?.ok, true);
  assert.equal((booking?.result as { simulated?: boolean }).simulated, true);
});

Then('the approval id is included in the audit event', function (this: GovernanceWorld) {
  const events = state(this).events;
  assert(events);
  const booking = toolResult(events, 'booking-simulator');
  assert.equal((booking?.result as { approvalId?: string }).approvalId, 'appr-demo-1');
});

Given(
  'a currency result older than the approved freshness threshold',
  function (this: GovernanceWorld) {
    state(this).events = [];
  },
);

When('a budget or booking confirmation is attempted', async function (this: GovernanceWorld) {
  state(this).events = await collectAgentEvents('stale-currency');
});

Then('deterministic code detects the stale data', function (this: GovernanceWorld) {
  const events = state(this).events;
  assert(events);
  const freshness = toolResult(events, 'currency-freshness');
  assert.equal(freshness?.ok, false);
  const result = freshness?.result as { status?: string; ageHours?: number; thresholdHours?: number };
  assert.equal(result.status, 'stale');
  assert((result.ageHours ?? 0) > (result.thresholdHours ?? 0));
});

Then('the final budget and simulated booking are blocked', function (this: GovernanceWorld) {
  const events = state(this).events;
  assert(events);
  assert.equal(toolResult(events, 'booking-simulator'), undefined);
  const text = events
    .filter((event): event is Extract<AgentEvent, { type: 'token' }> => event.type === 'token')
    .map((event) => event.value)
    .join('');
  assert(text.includes('holding off on the final EUR budget and booking'));
});

Then(
  'the service remains available and the itinerary is preserved',
  function (this: GovernanceWorld) {
    const events = state(this).events;
    assert(events);
    assert(events.some((event) => event.type === 'done'));
    assert(!events.some((event) => event.type === 'error'));
    const result = toolResult(events, 'currency-freshness')?.result as
      | { containment?: string }
      | undefined;
    assert(result?.containment?.includes('itinerary preserved'));
  },
);

Then(
  'a runtime finding is recorded for a proposed learning artefact',
  function (this: GovernanceWorld) {
    const events = state(this).events;
    assert(events);
    const finding = toolResult(events, 'currency-freshness');
    assert.equal(finding?.ok, false);
    const result = finding?.result as { status?: string; correlationId?: string };
    assert.equal(result.status, 'stale');
    assert.equal(result.correlationId, 'bdd-governance-session');
  },
);

Given('no Foundry hosting is configured', function (this: GovernanceWorld) {
  state(this).runtimeInfo = undefined;
});

When('the runtime metadata is read', function (this: GovernanceWorld) {
  const keys = [
    'FOUNDRY_AGENT_URL',
    'WAYPOINT_AGENT_URL',
    'FOUNDRY_MODEL_URL',
    'WAYPOINT_MODEL_URL',
    'FOUNDRY_API_KEY',
    'WAYPOINT_API_KEY',
    'FOUNDRY_MODEL',
    'WAYPOINT_MODEL',
    'AZURE_AI_MODEL_DEPLOYMENT_NAME',
    'FOUNDRY_USE_MANAGED_IDENTITY',
    'WAYPOINT_USE_MANAGED_IDENTITY',
  ] as const;
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    state(this).runtimeInfo = getRuntimeInfo();
  } finally {
    for (const key of keys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

Then(
  'the active driver is reported as the local deterministic driver',
  function (this: GovernanceWorld) {
    assert.equal(state(this).runtimeInfo?.runtimeMode, 'local-deterministic');
    assert.equal(state(this).runtimeInfo?.driverLabel, 'Local deterministic driver');
  },
);

Then('it is never labelled as the Foundry hosted agent', function (this: GovernanceWorld) {
  assert.notEqual(state(this).runtimeInfo?.driverLabel, 'Foundry hosted agent');
});
