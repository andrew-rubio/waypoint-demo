/**
 * Same-origin proxy for the API's /runtime-info. Keeps the API base URL server-side and
 * lets the runtime badge (D1 corroboration) read non-sensitive runtime metadata.
 */
export const dynamic = 'force-dynamic';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:8080';

export async function GET(): Promise<Response> {
  try {
    const upstream = await fetch(`${API_BASE_URL}/runtime-info`, { cache: 'no-store' });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ driverLabel: 'Unknown or unavailable', runtimeMode: 'unknown' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
