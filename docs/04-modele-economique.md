# Modèle économique — comment TocToc gagne de l'argent

Le modèle change de nature à chaque phase. Le décrire d'un bloc masquerait le fait que la Phase 1 doit être conçue pour être défendable sans subvention — c'est tout l'enjeu de la stratégie.

## Phase 1-2 (déjeuner de bureau) — les revenus

| Source | Description | Payeur |
|---|---|---|
| **Commission restaurants/cuisinières** | Pourcentage sur chaque commande servie via TocToc | Le partenaire (restaurant/cuisinière) |
| **Frais de livraison, dégressif par palier** | Payé par chaque personne à sa commande ; le tarif dépend du **rang de sa commande sur le lien au moment où elle rejoint** (voir tableau ci-dessous), jamais recalculé rétroactivement pour ceux qui ont déjà payé | L'individu, en mobile money |

**Pourquoi ce modèle est plus sain que le grand public généraliste dès le premier jour** : chaque commande est payée individuellement (pas de facturation différée, pas de risque d'impayé côté entreprise), et la commande groupée par immeuble réduit le coût de livraison par commande — un avantage de coût structurel obtenu par la mécanique produit, sans avoir besoin de subventionner artificiellement le prix pour attirer la demande.

### Le tarif de livraison dégressif — un mécanisme, pas juste une intention

**Le piège à éviter** : si le tarif de chacun dépendait du nombre total de participants au moment de la clôture ("on divise le coût du livreur par N"), le tarif de la 1ʳᵉ personne changerait rétroactivement quand la 8ᵉ rejoint — impossible, puisque chacun paie sa part indépendamment dès qu'il commande ([06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md), pour éviter tout blocage collectif). La solution : un tarif fixé **au rang de la commande sur le lien**, jamais recalculé après coup.

| Rang de la commande sur le lien | Frais de livraison (hypothèse) |
|---|---|
| 1ʳᵉ – 2ᵉ commande | 6 000 GNF |
| 3ᵉ – 5ᵉ commande | 5 000 GNF |
| 6ᵉ – 9ᵉ commande | 4 000 GNF |
| 10ᵉ commande et plus | 3 000 GNF (plancher) |

**Le tarif plancher n'est pas arbitraire — il est borné par la capacité réelle d'une tournée.** Une moto transporte un nombre limité de repas (une quinzaine, en pratique) ; au-delà, une deuxième tournée ou un deuxième livreur devient nécessaire, ce qui double une partie du coût. Le tarif ne doit donc **jamais continuer à baisser au-delà de la capacité d'une tournée** — il plafonne au palier plancher, quel que soit le nombre de participants supplémentaires. Voir le champ `deliveryFee` ajouté à `OrderItem` dans [08-schema-donnees.md](08-schema-donnees.md).

**Effet recherché, au-delà du prix** : ce mécanisme est la version "saine" de l'idée d'achat groupé chinois qu'on a examinée puis écartée sous sa forme bloquante ([10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md)) — il récompense un groupe qui grandit ("vous êtes 6, tarif réduit débloqué") sans jamais conditionner ou retarder une livraison.

### L'incitatif au relais — un coût, pas un cadeau gratuit

Inspiré du modèle des chefs de groupe communautaires chinois (Meituan, Pinduoduo — voir [10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md)), une petite commission ou récompense pour le relais qui recrée le lien chaque jour doit être **financée par l'économie de coût de livraison réelle** que la commande groupée génère (voir plus haut), pas par une subvention arbitraire. Concrètement : le montant de l'incitatif ne doit jamais dépasser une partie de l'économie de livraison effectivement réalisée par rapport à des livraisons dispersées. Meituan a dû réduire ses commissions aux chefs de groupe en 2025 faute de rentabilité — c'est le rappel direct à ne pas reproduire : tester l'incitatif en Phase 0 avec un montant modeste, et ne l'augmenter que si l'économie unitaire le permet réellement. Une fois automatisé, cet incitatif se verse via un `Payout` de type `RELAIS` ([08-schema-donnees.md](08-schema-donnees.md)) — traçable comme n'importe quel versement à un partenaire ou un livreur, jamais un solde interne géré à la main.

### Est-ce que ça peut vraiment être rentable ? Un calcul illustratif, à corriger avec de vrais chiffres

Les sections ci-dessus listent des *sources* de revenu sans jamais poser de montant — ce qui rend la question "est-ce que ça tient économiquement" impossible à trancher pour l'instant. Voici la structure du calcul à faire, avec des chiffres **hypothétiques, à remplacer par de vraies données de terrain à Conakry** (prix réel d'un plat, coût réel d'un livreur — voir la priorité n°1 identifiée pour la Phase 0) :

| Poste | Hypothèse de travail | À vérifier |
|---|---|---|
| Prix moyen d'un plat | ~25 000 GNF | Prix réel pratiqué par les cuisinières/restaurants ciblés |
| Commission TocToc (15 %) | ~3 750 GNF / commande | Taux acceptable pour un partenaire à faible marge |
| Frais de livraison | dégressif par palier, voir tableau ci-dessus (6 000 → 3 000 GNF) | Prix que les salariés visés trouvent raisonnable pour ce service |
| Coût d'une session livreur (créneau réel 12h–14h, 13h–15h le vendredi — voir [03-roadmap-phases.md](03-roadmap-phases.md)) | ~50 000 à 65 000 GNF | Coût réel à négocier avec un premier livreur pilote, et confirmation que ce créneau est ou non une heure de forte demande pour un taxi-moto |

**Deuxième correction — la fenêtre réelle est plus courte que ce qu'on avait supposé, ce qui redescend un peu l'estimation précédente.** On avait d'abord calculé sur un créneau de 3 heures (11h–14h30), une hypothèse jamais vérifiée. Le vrai créneau, fixé par décret pour la fonction publique guinéenne, est de **2 heures** (12h–14h en semaine, 13h–15h le vendredi). Un conducteur de taxi-moto à Conakry évalue son gain à environ 200 000 GNF sur une journée complète — en le ramenant à 2 heures plutôt que 3, l'ordre de grandeur redescend vers **50 000 à 65 000 GNF**, plutôt que les 60 000 à 80 000 précédemment estimés sur une base de temps trop longue. Ça reste nettement au-dessus de notre toute première estimation (40 000 GNF) parce qu'il faut probablement une prime au-dessus de la simple moyenne horaire — un livreur qui accepte un créneau fixe renonce à la liberté de choisir ses courses et ses zones, ce qui a une valeur en soi. **Aucun livreur ne travaillera pour TocToc si la proposition est moins bonne que ce qu'il gagne déjà en taxi-moto libre** — c'est une contrainte dure, pas un détail d'ajustement.

**Le bon niveau de calcul n'est pas "par immeuble", c'est "par session de livreur"** — mais la fenêtre de 2 heures (pas 3) rend plus serré le nombre d'immeubles qu'un seul livreur peut vraiment couvrir dans le temps imparti ; à vérifier sur le terrain selon la distance réelle entre les immeubles ciblés et le ou les partenaires. Recalculé prudemment sur 2 immeubles à 8 commandes chacun (16 commandes au total) sur la même session : frais de livraison collectés ≈ 2 × 39 000 = 78 000 GNF ; commissions ≈ 16 × 3 750 = 60 000 GNF ; revenu total ≈ 138 000 GNF ; coût de la session (haut de fourchette) = 65 000 GNF ; **marge ≈ 73 000 GNF sur la session, avant incitatif au relais**. L'économie tient toujours à l'échelle d'une session à deux immeubles, mais l'objectif de couverture de la Phase 0 doit rester réaliste par rapport à la fenêtre de 2 heures, pas viser trop d'immeubles à la fois avant d'avoir testé le temps de trajet réel entre eux.

### Comment payer les livreurs — ni salariés à temps plein, ni purement à la course

La question n'a pas de réponse évidente, et c'est normal de ne pas trancher à l'aveugle. Trois options, avec un choix recommandé :

| Option | Ce que ça donne |
|---|---|
| **À la course / par tournée** | Simple à mettre en place, mais imprévisible pour le livreur — un jour à 2 commandes lui rapporte moins que son taxi-moto habituel, ce qui ne l'incite pas à rester fidèle au créneau. La recherche sur les livreurs à la demande le confirme : la prévisibilité du revenu compte souvent plus pour eux que le montant brut par course. |
| **Salarié à temps plein** | Prévisible pour le livreur, mais lourd et risqué pour TocToc à ce stade — un engagement de long terme sur un volume de commandes qui n'est pas encore prouvé. Pas cohérent avec l'approche light-asset du reste du produit. |
| **Session garantie, engagement court (recommandé)** | Un montant fixe garanti pour être disponible sur le créneau réel (12h–14h en semaine, 13h–15h le vendredi), qu'il y ait 5 ou 25 commandes ce jour-là — sans contrat de travail long terme, révisable jour par jour ou semaine par semaine tant que le volume n'est pas stabilisé. C'est le compromis qui donne au livreur la prévisibilité qu'il recherche sans engager TocToc sur un salariat prématuré. C'est aussi, dans l'esprit, ce que Chowdeck a fait à ses débuts : une petite équipe de livreurs suivie de près par les fondateurs, pas un statut figé dès le premier jour — voir [10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md). |

**Ce que ça implique pour la Phase 0** : TocToc absorbe probablement une perte nette sur le coût livreur pendant les toutes premières semaines, le temps que le volume par session couvre le montant garanti — cohérent avec la philosophie déjà actée de ne jamais bloquer une livraison pour des raisons de volume ([06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md)), étendue ici à l'idée que le launch du service, pas seulement une livraison isolée, a le droit de démarrer à perte le temps de construire le volume.

**Au-delà du cash, d'autres leviers de fidélisation existent** : Chowdeck, avec des moyens aujourd'hui bien plus grands, ne fidélise pas ses livreurs qu'avec le tarif — incitatifs de performance, soutien au logement, perspectives de promotion ([11-reference-chowdeck.md](11-reference-chowdeck.md)). Tant que le budget cash de TocToc est serré, une perspective claire (par exemple, devenir le premier livreur permanent quand le volume justifiera une embauche) peut compenser un tarif encore imparfait pendant la phase de test.

**Ce que ce calcul ne remplace pas** : les vrais chiffres de Conakry (prix pratiqués, gain réel d'un taxi-moto sur 12h-14h et sur 13h-15h le vendredi spécifiquement — pas seulement sa moyenne journalière —, marge acceptable pour un partenaire) doivent être collectés sur le terrain avant de figer quoi que ce soit — ce calcul sert à savoir *quoi* mesurer, pas à remplacer la mesure.

Sources : [Guinée : les motos-taxis, un moyen de transport très prisé — Africa24](https://africa24tv.com/guinee-les-motos-taxis-un-moyen-de-transport-tres-prise/) · [Chowdeck riders earn N100,000 weekly — Vanguard](https://www.vanguardngr.com/2026/09/our-riders-earn-average-of-n100k-per-week-chowdeck-ceo-femi-aluko/) · [Gig Passenger and Delivery Driver Pay in Five Metro Areas — UC Berkeley Labor Center](https://laborcenter.berkeley.edu/wp-content/uploads/2024/05/Gig-Passenger-and-Delivery-Driver-Pay-in-Five-Metro-Areas.pdf)

## Phase 3 (grand public) — revenus additionnels

| Source | Description |
|---|---|
| **Commission restaurants/cuisinières** | Même principe qu'au déjeuner de bureau, potentiellement à un taux différent |
| **Frais de livraison au client final** | Payé par le particulier, par commande |
| **Publicité / mise en avant** (plus tard) | Restaurants payant pour être mieux positionnés dans le catalogue grand public |

Cette phase doit être jugée sur sa rentabilité propre, pas sur la croissance du nombre de commandes — voir le critère de sortie dans [03-roadmap-phases.md](03-roadmap-phases.md). La flotte et l'offre étant déjà amorties par le déjeuner de bureau, le seuil de rentabilité du grand public est plus bas ici que pour un acteur qui démarre de zéro en grand public (Glovo, Yassir) — c'est l'avantage structurel recherché.

## Phase 4 (avantage-repas comme upsell) — le revenu à plus forte marge

| Source | Description |
|---|---|
| **Abonnement / frais de plateforme RH** | Facturé à l'employeur qui choisit de subventionner le portefeuille repas de ses salariés déjà utilisateurs (équivalent des frais qu'Edenred/Swile facturent pour les titres-restaurant) |
| **Flottant (float)** | Le crédit chargé sur les comptes salariés avant d'être dépensé génère potentiellement un flottant de trésorerie — à traiter avec prudence et en conformité avec la réglementation de monnaie électronique de chaque pays, pas comme un revenu garanti |
| **Commission restaurants/cuisinières** | Toujours d'actualité sur les dépenses faites via le portefeuille |

C'est le produit à la plus forte marge et à la plus forte rétention, parce qu'il déplace la décision d'achat du salarié individuel vers un budget RH déjà engagé par l'employeur — mais il ne se vend qu'une fois l'usage individuel déjà prouvé dans l'entreprise ciblée (voir pourquoi il vient en Phase 4, pas avant, dans [02-strategie-differenciation.md](02-strategie-differenciation.md)).

## Ce qu'il faut mesurer dès la Phase 0, même sans produit

- **Coût de livraison par commande groupée** vs **coût de livraison par commande dispersée** (l'écart doit être net — c'est la preuve du modèle, pas une hypothèse)
- **Taux de commande répétée par individu** (le vrai indicateur de succès du déjeuner de bureau, plus important que le nombre brut de commandes) et **taux de propagation de la commande groupée** au sein d'un même immeuble
- **Marge par commande après commission partenaire et coût de livraison**, avant tout frais fixe — si elle est négative dès le début, ce n'est pas un problème de volume, c'est un problème de prix ou de logistique à résoudre avant de scaler

Ces chiffres doivent être suivis à la main dès la Phase 0 (tableur), pas attendre un tableau de bord logiciel pour savoir si l'économie unitaire tient.
