# TocToc — Documentation stratégique

Statut : **phase de réflexion**. Aucun code n'est écrit tant que cette base n'est pas validée. Objectif : concevoir un produit qui peut gagner dans un marché déjà disputé par des acteurs mieux capitalisés, sans les affronter de front.

## Lecture recommandée, dans l'ordre

1. [00-vision.md](00-vision.md) — le problème, l'insight stratégique, ce que TocToc est vraiment
2. [01-marche-et-concurrence.md](01-marche-et-concurrence.md) — état des lieux Guinée / Sénégal / Côte d'Ivoire / Bénin, avec sources
3. [02-strategie-differenciation.md](02-strategie-differenciation.md) — comment gagner sans copier Glovo/Yassir/Gozem
4. [03-roadmap-phases.md](03-roadmap-phases.md) — séquence d'exécution, ville par ville, phase par phase
5. [04-modele-economique.md](04-modele-economique.md) — comment TocToc gagne de l'argent, à chaque phase
6. [05-risques.md](05-risques.md) — ce qui peut faire échouer le projet, et les parades
7. [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md) — la fonctionnalité unique du lancement : le lien de commande groupée, et son effet waouh
8. [07-architecture-mvp.md](07-architecture-mvp.md) — architecture technique : monolithe modulaire Node.js/Fastify, patterns repris de `citimoov-v2`
9. [08-schema-donnees.md](08-schema-donnees.md) — schéma de base de données (Prisma) pour la Phase 1
10. [09-workflows.md](09-workflows.md) — les workflows achat, réception de commande par le partenaire, livraison, et notation
11. [10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md) — ce que font DoorDash, la Chine, le Brésil et l'Asie du Sud-Est, et ce qu'on en tire
12. [11-reference-chowdeck.md](11-reference-chowdeck.md) — notre référence de terrain la plus proche, mise à jour au fil du temps

## Décisions déjà actées

| Décision | Choix | Révisable ? |
|---|---|---|
| Marché de lancement | Guinée (Conakry) | Non — c'est le seul marché sans acteur international déjà installé |
| Occasion de lancement | Déjeuner de bureau — individus et petits groupes de collègues, chacun commande et paie pour lui-même | Oui, après Phase 0 (validation) |
| Fonctionnalité de lancement | Une seule feature : lien de commande groupée avec effet waouh (liste en direct, choix rapide, paiement individuel) — voir [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md) | Le principe non, l'implémentation oui |
| Stack technique | Monolithe modulaire Node.js + Fastify + PostgreSQL/Prisma + Redis/BullMQ + Socket.io, patterns repris de `citimoov-v2` (pas Go, pas de microservices) — voir [07-architecture-mvp.md](07-architecture-mvp.md) | Oui, si le volume ou l'équipe grandissent |
| Segment grand public | Reporté à la Phase 3, une fois la flotte et l'offre construites | Oui |
| Pays suivants | Sénégal → Côte d'Ivoire → Bénin (ordre de difficulté croissante) | Oui, à réévaluer après traction Guinée |
| Paiement client | Mobile money uniquement — pas de cash, jugé trop compliqué à fiabiliser pour un début (voir [08-schema-donnees.md](08-schema-donnees.md)) | Oui, si le mobile money s'avère trop peu fiable ou trop peu accessible sur le terrain |
| Tarif de livraison | Dégressif par palier selon le rang de la commande sur le lien, jamais de seuil minimum bloquant (voir [04-modele-economique.md](04-modele-economique.md), [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md)) | Oui, les paliers sont des valeurs de config à ajuster avec les vrais chiffres |
| Notation | Un score 1-5 par commande sur le partenaire, d'abord pour le suivi qualité, pas pour l'aspect social (voir [08-schema-donnees.md](08-schema-donnees.md)) | Oui |

## Ce que ce dossier n'est pas

Ce n'est pas un cahier des charges technique exhaustif (pas de spécification d'API détaillée, pas de maquettes) — mais l'architecture, le schéma de données et les workflows ([07](07-architecture-mvp.md), [08](08-schema-donnees.md), [09](09-workflows.md)) sont déjà tranchés, volontairement, une fois le produit et le go-to-market stabilisés. Le code peut commencer sur cette base ; ce qui reste à préciser (endpoints exacts, variables d'environnement, détails d'implémentation) se travaille naturellement en écrivant le code, pas avant.
