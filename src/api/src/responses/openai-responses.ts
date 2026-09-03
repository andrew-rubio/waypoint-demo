import { randomUUID } from 'node:crypto';
import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';

/**
 * Foundry `responses` protocol adapter (INC-9, ADR-010, Path A).
 *
 * The Foundry Agent Service invokes a hosted agent over the OpenAI-compatible
 * **Responses** protocol: `POST /responses` with `{ input, stream }`, replying
 * either a single Response object or the Responses **SSE lifecycle**
 * (`response.created` → `response.output_text.delta` → `response.completed`).
 *
 * There is no Node host SDK, so this maps our own `AgentEvent` stream onto that
 * contract by hand. Text tokens become output-text deltas; `tool_call` /
 * `tool_result` become `function_call` output items (so tool-call evaluators can
 * read them); `error` becomes `response.failed`. `decision` / `status` events are
 * observability-only and are not part of the model-facing payload.
 */

/** A single Server-Sent Event to write as `event: <event>\ndata: <json>\n\n`. */
export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

/** Parsed, validated `POST /responses` request. */
export interface ResponsesRequest {
  input: string;
  stream: boolean;
  /** Conversation id → in-memory session key (FR-001-6). */
  conversationId: string;
}

export interface ResponsesContext {
  /** Model deployment name to echo back (informational). */
  model: string;
}

/** Coerce the OpenAI `input` (string or message array) to a single user string. */
function inputToText(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) {
    // Take the last item's text — supports [{ role, content }] and content parts.
    for (let i = input.length - 1; i >= 0; i--) {
      const item = input[i] as { content?: unknown } | undefined;
      const content = item?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        const part = content.find((p) => typeof (p as { text?: unknown })?.text === 'string');
        if (part) return (part as { text: string }).text;
      }
    }
  }
  return undefined;
}

/**
 * Validate an untrusted `POST /responses` body. Mirrors the `/api/chat`
 * boundary rules but in the Responses shape. `conversation`/`previous_response_id`
 * (if present) seed the session key; otherwise a fresh one is issued.
 */
export function parseResponsesRequest(
  body: unknown,
): { ok: true; value: ResponsesRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = inputToText(b.input)?.trim();
  if (!text) return { ok: false, error: 'input must contain non-empty text' };
  if (text.length > 8000) return { ok: false, error: 'input is too long' };

  const conv = b.conversation as { id?: string } | string | undefined;
  const conversationId =
    (typeof conv === 'string' ? conv : conv?.id) ??
    (typeof b.previous_response_id === 'string' ? b.previous_response_id : undefined) ??
    `conv_${randomUUID()}`;

  return { ok: true, value: { input: text, stream: b.stream === true, conversationId } };
}

/** The output items assembled while consuming the agent stream. */
interface Accumulated {
  text: string;
  toolItems: Array<Record<string, unknown>>;
  error?: { code: string; message: string };
}

/** Build the base Response object shared by lifecycle events and the final reply. */
function responseObject(
  id: string,
  status: 'in_progress' | 'completed' | 'failed',
  model: string,
  acc: Accumulated,
): Record<string, unknown> {
  const output: Array<Record<string, unknown>> = [];
  if (acc.text || status === 'completed') {
    output.push({
      id: `msg_${id}`,
      type: 'message',
      status: status === 'in_progress' ? 'in_progress' : 'completed',
      role: 'assistant',
      content: acc.text ? [{ type: 'output_text', text: acc.text, annotations: [] }] : [],
    });
  }
  output.push(...acc.toolItems);
  const base: Record<string, unknown> = { id, object: 'response', status, model, output };
  if (status === 'completed') base.output_text = acc.text;
  if (acc.error) base.error = acc.error;
  return base;
}

/** A `function_call` output item representing one tool invocation. */
function functionCallItem(id: string, name: string, args: unknown, result: unknown, ok: boolean) {
  return {
    id: `fc_${id}`,
    type: 'function_call',
    status: 'completed',
    name,
    arguments: JSON.stringify(args ?? {}),
    output: result === undefined ? undefined : JSON.stringify(result),
    ok,
  };
}

