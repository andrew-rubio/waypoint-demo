# waypoint-data MCP server — Cosmos traveller profile (INC-6) + travel-guide search (INC-8).
# Build context is the repo root so npm workspaces resolve.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/shared/package.json src/shared/
COPY src/api/package.json src/api/
COPY src/web/package.json src/web/
COPY src/mcp/package.json src/mcp/
RUN npm ci

FROM node:22-slim AS runtime
# @azure/cosmos + @azure/identity make TLS calls; debian-slim ships without a CA store.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.base.json ./
COPY src/mcp ./src/mcp
EXPOSE 8081
# Run TypeScript directly via tsx — no build step for the demo.
CMD ["node", "--import", "tsx", "src/mcp/src/server.ts"]
