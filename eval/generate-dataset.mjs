// Turn the team's *already-approved* Gherkin behaviour specs into the golden
// dataset for Foundry agent evaluations (INC-11, FRD-008).
//
// Each scenario in specs/features/*.feature becomes one evaluation row:
//   When "…asks X"      → query               (the user message the agent receives)
//   Then / And asserts  → expected_behavior   (the behavioural rubric = ground truth)
//   tool/audit asserts  → expected_tools      (used by the tool-selection evaluator)
//   feature + tags      → context             (dataset slices)
//
// Output: .foundry/datasets/waypoint-agent-eval-seed-v1.jsonl (Foundry schema:
// query + expected_behavior [+ ground_truth] [+ context], plus lineage fields).
//
// Run:  node eval/generate-dataset.mjs

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const featuresDir = join(repoRoot, 'specs', 'features');
const outFile = join(repoRoot, '.foundry', 'datasets', 'waypoint-agent-eval-seed-v1.jsonl');

/** Map audit-trail / tool assertions in the Gherkin to the agent's tool names. */
const TOOL_HINTS = [
  [/travel-guide|travel guide/i, 'travel-guide.searchByMonth'],
  [/cosmos/i, 'cosmos.getTravellerProfile'],
  [/open-meteo|weather (?:window|normals|climate)|weather entry/i, 'open-meteo'],
  [/routestack|flights? and hotels?|flight search|travel-search|travel search/i, 'travel-search'],
  [/currency|converts? .*gbp|in gbp|exchange rate/i, 'currency'],
  [/wikipedia|tell me more/i, 'wikipedia.summary'],
];

/** Named skills asserted explicitly, e.g. `skill entry named "destination-advisor"`. */
function skillNames(text) {
  return [...text.matchAll(/skill entry named "([^"]+)"/gi)].map((m) => m[1]);
}

/** A `When` step is an agent query only if the traveller sends a message (not a UI action). */
const MESSAGE_VERB = /\b(asks?|says?|tells?|requests?|types?|answers?|replies|reply|provides?|sends?)\b/i;
function isMessageStep(text) {
  return MESSAGE_VERB.test(text);
}

/** Pull the user's message from a `When …` step: prefer the quoted text. */
function queryFromWhen(stepText) {
  const quoted = [...stepText.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (quoted.length) return quoted.join(' ');
  // No quotes — strip the Gherkin lead-in and use the remainder as the message.
  return stepText.replace(/^(the Traveller|the user)\s+/i, '').replace(/^(asks?|says?|sends?)( for| to)?\s+/i, '').trim();
}

const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
const rows = [];

for (const file of readdirSync(featuresDir).filter((f) => f.endsWith('.feature'))) {
  const text = readFileSync(join(featuresDir, file), 'utf8');
  const doc = parser.parse(text);
  const feature = doc.feature;
  if (!feature) continue;
  const featureTag = file.replace(/\.feature$/, '');

  // Background steps apply to every scenario as preconditions.
  const background =
    feature.children.find((c) => c.background)?.background?.steps?.map((s) => s.text) ?? [];

  for (const child of feature.children) {
    const scenario = child.scenario;
    if (!scenario) continue;

    const tags = scenario.tags.map((t) => t.name).join(' ');
    const given = [];
    const whens = [];
    const thens = [];
    for (const step of scenario.steps) {
      const kw = step.keyword.trim().toLowerCase();
      if (kw === 'when') whens.push(step.text);
      else if (kw === 'then') thens.push(step.text);
      else if (kw === 'and' || kw === 'but') {
        // "And" continues the previous section — bucket by what's been seen.
        (whens.length && !thens.length ? whens : thens.length ? thens : given).push(step.text);
      } else given.push(step.text); // given / *
    }
    if (!whens.length || !thens.length) continue; // needs an input and an expectation

    // Keep only turns where the traveller sends a message to the agent (skip pure
    // UI-interaction scenarios like opening/closing the audit panel).
    const messageWhens = whens.filter(isMessageStep);
    if (!messageWhens.length) continue;

    // The traveller's message(s) for this turn.
    const query = messageWhens.map(queryFromWhen).filter(Boolean).join(' — ');
    if (!query) continue;

    // Expected tools: keyword-match the Then asserts + explicit skill names.
    const thenBlob = thens.join(' ');
    const expectedTools = new Set();
    for (const [re, tool] of TOOL_HINTS) if (re.test(thenBlob)) expectedTools.add(tool);
    for (const s of skillNames(thenBlob)) expectedTools.add(s);

    // Behavioural rubric = the approved Then assertions, as concrete expected actions.
    let rubric = thens.map((t) => t.replace(/^the (agent|audit trail|suggestions?|destination list)\s+/i, '').trim()).join('; ');
    if (expectedTools.size) rubric += `. Expected tools: ${[...expectedTools].join(', ')}.`;

    const preconditions = [...background, ...given].filter(Boolean);

    rows.push({
      query,
      expected_behavior: rubric,
      context: `${featureTag}${tags ? ' | ' + tags : ''}`,
      // Lineage + custom-evaluator inputs (Foundry ignores unknown keys):
      expected_tools: [...expectedTools],
      preconditions,
      source: `${file} :: ${scenario.name}`,
    });
  }
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

const byFeature = rows.reduce((acc, r) => {
  const f = r.context.split(' | ')[0];
  acc[f] = (acc[f] ?? 0) + 1;
  return acc;
}, {});
console.log(`Wrote ${rows.length} evaluation rows → ${outFile.replace(repoRoot + '\\', '').replace(repoRoot + '/', '')}`);
console.table(byFeature);
