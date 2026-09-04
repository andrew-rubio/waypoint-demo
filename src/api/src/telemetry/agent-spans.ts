import { SpanStatusCode, trace, context, type Span } from '@opentelemetry/api';
import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';

/**
 * Map the agent's observable event stream onto GenAI OpenTelemetry spans
 * (INC-10, ADR-011) so each turn renders as a trace in Foundry Observability:
 *   - a root `invoke_agent` span per turn,
 *   - a child `chat <model>` span for the model generation (copilot.chat),
 *   - a child `execute_tool <name>` span per tool/MCP call,
 *   - `decision` events recorded as span events.
 *
 * Events pass through unchanged, so tracing is transparent to callers. Only
 * observable orchestration is recorded — never hidden model reasoning. Callers
 * MUST pass already-redacted events (FR-002-5).
 */

const TRACER_NAME = 'waypoint-agent';

export interface TurnContext {
  conversationId: string;
  turnId: string;
  model: string;
}

function truncate(value: string, max = 2000): string {
  return value.length > max ? value.slice(0, max) + '…' : value;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

export async function* traceAgentTurn(
  events: AsyncIterable<AgentEvent>,
  ctx: TurnContext,
): AsyncIterable<AgentEvent> {
  const tracer = trace.getTracer(TRACER_NAME);
  const root = tracer.startSpan('invoke_agent waypoint', {
    attributes: {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.system': 'github.copilot',
      'gen_ai.agent.name': 'waypoint',
      'gen_ai.request.model': ctx.model,
      'gen_ai.conversation.id': ctx.conversationId,
      'waypoint.turn.id': ctx.turnId,
    },
  });
  const rootCtx = trace.setSpan(context.active(), root);
  const pending = new Map<string, Span>();
  let replyLength = 0;

  try {
    for await (const event of events) {
      switch (event.type) {
        case 'decision':
          root.addEvent('gen_ai.agent.decision', { 'gen_ai.agent.decision.summary': event.summary });
          break;
        case 'token':
          replyLength += event.value.length;
          break;
        case 'tool_call': {
          const isModel = event.name === 'copilot.chat';
          const span = tracer.startSpan(
            isModel ? `chat ${ctx.model}` : `execute_tool ${event.name}`,
            {
              attributes: isModel
                ? { 'gen_ai.operation.name': 'chat', 'gen_ai.system': 'github.copilot', 'gen_ai.request.model': ctx.model }
                : { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': event.name },
            },
            rootCtx,
          );
          if (event.args) span.setAttribute('gen_ai.tool.call.arguments', truncate(asText(event.args)));
          pending.set(event.name, span);
          break;
        }
        case 'tool_result': {
          const span = pending.get(event.name);
          if (span) {
            if (event.result !== undefined) span.setAttribute('gen_ai.tool.call.result', truncate(asText(event.result)));
            span.setStatus({ code: event.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR });
            span.end();
            pending.delete(event.name);
          }
          break;
        }
        case 'error':
          root.setAttribute('error.type', event.code);
          root.setStatus({ code: SpanStatusCode.ERROR, message: event.code });
          break;
        default:
          break;
      }
      yield event;
    }
    root.setAttribute('gen_ai.response.output_text.length', replyLength);
  } catch (err) {
    root.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    throw err;
  } finally {
    for (const span of pending.values()) span.end();
    root.end();
  }
}
