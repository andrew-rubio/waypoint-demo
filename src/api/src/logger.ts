import pino from 'pino';

/**
 * Structured logger for the API. Never use console.log — everything goes
 * through pino so logs are JSON and secrets are redacted centrally.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Defence in depth: even if a secret reaches the logger, censor it here.
  redact: {
    paths: [
      '*.apiKey',
      '*.token',
      '*.authorization',
      'req.headers.authorization',
      'COPILOT_GITHUB_TOKEN',
    ],
    censor: '[redacted]',
  },
});
