import type { ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';

/**
 * In-memory conversation store (FR-001-6). One demo user, no database — each
 * sessionId maps to an ordered list of turns. "New chat" calls reset().
 * State lives only for the life of the process, which is exactly what the
 * walking-skeleton demo needs.
 */
export interface SessionStore {
  append(sessionId: string, message: ChatMessage): void;
  get(sessionId: string): ChatMessage[];
  reset(sessionId: string): void;
}

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, ChatMessage[]>();
  return {
    append(sessionId, message) {
      const history = sessions.get(sessionId) ?? [];
      history.push(message);
      sessions.set(sessionId, history);
    },
    get(sessionId) {
      return sessions.get(sessionId) ?? [];
    },
    reset(sessionId) {
      sessions.set(sessionId, []);
    },
  };
}
