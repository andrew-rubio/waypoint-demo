/**
 * Server-side proxy for resolving a runtime-governance approval (ADR-013 HITL).
 * Mirrors the chat proxy: forwards the decision to the Express API so the API
 * base URL stays server-side and the browser stays same-origin.
 */
export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8080';

export async function POST(req: Request): Promise<Response> {
  const upstream = await fetch(`${API_BASE_URL}/api/chat/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await req.text(),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
