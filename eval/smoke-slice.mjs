// Curate a small, high-signal SMOKE slice of the golden dataset for a fast, cheap
// first eval run (INC-11, FRD-008). ~12 rows covering all 7 features plus the cases
// that exercise the custom evaluators (RAG grounding, tool selection, Open-Meteo
// grounding, one-clarifying-question). Reproducible — derived from the seed dataset.
//
// Run:  node eval/smoke-slice.mjs   (after npm run eval:dataset)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedFile = join(repoRoot, '.foundry', 'datasets', 'waypoint-agent-eval-seed-v1.jsonl');
const outFile = join(repoRoot, '.foundry', 'datasets', 'waypoint-agent-smoke-v1.jsonl');

const seed = readFileSync(seedFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const feature = (r) => (r.context.split(' | ')[0] || '').trim();

// Each selector picks the best row matching a feature + query fragment; when several
// match, prefer the one with the most expected_tools (richest turn). `why` documents
// which evaluation dimension the row is chosen to exercise.
const selectors = [
  { feature: 'destination-advice', q: 'Where should I go in June', why: 'RAG grounding + tool selection + personalisation' },
  { feature: 'destination-advice', q: 'recommend somewhere', why: 'vague input -> exactly one clarifying question' },
  { feature: 'destination-advice', q: 'review my tax return', why: 'out-of-scope -> graceful decline' },
  { feature: 'weather-and-timing', q: 'weather like in Lisbon in June', why: 'Open-Meteo ERA5 grounding + tool selection' },
  { feature: 'weather-and-timing', q: 'best time to visit Iceland', why: 'timing advice grounded in climate normals' },
  { feature: 'flight-hotel-search-booking', q: 'find flights and hotels for Lisbon', why: 'RouteStack tool selection' },
  { feature: 'flight-hotel-search-booking', q: 'book the first flight', why: 'simulated booking flow' },
  { feature: 'personalisation', q: 'warm coastal break', why: 'Cosmos personalisation' },
  { feature: 'trip-summary-and-budget', q: 'summarise the trip and total cost', why: 'summary + budget tools' },
  { feature: 'trip-summary-and-budget', q: 'show that in euros', why: 'GBP->EUR currency conversion' },
  { feature: 'chat-and-agent-runtime', q: 'want to plan a holiday', why: 'core streamed runtime' },
  { feature: 'audit-trail', q: '', why: 'observable audit: decisions, no hidden reasoning' },
];

const picked = [];
const seen = new Set();
for (const sel of selectors) {
  const matches = seed
    .filter((r) => feature(r) === sel.feature && (!sel.q || r.query.toLowerCase().includes(sel.q.toLowerCase())))
    .sort((a, b) => (b.expected_tools?.length ?? 0) - (a.expected_tools?.length ?? 0));
  const row = matches.find((r) => !seen.has(r.query));
  if (!row) {
    console.warn(`! no match for ${sel.feature} :: "${sel.q}"`);
    continue;
  }
  seen.add(row.query);
  picked.push({ ...row, smoke_reason: sel.why });
}

// Follow-up turns can't be evaluated cold: the hosted agent is stateless per
// request, so a bare "book the first flight" has no prior search to act on and a
// Foundry conversation only threads text, not the structured trip state. Instead
// we rewrite these into self-contained turns that build the trip and then do the
// follow-up in one request. Dates are computed ~3 months out so they stay in the
// future whenever the dataset is regenerated (durable for CI).
const d1 = new Date();
d1.setMonth(d1.getMonth() + 3);
const d2 = new Date(d1);
d2.setDate(d2.getDate() + 4);
const fmt = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const trip = `Find flights and hotels for Lisbon departing London on ${fmt(d1)} returning ${fmt(d2)}`;
const rewrites = {
  'book the first flight': `${trip}, then book the first flight and the first hotel.`,
  'summarise the trip and total cost': `${trip}, then summarise the trip and total cost.`,
  'show that in euros': `${trip}, summarise the trip and total cost, then show that total in euros.`,
};
for (const r of picked) {
  for (const [frag, rewritten] of Object.entries(rewrites)) {
    if (r.query.toLowerCase().includes(frag.toLowerCase())) {
      r.query = rewritten;
      r.self_contained = true;
      break;
    }
  }
}

writeFileSync(outFile, picked.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
console.log(`Wrote ${picked.length} smoke rows -> .foundry/datasets/waypoint-agent-smoke-v1.jsonl`);
for (const r of picked) {
  const tag = r.self_contained ? ' [self-contained follow-up]' : '';
  console.log(`  [${feature(r)}] ${r.query.slice(0, 70)}  (${r.smoke_reason})${tag}`);
}
