import type { AgentEvent } from '../../../shared/types/chat-and-agent-runtime.js';
import type { AgentDriver, AgentInput } from './driver.js';
import { adviseDestinations, destinationRequestFromConversation } from '../tools/destination-advisor.js';

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
    const destinationRequest = destinationRequestFromConversation(input.message, input.history);
    const destinationResult = adviseDestinations(destinationRequest);

    // 1) An observable decision ALWAYS precedes the reply text.
    yield {
      type: 'decision',
      summary: `Use destination-advisor to help with "${preview(input.message)}".`,
    };

    // 2) Preserve the model audit lifecycle while surfacing the nested skill call.
    yield { type: 'tool_call', name: 'copilot.chat', args: { model: 'local', prompt: input.message } };
    yield { type: 'tool_call', name: 'destination-advisor', args: { ...destinationRequest } };
    yield { type: 'tool_result', name: 'destination-advisor', ok: true, result: destinationResult };

    // 3) Stream the reply one word at a time so the UI fills in progressively.
    const reply = composeReply(destinationResult);
    for (const word of reply.split(' ')) {
      await sleep(8);
      yield { type: 'token', value: word + ' ' };
    }

    yield { type: 'tool_result', name: 'copilot.chat', ok: true, result: reply };
    yield { type: 'done' };
  }
}

/** A concise conversational wrapper around the structured skill result. */
function composeReply(result: ReturnType<typeof adviseDestinations>): string {
  if (result.kind === 'clarification' || result.kind === 'redirect') return result.message;
  const names = result.suggestions.map((suggestion) => suggestion.name).join(', ');
  const prefix = result.message ? `${result.message} ` : '';
  return `${prefix}My ranked suggestions are ${names}.`;
}

function preview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? clean.slice(0, 57) + '…' : clean;
}
