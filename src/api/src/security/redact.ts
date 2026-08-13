/**
 * Secret redaction (FR-001-10). Nothing that looks like a credential should
 * ever be written to a log or streamed to the browser. We redact two ways:
 *   1. by key name  — fields called apiKey / token / authorization / etc.
 *   2. by value     — anything shaped like a GitHub/Copilot token or a bearer.
 */

const SECRET_KEY = /^(authorization|api[-_]?key|token|secret|password|cookie|copilot_github_token)$/i;
const SECRET_VALUE = /((gh[opsu]|github_pat)_[A-Za-z0-9_]+)|(bearer\s+[A-Za-z0-9._-]{8,})/gi;

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(SECRET_VALUE, '[redacted]');
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(val);
    }
    return out;
  }
  return value;
}

/** Return a deep copy of `input` with any secrets replaced by "[redacted]". */
export function redactSecrets<T>(input: T): T {
  return redact(input) as T;
}
