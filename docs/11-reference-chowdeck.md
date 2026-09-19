# Chowdeck — notre référence de terrain la plus proche

Contrairement à [10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md) (un tour d'horizon large, DoorDash à la Chine en passant par le Brésil), ce document se concentre sur un seul acteur, en profondeur, et se met à jour au fil du temps. Raison du choix : Chowdeck est le cas le plus transposable à TocToc — même continent, contraintes comparables (économie informelle, mobile money, embouteillages), lancé récemment (2021, pas une légende d'il y a quinze ans), et surtout **rentable depuis le début** dans un secteur où presque personne ne l'est. Ce n'est pas leurs débuts qu'on regarde ici (déjà couvert dans [10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md)) — c'est ce qu'ils font **maintenant**, avec l'échelle et les moyens qu'ils ont aujourd'hui, pour anticiper où le produit devra aller sans se tromper de direction.

## Chowdeck aujourd'hui, en chiffres

- 11 villes au Nigeria et au Ghana, 1,5 million de clients, plus de 20 000 livreurs.
- Rentable depuis le lancement, y compris pendant les levées de fonds — $2,5M en seed puis $9M en Series A (août 2025, mené par Novastar Ventures, avec Y Combinator, AAIC Investment, Rebel Fund, GFR Fund, Kaleo, HoaQ).
- Délai de livraison moyen inférieur à 30 minutes.
- Diversification en cours vers le quick commerce (épicerie, essentiels du quotidien via des "dark stores") — 40 prévus fin 2025, 500 visés fin 2026.

## Ce qu'on en tire, point par point

### 1. Croissance portée par le produit, pas par la publicité payante
Chowdeck a délibérément construit la viralité dans l'expérience produit plutôt que de brûler du cash en publicité. C'est exactement la thèse déjà au cœur de TocToc ([06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md)) — la confirmation vient d'un acteur qui a atteint 1,5 million de clients sans dévier de ce principe.

### 2. Fidéliser les livreurs par plus que l'argent
Chowdeck investit dans son réseau de livreurs avec des incitatifs de performance, **un soutien au logement**, et des perspectives de promotion — pas seulement un tarif compétitif. C'est directement utile à notre problème actuel ([04-modele-economique.md](04-modele-economique.md), [05-risques.md](05-risques.md)) : si le budget cash est serré pendant la phase de validation, des leviers non monétaires (par exemple, une perspective claire de devenir le premier livreur "référent" quand TocToc embauchera à mesure que le volume grandit) peuvent compenser un tarif encore imparfait, sans attendre d'avoir les moyens de rivaliser en pur cash avec le taxi-moto libre.

### 3. L'app livreur et l'app partenaire, une fois que ça vaut le coup — pas avant
L'app livreur actuelle de Chowdeck propose des notifications de commande en temps réel, un suivi des gains en direct, un **retrait instantané des gains depuis un portefeuille intégré**, l'historique des livraisons, et un support intégré. Leur app partenaire permet de gérer le menu et de suivre les commandes par statut. **Ce n'est pas ce qu'on construit en Phase 1** (voir la justification de sobriété dans [07-architecture-mvp.md](07-architecture-mvp.md)) — mais c'est une bonne carte de la destination : le retrait instantané des gains, en particulier, est une évolution naturelle et concrète de notre modèle `Payout` ([08-schema-donnees.md](08-schema-donnees.md)) une fois le volume là — remplacer un versement périodique par un solde que le livreur peut retirer à la demande.

### 4. Des partenariats d'ancrage pour percer un nouveau marché
Chowdeck a signé un accord d'exclusivité avec la chaîne Chicken Republic pour s'implanter fort à Lagos et Ibadan — un partenaire déjà connu et digne de confiance sert de point d'ancrage à l'entrée d'une ville, plutôt que d'agréger seulement des petits indépendants depuis zéro. **À réutiliser pour la Phase 2** ([03-roadmap-phases.md](03-roadmap-phases.md)) : à l'entrée de Dakar ou d'Abidjan, chercher un partenariat exclusif avec une enseigne locale déjà reconnue plutôt que de reconstruire toute la confiance partenaire à partir de rien.

