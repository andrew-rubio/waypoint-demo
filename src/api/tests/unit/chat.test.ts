import { describe, it, expect } from 'vitest';
// These modules do not exist yet — this is the red baseline contract for INC-1.
import { validateChatRequest } from '../../src/validation/chat.js';
import { redactSecrets } from '../../src/security/redact.js';
import { createSessionStore } from '../../src/session/store.js';

describe('Chat request validation (FR-001-8)', () => {
  it('accepts a well-formed request', () => {
    const result = validateChatRequest({ sessionId: 's1', message: 'Hello' });
    expect(result.ok).toBe(true);
  });

  // AC-001-2 — empty / whitespace rejected
  it('rejects an empty message', () => {
    expect(validateChatRequest({ sessionId: 's1', message: '' }).ok).toBe(false);
  });

  it('rejects a whitespace-only message', () => {
    expect(validateChatRequest({ sessionId: 's1', message: '   ' }).ok).toBe(false);
  });

  it('rejects a missing sessionId', () => {
    expect(validateChatRequest({ message: 'Hello' } as unknown).ok).toBe(false);
  });
});

describe('Secret redaction (FR-001-10)', () => {
  it('redacts a GitHub/Copilot token before it can be logged or streamed', () => {
    const out = redactSecrets({ apiKey: 'ghp_supersecretvalue123', note: 'ok' });
    expect(JSON.stringify(out)).not.toContain('ghp_supersecretvalue123');
    expect(JSON.stringify(out)).toContain('redacted');
  });
});

describe('In-memory session store (FR-001-6)', () => {
  it('keeps conversation per session and resets on new chat', () => {
    const store = createSessionStore();
    store.append('s1', { role: 'user', content: 'Hi', ts: new Date().toISOString() });
    expect(store.get('s1')).toHaveLength(1);
    store.reset('s1');
    expect(store.get('s1')).toHaveLength(0);
  });
});
