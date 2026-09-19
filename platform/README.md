# TocToc — platform

Monorepo pnpm : `apps/api` (Fastify), plus tard `apps/web` (React) et `packages/types`.
Le pourquoi des choix est dans [`../docs`](../docs/README.md), notamment `07-architecture-mvp.md`.

## Démarrer

```bash
pnpm install
pnpm infra:up                                  # Postgres (5433) + Redis (6380)
cp apps/api/.env.example apps/api/.env
pnpm --filter @toctoc/api db:migrate           # applique les migrations Prisma
pnpm api                                       # http://localhost:3000/health
```

## Tout lancer en conteneur

```bash
pnpm stack:up      # construit l'image, applique les migrations, démarre l'API sur :3000
pnpm stack:logs    # suit les logs de l'API — c'est là que s'affiche le code de connexion
pnpm stack:down
```

`stack:up` remplace `pnpm api` : les deux écoutent sur le port 3000, ne pas lancer les deux.
L'image (`apps/api/Dockerfile`, ~380 Mo) est construite en trois étapes : `build` (compile), `migrate`
(applique les migrations Prisma avant l'API), `runtime` (Node nu, utilisateur non-root, sans outils de dev).

## Se connecter (avant l'envoi WhatsApp)

Le code de connexion n'est pas envoyé : il est écrit dans les logs de l'API (`OTP_DELIVERY=console`).

```bash
curl -X POST localhost:3000/auth/otp/request -H 'content-type: application/json' -d '{"phone":"621 00 00 00"}'
# → lire le code dans les logs (`pnpm api` : le terminal ; `pnpm stack:up` : `pnpm stack:logs`)
curl -X POST localhost:3000/auth/otp/verify -H 'content-type: application/json' \
  -d '{"phone":"621 00 00 00","code":"123456","name":"Aïcha"}'   # `name` seulement à la 1re connexion
```

## Commandes

| Commande          | Rôle                                            |
| ----------------- | ----------------------------------------------- |
| `pnpm test`       | Tests unitaires (Vitest)                        |
| `pnpm typecheck`  | Vérification TypeScript                         |
| `pnpm format`     | Formatage Prettier                              |
| `pnpm infra:up`   | Lance Postgres et Redis seuls (pour `pnpm api`) |
| `pnpm infra:down` | Les arrête                                      |
| `pnpm stack:up`   | Lance tout : Postgres, Redis, migrations, API   |
| `pnpm stack:down` | Arrête tout                                     |

## Conventions

- TDD : le test d'abord, puis le code (Rouge → Vert → Refactor).
- Une branche par fonctionnalité, jamais de commit direct sur `main`.
- Toute réponse HTTP suit l'enveloppe `{ success: true, data }` / `{ success: false, error: { code, message } }`.
- Les montants sont des entiers (GNF n'a pas de sous-unité).
