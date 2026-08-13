import { describe, expect, it } from 'vitest';
import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { LocalAgentDriver } from '../../src/agent/local-driver.js';

async function run(message: string, history: ChatMessage[] = []): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of new LocalAgentDriver().run({ sessionId: 'destination-test', message, history })) {
    events.push(event);
  }
  return events;
}

function toolResult(events: AgentEvent[]): Record<string, unknown> {
  const result = events.find((event) => event.type === 'tool_result' && event.name === 'destination-advisor');
  expect(result).toBeDefined();
  expect(result?.type).toBe('tool_result');
  return (result as Extract<AgentEvent, { type: 'tool_result' }>).result as Record<string, unknown>;
}

function reply(events: AgentEvent[]): string {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'token' }> => event.type === 'token')
    .map((event) => event.value)
    .join('');
}

describe('destination-advisor skill', () => {
  it('returns 3-5 ranked canonical suggestions with rationales and tags (AC-003-1, AC-003-4)', async () => {
    const events = await run('Suggest destinations for warm weather, hiking, and good seafood');
    const call = events.find((event) => event.type === 'tool_call' && event.name === 'destination-advisor');
    expect(call).toBeDefined();

    const result = toolResult(events);
    expect(result.kind).toBe('shortlist');
    const suggestions = result.suggestions as Array<{ name: string; rationale: string; tags: string[] }>;
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    expect(suggestions.length).toBeLessThanOrEqual(5);
    for (const suggestion of suggestions) {
      expect(suggestion.name).toMatch(/^[^,]+, [^,]+$/);
      expect(suggestion.rationale).toMatch(/warm|hiking|seafood/i);
      expect(suggestion.tags.length).toBeGreaterThan(0);
    }
  });

  it('asks exactly one focused question instead of fabricating a shortlist (AC-003-2)', async () => {
    const events = await run('Recommend somewhere');
    const result = toolResult(events);
    expect(result.kind).toBe('clarification');
    expect(result.suggestions).toBeUndefined();
    const text = reply(events);
    expect(text.match(/\?/g)).toHaveLength(1);
    expect(text).toMatch(/climate|budget|activity|beach|city/i);
  });

  it('uses conversation history to refine a previous shortlist (AC-003-3)', async () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'Suggest warm hiking and seafood destinations', ts: '2026-08-13T00:00:00Z' },
      { role: 'assistant', content: 'Lisbon, Portugal; Palermo, Italy; Chania, Greece', ts: '2026-08-13T00:00:01Z' },
    ];
    const result = toolResult(await run('Make it cheaper and more beach-focused', history));
    expect(result.kind).toBe('shortlist');
    expect(JSON.stringify(result)).toMatch(/cheap|afford|budget/i);
    expect(JSON.stringify(result)).toMatch(/beach|coast/i);
  });

  it('acknowledges contradictory interests and offers both interpretations', async () => {
    const events = await run('I want hot weather and snowy beaches');
    expect(reply(events)).toMatch(/conflict|tension|different directions/i);
    expect(reply(events)).toMatch(/hot|warm/i);
    expect(reply(events)).toMatch(/snow|cold/i);
  });

  it('returns closest alternatives when no strong match exists', async () => {
    const result = toolResult(await run('Find midnight sun, tropical coral reefs, and nearby ski slopes'));
    expect(result.kind).toBe('no-match');
    expect(result.message).toMatch(/no (strong|exact|perfect) match/i);
    expect((result.suggestions as unknown[]).length).toBeGreaterThan(0);
  });

  it('redirects non-travel input without returning destinations', async () => {
    const result = toolResult(await run('Can you review my tax return?'));
    expect(result.kind).toBe('redirect');
    expect(result.message).toMatch(/trip|travel|holiday/i);
    expect(result.suggestions).toBeUndefined();
  });
});