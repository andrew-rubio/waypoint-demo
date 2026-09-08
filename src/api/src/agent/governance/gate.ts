import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PolicyEngine } from '@microsoft/agent-governance-sdk';
import type { PolicyDecisionResult } from '@microsoft/agent-governance-sdk';

/**
 * Runtime tool-authority gate (ADR-013).
 *
 * A deterministic policy-decision point backed by the Agent Governance Toolkit's
 * `PolicyEngine`. It is called before every tool/MCP invocation and answers a single
 * question — is THIS action, right now, permitted? — with one of three outcomes:
 *
 *   allow             → the call proceeds
 *   deny              → the call never reaches the wire
 *   require_approval  → the call is held until a human approves (RAI-HITL-001)
 *
 * No LLM is on this path. If the policy cannot be evaluated the gate fails CLOSED (deny),
 * matching AGT's design and ADR-012's "error blocks" posture.
 */

export type GateDecision = 'allow' | 'deny' | 'require_approval';

export interface GateResult {
  decision: GateDecision;
  /** Human-readable reason surfaced to the audit trail / approval card. */
  reason: string;
  /** Name of the policy rule that matched, if any. */
  matchedRule?: string;
  /** Approvers required for a `require_approval` decision. */
  approvers: string[];
  /** The raw AGT PolicyAction (allow|deny|warn|require_approval|log). */
  action: string;
}

const AGENT_DID = 'did:waypoint:agent';
const POLICY_PATH = resolve(import.meta.dirname, 'policy.yaml');

let engine: PolicyEngine | undefined;

function getEngine(): PolicyEngine {
  if (!engine) {
    const e = new PolicyEngine();
    e.loadYaml(readFileSync(POLICY_PATH, 'utf8'));
    engine = e;
  }
  return engine;
}

/** Reset the cached engine — test-only. */
export function resetGate(): void {
  engine = undefined;
}

/**
 * Evaluate one tool/MCP invocation against the runtime authority policy.
 * `tool` is the tool/skill/MCP name (e.g. "booking-simulator"); `kind` distinguishes
 * an MCP call from a local tool for future rules.
 */
export function evaluateToolCall(tool: string, kind: string = 'tool'): GateResult {
  let result: PolicyDecisionResult;
  try {
    result = getEngine().evaluatePolicy(AGENT_DID, { tool, kind });
  } catch (err) {
    // Fail closed: an unevaluable policy denies rather than silently allowing.
    return {
      decision: 'deny',
      action: 'deny',
      reason: `Policy could not be evaluated: ${(err as Error).message}`,
      approvers: [],
    };
  }

  const action = result.action;
  const decision: GateDecision =
    action === 'deny' ? 'deny' : action === 'require_approval' ? 'require_approval' : 'allow';

  return {
    decision,
    action,
    reason: result.reason ?? defaultReason(decision, tool, result.matchedRule),
    matchedRule: result.matchedRule,
    approvers: result.approvers ?? [],
  };
}

function defaultReason(decision: GateDecision, tool: string, rule?: string): string {
  const via = rule ? ` (rule "${rule}")` : '';
  switch (decision) {
    case 'deny':
      return `"${tool}" is outside the agent's approved authority${via}.`;
    case 'require_approval':
      return `"${tool}" is a consequential action and requires human approval${via}.`;
    default:
      return `"${tool}" is a permitted action${via}.`;
  }
}
