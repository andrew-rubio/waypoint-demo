import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { AgentInput, AgentDriver } from './driver.js';
import { LocalAgentDriver } from './local-driver.js';
import { CopilotAgentDriver } from './copilot-driver.js';
import { logger } from '../logger.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pick the driver for this environment:
 *   - real Copilot SDK when a service token is present and we're not testing;
 *   - the deterministic local driver otherwise (tests, offline demo).
 */
function selectDriver(): AgentDriver {
  const token = process.env.COPILOT_GITHUB_TOKEN;
  if (token && process.env.NODE_ENV !== 'test') {
    logger.info('Using Copilot SDK agent driver');
    return new CopilotAgentDriver(token);
  }
  logger.info('Using local agent driver (no COPILOT_GITHUB_TOKEN / test mode)');
  return new LocalAgentDriver();
}

/** One traveller turn → a stream of AgentEvents. Optional `fault` (test/demo only). */
export interface RunAgentInput extends AgentInput {
  fault?: string;
}

export async function* runAgent(input: RunAgentInput): AsyncIterable<AgentEvent> {
  // Test/demo fault hook — never enabled in production (enforced by the route).
  if (input.fault) {
    yield* runFault(input.fault);
    return;
  }
  yield* selectDriver().run(input);
}

/**
 * Deterministic failure paths so the error-handling Gherkin scenarios
 * (AC-001-5 and edge cases) are exercisable end-to-end.
 */
async function* runFault(kind: string): AsyncIterable<AgentEvent> {
  switch (kind) {
    case 'agent-unavailable':
    case 'model-unavailable':
      yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now. Please try again.' };
      return;

    case 'timeout':
      yield { type: 'decision', summary: 'Attempt to answer the traveller.' };
      yield { type: 'error', code: 'timeout', message: 'The assistant timed out. Please try again.' };
      return;

    case 'mid-stream-error':
      yield { type: 'decision', summary: 'Attempt to answer the traveller.' };
      yield { type: 'token', value: 'Let me help you ' };
      yield { type: 'token', value: 'plan that' };
      yield { type: 'error', code: 'stream_error', message: 'The reply was interrupted. Please try again.' };
      return;

    case 'slow-reply': {
      yield { type: 'decision', summary: 'Attempt to answer the traveller.' };
      const words = 'Working on your holiday plan, one moment while I gather a few details...'.split(' ');
      for (const word of words) {
        await sleep(500);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'done' };
      return;
    }

    // A representative tool-using turn so the audit trail (FRD-002) can be
    // exercised before real MCP servers arrive (INC-3+). The apiKey below is
    // deliberately present — it must be redacted at the SSE boundary, never
    // reaching the client.
    case 'sample-tools': {
      yield { type: 'decision', summary: 'Live flight search required — calling RouteStack.' };
      yield {
        type: 'tool_call',
        name: 'routestack.searchFlights',
        args: { from: 'LON', to: 'LIS', depart: '2026-10-14', return: '2026-10-21', pax: 2, apiKey: 'super-secret-key-value' },
      };
      await sleep(120);
      yield {
        type: 'tool_result',
        name: 'routestack.searchFlights',
        ok: true,
        result: [
          { airline: 'TAP', price: { amount: 128, ccy: 'GBP' }, stops: 0 },
          { airline: 'BA', price: { amount: 146, ccy: 'GBP' }, stops: 0 },
          { airline: 'easyJet', price: { amount: 97, ccy: 'GBP' }, stops: 0 },
        ],
      };
      const words = 'Here are three direct options from London to Lisbon in October.'.split(' ');
      for (const word of words) {
        await sleep(8);
        yield { type: 'token', value: word + ' ' };
      }
      yield { type: 'done' };
      return;
    }

    // A markdown-formatted reply so the rich-text rendering in the chat is
    // exercisable (bold, bullet list, heading).
    case 'sample-markdown': {
      yield { type: 'decision', summary: 'Reply with a formatted answer.' };
      const md =
        '### Two great options\n\nHere are **two** places to consider:\n\n' +
        '- **Lisbon** — sunny and coastal\n- **Kyoto** — temples and gardens\n\nTell me which you prefer.';
      for (const chunk of md.match(/[\s\S]{1,8}/g) ?? [md]) {
        await sleep(8);
        yield { type: 'token', value: chunk };
      }
      yield { type: 'done' };
      return;
    }

    default:
      yield { type: 'error', code: 'agent_unavailable', message: 'The assistant is unavailable right now.' };
  }
}
