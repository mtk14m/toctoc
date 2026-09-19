# syntax=docker/dockerfile:1
#
# Build depuis la racine du monorepo (platform/) :
#   docker build -f apps/api/Dockerfile --target runtime -t toctoc-api .
#
# Trois cibles : `build` (compile), `migrate` (applique les migrations Prisma),
# `runtime` (l'API, sans outils de build ni dépendances de dev).

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app


# ── build : dépendances complètes, client Prisma, compilation TypeScript ──────────────────
FROM base AS build

# Manifestes + schéma Prisma d'abord : cette couche (et l'installation) reste en cache
# tant que les dépendances et le schéma ne changent pas, même si le code change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs tsconfig.base.json ./
COPY apps/api/package.json apps/api/prisma.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
# Le `postinstall` de l'API lance `prisma generate` : il lui faut le schéma copié juste au-dessus.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

COPY apps/api apps/api
RUN pnpm --filter @toctoc/api build


# ── migrate : applique les migrations puis s'arrête ───────────────────────────────────────
FROM build AS migrate
WORKDIR /app/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]


# ── prod-deps : dépendances de production seulement ───────────────────────────────────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
COPY apps/api/package.json apps/api/
# --ignore-scripts : le client Prisma est déjà généré et compilé dans dist/, rien à générer ici.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --ignore-scripts


# ── runtime : uniquement de quoi exécuter l'API ───────────────────────────────────────────
# Image Node nue : pas de pnpm ni de corepack à l'exécution.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/api/node_modules apps/api/node_modules
COPY apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist

WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
