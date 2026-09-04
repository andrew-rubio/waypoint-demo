import { DefaultAzureCredential } from '@azure/identity';
import type { AgentEvent, ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { logger } from '../logger.js';

/**
 * Option C — route a turn through the **Foundry-hosted agent** instead of the
 * local Copilot SDK runtime, so the conversation actually runs on the Foundry
 * Agent Service platform and appears in the agent's Traces / Conversation view.
 *
 * We call the platform Responses endpoint (`.../agents/<agent>/endpoint/protocols/
 * openai/responses`) with a managed-identity token, then map the Responses SSE
 * lifecycle back onto our own `AgentEvent` stream so the web app is unchanged.
 * (`decision` events are not part of the Responses payload, so the web audit
 * panel shows tool calls/results but not decision lines in this mode; the full
 * trace lives on the Foundry side.)
 */

const AGENT_AUDIENCE = 'https://ai.azure.com/.default';

let credential: DefaultAzureCredential | undefined;
function getCredential(): DefaultAzureCredential {
  credential ??= new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID });
  return credential;
}

/** The hosted-agent Responses URL, when the front-end should route via Foundry. */
export function foundryAgentUrl(): string | undefined {
  return process.env.FOUNDRY_AGENT_RESPONSES_URL;
}

interface ProxyInput {
  message: string;
  history: ChatMessage[];
}

interface ResponsesFunctionCall {
  type?: string;
  name?: string;
  arguments?: string;
  output?: string;
  ok?: boolean;
}

/** Map one parsed Responses SSE event onto zero or more AgentEvents. */
function* mapResponsesEvent(evt: {
  type?: string;
  delta?: string;
  item?: ResponsesFunctionCall;
}): Iterable<AgentEvent> {
  switch (evt.type) {
    case 'response.output_text.delta':
      if (typeof evt.delta === 'string' && evt.delta) yield { type: 'token', value: evt.delta };
      break;
    case 'response.output_item.done': {
      const item = evt.item;
      if (item?.type === 'function_call' && item.name) {
        let args: Record<string, unknown> | undefined;
        try {
          args = item.arguments ? (JSON.parse(item.arguments) as Record<string, unknown>) : undefined;
        } catch {
          args = undefined;
        }
        let result: unknown;
        try {
          result = item.output ? JSON.parse(item.output) : undefined;
        } catch {
          result = item.output;
        }
        yield { type: 'tool_call', name: item.name, args };
        yield { type: 'tool_result', name: item.name, ok: item.ok !== false, result };
      }
      break;
    }
    case 'response.completed':
      yield { type: 'done' };
      break;
    case 'response.failed':
    case 'error':
      yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now.' };
      break;
    default:
      break;
  }
}

export async function* runViaFoundryAgent({ message, history }: ProxyInput): AsyncIterable<AgentEvent> {
  const url = foundryAgentUrl();
  if (!url) throw new Error('FOUNDRY_AGENT_RESPONSES_URL not set');

  let token: string;
  try {
    token = (await getCredential().getToken(AGENT_AUDIENCE)).token;
  } catch (err) {
    logger.error({ err: String(err) }, 'failed to acquire Foundry agent token');
    yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now.' };
    return;
  }

  // Send prior turns + the new message so context is preserved (stateless).
  const input = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        accept: 'text/event-stream',
      },
      body: JSON.stringify({ input, stream: true }),
    });
  } catch (err) {
    logger.error({ err: String(err) }, 'Foundry agent request failed');
    yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now.' };
    return;
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    logger.error({ status: res.status, detail: detail.slice(0, 300) }, 'Foundry agent returned an error');
    yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now.' };
    return;
  }

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    finished = done;
    if (value) buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json || json === '[DONE]') continue;
      try {
        for (const out of mapResponsesEvent(JSON.parse(json))) yield out;
      } catch {
        // Ignore malformed frames.
      }
    }
  }
}
