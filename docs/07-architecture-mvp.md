# Architecture — Phase 1 (monolithe modulaire, Node.js + Fastify)

## Décision de stack

**Node.js + Fastify, en monolithe modulaire — pas Go, pas de microservices.** On reprend le pattern déjà utilisé et éprouvé en production dans `citimoov-v2/apps/api` (l'application CityMoov, VTC au Tchad) : un seul service Fastify, découpé en modules clairs (routes / services / lib / jobs / websocket), pas une architecture distribuée. CityMoov gère déjà en production du matching temps réel, du tracking GPS, des paiements et un back-office admin avec exactement ce pattern, sans Kafka ni Kubernetes — c'est la preuve que ce choix tient une vraie charge, pas seulement un prototype.

TocToc reste un **projet séparé** (dépôt Git distinct, comme CityMoov l'est déjà) — produit et marque différents — mais on copie et on adapte la structure de dossiers et les briques d'infrastructure (`lib/`, `app.ts`/`server.ts`, patterns Prisma/Redis/BullMQ/Socket.io) plutôt que de repartir de zéro.

## Ce qu'on reprend tel quel de CityMoov

| Pattern CityMoov | Fichier(s) de référence | Ce qu'on en fait pour TocToc |
|---|---|---|
| Split `app.ts` (construction, plugins) / `server.ts` (bootstrap, jobs, écoute) | `apps/api/src/app.ts`, `src/server.ts` | Repris à l'identique : Redis se connecte en premier, les jobs planifiés démarrent au boot, puis le serveur écoute |
| Plugins Fastify : `helmet`, `cors`, `multipart`, `rate-limit` (backé par Redis), `jwt` | `app.ts` | Repris tel quel |
| Décorateur `authenticate` + `{ onRequest: [app.authenticate] }` par route | `app.ts` | Repris tel quel pour protéger les routes qui en ont besoin |
| Validation des entrées avec **Zod**, schémas déclarés en tête de chaque fichier de routes | `routes/auth.ts` | Repris tel quel |
| Enveloppe de réponse uniforme `{ success: true, data }` / `{ success: false, error: { code, message } }` | `routes/auth.ts` | Repris tel quel — permet au frontend React de traiter les erreurs de façon générique |
| Rate limiting manuel Redis (`INCR` + `EXPIRE`) sur les endpoints sensibles, en plus du rate-limit global | `routes/auth.ts` (OTP, login) | Appliqué à la création de lien, aux tentatives de paiement, et à la saisie du code de confirmation de livraison (5 essais max, voir [09-workflows.md](09-workflows.md)) — même pattern partout, pas un mécanisme différent par cas d'usage. **Amélioré à l'implémentation** : `INCR` puis `EXPIRE` séparés laissent une clé sans expiration (donc bloquée pour toujours) si le processus s'arrête entre les deux ; TocToc les envoie dans une seule transaction, `EXPIRE … NX`, dans `lib/rate-limiter.ts` |
| Réponse identique en cas d'échec pour éviter l'énumération (ex. `INVALID_CREDENTIALS`) | `routes/auth.ts` | Repris pour tout endpoint d'authentification par téléphone |
| Prisma en singleton (`globalForPrisma`) pour éviter les connexions multiples en dev | `lib/prisma.ts` | Repris tel quel |
| Redis en singleton + objet `redisKeys` qui centralise les conventions de nommage des clés | `lib/redis.ts` | Repris et étendu avec les clés propres à TocToc (voir plus bas) |
| BullMQ : une paire `Queue` + `Worker` par tâche planifiée, un fichier par job dans `jobs/`, une fonction `scheduleXWorker()` qui programme une répétition | `jobs/scheduledTripsWorker.ts` | Réutilisé pour clôturer un lien à l'heure limite et envoyer le récapitulatif au partenaire (voir [09-workflows.md](09-workflows.md)) |
| Temps réel avec **Socket.io** (pas de WebSocket brut), adaptateur Redis pour pouvoir scaler à plusieurs instances, auth du socket par JWT dans un middleware `io.use`, diffusion par "room" | `websocket/handler.ts`, `websocket/events.ts` | Réutilisé pour la liste qui se remplit en direct — voir mapping ci-dessous. **État du code** : `apps/api/src/realtime/` (`events.ts` : contrat typé et noms de rooms ; `socket-server.ts` ; `socket-io-publisher.ts`). **Écart assumé : pas d'authentification JWT sur les sockets.** Le participant n'a pas de compte (voir [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md)) : il rejoint la room d'un lien avec le `shareToken` public, comme il ouvre la page. Les rooms portent l'id interne du lien, jamais le jeton, et une room par commande (`orderItem:{id}`) porte le message privé de la personne (confirmation, échec de paiement). Le contrat reste dans l'API en attendant `apps/web` ; il montera dans `packages/types` à ce moment-là |
| Fonctions `emitToX(id, event, payload)` isolées dans `websocket/events.ts`, appelées depuis les routes ou les jobs sans dépendre directement de l'instance `io` | `websocket/events.ts` | Repris tel quel |
| Contrat d'événements **typé** partagé (`ClientToServerEvents`, `ServerToClientEvents`, `SocketData`) dans un package commun | `packages/types/src/events.ts` | Même principe : un fichier d'événements typés partagé entre le backend et le frontend React |
| Couche `services/` séparée des routes, pour la logique métier testable indépendamment | `services/matching.ts`, `services/pricing.ts` | Repris — ex : un `services/group-order.ts` qui contient la logique de clôture, indépendant du transport HTTP |
| Tests Vitest, arborescence de tests qui reflète `src/` (`tests/routes/`, `tests/services/`, `tests/lib/`) | `tests/` | Repris tel quel |
| OTP par WhatsApp souhaité, SMS en secours | à construire — **correction** : `services/whatsapp.ts` dans CityMoov envoie en réalité par SMS (gateway EasySendSMS), pas par WhatsApp, malgré son nom ; `services/sms.ts` utilise Twilio. Aucun des deux n'est une vraie intégration WhatsApp | **Rien à réutiliser tel quel ici** — l'envoi d'OTP par WhatsApp reste à construire pour TocToc : choisir un fournisseur (API Cloud WhatsApp officielle de Meta, ou un agrégateur), et vérifier les contraintes réelles (validation du compte professionnel Meta, approbation préalable des modèles de message pour un envoi proactif comme un code OTP). Le SMS (pattern Twilio de `services/sms.ts`) reste la valeur de repli fiable et déjà éprouvée en attendant. **État du code** : l'envoi passe par une interface `OtpSender` ; la seule implémentation livrée est `ConsoleOtpSender`, qui écrit le code dans les logs (`OTP_DELIVERY=console`) — suffisant pour le pilote interne, jamais pour de vrais clients (le serveur avertit au démarrage en production). WhatsApp et SMS s'ajouteront comme deux implémentations de plus, sans toucher au reste |
| Stockage de fichiers via MinIO (S3-compatible, auto-hébergé) | `services/storage.ts` | Utile plus tard pour les photos de plats, pas indispensable au tout premier test |
| Monorepo pnpm + Turborepo, `apps/api` + `apps/web` + `packages/types|config|utils` partagés | racine `citimoov-v2/` | Même structure de monorepo pnpm, dans le dossier `platform/` de ce dépôt : `apps/api` (Fastify), `apps/web` (React), `packages/types` partagé au minimum. **Turborepo est repoussé** : avec une seule app, `pnpm -r` suffit ; on l'ajoutera avec `apps/web` quand l'orchestration des builds aura un intérêt réel |
| Docker Compose (dev : Postgres + Redis + MinIO ; prod complet) + Caddy comme reverse proxy avec SSL automatique | `infra/` | Repris tel quel pour le déploiement sur VPS. **État du code** : `platform/infra/docker-compose.yml` lance Postgres + Redis (dev) et, avec le profil `app`, l'API conteneurisée (`pnpm stack:up`) ; image multi-étapes `platform/apps/api/Dockerfile` (build, migrate, runtime en utilisateur non-root, ~380 Mo). Reste à faire pour le VPS : fichier de production avec secrets réels et Caddy |

## Comment ça se traduit dans le domaine TocToc

| Concept CityMoov | Équivalent TocToc |
|---|---|
| `Trip` (course) | `GroupOrder` (le lien de commande groupée) |
| Room socket `trip:${tripId}` | Room socket `groupOrder:${id}` — diffuse chaque nouvelle commande à tous les participants déjà connectés, c'est le moteur technique du **moment waouh n°1** ([06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md)) |
| `trip:driver_location` (émis à chaque update GPS) | `groupOrder:item_added` (émis à chaque nouveau participant qui choisit son plat) |
| `scheduledTripsWorker` (scanne les courses planifiées à venir) | `groupOrderClosingWorker` — scanne les liens dont l'heure limite approche, les ferme automatiquement, déclenche l'envoi du récap au partenaire |
| Auth client par téléphone + OTP (`routes/auth.ts`) | Structure reprise pour le **relais** (revient chaque jour, OTP justifié) ; un participant qui rejoint un lien une seule fois n'en a pas besoin — voir la précision dans [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md) et [08-schema-donnees.md](08-schema-donnees.md) |
| `matchingWorker` (assignation chauffeur ↔ course, temps réel) | Pas nécessaire en Phase 1 — la livraison du déjeuner est planifiée à heure fixe, pas de matching à la demande (voir [09-workflows.md](09-workflows.md)) |

## Structure de projet (dans `platform/`, même dépôt que `docs/`)

```
platform/
├── apps/
│   ├── api/          # Fastify — même arborescence que citimoov-v2/apps/api
│   │   └── src/
│   │       ├── app.ts, server.ts
│   │       ├── routes/        # group-orders.ts, payments.ts, auth.ts, partners.ts...
│   │       ├── services/      # group-order.ts, payment.ts, partner-recap.ts...
│   │       ├── jobs/          # groupOrderClosingWorker.ts, reminderWorker.ts...
│   │       ├── websocket/     # events.ts, handler.ts
│   │       └── lib/           # prisma.ts, redis.ts, phone.ts...
│   └── web/           # React — le lien de commande groupée, sans app à installer
├── packages/
│   └── types/         # contrat d'événements partagé (events.ts), types de domaine
└── infra/             # docker-compose, Caddyfile
```

## Ce qui reste hors scope en Phase 1 (inchangé dans le principe)

Même sans microservices, on ne construit que ce dont la fonctionnalité unique a besoin : pas de back-office partenaire dédié (un récap transmis par SMS/WhatsApp suffit, voir [09-workflows.md](09-workflows.md)), pas de suivi GPS temps réel du livreur (la livraison est planifiée, pas à la demande), pas de k3s/Kubernetes (un VPS avec Docker Compose suffit au volume visé). Ces choix ne sont pas liés au stack Node/Fastify — ils resteraient vrais avec n'importe quelle techno, tant que le produit reste une seule fonctionnalité.
