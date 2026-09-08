import { randomUUID } from 'node:crypto';

/**
 * In-memory pending-approvals store for runtime governance HITL (ADR-013).
 *
 * When the policy engine returns `require_approval` for a consequential action
 * (e.g. a simulated booking), the agent creates a pending approval, emits an
 * `approval_request` event, and awaits the human's decision. The open SSE stream
 * stays paused inside the request handler until `POST /api/chat/approve` calls
 * `resolveApproval`, which settles the awaited promise and lets the stream continue.
 *
 * Fail-closed: an unknown/expired approval id resolves to `denied`.
 *
 * ⚠ Single-process store: in a multi-replica deployment the approve request must
 * reach the same instance holding the paused stream (demo runs a single replica).
 */

export type ApprovalDecision = 'approved' | 'denied';

export interface PendingApproval {
  approvalId: string;
  sessionId: string;
  tool: string;
  itineraryId: string;
  createdAt: string;
  /** Settled by `resolveApproval` (or the test default). */
  promise: Promise<ApprovalDecision>;
  resolve: (decision: ApprovalDecision) => void;
}

const TEST = process.env.NODE_ENV === 'test';

const pending = new Map<string, PendingApproval>();
/** Test-only: a decision pre-seeded per session so a turn resolves without HTTP. */
const seeded = new Map<string, ApprovalDecision>();

/** Register a pending approval and return its record (id + awaitable promise). */
export function requestApproval(params: { sessionId: string; tool: string; itineraryId: string }): PendingApproval {
  const approvalId = `appr-${randomUUID()}`;
  let resolve!: (decision: ApprovalDecision) => void;
  const promise = new Promise<ApprovalDecision>((r) => {
    resolve = r;
  });
  const record: PendingApproval = {
    approvalId,
    sessionId: params.sessionId,
    tool: params.tool,
    itineraryId: params.itineraryId,
    createdAt: new Date().toISOString(),
    promise,
    resolve,
  };
  pending.set(approvalId, record);
  return record;
}

/**
 * Block until the human decides.
 *   - production: waits on the promise settled by `POST /api/chat/approve`;
 *   - test: resolves immediately to a seeded decision, else `approved` so
 *     existing booking tests (which complete a booking) stay green. Tests that
 *     drive the real async resolve should use `requestApproval`/`resolveApproval`.
 */
export async function awaitApproval(record: PendingApproval): Promise<ApprovalDecision> {
  if (TEST) {
    const seededDecision = seeded.get(record.sessionId);
    seeded.delete(record.sessionId);
    pending.delete(record.approvalId);
    return seededDecision ?? 'approved';
  }
  return record.promise;
}

/** Resolve a pending approval by id. Returns false if the id is unknown. */
export function resolveApproval(approvalId: string, decision: ApprovalDecision): boolean {
  const record = pending.get(approvalId);
  if (!record) return false;
  pending.delete(approvalId);
  record.resolve(decision);
  return true;
}

/** Test hook: pre-seed the decision the next approval for this session resolves to. */
export function seedApprovalDecision(sessionId: string, decision: ApprovalDecision): void {
  seeded.set(sessionId, decision);
}

/** Test hook: clear all pending approvals and seeded decisions. */
export function resetApprovals(): void {
  pending.clear();
  seeded.clear();
}
