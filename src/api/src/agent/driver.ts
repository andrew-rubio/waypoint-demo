import type {
  AgentEvent,
  ChatMessage,
} from '../../../shared/types/chat-and-agent-runtime.js';

/** Everything a driver needs to answer one turn. */
export interface AgentInput {
  sessionId: string;
  /** The traveller's latest message. */
  message: string;
  /** Prior turns for this session (oldest first). */
  history: ChatMessage[];
}

/**
 * An AgentDriver turns one traveller message into a stream of AgentEvents.
 * Two implementations exist:
 *   - CopilotDriver: the real GitHub Copilot SDK (the demo showcase).
 *   - LocalDriver:   a deterministic, offline reply used for tests and for
 *                    running the demo without a Copilot credential.
 * Both emit the SAME event contract, so the rest of the app never cares which
 * one is active.
 */
export interface AgentDriver {
  run(input: AgentInput): AsyncIterable<AgentEvent>;
}
