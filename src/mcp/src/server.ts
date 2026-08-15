import express from 'express';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import { cosmosConfigured, readTravellerProfile } from './cosmos.js';

/**
 * waypoint-data MCP server (ADR-009). A real MCP server the Waypoint API calls
 * as a client. INC-6 exposes one tool — `getTravellerProfile` — backed by Azure
 * Cosmos DB (keyless, managed identity) with a deterministic offline fallback.
 * INC-8 will add `searchByMonth` over the travel-guide AI Search index.
 *
 * Streamable HTTP over Node/Express, stateless (one shared transport; the demo
 * is single-user). Internal ingress only — no auth on the hop.
 */
const PORT = Number(process.env.PORT ?? 8081);

const server = new McpServer({ name: 'waypoint-data', version: '1.0.0' });

server.registerTool(
  'getTravellerProfile',
  {
    description:
      "Fetch the traveller's loyalty profile, reward points, travel preferences and past destinations from Cosmos DB.",
    inputSchema: z.object({}),
  },
  async () => {
    const { profile, source } = await readTravellerProfile();
    return {
      content: [{ type: 'text', text: JSON.stringify(profile) }],
      structuredContent: { ...profile, source },
    };
  },
);

const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
await server.connect(transport);

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => {
  res.json({ ok: true, cosmos: cosmosConfigured() });
});
app.post('/mcp', (req, res) => {
  void transport.handleRequest(req, res, req.body);
});
app.get('/mcp', (req, res) => {
  void transport.handleRequest(req, res);
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`waypoint-data MCP listening on :${PORT} (cosmos=${cosmosConfigured()})`);
});
