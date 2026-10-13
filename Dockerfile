# syntax=docker/dockerfile:1
# Track Studio: API + web app in one image.
#   docker build -t track-studio .
#   docker compose up        (see docker-compose.yml)

ARG NODE_VERSION=22

# ---------------------------------------------------------------- build
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src

# dependency layer: only manifests, so code changes don't re-install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY reference reference
COPY packages/engine packages/engine
COPY apps/server apps/server
COPY apps/web apps/web
RUN pnpm --filter @track-studio/engine test \
 && pnpm --filter @track-studio/server typecheck \
 && pnpm --filter @track-studio/web typecheck \
 && pnpm --filter @track-studio/web test \
 && pnpm --filter @track-studio/web build \
 && pnpm --filter @track-studio/server build \
 && pnpm --filter @track-studio/server deploy --prod /out \
 && rm -rf /out/src /out/test /out/build.mjs /out/tsconfig.json

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
# same layout as the repo (apps/server + reference) so seed finds reference/ and paths resolve the same way
WORKDIR /app/apps/server
COPY --from=build --chown=root:root /out ./
# the built web app; the server finds it at <root>/apps/web/dist and serves it
COPY --from=build --chown=root:root /src/apps/web/dist /app/apps/web/dist
COPY --chown=root:root reference /app/reference
# code is root-owned and read-only for the app user; only /data is writable
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
