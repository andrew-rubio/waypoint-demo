/**
 * Server-side proxy for the chat stream. Using a Route Handler (instead of a
 * Next.js rewrite) gives us reliable pass-through of the API's Server-Sent
 * Events: we forward the request to the Express API and stream its response
 * body straight back to the browser. Same-origin for the browser (no CORS),
 * and the API base URL stays server-side.
 */
export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8080';

export async function POST(req: Request): Promise<Response> {
  const fault = new URL(req.url).searchParams.get('fault');
  const target = `${API_BASE_URL}/api/chat${fault ? `?fault=${encodeURIComponent(fault)}` : ''}`;

  const upstream = await fetch(target, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: await req.text(),
  });

  // Stream the upstream SSE body straight through to the browser.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