### 5. Rentable, pas seulement grand
Le fait le plus rare et le plus important : Chowdeck est resté rentable en scalant, y compris en levant des fonds — ce n'est pas un choix "on lèvera pour compenser les pertes plus tard". Ça confirme directement notre propre règle déjà posée pour la Phase 3 ([04-modele-economique.md](04-modele-economique.md)) : le grand public doit être rentable ou proche de l'équilibre par lui-même, pas une fuite en avant financée par du capital — ce n'est pas qu'une précaution défensive de notre part, c'est une discipline qui marche, prouvée dans un marché comparable.

### 6. S'adapter quartier par quartier, pas ville par ville
Le CEO de Chowdeck insiste sur le fait que les préférences à Yaba diffèrent de celles à Ikeja, dans la même ville. **Pour Conakry** : ne pas supposer que ce qui marche à Kaloum marchera identique à Almamya — horaires, types de plats, prix acceptables peuvent varier d'un immeuble à l'autre, ce que la Phase 0 doit justement laisser émerger plutôt que d'imposer un standard unique dès le départ ([03-roadmap-phases.md](03-roadmap-phases.md)).

## Où Chowdeck ne s'applique pas directement à nous — pour rester honnête

- **Le vélo plutôt que la moto en zone dense (Nigeria) ne se transpose pas à la Guinée.** Chowdeck livre plus de la moitié de ses commandes à vélo dans ses zones denses — mais la moto est la norme de transport à Conakry, pas une option parmi d'autres à tester. Reprendre ce point tel quel serait copier une contrainte locale nigériane qui ne s'applique pas ici.
- Chowdeck reste une marketplace grand public généraliste "à la demande" — notre différenciation de départ (l'occasion du déjeuner de bureau, pas un marché ouvert à toute heure) reste ailleurs, voir [02-strategie-differenciation.md](02-strategie-differenciation.md) et [10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md).
- Leur virage vers le quick commerce (dark stores) est une diversification hors de la livraison de repas — pas un signal pour élargir le scope de TocToc maintenant.
- Leurs chiffres actuels (20 000 livreurs, 11 villes) sont une destination à des années de distance, pas un objectif de Phase 0/1 — le risque serait de vouloir "faire comme Chowdeck" avant d'avoir prouvé le modèle sur un seul immeuble.

## Sources

- [Chowdeck secures $9m funding to expand Nigeria, Ghana operations — Guardian NG](https://guardian.ng/news/chowdeck-secures-9m-from-8-foreign-investors-for-nigeria-ghana-expansion/)
- [Profitable Nigerian food delivery Chowdeck lands $9M from Novastar, Y Combinator — TechCrunch](https://techcrunch.com/2025/08/11/nigeria-profitable-food-delivery-chowdeck-lands-9m-from-novastar-y-combinator/)
- [Chowdeck: How This Food Delivery Startup Hit ₦30 Billion in Sales](https://www.marketinginaction.xyz/p/chowdeck-marketing-led-growth-case-study)
- [How Chowdeck delivered food worth ₦1 billion monthly — TechCabal](https://techcabal.com/2023/11/03/chowdeck-1billion/)
- [Chowdeck Rider — App Store](https://apps.apple.com/us/app/chowdeck-rider/id1621694338)
- [How do I join Chowdeck as a vendor? — Chowdeck Help](https://help.chowdeck.com/en/articles/7984335-how-do-i-join-chowdeck-as-a-vendor)
- [Our riders earn average of N100k per week — Chowdeck CEO — Vanguard](https://www.vanguardngr.com/2026/09/our-riders-earn-average-of-n100k-per-week-chowdeck-ceo-femi-aluko/)
