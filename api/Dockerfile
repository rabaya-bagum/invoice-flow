# Build from the repo root:  docker build -f api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY api/package.json api/
RUN pnpm install --frozen-lockfile --filter @invoiceflow/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY api api
RUN pnpm --filter @invoiceflow/shared build && pnpm --filter @invoiceflow/api build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "api/dist/server.js"]
