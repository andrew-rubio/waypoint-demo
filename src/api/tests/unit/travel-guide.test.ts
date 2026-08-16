import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { LocalAgentDriver } from '../../src/agent/local-driver.js';
import { extractMonth, searchGuideByMonth } from '../../src/tools/travel-guide.js';
import { adviseDestinations } from '../../src/tools/destination-advisor.js';

// INC-8 (reworks FRD-003): data-driven, month-aware destination advice grounded
// in the travel-guide knowledge base and personalised from the Cosmos profile.
// These tests target the deterministic offline path — the same behaviour the
// live RAG/AI-Search path is validated against by the deploy smoke.

const PAST_CITIES = ['Lisbon', 'Barcelona', 'Chania'];

async function run(message: string, history: ChatMessage[] = []): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of new LocalAgentDriver().run({ sessionId: 'travel-guide-test', message, history })) {
    events.push(event);
  }
  return events;
}

function toolNames(events: AgentEvent[], type: 'tool_call' | 'tool_result'): string[] {
  return events.filter((e): e is Extract<AgentEvent, { type: 'tool_call' | 'tool_result' }> => e.type === type).map((e) => e.name);
}

function destinationResult(events: AgentEvent[]): { kind: string; suggestions?: Array<{ name: string; rationale: string; tags: string[] }>; guideMatched?: boolean; message?: string } {
  const result = events.find((e) => e.type === 'tool_result' && e.name === 'destination-advisor');
  expect(result).toBeDefined();
  return (result as Extract<AgentEvent, { type: 'tool_result' }>).result as never;
}

function guideResult(events: AgentEvent[]): Record<string, unknown> {
  const result = events.find((e) => e.type === 'tool_result' && e.name === 'travel-guide.searchByMonth');
  expect(result).toBeDefined();
  return (result as Extract<AgentEvent, { type: 'tool_result' }>).result as Record<string, unknown>;
}

describe('travel-guide knowledge base (offline)', () => {
  it('extracts the target month from a natural-language request (case-insensitive)', () => {
    expect(extractMonth('Where should I go in June?')).toBe('June');
    expect(extractMonth('somewhere warm for december please')).toBe('December');
    expect(extractMonth('I love hiking and seafood')).toBeUndefined();
  });

  it('returns at least three canonical, tagged, month-tagged guide passages for a month', () => {
    const passages = searchGuideByMonth('June');
    expect(passages.length).toBeGreaterThanOrEqual(3);
    for (const passage of passages) {
      expect(passage.name).toMatch(/^[^,]+, [^,]+$/);
      expect(passage.rationale.length).toBeGreaterThan(0);
      expect(passage.tags.length).toBeGreaterThan(0);
      expect(passage.month).toBe('June');
    }
  });

  it('matches the month case-insensitively and returns nothing for an unknown month', () => {
    expect(searchGuideByMonth('june').length).toBeGreaterThanOrEqual(3);
    expect(searchGuideByMonth('Smarch')).toHaveLength(0);
  });
});

describe('destination advice — month-aware, guide-grounded, personalised (AC-003-5)', () => {
  it('makes both the travel-guide and Cosmos MCP calls on a month turn (FR-003-5)', async () => {
    const events = await run('Where should I go in June?');
    expect(toolNames(events, 'tool_call')).toEqual(expect.arrayContaining(['travel-guide.searchByMonth', 'cosmos.getTravellerProfile', 'destination-advisor']));
    expect(toolNames(events, 'tool_result')).toEqual(expect.arrayContaining(['travel-guide.searchByMonth', 'cosmos.getTravellerProfile', 'destination-advisor']));
  });

  it('the travel-guide MCP result summarises the requested month and a result count', async () => {
    const summary = guideResult(await run('Where should I go in June?'));
    expect(JSON.stringify(summary)).toMatch(/june/i);
    expect(JSON.stringify(summary)).toMatch(/[3-9]/);
  });

  it('returns 3-5 guide-grounded suggestions for the month', async () => {
    const result = destinationResult(await run('Where should I go in June?'));
    expect(result.kind).toBe('shortlist');
    expect(result.guideMatched).toBe(true);
    expect(result.suggestions!.length).toBeGreaterThanOrEqual(3);
    expect(result.suggestions!.length).toBeLessThanOrEqual(5);
    for (const suggestion of result.suggestions!) {
      expect(suggestion.name).toMatch(/^[^,]+, [^,]+$/);
      expect(suggestion.tags.length).toBeGreaterThan(0);
    }
  });

  it('avoids destinations the traveller has recently visited (FR-003-6)', async () => {
    const result = destinationResult(await run('Where should I go in June?'));
    for (const suggestion of result.suggestions!) {
      for (const city of PAST_CITIES) expect(suggestion.name).not.toContain(city);
    }
  });

  it('falls back to preference-based suggestions when the guide has no strong match', () => {
    const result = adviseDestinations({ interests: ['warm weather'], constraints: [], month: 'June', guidePassages: [], pastDestinations: ['Lisbon, Portugal', 'Barcelona, Spain', 'Chania, Greece'] });
    expect(result.kind).toBe('shortlist');
    if (result.kind === 'shortlist') {
      expect(result.guideMatched).toBe(false);
      expect(result.message ?? '').toMatch(/guide.*no (strong|good) match|no (strong|good) match.*guide/i);
      expect(result.suggestions.length).toBeGreaterThanOrEqual(3);
      for (const suggestion of result.suggestions) {
        for (const city of PAST_CITIES) expect(suggestion.name).not.toContain(city);
      }
    }
  });

  it('shows a loading status while searching the travel guide, then clears it', async () => {
    const events = await run('Where should I go in June?');
    const statuses = events.filter((e): e is Extract<AgentEvent, { type: 'status' }> => e.type === 'status').map((e) => e.message);
    expect(statuses.some((m) => /searching the travel guide/i.test(m))).toBe(true);
    expect(statuses).toContain('');
  });

  it('does not repeat the personalisation note on a "tell me more about X" detail turn', async () => {
    const events = await run('Tell me more about Rome, Italy');
    const note = events.find((e) => e.type === 'tool_result' && e.name === 'personalise');
    expect(note).toBeUndefined();
  });

  it('researches the place (Wikipedia) instead of a shortlist on a "tell me more" turn', async () => {
    const events = await run('Tell me more about Rome, Italy');
    const wiki = events.find((e) => e.type === 'tool_result' && e.name === 'wikipedia.summary');
    expect(wiki).toBeDefined();
    expect(events.find((e) => e.type === 'tool_result' && e.name === 'destination-advisor')).toBeUndefined();
    const statuses = events.filter((e): e is Extract<AgentEvent, { type: 'status' }> => e.type === 'status').map((e) => e.message);
    expect(statuses.some((m) => /researching more into rome, italy/i.test(m))).toBe(true);
    expect(statuses.some((m) => /into about/i.test(m))).toBe(false);
  });
});
