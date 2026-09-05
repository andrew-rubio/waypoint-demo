import { SpanStatusCode, trace, context, type Span } from '@opentelemetry/api';
import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import { flushTracing } from './tracing.js';

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
  /** The traveller's message this turn — recorded as the dialogue input. */
  userMessage: string;
}

function truncate(value: string, max = 2000): string {
  return value.length > max ? value.slice(0, max) + '…' : value;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null);
}

/** Classify a call the same way the front-end audit trail does (FRD-002). */
function auditType(name: string): 'api' | 'skill' | 'mcp' {
  if (name === 'copilot.chat' || name.startsWith('wikipedia')) return 'api';
  const SKILLS = new Set([
    'destination-advisor',
    'weather-window',
    'booking-simulator',
    'trip-summariser',
    'budget-estimator',
    'personalise',
  ]);
  if (SKILLS.has(name)) return 'skill';
  return 'mcp';
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
      'waypoint.user_message': truncate(ctx.userMessage),
    },
  });
  // The dialogue and every audit item are also recorded as ROOT span events —
  // these reliably export with the request even where child spans don't (the
  // hosted sandbox), so the full audit trail is visible in the trace.
  root.addEvent('gen_ai.user.message', { content: truncate(ctx.userMessage) });

  const rootCtx = trace.setSpan(context.active(), root);
  const pending = new Map<string, Span>();
  let replyText = '';

  try {
    for await (const event of events) {
      switch (event.type) {
        case 'decision':
          root.addEvent('gen_ai.agent.decision', { summary: event.summary });
          break;
        case 'token':
          replyText += event.value;
          break;
        case 'tool_call': {
          const kind = auditType(event.name);
          const isModel = event.name === 'copilot.chat';
          const args = event.args ? truncate(asText(event.args)) : '';
          root.addEvent('gen_ai.tool.call', { 'tool.name': event.name, 'tool.type': kind, 'tool.arguments': args });
          const span = tracer.startSpan(
            isModel ? `chat ${ctx.model}` : `execute_tool ${event.name}`,
            {
              attributes: isModel
                ? { 'gen_ai.operation.name': 'chat', 'gen_ai.system': 'github.copilot', 'gen_ai.request.model': ctx.model, 'waypoint.audit.type': kind }
                : { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': event.name, 'waypoint.audit.type': kind },
            },
            rootCtx,
          );
          if (args) span.setAttribute('gen_ai.tool.call.arguments', args);
          pending.set(event.name, span);
          break;
        }
        case 'tool_result': {
          const result = event.result !== undefined ? truncate(asText(event.result)) : '';
          root.addEvent('gen_ai.tool.result', { 'tool.name': event.name, 'tool.ok': event.ok, 'tool.result': result });
          const span = pending.get(event.name);
          if (span) {
            if (result) span.setAttribute('gen_ai.tool.call.result', result);
            span.setStatus({ code: event.ok ? SpanStatusCode.OK : SpanStatusCode.ERROR });
            span.end();
            pending.delete(event.name);
          }
          break;
        }
        case 'error':
          root.addEvent('gen_ai.error', { code: event.code, message: event.message });
          root.setAttribute('error.type', event.code);
          root.setStatus({ code: SpanStatusCode.ERROR, message: event.code });
          break;
        default:
          break;
      }
      yield event;
    }
    // The assistant's reply (observable output — never model reasoning).
    root.setAttribute('waypoint.assistant_reply', truncate(replyText));
    root.setAttribute('gen_ai.response.output_text.length', replyText.length);
    root.addEvent('gen_ai.assistant.message', { content: truncate(replyText) });
  } catch (err) {
    root.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
    throw err;
  } finally {
    for (const span of pending.values()) span.end();
    root.end();
    // Export now — the hosted container may pause between requests (batch timer won't fire).
    await flushTracing();
  }
}
