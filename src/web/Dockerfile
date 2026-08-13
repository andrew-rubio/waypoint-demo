# Web image — Next.js frontend. Build context is the repo root (npm workspaces).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY src/shared/package.json src/shared/
COPY src/api/package.json src/api/
COPY src/web/package.json src/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY src/shared ./src/shared
COPY src/web ./src/web
RUN npm run build --workspace @waypoint/web

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/src/web ./src/web
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@waypoint/web"]
