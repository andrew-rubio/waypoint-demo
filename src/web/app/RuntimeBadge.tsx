'use client';

import { useEffect, useState } from 'react';
import styles from './RuntimeBadge.module.css';

/**
 * D1 runtime-proof badge. Shows the ACTIVE driver (derived server-side from the real
 * selection path). The local fallback is unmistakable and never claims Foundry hosting;
 * this is one link in the corroboration chain (badge + correlation trace + portal).
 */
interface RuntimeInfo {
  driverLabel?: 'Foundry hosted agent' | 'Local deterministic driver' | 'Unknown or unavailable';
  runtimeMode?: string;
  agentVersion?: string;
  sourceCommit?: string;
  correlationId?: string;
  evidenceMode?: string;
}

export function RuntimeBadge() {
  const [info, setInfo] = useState<RuntimeInfo | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch('/api/runtime-info', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => active && setInfo(d))
        .catch(() => active && setInfo({ driverLabel: 'Unknown or unavailable' }));
    load();
    const id = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const label = info?.driverLabel ?? 'Unknown or unavailable';
  const tone = label === 'Foundry hosted agent' ? 'foundry' : label === 'Local deterministic driver' ? 'local' : 'unknown';
  const title = info
    ? `mode: ${info.runtimeMode ?? 'unknown'}\nagent: ${info.agentVersion ?? '?'}\ncommit: ${info.sourceCommit ?? '?'}\nevidence: ${info.evidenceMode ?? '?'}\ncorrelation: ${info.correlationId ?? '—'}`
    : 'loading runtime metadata…';

  return (
    <span className={`${styles.badge} ${styles[tone]}`} data-testid="runtime-badge" title={title}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}
