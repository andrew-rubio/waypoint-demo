import { describe, it, expect } from 'vitest';
import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import {
  parseResponsesRequest,
  streamResponses,
  collectResponse,
} from '../../src/responses/openai-responses.js';

async function* from(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  for (const e of events) yield e;
}

async function drain(events: AgentEvent[]) {
  const frames = [];
  for await (const f of streamResponses(from(events), { model: 'test-model' })) frames.push(f);
  return frames;
}

describe('responses adapter — parse (INC-9, ADR-010)', () => {
  it('accepts a string input and defaults stream=false', () => {
    const r = parseResponsesRequest({ input: 'Plan a trip' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.input).toBe('Plan a trip');
      expect(r.value.stream).toBe(false);
      expect(r.value.conversationId).toMatch(/^conv_/);
    }
  });

  it('extracts text from an OpenAI message array', () => {
    const r = parseResponsesRequest({
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'Where to in May?' }] }],
      stream: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.input).toBe('Where to in May?');
      expect(r.value.stream).toBe(true);
    }
  });

  it('keys history off a supplied conversation id', () => {
    const r = parseResponsesRequest({ input: 'hi', conversation: { id: 'conv_abc' } });
    expect(r.ok && r.value.conversationId).toBe('conv_abc');
  });

  it('reconstructs prior turns from a multi-message input array (stateless context)', () => {
    const r = parseResponsesRequest({
      input: [
        { role: 'user', content: 'I want to visit Lisbon.' },
        { role: 'assistant', content: 'Lisbon is a great coastal city.' },
        { role: 'user', content: 'What is the weather there in December?' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.input).toBe('What is the weather there in December?');
      expect(r.value.history).toHaveLength(2);
      expect(r.value.history[0]).toMatchObject({ role: 'user', content: 'I want to visit Lisbon.' });
      expect(r.value.history[1]).toMatchObject({ role: 'assistant', content: 'Lisbon is a great coastal city.' });
    }
  });

  it('returns empty history for a single-message turn', () => {
    const r = parseResponsesRequest({ input: 'Plan a trip' });
    expect(r.ok && r.value.history).toEqual([]);
  });

  it('rejects empty input', () => {
    expect(parseResponsesRequest({ input: '   ' }).ok).toBe(false);
    expect(parseResponsesRequest({}).ok).toBe(false);
  });
});

describe('responses adapter — streaming lifecycle', () => {
  it('emits created → in_progress → text deltas → completed', async () => {
    const frames = await drain([
      { type: 'decision', summary: 'answer' },
      { type: 'token', value: 'Hello ' },
      { type: 'token', value: 'world' },
      { type: 'done' },
    ]);
    const names = frames.map((f) => f.event);
    expect(names[0]).toBe('response.created');
    expect(names).toContain('response.in_progress');
    expect(names).toContain('response.output_text.delta');
    expect(names.at(-1)).toBe('response.completed');

    const deltas = frames.filter((f) => f.event === 'response.output_text.delta').map((f) => f.data.delta);
    expect(deltas.join('')).toBe('Hello world');

    const completed = frames.at(-1)!.data.response as Record<string, unknown>;
    expect(completed.status).toBe('completed');
    expect(completed.output_text).toBe('Hello world');
  });

  it('surfaces tool_call/tool_result as a function_call output item', async () => {
    const frames = await drain([
      { type: 'tool_call', name: 'open-meteo', args: { place: 'Lisbon' } },
      { type: 'tool_result', name: 'open-meteo', ok: true, result: { tempC: 22 } },
      { type: 'token', value: 'It is warm.' },
      { type: 'done' },
    ]);
    const completed = frames.at(-1)!.data.response as { output: Array<Record<string, unknown>> };
    const fc = completed.output.find((o) => o.type === 'function_call');
    expect(fc).toBeDefined();
    expect(fc!.name).toBe('open-meteo');
    expect(fc!.arguments).toBe(JSON.stringify({ place: 'Lisbon' }));
    expect(fc!.ok).toBe(true);
  });

  it('maps a mid-stream error to response.failed and stops', async () => {
    const frames = await drain([
      { type: 'token', value: 'Let me ' },
      { type: 'error', code: 'stream_error', message: 'interrupted' },
      { type: 'done' },
    ]);
    expect(frames.at(-1)!.event).toBe('response.failed');
    const failed = frames.at(-1)!.data.response as { status: string; error: { code: string } };
    expect(failed.status).toBe('failed');
    expect(failed.error.code).toBe('stream_error');
    expect(frames.some((f) => f.event === 'response.completed')).toBe(false);
  });
});

describe('responses adapter — non-streaming', () => {
  it('collects a single completed response object', async () => {
    const res = await collectResponse(
      from([
        { type: 'token', value: 'A ' },
        { type: 'token', value: 'reply' },
        { type: 'done' },
      ]),
      { model: 'test-model' },
    );
    expect(res.object).toBe('response');
    expect(res.status).toBe('completed');
    expect(res.output_text).toBe('A reply');
  });
});
