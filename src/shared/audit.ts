/**
 * Audit trail contract & reducer (FRD-002, INC-2).
 *
 * The chat stream (FRD-001) carries the agent's observable activity as
 * `AgentEvent`s. The audit panel needs that same stream folded into rows the
 * presenter can read: one entry per decision / tool call, grouped by turn, with
 * a pending→ok/error lifecycle and a duration. This module is the single source
 * of truth for that mapping. It is pure (no clock, no DOM) so both the web
 * client and unit tests can drive it deterministically.
 *
 * Secrets are redacted on the server before events are streamed, so nothing
 * here needs to redact again — it only ever sees already-sanitised payloads.
 */

import type { AgentEvent } from './types/chat-and-agent-runtime.js';

/** A single row in the audit panel (shape fixed by FRD-002). */
export interface AuditEntry {
  id: string;
  turnId: string;
  type: 'decision' | 'skill' | 'mcp' | 'api';
  name: string;
  /** Redacted, JSON-ish summary of the request/args. */
  requestSummary: string;
  /** Redacted, JSON-ish summary of the response/result. */
  responseSummary: string;
  /** Elapsed time in ms; `null` while the entry is still pending. */
  durationMs: number | null;
  status: 'pending' | 'ok' | 'error';
  /** Present when status is `error`. */
  reason?: string;
  /** ISO-8601 timestamp of when the entry was created. */
  ts: string;
}

/** Accumulated audit state for one conversation. */
export interface AuditState {
  entries: AuditEntry[];
  /** Turn ids in the order they first appeared. */
  turnIds: string[];
  /** Monotonic counter used to mint stable entry ids. */
  seq: number;
}

/** MCP servers wired into Waypoint; everything else is treated as a local skill. */
const MCP_SERVERS = ['open-meteo', 'routestack', 'currency', 'microsoft-fabric-data-agent', 'fabric'];

/** Direct API calls (the Copilot model itself); surfaced with the `api` badge. */
const API_SERVERS = ['copilot'];

/** Collapse very long payloads so a single entry can never blow up the panel. */
const MAX_SUMMARY = 2000;

export function emptyAuditState(): AuditState {
  return { entries: [], turnIds: [], seq: 0 };
}

/** Fold a single AgentEvent for `turnId` into the audit state at time `now` (ms). */
export function applyAuditEvent(state: AuditState, turnId: string, event: AgentEvent, now: number): AuditState {
  const turnIds = state.turnIds.includes(turnId) ? state.turnIds : [...state.turnIds, turnId];
  const base: AuditState = { ...state, turnIds };

  switch (event.type) {
    case 'decision':
      return pushEntry(base, {
        turnId,
        type: 'decision',
        name: 'decision',
        requestSummary: summarise(event.summary),
        responseSummary: '',
        durationMs: 0,
        status: 'ok',
        ts: new Date(now).toISOString(),
      });

    case 'tool_call':
      return pushEntry(base, {
        turnId,
        type: classify(event.name),
        name: event.name,
        requestSummary: summarise(event.args ?? {}),
        responseSummary: '',
        durationMs: null,
        status: 'pending',
        ts: new Date(now).toISOString(),
      });

    case 'tool_result': {
      const idx = lastPendingIndex(base.entries, turnId, event.name);
      if (idx === -1) return base;
      return resolveEntry(base, idx, {
        status: event.ok ? 'ok' : 'error',
        responseSummary: summariseToolResult(event.name, event.result ?? (event.ok ? 'ok' : 'error')),
        durationMs: elapsed(base.entries[idx].ts, now),
        reason: event.ok ? undefined : 'Tool call failed',
      });
    }

    case 'error': {
      const idx = lastPendingIndex(base.entries, turnId);
      if (idx !== -1) {
        return resolveEntry(base, idx, {
          status: 'error',
          durationMs: elapsed(base.entries[idx].ts, now),
          reason: event.message,
        });
      }
      // Nothing in flight — record the failure as its own entry.
      return pushEntry(base, {
        turnId,
        type: 'api',
        name: event.code,
        requestSummary: '',
        responseSummary: '',
        durationMs: 0,
        status: 'error',
        reason: event.message,
        ts: new Date(now).toISOString(),
      });
    }

    // token / done carry no audit information.
    default:
      return base;
  }
}

/** Group the entries by turn, preserving turn order and in-turn order. */
export function auditTurns(state: AuditState): Array<{ turnId: string; entries: AuditEntry[] }> {
  return state.turnIds
    .map((turnId) => ({ turnId, entries: state.entries.filter((e) => e.turnId === turnId) }))
    .filter((group) => group.entries.length > 0);
}

// ── internals ────────────────────────────────────────────────────────────────

function pushEntry(state: AuditState, entry: Omit<AuditEntry, 'id'>): AuditState {
  const id = `e${state.seq}`;
  return { ...state, seq: state.seq + 1, entries: [...state.entries, { id, ...entry }] };
}

function resolveEntry(state: AuditState, index: number, patch: Partial<AuditEntry>): AuditState {
  const entries = state.entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
  return { ...state, entries };
}

/** Index of the newest still-pending entry in a turn, optionally matching `name`. */
function lastPendingIndex(entries: AuditEntry[], turnId: string, name?: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.turnId === turnId && e.status === 'pending' && (name === undefined || e.name === name)) return i;
  }
  return -1;
}

function classify(name: string): AuditEntry['type'] {
  const prefix = name.split('.')[0];
  if (MCP_SERVERS.includes(prefix)) return 'mcp';
  if (API_SERVERS.includes(prefix)) return 'api';
  return 'skill';
}

function elapsed(startIso: string, now: number): number {
  return Math.max(0, now - Date.parse(startIso));
}

function summarise(value: unknown): string {
  const text = typeof value === 'string' ? value : safeStringify(value);
  return text.length > MAX_SUMMARY ? text.slice(0, MAX_SUMMARY - 1) + '…' : text;
}

function summariseToolResult(name: string, value: unknown): string {
  if (name !== 'destination-advisor' || !value || typeof value !== 'object') return summarise(value);
  const result = value as { kind?: unknown; suggestions?: unknown[]; message?: unknown };
  if (Array.isArray(result.suggestions)) {
    const suffix = result.kind === 'no-match' ? ' closest alternatives' : ' ranked destinations';
    return `${result.suggestions.length}${suffix}${typeof result.message === 'string' ? ` · ${result.message}` : ''}`;
  }
  return typeof result.message === 'string' ? result.message : summarise(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
