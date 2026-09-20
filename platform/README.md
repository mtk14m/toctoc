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
# un partenaire (commissionRate optionnel, 15 % par défaut ; serviceStart / serviceEnd optionnels,
# 09:00 - 24:00 par défaut : une cuisinière qui ne fait que le déjeuner met "11:00" et "15:00" ;
# description, logoUrl, coverUrl et tags (8 au plus) alimentent l'annuaire public)
curl -X POST localhost:3000/admin/partners -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Chez Aïssatou","type":"CUISINE_MAISON","phone":"622 00 00 00","address":"Almamya","city":"Conakry","description":"Cuisine guinéenne du quotidien","tags":["riz gras","poulet braisé"]}'
# la modifier ensuite : une clé absente ne change rien, null efface ; "active": false la retire de l'annuaire
curl -X PATCH localhost:3000/admin/partners/$PARTNER_ID -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"logoUrl":"https://cdn.example.com/logo.png","serviceStart":"11:00","serviceEnd":"15:00"}'
# son plat du jour (prix en GNF entiers, date AAAA-MM-JJ : sans plat ce jour-là, pas de commande possible)
curl -X POST localhost:3000/admin/partners/$PARTNER_ID/menu-items -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Riz gras","price":25000,"availableDate":"2026-09-22"}'
```

## L'annuaire des restaurants (public)

Le parcours commence par le choix d'un restaurant ([docs/12](../docs/12-la-commande.md)). Aucun jeton requis :

```bash
curl localhost:3000/restaurants          # tous les restaurants actifs
curl localhost:3000/restaurants/$ID      # la fiche, avec le menu complet du jour
```

Chaque restaurant porte sa présentation (`description`, `logoUrl`, `coverUrl`, `tags`), ses heures (`hours`),
sa note (`rating`, `null` tant qu'il n'y en a pas), un résumé du menu du jour (`todaysMenu` : le nombre de
plats et un aperçu de trois) et surtout `availability` : `{ available: true }`, ou `available: false` avec la
raison (`SERVICE_NOT_OPEN`, `TOO_LATE_TO_DELIVER`, `PARTNER_CLOSED_AT_THAT_TIME`, `NO_MENU_FOR_DATE`) et les heures
utiles à afficher (« ouvre à 11:00 »). Ce sont **exactement** les règles de la création d'une commande : un
restaurant n'est jamais annoncé disponible alors que commencer une commande serait refusé.

Les disponibles passent en premier, puis les mieux notés, puis l'ordre alphabétique. Ni téléphone, ni adresse, ni
commission. Réponse mise en cache 30 secondes (`cache-control: public, max-age=30`).

## Commencer une commande

Tout le monde peut commencer une commande, seul ou pour la partager : **téléphone et nom suffisent**, le compte
est créé discrètement (pas d'OTP), comme pour rejoindre. Avec un jeton (`Authorization: Bearer …`), le téléphone
et le nom ne sont pas nécessaires ; un jeton invalide est refusé, pas ignoré.

```bash
curl -X POST localhost:3000/group-orders -H 'content-type: application/json' \
  -d '{"partnerId":"'$PARTNER_ID'","deliveryAddress":"Kaloum Center, 3e étage","phone":"622 00 00 01","name":"Aïcha"}'
# → { orderCutoffTime, deliveryTime, shareToken, ... } ; le lien à partager est toctoc.app/g/{shareToken}
```

**On ne choisit aucune heure.** La commande reste ouverte **20 minutes** (`orderCutoffTime`), puis la livraison
est estimée **45 minutes** plus tard (`deliveryTime` : préparation et trajet). Une heure envoyée par le client est
ignorée. Règles refusées avec un 422 exploitable par le frontend :

| Code                          | Cas                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `SERVICE_NOT_OPEN`            | avant 9h, ou la nuit                                                               |
| `TOO_LATE_TO_DELIVER`         | la livraison estimée dépasserait minuit (dernière commande à 22h54)                |
| `PARTNER_CLOSED_AT_THAT_TIME` | le restaurant est fermé quand il recevrait la commande (à la fermeture du lien)    |
| `NO_MENU_FOR_DATE`            | aucun plat au menu ce jour-là                                                      |
| `PAYMENT_MODE_UNAVAILABLE`    | `HOST_PAYS` (`ENABLE_HOST_PAYS=false` tant que la charge du créateur n'existe pas) |

Les 20 minutes, les 45 minutes et les heures de service se règlent dans `.env` (`ORDER_WINDOW_MINUTES`,
`DELIVERY_LEAD_MINUTES`, `SERVICE_START_HOUR`, `SERVICE_END_HOUR`).

## Simuler un paiement (avant l'opérateur mobile money)

`PAYMENT_PROVIDER=fake` : aucun opérateur derrière.

**Le raccourci** : avec `ENABLE_PAYMENT_SIMULATOR=true` (déjà levé dans le stack Docker local, à `false`
partout ailleurs), une seule requête paie la part, avec l'`id` renvoyé quand on rejoint :

```bash
curl -X POST localhost:3000/dev/order-items/$ORDER_ITEM_ID/payment                                # paie
curl -X POST localhost:3000/dev/order-items/$ORDER_ITEM_ID/payment -H 'content-type: application/json' \
  -d '{"outcome":"FAILED"}'                                                                      # échoue
