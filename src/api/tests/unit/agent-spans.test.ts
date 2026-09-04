import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import { traceAgentTurn } from '../../src/telemetry/agent-spans.js';

/** INC-10 / ADR-011 — GenAI OpenTelemetry span emission from the AgentEvent stream. */
const exporter = new InMemorySpanExporter();

beforeAll(() => {
  new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }).register();
});
beforeEach(() => exporter.reset());

async function* from(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  for (const e of events) yield e;
}
async function drain(events: AgentEvent[]) {
  const out: AgentEvent[] = [];
  for await (const e of traceAgentTurn(from(events), { conversationId: 'conv-1', turnId: 'turn-1', model: 'gpt-5.4-mini', userMessage: 'plan a trip' })) {
    out.push(e);
  }
  return out;
}

describe('traceAgentTurn', () => {
  it('passes every event through unchanged and in order', async () => {
    const input: AgentEvent[] = [
      { type: 'decision', summary: 'answer' },
      { type: 'token', value: 'Hi' },
      { type: 'done' },
    ];
    expect(await drain(input)).toEqual(input);
  });

  it('emits a root invoke_agent span with GenAI attributes', async () => {
    await drain([{ type: 'token', value: 'Hi' }, { type: 'done' }]);
    const root = exporter.getFinishedSpans().find((s) => s.name === 'invoke_agent waypoint');
    expect(root).toBeDefined();
    expect(root!.attributes['gen_ai.operation.name']).toBe('invoke_agent');
    expect(root!.attributes['gen_ai.conversation.id']).toBe('conv-1');
    expect(root!.attributes['gen_ai.request.model']).toBe('gpt-5.4-mini');
  });

  it('emits a chat span for copilot.chat and execute_tool spans for tools', async () => {
    await drain([
      { type: 'tool_call', name: 'open-meteo', args: { place: 'Lisbon' } },
      { type: 'tool_result', name: 'open-meteo', ok: true, result: { tempC: 22 } },
      { type: 'tool_call', name: 'copilot.chat', args: { model: 'gpt-5.4-mini', prompt: 'hi' } },
      { type: 'tool_result', name: 'copilot.chat', ok: true, result: 'reply' },
      { type: 'done' },
    ]);
    const names = exporter.getFinishedSpans().map((s) => s.name);
    expect(names).toContain('execute_tool open-meteo');
    expect(names).toContain('chat gpt-5.4-mini');

    const tool = exporter.getFinishedSpans().find((s) => s.name === 'execute_tool open-meteo')!;
    expect(tool.attributes['gen_ai.tool.name']).toBe('open-meteo');
  });

  it('marks the root span as error on an error event', async () => {
    await drain([{ type: 'token', value: 'x' }, { type: 'error', code: 'stream_error', message: 'boom' }]);
    const root = exporter.getFinishedSpans().find((s) => s.name === 'invoke_agent waypoint')!;
    expect(root.attributes['error.type']).toBe('stream_error');
    expect(root.status.code).toBe(2); // SpanStatusCode.ERROR
  });

  it('records the dialogue and every audit item as root span events', async () => {
    await drain([
      { type: 'decision', summary: 'get profile then advise' },
      { type: 'tool_call', name: 'cosmos.getTravellerProfile', args: { q: 'profile' } },
      { type: 'tool_result', name: 'cosmos.getTravellerProfile', ok: true, result: { tier: 'Gold' } },
      { type: 'token', value: 'Try Palermo.' },
      { type: 'done' },
    ]);
    const root = exporter.getFinishedSpans().find((s) => s.name === 'invoke_agent waypoint')!;
    const events = Object.fromEntries(root.events.map((e) => [e.name, e.attributes ?? {}]));
    expect(events['gen_ai.user.message']?.content).toBe('plan a trip');
    expect(events['gen_ai.agent.decision']).toBeDefined();
    expect(events['gen_ai.tool.call']?.['tool.type']).toBe('mcp');
    expect(events['gen_ai.tool.result']?.['tool.ok']).toBe(true);
    expect(events['gen_ai.assistant.message']?.content).toBe('Try Palermo.');
    expect(root.attributes['waypoint.assistant_reply']).toBe('Try Palermo.');
  });
});
