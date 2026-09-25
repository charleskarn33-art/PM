# syntax=docker/dockerfile:1.7
# IPT PowerTech PM API. Build from the repository root:
#   docker build -f docker/api.Dockerfile --target runtime -t ipt-pm-api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

# All dependencies (build tools, Prisma CLI), from the lockfile only.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch --frozen-lockfile

FROM deps AS build
COPY tsconfig.base.json prisma.config.ts ./
COPY prisma ./prisma
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --ignore-scripts --filter ipt-powertech-pm --filter @ipt/api \
 && pnpm rebuild argon2 @prisma/engines prisma \
 && pnpm exec prisma generate \
 && pnpm --filter @ipt/api build

# One-shot job: apply pending migrations (`prisma migrate deploy`), then exit.
FROM build AS migrate
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# Standalone copy of the API with production dependencies only. (The
# repository uses pnpm's hoisted layout for Expo, where filtered installs would
# pull every app's dependencies; `pnpm deploy` does not.)
FROM build AS prod
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @ipt/api deploy --prod --legacy --config.auto-install-peers=false /out

FROM node:22-bookworm-slim AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION STORAGE_PATH=/app/storage
WORKDIR /app
COPY --from=prod /out/node_modules ./node_modules
COPY --from=prod /out/dist ./dist
COPY --from=prod /out/package.json ./package.json
# uid/gid 1000 = the image's unprivileged `node` user
RUN mkdir -p /app/storage && chown 1000:1000 /app/storage
USER 1000:1000
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
