'use client';

import { useState, type KeyboardEvent } from 'react';
import { useChat } from '../lib/useChat';
import { AuditPanel } from './AuditPanel';
import { Markdown } from './Markdown';
import styles from './page.module.css';

/**
 * Waypoint chat shell (INC-1 walking skeleton). One screen: a header, the
 * conversation (or a welcome state), and the composer. All streaming logic
 * lives in useChat — this file is just the view.
 */
export default function ChatPage() {
  const { messages, streaming, error, truncated, started, send, reset, auditOpen, auditGroups, toggleAudit, clearAudit } =
    useChat();
  const [draft, setDraft] = useState('');

  const canSend = draft.trim().length > 0 && !streaming;

  const submit = async () => {
    if (!canSend) return;
    const text = draft;
    // Keep the text in the composer if the send fails so the traveller can resend.
    const ok = await send(text);
    if (ok) setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline (FR-001-2).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={styles.app}>
      <header className={styles.header} data-testid="app-header">
        <button className={styles.brand} data-testid="brand-home" onClick={reset} aria-label="Waypoint home">
          <CompassIcon />
          Waypoint
        </button>
        <span className={styles.userChip} data-testid="user-chip">
          John Doe · Gold Tier · 7,463 Pts
        </span>
        <span className={styles.spacer} />
        <button className={styles.headerBtn} data-testid="new-chat" onClick={reset}>
          <PlusIcon />
          New chat
        </button>
        <button
          className={styles.headerBtn}
          data-testid="audit-toggle"
          aria-pressed={auditOpen}
          aria-label="Audit trail"
          onClick={toggleAudit}
        >
          <ActivityIcon />
          Audit
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.chatColumn}>
          <main className={styles.main}>
        {!started ? (
          <section className={styles.welcome} data-testid="welcome">
            <h1>Where would you like to go?</h1>
            <p>I can suggest destinations, check the weather, and plan flights, hotels and a budget — just ask.</p>
          </section>
        ) : (
          <div className={styles.thread} data-testid="message-list" role="log" aria-live="polite">
            {messages.map((m, i) => {
              const isStreamingBubble = streaming && i === messages.length - 1 && m.role === 'assistant';
              return (
                <div
                  key={i}
                  data-testid={`message-${m.role}-${i}`}
                  className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}
                >
                  {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : m.content}
                  {isStreamingBubble && <span className={styles.caret} data-testid="streaming-caret" aria-hidden />}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {error && (
        <div className={`${styles.notice} ${styles.error}`} data-testid="error-notice" role="alert">
          {error}
        </div>
      )}
      {truncated && (
        <div className={`${styles.notice} ${styles.truncation}`} data-testid="truncation-notice">
          Your message was long, so it was shortened for the agent.
        </div>
      )}

      <div className={styles.composerWrap}>
        <div className={styles.composer} data-testid="composer">
          <textarea
            className={styles.input}
            data-testid="composer-input"
            placeholder="Ask about destinations, weather, flights or hotels…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label="Message"
          />
          <button className={styles.send} data-testid="send-button" onClick={submit} disabled={!canSend}>
            <SendIcon />
            Send
          </button>
        </div>
      </div>
        </div>

        <AuditPanel open={auditOpen} groups={auditGroups} onClear={clearAudit} />
      </div>
    </div>
  );
}

/* Inline Lucide-style SVG icons (never emoji, per the design system). */
function CompassIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}
