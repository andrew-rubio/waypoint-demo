import { z } from 'zod';
import {
  CHAT_LIMITS,
  type ChatRequest,
} from '../../../shared/types/chat-and-agent-runtime.js';

/**
 * Boundary validation for POST /api/chat (FR-001-8).
 * The message is trimmed and must be non-empty and within the length cap.
 */
const chatRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  message: z
    .string()
    .trim()
    .min(1, 'message must not be empty')
    .max(CHAT_LIMITS.maxMessageLength, 'message is too long'),
});

export type ValidationResult =
  | { ok: true; value: ChatRequest }
  | { ok: false; error: string };

/** Validate an untrusted request body. Returns a discriminated result. */
export function validateChatRequest(input: unknown): ValidationResult {
  const result = chatRequestSchema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.error.issues[0]?.message ?? 'invalid request' };
}
