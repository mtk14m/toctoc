# TocToc — platform

Monorepo pnpm : `apps/api` (Fastify), plus tard `apps/web` (React) et `packages/types`.
Le pourquoi des choix est dans [`../docs`](../docs/README.md), notamment `07-architecture-mvp.md`.

## Démarrer

```bash
pnpm install
pnpm infra:up                                  # Postgres (5433) + Redis (6380)
cp apps/api/.env.example apps/api/.env
pnpm api                                       # http://localhost:3000/health
```

## Commandes

| Commande          | Rôle                              |
| ----------------- | --------------------------------- |
| `pnpm test`       | Tests unitaires (Vitest)          |
| `pnpm typecheck`  | Vérification TypeScript           |
| `pnpm format`     | Formatage Prettier                |
| `pnpm infra:up`   | Lance Postgres et Redis en Docker |
| `pnpm infra:down` | Les arrête                        |

## Conventions

- TDD : le test d'abord, puis le code (Rouge → Vert → Refactor).
- Une branche par fonctionnalité, jamais de commit direct sur `main`.
- Toute réponse HTTP suit l'enveloppe `{ success: true, data }` / `{ success: false, error: { code, message } }`.
- Les montants sont des entiers (GNF n'a pas de sous-unité).
