import type { PersonalisationProfile } from '../../../shared/types/personalisation.js';
import { getTravellerProfile } from './cosmos.js';
import { logger } from '../logger.js';

/**
 * MCP client for the self-hosted `waypoint-data` MCP server (ADR-009). The API
 * calls the `getTravellerProfile` tool over Streamable HTTP — a genuine MCP
 * round-trip that the audit surfaces as `cosmos.getTravellerProfile`. Used only
 * by the production Copilot driver; tests/offline keep the deterministic
 * in-process profile. Falls back to that offline profile if the MCP is not
 * configured or the call fails, so the demo never breaks.
 */

const MCP_URL = process.env.WAYPOINT_DATA_MCP_URL;

/** True when the waypoint-data MCP endpoint is configured (the live path). */
export function hasWaypointDataMcp(): boolean {
  return Boolean(MCP_URL);
}

/** Call the waypoint-data MCP `getTravellerProfile` tool; fall back offline on any failure. */
export async function fetchTravellerProfile(): Promise<{ profile: PersonalisationProfile; source: 'cosmos' | 'offline' }> {
  if (!MCP_URL) return { profile: getTravellerProfile(), source: 'offline' };

  // Lazy-import so the MCP client is only loaded when a live endpoint is present.
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
  const client = new Client({ name: 'waypoint-api', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'getTravellerProfile', arguments: {} });
    if (result.isError) throw new Error('getTravellerProfile returned a tool error');
    return { profile: parseProfile(result), source: 'cosmos' };
  } catch (err) {
    logger.warn({ err: String(err) }, 'waypoint-data MCP call failed; using offline profile');
    return { profile: getTravellerProfile(), source: 'offline' };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Read the profile from the tool result (structuredContent, else the text content JSON). */
function parseProfile(result: { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> }): PersonalisationProfile {
  const structured = result.structuredContent;
  if (structured && typeof structured === 'object') return structured as PersonalisationProfile;
  const text = result.content?.find((block) => block.type === 'text')?.text;
  if (text) return JSON.parse(text) as PersonalisationProfile;
  throw new Error('waypoint-data getTravellerProfile returned no profile content');
}
