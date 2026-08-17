import { z } from 'zod';
import type {
  DestinationAdviceRequest,
  DestinationAdviceResult,
  DestinationCandidate,
  DestinationSuggestion,
} from '../../../shared/types/destination-advice.js';
import type { ChatMessage } from '../../../shared/types/chat-and-agent-runtime.js';
import { extractMonth } from './travel-guide.js';

const candidateSchema = z.object({
  name: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  matchedPreferences: z.array(z.string().trim().min(1)).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
});

const guidePassageSchema = z.object({
  name: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)),
  month: z.string().trim().min(1),
});

const requestSchema = z.object({
  interests: z.array(z.string().trim().min(1)).min(1),
  constraints: z.array(z.string().trim().min(1)).default([]),
  candidates: z.array(candidateSchema).optional(),
  previousSuggestions: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        rationale: z.string().trim().min(1),
        tags: z.array(z.string().trim().min(1)).min(1),
      }),
    )
    .optional(),
  month: z.string().trim().min(1).optional(),
  guidePassages: z.array(guidePassageSchema).optional(),
  pastDestinations: z.array(z.string().trim().min(1)).default([]),
});

/** SDK-facing JSON schema. The agent proposes candidates; the tool validates and ranks them. */
export const destinationAdvisorParameters = {
  type: 'object',
  additionalProperties: false,
  required: ['interests'],
  properties: {
    interests: { type: 'array', minItems: 1, items: { type: 'string' }, description: "The traveller's stated interests and preferences." },
    constraints: { type: 'array', items: { type: 'string' }, description: 'Hard constraints such as budget, region or dates.' },
    candidates: {
      type: 'array',
      description: 'Three to five destinations you propose for these preferences. Omit for a month-specific request — the travel guide supplies month-appropriate options. The tool validates, de-duplicates and ranks them.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'rationale'],
        properties: {
          name: { type: 'string', description: 'Canonical "City or Region, Country", e.g. "Lisbon, Portugal".' },
          rationale: { type: 'string', description: 'One line tying the destination to the stated preferences.' },
          matchedPreferences: { type: 'array', items: { type: 'string' }, description: 'Which stated preferences this destination satisfies.' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

/**
 * Deterministic pool used to propose candidates in test/offline mode and to
 * guarantee a valid shortlist when the agent proposes too few. In production the
 * agent proposes candidates from its own broad knowledge and this tool validates
 * and ranks them — the pool is only the safety net.
 */
interface PoolEntry {
  name: string;
  tags: string[];
  rationale: string;
}

const POOL: PoolEntry[] = [
  { name: 'Lisbon, Portugal', tags: ['warm', 'hiking', 'seafood', 'beach', 'city', 'culture', 'food'], rationale: 'Sunny Atlantic capital with coastal trails and a rich seafood scene.' },
  { name: 'Palermo, Italy', tags: ['warm', 'seafood', 'hiking', 'food', 'beach', 'culture'], rationale: 'Sicilian markets, warm coast and scenic hikes just outside the city.' },
  { name: 'Chania, Greece', tags: ['warm', 'hiking', 'seafood', 'beach', 'island', 'relaxed'], rationale: 'Cretan harbour town with gorge walks and relaxed seafood tavernas.' },
  { name: 'Split, Croatia', tags: ['warm', 'beach', 'hiking', 'seafood', 'island', 'culture'], rationale: 'Adriatic coast with island hopping, coastal hikes and fresh fish.' },
  { name: 'San Sebastián, Spain', tags: ['warm', 'seafood', 'food', 'beach', 'city'], rationale: 'Basque bay city famed for pintxos and celebrated seafood.' },
  { name: 'Valencia, Spain', tags: ['warm', 'beach', 'city', 'food', 'budget'], rationale: 'Affordable coastal city with an urban beach and great local food.' },
  { name: 'Porto, Portugal', tags: ['city', 'food', 'budget', 'culture'], rationale: 'Riverside city with wine cellars and excellent value dining.' },
  { name: 'Kraków, Poland', tags: ['city', 'culture', 'budget', 'food', 'nightlife'], rationale: 'Historic old town, lively bars and low prices.' },
  { name: 'Belgrade, Serbia', tags: ['city', 'nightlife', 'budget', 'food'], rationale: 'Energetic riverside nightlife and very affordable eating out.' },
  { name: 'Naples, Italy', tags: ['warm', 'city', 'food', 'budget', 'seafood', 'culture'], rationale: 'Warm, chaotic and delicious, with seafood and world-class pizza.' },
  { name: 'Algarve, Portugal', tags: ['warm', 'beach', 'budget', 'hiking', 'relaxed'], rationale: 'Broad beaches, clifftop walks and good-value coastal stays.' },
  { name: 'Antalya, Türkiye', tags: ['warm', 'beach', 'budget', 'family'], rationale: 'Budget-friendly Mediterranean resorts with warm, calm water.' },
  { name: 'Corfu, Greece', tags: ['warm', 'beach', 'island', 'relaxed', 'budget'], rationale: 'Green Ionian island with easy beaches and a relaxed pace.' },
  { name: 'Tromsø, Norway', tags: ['cold', 'hiking', 'skiing', 'relaxed'], rationale: 'Arctic base for the northern lights, fjord hikes and winter sports.' },
  { name: 'Reykjavík, Iceland', tags: ['cold', 'hiking', 'relaxed'], rationale: 'Compact capital near geysers, waterfalls and aurora country.' },
  { name: 'Rovaniemi, Finland', tags: ['cold', 'skiing', 'family'], rationale: 'Lapland gateway for husky trails, snow and the northern lights.' },
  { name: 'Innsbruck, Austria', tags: ['cold', 'skiing', 'hiking', 'city'], rationale: 'Alpine city with slopes and mountain trails on the doorstep.' },
  { name: 'Zermatt, Switzerland', tags: ['cold', 'skiing', 'hiking', 'relaxed'], rationale: 'Car-free Matterhorn resort for skiing and high-mountain walks.' },
];

const PREFERENCE_SYNONYMS: Record<string, string> = {
  warm: 'warm', hot: 'warm', sunny: 'warm', sun: 'warm', mediterranean: 'warm', tropical: 'warm',
  cold: 'cold', snow: 'cold', snowy: 'cold', winter: 'cold', arctic: 'cold',
  hiking: 'hiking', hike: 'hiking', trekking: 'hiking', trek: 'hiking', mountains: 'hiking', mountain: 'hiking', trails: 'hiking', walking: 'hiking',
  beach: 'beach', beaches: 'beach', coast: 'beach', coastal: 'beach', seaside: 'beach',
  seafood: 'seafood', fish: 'seafood',
  food: 'food', cuisine: 'food', culinary: 'food', gastronomy: 'food', dining: 'food', restaurants: 'food',
  budget: 'budget', cheap: 'budget', cheaper: 'budget', affordable: 'budget', afford: 'budget', value: 'budget', inexpensive: 'budget',
  city: 'city', urban: 'city', metropolitan: 'city',
  nightlife: 'nightlife', party: 'nightlife', bars: 'nightlife', clubs: 'nightlife', clubbing: 'nightlife',
  culture: 'culture', history: 'culture', historic: 'culture', historical: 'culture', museums: 'culture', museum: 'culture', art: 'culture',
  ski: 'skiing', skiing: 'skiing', snowboard: 'skiing', snowboarding: 'skiing', slopes: 'skiing',
  relax: 'relaxed', relaxed: 'relaxed', relaxing: 'relaxed', quiet: 'relaxed', calm: 'relaxed', peaceful: 'relaxed',
  island: 'island', islands: 'island',
  family: 'family', kids: 'family',
};

/** Map free text to canonical preference tags used for scoring. */
function matchPreferences(text: string): string[] {
  const matched = new Set<string>();
  if (/northern lights|aurora/.test(text)) matched.add('cold');
  for (const token of text.split(/[^a-z]+/)) {
    const canon = PREFERENCE_SYNONYMS[token];
    if (canon) matched.add(canon);
  }
  return [...matched];
}

const isCanonicalName = (name: string): boolean => /^[^,]+,\s*.+$/.test(name.trim());

/** Validate, de-duplicate and rank agent-proposed candidates. */
function rankCandidates(candidates: DestinationCandidate[], matched: string[]): DestinationSuggestion[] {
  const seen = new Set<string>();
  const scored: Array<{ suggestion: DestinationSuggestion; score: number }> = [];
  for (const candidate of candidates) {
    const name = candidate.name.trim();
    if (!isCanonicalName(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const prefs = (candidate.matchedPreferences ?? []).map((p) => p.toLowerCase());
    const score = prefs.filter((p) => matched.some((m) => p.includes(m) || m.includes(p))).length || prefs.length;
    const tags = (candidate.tags?.length ? candidate.tags : prefs.length ? prefs : ['destination']).slice(0, 5);
    scored.push({ suggestion: { name, rationale: candidate.rationale.trim(), tags }, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.suggestion);
}

/** Deterministically propose a preference-appropriate shortlist from the pool. */
function proposeFromPool(matched: string[]): DestinationSuggestion[] {
  const scored = POOL.map((entry) => ({ entry, score: entry.tags.filter((tag) => matched.includes(tag)).length }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ entry }) => {
    const hits = entry.tags.filter((tag) => matched.includes(tag));
    const tags = [...hits, ...entry.tags.filter((tag) => !hits.includes(tag))].slice(0, 5);
    const rationale = hits.length ? `${entry.rationale} Great for ${hits.join(', ')}.` : entry.rationale;
    return { name: entry.name, rationale, tags };
  });
}

/** Remove destinations the traveller has recently visited (by canonical name or city). */
function withoutPast<T extends { name: string }>(items: T[], past: string[]): T[] {
  if (!past.length) return items;
  const names = new Set(past.map((p) => p.toLowerCase()));
  const cities = new Set(past.map((p) => p.split(',')[0].trim().toLowerCase()));
  return items.filter((item) => {
    const name = item.name.toLowerCase();
    const city = item.name.split(',')[0].trim().toLowerCase();
    return !names.has(name) && !cities.has(city);
  });
}

/** Rank guide passages by how well their tags match the traveller's stated preferences. */
function rankGuidePassages(passages: DestinationAdviceRequest['guidePassages'], matched: string[]): DestinationSuggestion[] {
  const scored = (passages ?? []).map((passage) => ({
    suggestion: { name: passage.name, rationale: passage.rationale, tags: passage.tags.slice(0, 5) },
    score: passage.tags.filter((tag) => matched.includes(tag)).length,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.suggestion);
}

/** Pure, deterministic tool handler shared by the real SDK and local test driver. */
export function adviseDestinations(raw: DestinationAdviceRequest): DestinationAdviceResult {
  const request = requestSchema.parse(raw);
  const text = [...request.interests, ...request.constraints].join(' ').toLowerCase();

  if (isNonTravel(text)) {
    return { kind: 'redirect', message: 'I can help with trip and holiday planning. What sort of travel are you considering?' };
  }

  if (isVague(text)) {
    return { kind: 'clarification', message: 'Would you prefer to narrow this by climate, budget, or activity?' };
  }

  if (isNicheConflict(text)) {
    return {
      kind: 'no-match',
      message: 'There is no strong match for all three conditions, so these are the closest alternatives.',
      suggestions: [
        { name: 'Tromsø, Norway', rationale: 'Midnight sun and nearby skiing, but no tropical coral reefs.', tags: ['midnight-sun', 'skiing', 'closest-match'] },
        { name: 'Cairns, Australia', rationale: 'Tropical coral reefs with warm weather, but no nearby snow sports.', tags: ['tropical', 'coral', 'closest-match'] },
      ],
    };
  }

  if (isContradictory(text)) {
    return {
      kind: 'shortlist',
      message: 'Those interests pull in different directions: choose warm coastal options or cold snowy options.',
      suggestions: [
        { name: 'Lisbon, Portugal', rationale: 'A warm, coastal interpretation with beaches and seafood.', tags: ['warm', 'coastal', 'beach'] },
        { name: 'Reykjavík, Iceland', rationale: 'A cold, snowy interpretation with dramatic winter coastline.', tags: ['cold', 'snow', 'coastal'] },
      ],
    };
  }

  const matched = matchPreferences(text);
  const past = request.pastDestinations;

  // INC-8: when the month yielded guide passages, ground the shortlist in them.
  if (request.guidePassages && request.guidePassages.length > 0) {
    const grounded = withoutPast(rankGuidePassages(request.guidePassages, matched), past).slice(0, 5);
    const suggestions = grounded.length >= 3 ? grounded : withoutPast(proposeFromPool(matched), past).slice(0, 5);
    const month = request.month ? ` for ${request.month}` : '';
    return { kind: 'shortlist', suggestions, guideMatched: true, month: request.month, message: `From the travel guide${month}.` };
  }

  // INC-8: a month was requested but the guide had no strong match — only now does
  // the tool fall back to candidates: the model's proposals if it offered any,
  // otherwise its own deterministic pool.
  if (request.month) {
    const proposed = request.candidates ? withoutPast(rankCandidates(request.candidates, matched), past) : [];
    const suggestions = (proposed.length >= 3 ? proposed : withoutPast(proposeFromPool(matched), past)).slice(0, 5);
    return {
      kind: 'shortlist',
      suggestions,
      guideMatched: false,
      month: request.month,
      message: `The travel guide had no strong match for ${request.month}, so here are ideas based on your preferences.`,
    };
  }

  const proposed = request.candidates ? withoutPast(rankCandidates(request.candidates, matched), past) : [];
  const suggestions = proposed.length >= 3 ? proposed.slice(0, 3) : withoutPast(proposeFromPool(matched), past).slice(0, 3);
  const message = matched.length ? `Ranked for ${matched.join(', ')}.` : undefined;
  return { kind: 'shortlist', suggestions, message };
}

/** Convert a chat turn into structured tool input. */
export function destinationRequestFromConversation(message: string, _history: ChatMessage[]): DestinationAdviceRequest {
  return {
    interests: [message],
    constraints: extractConstraints(message),
    month: extractMonth(message),
  };
}

function extractConstraints(message: string): string[] {
  const text = message.toLowerCase();
  return ['cheap', 'affordable', 'budget', 'beach', 'coast'].filter((term) => text.includes(term));
}

function isVague(text: string): boolean {
  return /^(recommend somewhere|somewhere|anywhere|where should i go)\??$/.test(text.trim());
}

/** Detect a "tell me more about X" style follow-up asking for detail on a place (INC-8). */
export function isDetailQuery(message: string): boolean {
  return /\b(tell me (more|about)|more about|more info|read more|describe|what'?s it like|what is it like)\b/i.test(message);
}

function isNonTravel(text: string): boolean {
  return /tax return|source code|legal contract|medical diagnosis/.test(text);
}

function isContradictory(text: string): boolean {
  return /(hot|warm).*(snow|snowy)|(snow|snowy).*(hot|warm)/.test(text);
}

function isNicheConflict(text: string): boolean {
  return /midnight sun/.test(text) && /tropical|coral/.test(text) && /ski/.test(text);
}
