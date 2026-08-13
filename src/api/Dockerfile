# API image — Express backend embedding the GitHub Copilot SDK.
# Build context is the repo root so npm workspaces (root + src/shared + src/api) resolve.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/shared/package.json src/shared/
COPY src/api/package.json src/api/
COPY src/web/package.json src/web/
RUN npm ci

FROM node:22-slim AS runtime
# The bundled Copilot runtime is a native binary that needs a system CA store
# for TLS; debian-slim ships without it, so install ca-certificates.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.base.json ./
COPY src/shared ./src/shared
COPY src/api ./src/api
EXPOSE 8080
# Run TypeScript directly via tsx — no build step for the demo.
CMD ["node", "--import", "tsx", "src/api/src/server.ts"]
