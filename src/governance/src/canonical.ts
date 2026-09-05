import { createHash } from 'node:crypto';

/**
 * Deterministic canonicalisation + hashing.
 *
 * The contract hash is the identity that human approval binds to, so it MUST be
 * byte-stable for semantically-equivalent inputs and MUST change when any material
 * obligation changes. Canonicalisation rules (see ADR-012 / FRD-010):
 *   - object keys sorted lexicographically;
 *   - arrays preserved in caller-sorted order (controls sorted by id, evidence by id
 *     upstream) — we do not reorder arrays here to avoid hiding a real ordering change;
 *   - numbers, booleans, null and strings preserved without lossy coercion;
 *   - undefined keys dropped (JSON has no undefined);
 *   - line endings are irrelevant because we hash a canonical JSON string, never YAML text.
 */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = canonicalise(v);
    }
    return out;
  }
  return value;
}

/** Canonical JSON string — stable regardless of input key order or formatting. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

/** sha256 of the canonical JSON form, prefixed with the algorithm for transparency. */
export function sha256Of(value: unknown): string {
  return 'sha256:' + createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** sha256 of a raw string/buffer (for result-file hashes). */
export function sha256OfBytes(data: string | Buffer): string {
  return 'sha256:' + createHash('sha256').update(data).digest('hex');
}
