import { describe, it, expect } from 'vitest';
// These modules do not exist yet — this is the red baseline contract for INC-2.
// The audit reducer folds the FRD-001 AgentEvent stream into FRD-002 AuditEntry
// rows (grouped by turn, pending→ok/error, with durations). It is pure so the
// web client can drive it deterministically and we can unit-test it here.
import {
  emptyAuditState,
  applyAuditEvent,
  auditTurns,
  type AuditState,
} from '../../../shared/audit.js';
import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';

const T1 = 'turn-1';
const T2 = 'turn-2';

function fold(events: Array<[AgentEvent, number]>, turnId = T1): AuditState {
  return events.reduce<AuditState>((state, [event, now]) => applyAuditEvent(state, turnId, event, now), emptyAuditState());
}

describe('Audit reducer — decision entries (AC-002-3)', () => {
  it('turns a decision event into a human-readable decision entry', () => {
    const state = fold([[{ type: 'decision', summary: 'Answer the traveller directly.' }, 1000]]);
    expect(state.entries).toHaveLength(1);
    const entry = state.entries[0];
    expect(entry.type).toBe('decision');
    expect(entry.status).toBe('ok');
    expect(entry.turnId).toBe(T1);
    // The observable summary is surfaced verbatim (no hidden reasoning).
    expect(`${entry.requestSummary} ${entry.responseSummary}`).toContain('Answer the traveller directly.');
  });
});

describe('Audit reducer — tool call lifecycle (AC-002-2)', () => {
  it('creates a pending entry on tool_call and resolves it to ok with a duration', () => {
    const state = fold([
      [{ type: 'tool_call', name: 'open-meteo.climate', args: { lat: 38.7, lon: -9.1 } }, 1000],
      [{ type: 'tool_result', name: 'open-meteo.climate', ok: true, result: { tHigh: 22 } }, 1212],
    ]);
    expect(state.entries).toHaveLength(1);
    const entry = state.entries[0];
    expect(entry.type).toBe('mcp');
    expect(entry.status).toBe('ok');
    expect(entry.durationMs).toBe(212);
    expect(entry.responseSummary).toContain('22');
  });

  it('marks the entry as pending with a null duration before the result arrives', () => {
    const state = fold([[{ type: 'tool_call', name: 'routestack.searchFlights', args: {} }, 1000]]);
    expect(state.entries[0].status).toBe('pending');
    expect(state.entries[0].durationMs).toBeNull();
  });

  it('resolves a failed tool_result to an error entry', () => {
    const state = fold([
      [{ type: 'tool_call', name: 'open-meteo.climate', args: {} }, 1000],
      [{ type: 'tool_result', name: 'open-meteo.climate', ok: false, result: 'timeout' }, 1500],
    ]);
    expect(state.entries[0].status).toBe('error');
  });
});

describe('Audit reducer — classification', () => {
  it('classifies known MCP servers as mcp and local skills as skill', () => {
    const state = fold([
      [{ type: 'tool_call', name: 'destination-advisor', args: {} }, 1000],
      [{ type: 'tool_call', name: 'currency.convert', args: {} }, 1001],
    ]);
    const byName = Object.fromEntries(state.entries.map((e) => [e.name, e.type]));
    expect(byName['destination-advisor']).toBe('skill');
    expect(byName['currency.convert']).toBe('mcp');
  });

  it('classifies the copilot model call as an api entry', () => {
    const state = fold([[{ type: 'tool_call', name: 'copilot.chat', args: { model: 'gpt-4o' } }, 1000]]);
    expect(state.entries[0].type).toBe('api');
  });
});

describe('Audit reducer — error event (AC-002-6)', () => {
  it('fails the pending entry when an error event interrupts a tool call', () => {
    const state = fold([
      [{ type: 'tool_call', name: 'routestack.searchHotels', args: {} }, 1000],
      [{ type: 'error', code: 'stream_error', message: 'The reply was interrupted.' }, 1400],
    ]);
    expect(state.entries[0].status).toBe('error');
    expect(state.entries[0].reason).toContain('interrupted');
  });

  it('adds a standalone error entry when nothing is pending', () => {
    const state = fold([[{ type: 'error', code: 'agent_unavailable', message: 'Unavailable.' }, 1000]]);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].status).toBe('error');
  });
});

describe('Audit reducer — turn grouping (FR-002-2)', () => {
  it('groups entries by turn in the order the turns occurred', () => {
    let state = emptyAuditState();
    state = applyAuditEvent(state, T1, { type: 'decision', summary: 'First turn.' }, 1000);
    state = applyAuditEvent(state, T2, { type: 'decision', summary: 'Second turn.' }, 2000);
    const turns = auditTurns(state);
    expect(turns).toHaveLength(2);
    expect(turns[0].turnId).toBe(T1);
    expect(turns[1].turnId).toBe(T2);
    expect(turns[0].entries).toHaveLength(1);
  });
});
