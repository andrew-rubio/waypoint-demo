import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { validateChatRequest } from './validation/chat.js';
import { redactSecrets } from './security/redact.js';
import { createSessionStore } from './session/store.js';
import { runAgent } from './agent/runtime.js';
import { runViaFoundryAgent, foundryAgentUrl } from './agent/foundry-agent-proxy.js';
import { parseResponsesRequest, streamResponses, collectResponse } from './responses/openai-responses.js';
import { traceAgentTurn } from './telemetry/agent-spans.js';
import { logger } from './logger.js';

/** The model deployment name, used for telemetry + the responses payload. */
function resolveModelName(): string {
  return (
    process.env.FOUNDRY_MODEL ??
    process.env.WAYPOINT_MODEL ??
    process.env.AZURE_AI_MODEL_DEPLOYMENT_NAME ??
    'waypoint'
  );
}

/**
 * Build the Waypoint API. `POST /api/chat` streams the agent's reply as
 * Server-Sent Events (see specs/contracts/api/chat-and-agent-runtime.yaml).
 * Kept as a factory so tests can create an isolated app instance.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  const store = createSessionStore();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Foundry hosted-agent readiness probe (INC-9, ADR-010).
  app.get('/readiness', (_req, res) => {
    res.json({ status: 'ready' });
  });

  app.post('/api/chat', async (req, res) => {
    // 1) Validate at the boundary (FR-001-8).
    const parsed = validateChatRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error, code: 'invalid_request' });
      return;
    }
    const { sessionId, message } = parsed.value;

    // Test/demo-only fault hook — disabled in production.
    const fault =
      process.env.NODE_ENV !== 'production'
        ? typeof req.query.fault === 'string'
          ? req.query.fault
          : typeof req.body.fault === 'string'
            ? req.body.fault
            : undefined
        : undefined;

    // 2) Open the SSE stream.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // 3) Record the user's turn, then stream the agent's reply.
    store.append(sessionId, { role: 'user', content: message, ts: new Date().toISOString() });
    const model = resolveModelName();
    let reply = '';
    try {
      // Option C: when configured, route the turn through the Foundry-hosted agent
      // so it runs on the platform and appears in the agent's Conversation view.
      // Otherwise run the local Copilot SDK runtime and trace the turn ourselves.
      const viaFoundry = !!foundryAgentUrl();
      // Redact at the boundary (FR-001-10).
      const redacted = (async function* () {
        const source = viaFoundry
          ? runViaFoundryAgent({ message, history: store.get(sessionId) })
          : runAgent({ sessionId, message, history: store.get(sessionId), fault });
        for await (const event of source) {
          yield redactSecrets(event);
        }
      })();
      // The hosted agent emits its own traces; only self-trace the local path (INC-10, ADR-011).
      const stream = viaFoundry
        ? redacted
        : traceAgentTurn(redacted, { conversationId: sessionId, turnId: randomUUID(), model, userMessage: message });
      for await (const event of stream) {
        if (event.type === 'token') reply += event.value;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      if (reply) {
        store.append(sessionId, { role: 'assistant', content: reply, ts: new Date().toISOString() });
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'agent run failed');
      res.write(`data: ${JSON.stringify({ type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now.' })}\n\n`);
    } finally {
      res.end();
    }
  });

  // Foundry `responses` protocol surface (INC-9, ADR-010, Path A). Same agent
  // runtime as /api/chat, mapped to the OpenAI Responses contract so the app can
  // be hosted on Foundry Agent Service. History is keyed by the conversation id.
  app.post('/responses', async (req, res) => {
    const parsed = parseResponsesRequest(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error, code: 'invalid_request' });
      return;
    }
    const { input, stream, conversationId } = parsed.value;
    const model = resolveModelName();

    store.append(conversationId, { role: 'user', content: input, ts: new Date().toISOString() });
    // Redact at the boundary (FR-001-10), then trace the turn (INC-10, ADR-011).
    const events = traceAgentTurn(
      (async function* () {
        let reply = '';
        for await (const event of runAgent({ sessionId: conversationId, message: input, history: store.get(conversationId) })) {
          if (event.type === 'token') reply += event.value;
          yield redactSecrets(event);
        }
        if (reply) store.append(conversationId, { role: 'assistant', content: reply, ts: new Date().toISOString() });
      })(),
      { conversationId, turnId: randomUUID(), model, userMessage: input },
    );

    try {
      if (!stream) {
        const response = await collectResponse(events, { model });
        res.status(200).json(response);
        return;
      }
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();
      for await (const frame of streamResponses(events, { model })) {
        res.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
      }
    } catch (err) {
      logger.error({ err: String(err) }, 'responses run failed');
      if (!res.headersSent) {
        res.status(500).json({ error: 'agent unavailable', code: 'agent_unavailable' });
      }
    } finally {
      res.end();
    }
  });

  return app;
}
