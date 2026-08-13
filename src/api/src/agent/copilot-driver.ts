import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { AgentDriver, AgentInput } from './driver.js';
import type { ProviderConfig } from '@github/copilot-sdk';
import type { TokenCredential } from '@azure/identity';
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

/**
 * BYOK provider settings for a Microsoft Foundry model deployment (ADR-005).
 * The model is served by Foundry; the GitHub Copilot token is no longer used for
 * inference. Auth is either a Foundry API key or — where policy disables local
 * auth — the Container App's managed identity (Entra).
 */
export interface FoundryProviderConfig {
  /** OpenAI-compatible base URL, e.g. https://<resource>.openai.azure.com/openai/v1/ */
  baseUrl: string;
  /** The Foundry deployment name (e.g. "gpt-5.4-mini"); passed to the SDK as `model`. */
  model: string;
  /** "responses" for GPT-5-series, "completions" for older models. */
  wireApi: 'responses' | 'completions';
  /** API key (BYOK key-based). Omitted when using managed identity. */
  apiKey?: string;
  /** Authenticate the model with the Container App's managed identity (Entra). */
  useManagedIdentity?: boolean;
}

// One credential instance is reused so its internal token cache is effective.
let cachedCredential: TokenCredential | undefined;

/** Build the Copilot SDK provider block for a Foundry model (key or managed identity). */
async function buildFoundryProvider(cfg: FoundryProviderConfig): Promise<ProviderConfig> {
  const base: ProviderConfig = { type: 'openai', baseUrl: cfg.baseUrl, wireApi: cfg.wireApi };
  if (cfg.useManagedIdentity) {
    const { DefaultAzureCredential } = await import('@azure/identity');
    const credential: TokenCredential = (cachedCredential ??= new DefaultAzureCredential());
    return {
      ...base,
      // Entra token for the Azure OpenAI data plane; the SDK calls this per request.
      bearerTokenProvider: async () => {
        const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
        if (!token?.token) throw new Error('Failed to acquire an Entra token for the Foundry model');
        return token.token;
      },
    };
  }
  return { ...base, apiKey: cfg.apiKey };
}

export class CopilotAgentDriver implements AgentDriver {
  // ── B1 / ADR-005: the agent's model is a Microsoft Foundry deployment (BYOK, API key). ──
  constructor(private readonly foundry: FoundryProviderConfig) {}
  // ── ORIGINAL (ADR-002, swapped out): a GitHub Copilot service token. ──
  // constructor(private readonly gitHubToken: string) {}

  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    // Lazy import so the SDK (and its bundled runtime) is only loaded when a
    // real credential is present — tests and offline demos never touch it.
    const { CopilotClient } = await import('@github/copilot-sdk');

    // ── B1 / ADR-005: BYOK → Microsoft Foundry. No GitHub auth; the model is a
    //    Foundry deployment reached via an OpenAI-compatible endpoint + API key. ──
    const client = new CopilotClient();
    await client.start();
    const model = this.foundry.model;

    // ── ORIGINAL: GitHub Copilot models via COPILOT_GITHUB_TOKEN (kept to show the swap). ──
    // const client = new CopilotClient({ gitHubToken: this.gitHubToken });
    // await client.start();
    // const model = await pickModel(client);

    // A tiny async queue bridges the SDK's callback events into the
    // `for await` stream the route consumes.
    const queue = new EventQueue();
    // Accumulated reply text, echoed into the model's audit entry.
    let reply = '';

    // BYOK provider → a Microsoft Foundry model deployment (ADR-005). This
    // environment disables API keys, so we authenticate with the Container App's
    // managed identity via a bearerTokenProvider (Entra); key-based is the fallback.
    const provider = await buildFoundryProvider(this.foundry);

    const session = await client.createSession({
      model,
      streaming: true,
      provider,

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
      const delta = e.data.deltaContent;
      reply += delta;
      queue.push({ type: 'token', value: delta });
    });
    session.on('session.idle', () => {
      // Close out the model-generation audit entry with the reply that was sent.
      queue.push({ type: 'tool_result', name: 'copilot.chat', ok: true, result: reply || 'Response generated.' });
      queue.close();
    });

    try {
      // Always record the model turn so the audit trail shows activity even when
      // no external tool is called (a plain conversational reply).
      queue.push({ type: 'decision', summary: 'Plan a reply for the traveller.' });
      queue.push({ type: 'tool_call', name: 'copilot.chat', args: { model: model ?? 'copilot', prompt: input.message } });
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
