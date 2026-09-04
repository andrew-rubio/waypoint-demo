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

writeFileSync(outFile, picked.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
console.log(`Wrote ${picked.length} smoke rows -> .foundry/datasets/waypoint-agent-smoke-v1.jsonl`);
for (const r of picked) console.log(`  [${feature(r)}] ${r.query}  (${r.smoke_reason})`);
