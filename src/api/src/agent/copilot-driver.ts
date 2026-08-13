import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { AgentDriver, AgentInput } from './driver.js';
import { logger } from '../logger.js';

/**
 * The showcase: a real agent powered by the GitHub Copilot SDK.
 *
 * This is deliberately small — the whole point of the demo is that wiring an
 * agent takes only a handful of calls:
 *   1. `new CopilotClient({ gitHubToken })`  → authenticate
 *   2. `client.createSession({ ... })`        → get a conversation
 *   3. `session.send({ prompt })`             → ask
 *   4. listen for streamed events             → forward to the browser
 *
 * Every observable thing the agent does — a permission decision, an MCP/tool
 * call, its result — is turned into an AgentEvent and streamed out. That stream
 * IS the audit trail. We never forward the model's private reasoning.
 *
 * MCP servers (weather, flights/hotels, currency, Fabric data) are added in
 * later increments; INC-1 only needs chat, but the permission hook and
 * allowlist below are already in place so the audit wiring is demonstrable.
 */

/** The only MCP servers this agent is ever allowed to call (INC-1: none live yet). */
const MCP_ALLOWLIST = ['routestack', 'open-meteo', 'microsoft-fabric-data-agent', 'currency'];

/**
 * Choose a model the current token can actually use. Prefer COPILOT_MODEL, then
 * a sensible fallback order, then whatever the account lists first.
 */
async function pickModel(client: any): Promise<string | undefined> {
  const preferred = ['gpt-4o', 'gpt-4.1', 'claude-sonnet-4.5', 'claude-3.5-sonnet', 'o4-mini', 'gpt-4o-mini'];
  try {
    const models: any[] = (await client.listModels()) ?? [];
    const ids = models.map((m) => m.id ?? m.name ?? m.model).filter(Boolean);
    logger.info({ models: ids }, 'Copilot models available to this token');
    if (process.env.COPILOT_MODEL) return process.env.COPILOT_MODEL;
    return preferred.find((p) => ids.includes(p)) ?? ids[0];
  } catch (err) {
    logger.warn({ err: String(err) }, 'listModels failed; falling back to COPILOT_MODEL/default');
    return process.env.COPILOT_MODEL; // let the SDK apply its own default
  }
}

export class CopilotAgentDriver implements AgentDriver {
  constructor(private readonly gitHubToken: string) {}

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    // Lazy import so the SDK (and its bundled runtime) is only loaded when a
    // real credential is present — tests and offline demos never touch it.
    const { CopilotClient } = await import('@github/copilot-sdk');

    const client = new CopilotClient({ gitHubToken: this.gitHubToken });
    await client.start();

    // Pick a model this token actually has access to (don't hardcode one).
    const model = await pickModel(client);

    // A tiny async queue bridges the SDK's callback events into the
    // `for await` stream the route consumes.
    const queue = new EventQueue();

    const session = await client.createSession({
      model,
      streaming: true,

      // Called before every tool / MCP call. This is where the audit trail is
      // born: we record the decision, enforce the allowlist, then approve.
      onPermissionRequest: (request: any) => {
        const name: string = request.toolName ?? request.kind ?? 'tool';
        queue.push({ type: 'decision', summary: `Use ${name} to help answer the request.` });

        if (request.kind === 'mcp') {
          const server = String(name).split('-')[0];
          if (!MCP_ALLOWLIST.includes(server)) {
            return { kind: 'reject', feedback: `MCP server "${server}" is not allow-listed.` };
          }
        }
        return { kind: 'approve-once' };
      },

      // Observe tool execution start/finish and surface them to the audit trail.
      hooks: {
        onPreToolUse: async (i: any) => {
          queue.push({ type: 'tool_call', name: i.toolName, args: i.toolArgs });
          return { permissionDecision: 'allow' };
        },
        onPostToolUse: async (i: any) => {
          queue.push({ type: 'tool_result', name: i.toolName, ok: true, result: i.result });
          return {};
        },
        onPostToolUseFailure: async (i: any) => {
          queue.push({ type: 'tool_result', name: i.toolName, ok: false, result: i.error });
          return {};
        },
      },
    });

    // Stream reply text as `token` events. We intentionally do NOT subscribe to
    // `assistant.reasoning_delta` — hidden chain-of-thought never leaves here.
    session.on('assistant.message_delta', (e: any) => {
      queue.push({ type: 'token', value: e.data.deltaContent });
    });
    session.on('session.idle', () => queue.close());

    try {
      await session.send({ prompt: input.message });
      // Drain events until the session goes idle.
      for await (const event of queue) {
        yield event;
      }
      yield { type: 'done' };
    } catch (err) {
      logger.error({ err: String(err) }, 'Copilot session failed');
      yield {
        type: 'error',
        code: 'agent_unavailable',
        message: 'The assistant is unavailable right now.',
      };
    } finally {
      await session.disconnect();
      await client.stop();
    }
  }
}

/**
 * Minimal push/pull async queue: SDK callbacks `push()`, the generator awaits
 * the next item, and `close()` ends the stream.
 */
class EventQueue implements AsyncIterable<AgentEvent> {
  private readonly buffer: AgentEvent[] = [];
  private waiting: ((r: IteratorResult<AgentEvent>) => void) | null = null;
  private closed = false;

  push(event: AgentEvent): void {
    if (this.waiting) {
      this.waiting({ value: event, done: false });
      this.waiting = null;
    } else {
      this.buffer.push(event);
    }
  }

  close(): void {
    this.closed = true;
    if (this.waiting) {
      this.waiting({ value: undefined as never, done: true });
      this.waiting = null;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    while (true) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift() as AgentEvent;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<AgentEvent>>((resolve) => {
        this.waiting = resolve;
      });
      if (next.done) return;
      yield next.value;
    }
  }
}
