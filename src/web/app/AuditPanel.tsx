'use client';

import { useState, type KeyboardEvent } from 'react';
import type { AuditEntry } from '../../shared/audit';
import styles from './AuditPanel.module.css';

interface AuditGroup {
  turnId: string;
  entries: AuditEntry[];
}

interface AuditPanelProps {
  open: boolean;
  groups: AuditGroup[];
  onClear: () => void;
}

/**
 * Audit trail side panel (FRD-002). Renders the folded agent activity for the
 * current chat, grouped by turn, with a pending→ok/error lifecycle and expandable
 * request/response detail. Secrets are already redacted server-side, so this view
 * only ever shows sanitised payloads. Hidden model reasoning is never present.
 */
export function AuditPanel({ open, groups, onClear }: AuditPanelProps) {
  if (!open) return null;
  const isEmpty = groups.length === 0;

  return (
    <aside className={styles.panel} data-testid="audit-panel" role="complementary" aria-label="Audit trail">
      <div className={styles.header} data-testid="audit-panel-header">
        <h2 className={styles.title}>
          <ChartIcon />
          Audit trail
        </h2>
        <button className={styles.clear} data-testid="audit-clear" onClick={onClear}>
          Clear
        </button>
      </div>

      {isEmpty ? (
        <div className={styles.empty} data-testid="audit-empty">
          No agent activity yet
        </div>
      ) : (
        <div className={styles.list} data-testid="audit-list">
          {groups.map((group, i) => (
            <div key={group.turnId} data-testid={`audit-turn-${group.turnId}`}>
              <div className={styles.turnLabel}>Turn {i + 1}</div>
              {group.entries.map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function Entry({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => setExpanded((v) => !v);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  };

  return (
    <div
      className={`${styles.entry} ${expanded ? styles.open : ''}`}
      data-testid={`audit-entry-${entry.id}`}
      data-type={entry.type}
      data-status={entry.status}
    >
      <div
        className={styles.entryTop}
        data-testid="audit-entry-top"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className={`${styles.badge} ${styles[`t_${entry.type}`]}`} data-testid="type-badge">
          {entry.type}
        </span>
        <span className={styles.name}>{entry.name}</span>
        <span className={styles.duration} data-testid="audit-duration">
          {entry.durationMs === null ? <span className={styles.spin} aria-hidden /> : `${entry.durationMs}ms`}
        </span>
        <StatusPill status={entry.status} />
      </div>

      {expanded && (
        <div className={styles.detail} data-testid="audit-entry-detail">
          <div>
            <span className={styles.k}>request</span> {entry.requestSummary || '—'}
          </div>
          <div>
            <span className={styles.k}>response</span> {entry.responseSummary || entry.reason || '—'}
          </div>
          {entry.type === 'decision' && (
            <div className={styles.note}>Observable summary — no hidden model reasoning is captured.</div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: AuditEntry['status'] }) {
  return (
    <span className={`${styles.status} ${styles[`s_${status}`]}`} data-testid="status-pill">
      {status}
    </span>
  );
}

function ChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="m7 14 3-3 3 3 4-4" />
    </svg>
  );
}
