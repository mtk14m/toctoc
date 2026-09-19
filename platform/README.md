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

## Créer le premier admin, un partenaire et son menu

Aucune route ne donne le rôle `ADMIN_PLATFORM` (c'est voulu) : le premier admin se promeut en base,
après s'être connecté une fois par OTP.

```bash
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U toctoc -d toctoc -c "UPDATE \"User\" SET role = 'ADMIN_PLATFORM' WHERE phone = '+224621000000';"
```

Le jeton reste valable, le rôle est relu en base à chaque appel `/admin/*`. Ensuite, avec le jeton de l'admin
(`Authorization: Bearer …`) :

```bash
# un partenaire (commissionRate optionnel, 15 % par défaut)
curl -X POST localhost:3000/admin/partners -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Chez Aïssatou","type":"CUISINE_MAISON","phone":"622 00 00 00","address":"Almamya","city":"Conakry"}'
# son plat du jour (prix en GNF entiers, date AAAA-MM-JJ)
curl -X POST localhost:3000/admin/partners/$PARTNER_ID/menu-items -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Riz gras","price":25000,"availableDate":"2026-09-22"}'
```

## Simuler un paiement (avant l'opérateur mobile money)

`PAYMENT_PROVIDER=fake` : aucun opérateur derrière, mais le webhook est vérifié comme le sera celui d'un
vrai opérateur (signature HMAC-SHA256 du corps brut, en-tête `x-toctoc-signature`). Pour « payer » une
commande, on envoie soi-même l'évènement signé :

```bash
# 1. rejoindre un lien (route publique) : la réponse annonce `payment: { status: "PENDING" }`
curl -X POST localhost:3000/group-orders/$SHARE_TOKEN/items -H 'content-type: application/json' \
  -d '{"menuItemId":"'$MENU_ITEM_ID'","phone":"622 00 00 01","name":"Aïcha"}'

# 2. la référence du paiement (notre id, que l'opérateur renvoie dans son webhook)
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U toctoc -d toctoc -tAc 'SELECT id, amount FROM "Payment" ORDER BY "createdAt" DESC LIMIT 1;'

# 3. le webhook signé (status: CONFIRMED ou FAILED ; amount = celui de l'étape 2)
SECRET='dev-only-payment-webhook-secret-do-not-use'   # compose : local-compose-webhook-secret-do-not-use-32
BODY='{"reference":"<id>","providerTransactionId":"tx_1","amount":31000,"status":"CONFIRMED"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -X POST localhost:3000/webhooks/payments -H 'content-type: application/json' \
  -H "x-toctoc-signature: $SIG" -d "$BODY"
```

Après un `CONFIRMED`, la personne apparaît sur `GET /group-orders/$SHARE_TOKEN`. Un `FAILED` annule sa
commande (elle peut recommencer). Un paiement reçu après l'heure limite plus 2 minutes est encaissé mais
la commande reste annulée : le serveur l'écrit dans ses logs, le remboursement est manuel en Phase 1.

## Suivre un lien en direct (Socket.io)

Le temps réel est sur le même port que l'API. Il est public, comme la page du lien : le jeton du lien suffit.
Le contrat complet (évènements, noms de rooms) est dans `apps/api/src/realtime/events.ts`.

```js
import { io } from 'socket.io-client'
const socket = io('http://localhost:3000')

// le groupe : la liste qui se remplit, et le tarif que paiera le prochain arrivant
socket.emit('groupOrder:join', { shareToken }, console.log) // → { ok: true }
socket.on('groupOrder:item_added', console.log) // { participant, nextDeliveryFee } : paiement confirmé
socket.on('groupOrder:item_pending', console.log) // idem en HOST_PAYS : en attente du règlement du créateur

// la personne : son propre message, avec l'id de commande reçu au moment de rejoindre
socket.emit('orderItem:watch', { orderItemId }, console.log)
socket.on('orderItem:updated', console.log) // { orderItemId, status, reason: PAYMENT_CONFIRMED | PAYMENT_FAILED | PAYMENT_TOO_LATE }
```

En production, l'adaptateur Redis relaie les évènements entre plusieurs instances de l'API. Les
deux connexions Redis dédiées qu'il utilise s'ajoutent à celle de l'API.

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