```

Il n'a aucune authentification : le serveur l'écrit dans ses logs au démarrage. Il ne contourne rien : il
envoie au service un webhook signé, comme l'opérateur, donc les mêmes règles s'appliquent.

**À la main** : le webhook est vérifié comme le sera celui d'un vrai opérateur (signature HMAC-SHA256 du
corps brut, en-tête `x-toctoc-signature`). Pour « payer » une commande, on envoie soi-même l'évènement
signé :

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
socket.on('orderItem:updated', console.log) // { orderItemId, status, reason: PAYMENT_CONFIRMED | PAYMENT_FAILED | PAYMENT_TOO_LATE | LINK_CLOSED }
```

En production, l'adaptateur Redis relaie les évènements entre plusieurs instances de l'API. Les
deux connexions Redis dédiées qu'il utilise s'ajoutent à celle de l'API.

## La livraison

Quand une commande est fermée (`CLOSED`), l'équipe lui assigne un livreur ; le livreur récupère les plats ;
le groupe lui donne le code affiché sur sa page ; le livreur le saisit. Le code est **la preuve** qu'il est
arrivé (docs/09) : il n'existe qu'entre la récupération et la livraison, et le livreur ne le voit jamais.

| Qui     | Route                                                  | Rôle                                                                  |
| ------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| Équipe  | `POST /admin/drivers` `{ phone, name }`                | crée un livreur (compte + fiche) ; il se connecte ensuite par OTP     |
| Équipe  | `GET /admin/drivers`                                   | les livreurs, actifs d'abord                                          |
| Équipe  | `GET /admin/group-orders?status=CLOSED,IN_DELIVERY`    | les commandes à traiter, avec récap et livreur                        |
| Équipe  | `POST /admin/group-orders/:id/delivery` `{ driverId }` | assigne (201) ou réassigne (200) tant que rien n'est récupéré         |
| Équipe  | `POST /admin/deliveries/:id/override` `{ reason }`     | confirmation manuelle, toujours tracée dans `AuditLog` avec sa raison |
| Livreur | `GET /driver/deliveries`                               | sa tournée : où récupérer, quoi, où livrer                            |
| Livreur | `POST /driver/deliveries/:id/picked-up`                | « récupéré » : génère le code, la commande passe en route             |
| Livreur | `POST /driver/deliveries/:id/confirm` `{ code }`       | 5 essais au plus, puis seule l'équipe peut confirmer                  |

La page publique de la commande (`GET /group-orders/:jeton`) porte `delivery: { status, confirmationCode }` :
le code n'y figure que pendant `PICKED_UP`. En direct, `groupOrder:in_delivery` (avec le code et le temps
estimé) puis `groupOrder:delivered`. Le rôle est relu en base à chaque appel : un livreur désactivé est refusé
immédiatement, sans attendre l'expiration de son jeton.

## La notation et les remboursements

Une fois la commande livrée, la page propose de noter le restaurant (`groupOrder:rating_open` en direct).
Pas de compte : le numéro de la part suffit, comme pour rejoindre.

| Qui    | Route                                                       | Rôle                                                                               |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Public | `POST /order-items/:id/rating` `{ phone, score }`           | note de 1 à 5, une fois par part payée et livrée ; renvoie la moyenne du jour      |
| Équipe | `GET /admin/refunds`                                        | paiements encaissés pour une part annulée (débit tardif), les plus anciens d'abord |
| Équipe | `POST /admin/refunds/:orderItemId/refunded` `{ reference }` | garde la référence du remboursement mobile money dans l'`AuditLog`                 |

La moyenne est sur la page publique (`rating: { average, count }`, `null` tant que personne n'a noté) et en
direct (`groupOrder:rating_added`) ; celle du restaurant, dans l'annuaire, vient des mêmes notes. Le
remboursement reste manuel : l'équipe rembourse par mobile money, puis enregistre la référence ici.

## La clôture des liens et le récap partenaire

Un job BullMQ tourne chaque minute au démarrage de l'API (Redis requis). Pour chaque lien `SPLIT` dont l'heure
limite plus 2 minutes de grâce est passée : les commandes encore en attente de paiement sont annulées, le lien
passe à `CLOSED` (ou `CANCELLED` si personne n'a payé), le groupe l'apprend en direct (`groupOrder:closed`), puis
le récap est transmis au partenaire.

Sans WhatsApp ni SMS (`PARTNER_NOTIFICATION=console`), le récap **s'écrit dans les logs** : l'équipe le lit et le
transmet elle-même (`pnpm stack:logs`). Le serveur avertit au démarrage en production. Si l'envoi échoue, il est
réessayé à chaque passage jusqu'à réussir.

Les liens `HOST_PAYS` ne sont pas encore fermés automatiquement (la charge unique du créateur reste à construire).

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
