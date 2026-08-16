// INC-8 (ADR-008) — one-time ingestion: create the `travel-guide` Azure AI Search
// index and seed it with the guide's month→destinations passages, each embedded
// via the Foundry text-embedding-3-small deployment. Run after `azd provision`:
//
//   node --import tsx scripts/ingest-guide.mjs
//
// Auth is keyless (DefaultAzureCredential = your `az login`): the deployer needs
// Search Index Data Contributor + Search Service Contributor on the Search service
// and Cognitive Services OpenAI User on the Foundry account (granted in Bicep when
// AZURE_PRINCIPAL_ID / deployerPrincipalId is set).
import { SearchIndexClient, SearchClient } from '@azure/search-documents';
import { DefaultAzureCredential } from '@azure/identity';
import { allGuidePassages } from '../src/mcp/src/travel-guide.ts';

const SEARCH_ENDPOINT = process.env.SEARCH_ENDPOINT;
const INDEX = process.env.SEARCH_INDEX ?? 'travel-guide';
const EMBED_BASE = process.env.FOUNDRY_MODEL_URL; // https://<acct>.openai.azure.com/openai/v1/
const EMBED_DEPLOYMENT = process.env.FOUNDRY_EMBEDDING_DEPLOYMENT ?? 'text-embedding-3-small';
const DIMENSIONS = 1536;

if (!SEARCH_ENDPOINT) {
  console.error('SEARCH_ENDPOINT is required (from `azd env get-values`).');
  process.exit(1);
}

const credential = new DefaultAzureCredential();

/** Embed a batch of texts via the Foundry embedding deployment (Entra bearer token). */
async function embed(texts) {
  if (!EMBED_BASE) return texts.map(() => undefined);
  const token = (await credential.getToken('https://cognitiveservices.azure.com/.default')).token;
  const res = await fetch(`${EMBED_BASE}embeddings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: EMBED_DEPLOYMENT, input: texts }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.data.map((d) => d.embedding);
}

async function ensureIndex() {
  const indexClient = new SearchIndexClient(SEARCH_ENDPOINT, credential);
  const index = {
    name: INDEX,
    fields: [
      { name: 'id', type: 'Edm.String', key: true, filterable: true },
      { name: 'month', type: 'Edm.String', filterable: true, facetable: true, searchable: true },
      { name: 'name', type: 'Edm.String', searchable: true, retrievable: true },
      { name: 'rationale', type: 'Edm.String', searchable: true, retrievable: true },
      { name: 'tags', type: 'Collection(Edm.String)', searchable: true, filterable: true, retrievable: true },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        vectorSearchDimensions: DIMENSIONS,
        vectorSearchProfileName: 'vprofile',
      },
    ],
    vectorSearch: {
      algorithms: [{ name: 'hnsw', kind: 'hnsw' }],
      profiles: [{ name: 'vprofile', algorithmConfigurationName: 'hnsw' }],
    },
  };
  await indexClient.createOrUpdateIndex(index);
  console.log(`Index '${INDEX}' created/updated.`);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  await ensureIndex();
  const passages = allGuidePassages();
  const texts = passages.map((p) => `${p.name}. ${p.rationale} Tags: ${p.tags.join(', ')}. Best in ${p.month}.`);

  let vectors = [];
  try {
    // Embed in one batch (78 short passages is well within limits).
    vectors = await embed(texts);
    console.log(`Embedded ${vectors.filter(Boolean).length}/${passages.length} passages.`);
  } catch (err) {
    console.warn(`Embedding failed (${err.message}); uploading text-only (index still searchable by month).`);
    vectors = passages.map(() => undefined);
  }

  const docs = passages.map((p, i) => ({
    id: `${slug(p.name)}-${p.month.toLowerCase()}`,
    month: p.month,
    name: p.name,
    rationale: p.rationale,
    tags: p.tags,
    ...(vectors[i] ? { contentVector: vectors[i] } : {}),
  }));

  const searchClient = new SearchClient(SEARCH_ENDPOINT, INDEX, credential);
  const result = await searchClient.uploadDocuments(docs);
  const ok = result.results.filter((r) => r.succeeded).length;
  console.log(`Uploaded ${ok}/${docs.length} guide passages to '${INDEX}'.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
