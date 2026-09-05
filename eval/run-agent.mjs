// Agent runner — step 1 of the Foundry evaluation pipeline.
//
// Reads the smoke (or seed) golden dataset, replays each `query` against the
// deployed Foundry-hosted `waypoint-agent` via its Responses endpoint, and
// captures the agent's answer + tool calls. The output JSONL (query + response
// + tool_calls) is the input to eval/evaluate.py, which scores it with Foundry
// evaluators. Every query runs as an independent single-turn conversation.
//
// Usage:
//   node eval/run-agent.mjs [--input <file>] [--output <file>] [--limit N]
//
// Auth: DefaultAzureCredential (local `az login`, or a managed identity in CI)
// for audience https://ai.azure.com. Endpoint from FOUNDRY_AGENT_RESPONSES_URL
// or the built-in default below.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DefaultAzureCredential } from '@azure/identity';

const DEFAULT_RESPONSES_URL =
  'https://aif-dnszpz4hqfi7g.services.ai.azure.com/api/projects/waypoint/agents/waypoint-agent/endpoint/protocols/openai/responses?api-version=v1';
const AGENT_AUDIENCE = 'https://ai.azure.com/.default';

function parseArgs(argv) {
  const args = { input: '.foundry/datasets/waypoint-agent-smoke-v1.jsonl', output: '.foundry/datasets/waypoint-agent-smoke-responses.jsonl', limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Replay one query against the hosted agent; return { response, toolCalls }. */
async function runOne(url, bearer, query) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
      accept: 'text/event-stream',
    },
    body: JSON.stringify({ input: query, stream: true }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`agent returned ${res.status}: ${detail.slice(0, 300)}`);
  }

  let text = '';
  const toolCalls = [];
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = '';
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    finished = done;
    if (value) buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json || json === '[DONE]') continue;
      let evt;
      try {
        evt = JSON.parse(json);
      } catch {
        continue;
      }
      if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
        text += evt.delta;
      } else if (evt.type === 'response.output_item.done' && evt.item?.type === 'function_call' && evt.item.name) {
        let args;
        try {
          args = evt.item.arguments ? JSON.parse(evt.item.arguments) : undefined;
        } catch {
          args = evt.item.arguments;
        }
        let result;
        try {
          result = evt.item.output ? JSON.parse(evt.item.output) : undefined;
        } catch {
          result = evt.item.output;
        }
        toolCalls.push({ name: evt.item.name, arguments: args, result, ok: evt.item.ok !== false });
      }
    }
  }
  return { response: text.trim(), toolCalls };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.FOUNDRY_AGENT_RESPONSES_URL || DEFAULT_RESPONSES_URL;
  const rows = readJsonl(args.input).slice(0, args.limit);

  console.log(`Running ${rows.length} queries against ${url}`);
  const credential = new DefaultAzureCredential({ managedIdentityClientId: process.env.AZURE_CLIENT_ID });
  const bearer = (await credential.getToken(AGENT_AUDIENCE)).token;

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    process.stdout.write(`[${i + 1}/${rows.length}] ${row.query.slice(0, 60)}… `);
    try {
      const { response, toolCalls } = await runOne(url, bearer, row.query);
      out.push({
        query: row.query,
        response,
        tool_calls: toolCalls.map((t) => t.name),
        tool_calls_detail: toolCalls,
        expected_behavior: row.expected_behavior ?? '',
        expected_tools: row.expected_tools ?? [],
        context: row.context ?? '',
        smoke_reason: row.smoke_reason ?? '',
        source: row.source ?? '',
      });
      console.log(`ok (${response.length} chars, ${toolCalls.length} tools: ${toolCalls.map((t) => t.name).join(', ') || 'none'})`);
    } catch (err) {
      console.log(`FAILED: ${String(err)}`);
      out.push({
        query: row.query,
        response: '',
        tool_calls: [],
        tool_calls_detail: [],
        expected_behavior: row.expected_behavior ?? '',
        expected_tools: row.expected_tools ?? [],
        context: row.context ?? '',
        smoke_reason: row.smoke_reason ?? '',
        source: row.source ?? '',
        error: String(err),
      });
    }
  }

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const failures = out.filter((r) => r.error).length;
  console.log(`\nWrote ${out.length} rows to ${args.output}${failures ? ` (${failures} failed)` : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
