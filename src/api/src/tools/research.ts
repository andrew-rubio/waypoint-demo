import type { ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';

/**
 * FRD-003 (INC-8 refinement) — "tell me more about X" research. Fetches a short,
 * factual summary of a place from Wikipedia (keyless REST API) so the agent can
 * give a richer, grounded description instead of a shortlist. Tests/offline use a
 * deterministic stub (no network). The live agent weaves these facts together
 * with its own travel advice.
 */

export interface ResearchResult {
  title: string;
  extract: string;
  description?: string;
  url?: string;
}

const DETAIL_PREFIX = /^\s*(please\s+)?(could you\s+|can you\s+|i'?d like to\s+)?(tell me more about|tell me about|tell me more|read more about|more about|more info(rmation)? (on|about)|describe|what'?s|what is)\s+/i;

/** Pull the place name out of a "tell me more about X" message. */
export function extractResearchPlace(message: string, _history: ChatMessage[] = []): string {
  const trimmed = message.trim();
  const stripped = trimmed
    .replace(DETAIL_PREFIX, '')
    .replace(/\s+like\s*[?.!]*$/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
  return stripped || trimmed;
}

/** The Wikipedia article title for a canonical "City, Country" — the city part. */
function articleTitle(place: string): string {
  return place.split(',')[0].trim();
}

/** Research a place via Wikipedia's summary REST API; deterministic stub under test. */
export async function researchPlace(place: string): Promise<ResearchResult | undefined> {
  const title = articleTitle(place);
  if (process.env.NODE_ENV === 'test') {
    return { title, extract: `${title} is a popular travel destination known for its culture, cuisine and landmarks.` };
  }
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { accept: 'application/json', 'user-agent': 'Waypoint-Demo/1.0 (holiday planning agent)' },
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      type?: string;
      title?: string;
      extract?: string;
      description?: string;
      content_urls?: { desktop?: { page?: string } };
    };
    if (json.type === 'disambiguation' || !json.extract) return undefined;
    return { title: json.title ?? title, extract: json.extract, description: json.description, url: json.content_urls?.desktop?.page };
  } catch {
    return undefined;
  }
}

/** Redacted summary for the `wikipedia.summary` audit entry. */
export function researchAuditSummary(place: string, result?: ResearchResult): Record<string, unknown> {
  return {
    source: 'wikipedia',
    place,
    title: result?.title ?? articleTitle(place),
    description: result?.description,
    found: Boolean(result?.extract),
    url: result?.url,
  };
}

/** A grounded, readable description for the offline/local path (the live agent enriches this itself). */
export function composeResearchReply(place: string, result?: ResearchResult): string {
  const facts = result?.extract ?? `${articleTitle(place)} is a rewarding place to visit, with plenty to see, do and eat.`;
  return `Here's a bit more about ${place}. ${facts} If you'd like, I can check the best time to visit, or search flights and hotels once you have your travel dates.`;
}
