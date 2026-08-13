'use client';

import { Fragment, useState, type KeyboardEvent } from 'react';
import type { DestinationSuggestion } from '../../shared/types/destination-advice';
import { useChat, type UiMessage } from '../lib/useChat';
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
  const activeDestinationMessage = latestDestinationMessageIndex(messages);

  const submit = async () => {
    if (!canSend) return;
    const text = draft;
    // Clear immediately on send; the message is already in the thread. Restore
    // the draft only if the send fails so the traveller can resend.
    setDraft('');
    const ok = await send(text);
    if (!ok) setDraft(text);
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
              const showDestinations = m.role === 'assistant' && i === activeDestinationMessage && !isStreamingBubble;
              return (
                <Fragment key={i}>
                  <div
                    data-testid={`message-${m.role}-${i}`}
                    className={`${styles.bubble} ${m.role === 'user' ? styles.user : styles.assistant}`}
                  >
                    {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : m.content}
                    {isStreamingBubble && <span className={styles.caret} data-testid="streaming-caret" aria-hidden />}
                  </div>
                  {showDestinations && (
                    <DestinationList message={m} onExplore={(name) => setDraft(`Tell me more about ${name}`)} />
                  )}
                </Fragment>
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

function latestDestinationMessageIndex(messages: UiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const advice = messages[index].destinationAdvice;
    if (advice && 'suggestions' in advice) return index;
  }
  return -1;
}

function DestinationList({ message, onExplore }: { message: UiMessage; onExplore: (name: string) => void }) {
  const advice = message.destinationAdvice;
  if (!advice || !('suggestions' in advice)) return null;

  return (
    <section className={styles.destinationBubble} aria-label="Suggested destinations">
      <div className={styles.destinationList} data-testid="destination-list">
        <h2>
          <MapPinIcon />
          Suggested destinations
        </h2>
        <div className={styles.destinations}>
          {advice.suggestions.map((destination, index) => (
            <DestinationItem key={destination.name} destination={destination} index={index} onExplore={onExplore} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DestinationItem({
  destination,
  index,
  onExplore,
}: {
  destination: DestinationSuggestion;
  index: number;
  onExplore: (name: string) => void;
}) {
  return (
    <article className={styles.destinationItem} data-testid={`destination-item-${index}`}>
      <div className={styles.destinationCopy}>
        <h4>{destination.name}</h4>
        <p>{destination.rationale}</p>
        <div className={styles.tags} aria-label="Destination qualities">
          {destination.tags.map((tag) => (
            <span className={styles.tag} data-testid={`tag-${tag}`} key={tag}>
              {tag}
            </span>
          ))}
        </div>
      </div>
      <button className={styles.explore} type="button" onClick={() => onExplore(destination.name)}>
        Explore
        <ArrowRightIcon />
      </button>
    </article>
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
function MapPinIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function ArrowRightIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