/**
 * Stream the agent's turn as OpenAI Responses SSE frames. Callers write each
 * frame and are responsible for boundary redaction of the underlying events.
 */
export async function* streamResponses(
  events: AsyncIterable<AgentEvent>,
  ctx: ResponsesContext,
): AsyncIterable<SseFrame> {
  const id = `resp_${randomUUID()}`;
  const acc: Accumulated = { text: '', toolItems: [] };
  const msgId = `msg_${id}`;
  let messageOpen = false;
  let outputIndex = 0;

  yield { event: 'response.created', data: { type: 'response.created', response: responseObject(id, 'in_progress', ctx.model, acc) } };
  yield { event: 'response.in_progress', data: { type: 'response.in_progress', response: responseObject(id, 'in_progress', ctx.model, acc) } };

  const pendingArgs = new Map<string, unknown>();

  for await (const event of events) {
    switch (event.type) {
      case 'token': {
        if (!messageOpen) {
          messageOpen = true;
          yield {
            event: 'response.output_item.added',
            data: {
              type: 'response.output_item.added',
              output_index: outputIndex,
              item: { id: msgId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
            },
          };
        }
        acc.text += event.value;
        yield {
          event: 'response.output_text.delta',
          data: { type: 'response.output_text.delta', item_id: msgId, output_index: outputIndex, content_index: 0, delta: event.value },
        };
        break;
      }
      case 'tool_call':
        pendingArgs.set(event.name, event.args);
        break;
      case 'tool_result': {
        const item = functionCallItem(randomUUID(), event.name, pendingArgs.get(event.name), event.result, event.ok);
        pendingArgs.delete(event.name);
        acc.toolItems.push(item);
        const toolIndex = ++outputIndex;
        yield { event: 'response.output_item.added', data: { type: 'response.output_item.added', output_index: toolIndex, item } };
        yield { event: 'response.output_item.done', data: { type: 'response.output_item.done', output_index: toolIndex, item } };
        break;
      }
      case 'error':
        acc.error = { code: event.code, message: event.message };
        yield { event: 'response.failed', data: { type: 'response.failed', response: responseObject(id, 'failed', ctx.model, acc) } };
        return;
      // 'decision' | 'status' | 'done' are not part of the Responses payload.
      default:
        break;
    }
  }

  if (messageOpen) {
    yield { event: 'response.output_text.done', data: { type: 'response.output_text.done', item_id: msgId, output_index: 0, content_index: 0, text: acc.text } };
    yield {
      event: 'response.output_item.done',
      data: {
        type: 'response.output_item.done',
        output_index: 0,
        item: { id: msgId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: acc.text, annotations: [] }] },
      },
    };
  }
  yield { event: 'response.completed', data: { type: 'response.completed', response: responseObject(id, 'completed', ctx.model, acc) } };
}

/** Collect a non-streaming Response object from the agent's turn. */
export async function collectResponse(
  events: AsyncIterable<AgentEvent>,
  ctx: ResponsesContext,
): Promise<Record<string, unknown>> {
  const id = `resp_${randomUUID()}`;
  const acc: Accumulated = { text: '', toolItems: [] };
  const pendingArgs = new Map<string, unknown>();

  for await (const event of events) {
    if (event.type === 'token') acc.text += event.value;
    else if (event.type === 'tool_call') pendingArgs.set(event.name, event.args);
    else if (event.type === 'tool_result') {
      acc.toolItems.push(functionCallItem(randomUUID(), event.name, pendingArgs.get(event.name), event.result, event.ok));
      pendingArgs.delete(event.name);
    } else if (event.type === 'error') {
      acc.error = { code: event.code, message: event.message };
      return responseObject(id, 'failed', ctx.model, acc);
    }
  }
  return responseObject(id, 'completed', ctx.model, acc);
}
