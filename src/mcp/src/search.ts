import { offlineGuideByMonth, type GuidePassage } from './travel-guide.js';

/**
 * Travel-guide retrieval for the `searchByMonth` MCP tool (ADR-008). In
 * production this runs a hybrid vector query over the Azure AI Search
 * `travel-guide` index (populated by the ingestion step from the guide PDF); the
 * curated offline dataset backs it when AI Search is not configured, mirroring
 * the Cosmos/offline profile pattern so the demo always works.
 */

const SEARCH_ENDPOINT = process.env.SEARCH_ENDPOINT;
const SEARCH_INDEX = process.env.SEARCH_INDEX ?? 'travel-guide';

/** True when an Azure AI Search endpoint is configured (the live path). */
export function searchConfigured(): boolean {
  return Boolean(SEARCH_ENDPOINT);
}

export interface GuideSearchResult {
  passages: GuidePassage[];
  source: 'ai-search' | 'offline';
}

/** Retrieve the guide's picks for a month from AI Search, falling back offline. */
export async function searchGuideByMonth(month: string): Promise<GuideSearchResult> {
  if (!SEARCH_ENDPOINT) return { passages: offlineGuideByMonth(month), source: 'offline' };
  try {
    const passages = await queryAiSearch(month);
    if (passages.length === 0) return { passages: offlineGuideByMonth(month), source: 'offline' };
    return { passages, source: 'ai-search' };
  } catch {
    return { passages: offlineGuideByMonth(month), source: 'offline' };
  }
}

/** Hybrid keyword + month-filter query over the AI Search travel-guide index. */
async function queryAiSearch(month: string): Promise<GuidePassage[]> {
  const canonicalMonth = month.trim();
  const { SearchClient } = await import('@azure/search-documents');
  const { DefaultAzureCredential } = await import('@azure/identity');
  const client = new SearchClient<GuidePassage>(SEARCH_ENDPOINT!, SEARCH_INDEX, new DefaultAzureCredential());
  const results = await client.search(canonicalMonth, {
    filter: `month eq '${canonicalMonth}'`,
    top: 8,
    searchFields: ['month', 'name', 'rationale', 'tags'],
    select: ['name', 'rationale', 'tags', 'month'],
  });
  const passages: GuidePassage[] = [];
  for await (const r of results.results) passages.push(r.document);
  return passages;
}
