import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { AgentDriver, AgentInput } from './driver.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Deterministic, dependency-free agent used for tests and for running the demo
 * without a Copilot credential. It emits exactly the same event shape as the
 * real Copilot driver: one observable `decision`, then streamed `token`s, then
 * `done`. It never emits hidden reasoning — that guarantee is part of the
 * contract (AC-001-4).
 */
export class LocalAgentDriver implements AgentDriver {
  async *run(input: AgentInput): AsyncIterable<AgentEvent> {
    // 1) An observable decision ALWAYS precedes the reply text.
    yield {
      type: 'decision',
      summary: `Answer the traveller directly about "${preview(input.message)}".`,
    };

    // 2) Open a model-generation audit entry so a plain conversation still shows
    //    the model working — mirrors the real Copilot driver's copilot.chat entry.
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };

    // 3) Stream the reply one word at a time so the UI fills in progressively.
    const reply = composeReply(input.message);
    for (const word of reply.split(' ')) {
      await sleep(8);
      yield { type: 'token', value: word + ' ' };
    }

    // 4) Close the model-generation entry with the reply text, then finish.
    yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
    yield { type: 'done' };
  }
}

/** A short, friendly holiday-planning reply grounded in the traveller's text. */
function composeReply(message: string): string {
  return (
    `Happy to help you plan that! Based on "${preview(message)}", ` +
    `I can suggest destinations, check the weather for your dates, and put ` +
    `together a flight, hotel and budget summary whenever you're ready.`
  );
}

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? clean.slice(0, 57) + '…' : clean;
}
