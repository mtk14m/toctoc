# Benchmark produit mondial — ce que font DoorDash, l'Asie et l'Amérique latine

Recherche menée pour enrichir le MVP, pas pour le complexifier. Chaque section se termine par ce qu'on en tire concrètement pour TocToc — certains constats confirment des choix déjà pris, d'autres suggèrent un ajustement précis.

## DoorDash et Uber Eats — le "Group Order" existe déjà, et confirme nos choix de base

**Constats** :
- **DoorDash Group Order** : le créateur lance un panier, partage un lien unique ; les invités **n'ont pas besoin d'un compte DoorDash** pour ajouter leurs articles. Fenêtre de commande jusqu'à 24h avant la livraison souhaitée (ou jusqu'à 4 jours à l'avance en pré-commande). Un admin peut fixer une **limite de dépense par personne**. "Split Billing" : chacun paie sa propre part avec son propre moyen de paiement. Une seule livraison, un seul livreur pour tout le groupe.
- **Uber Eats Group Order** : jusqu'à 18 participants par commande groupée, deadline réglable jusqu'à 7 jours à l'avance, option "Guests pay for themselves". Contrairement à DoorDash, Uber **exige un compte connecté** pour que chaque invité puisse payer sa part — une friction de plus que DoorDash.

**Ce qu'on en tire** :
- Notre principe "rejoindre sans compte, juste un numéro de téléphone pour payer" est le bon choix — c'est exactement ce qui distingue DoorDash (plus fluide) d'Uber Eats sur ce point précis. À ne pas relâcher.
- Une **limite de dépense par personne** est une fonctionnalité utile à garder en réserve pour la Phase 4 (compte entreprise) — pas nécessaire en Phase 1, mais son absence ne serait plus tenable une fois qu'un employeur finance le portefeuille repas.
- Un **plafond de participants par lien** (Uber Eats en fixe un à 18) est une limite technique raisonnable à reprendre — évite un panier qui grossit indéfiniment et complique la tournée de livraison.

Sources : [DoorDash Group Orders Guide](https://help.doordash.com/en-us/business/article/guide-to-group-orders) · [DoorDash Group Orders FAQ](https://help.doordash.com/en-us/business/article/group-orders-faq) · [Uber Eats bill-splitting announcement](https://www.uber.com/us/en/newsroom/bill-splitting/) · [Large Group Orders FAQ — Uber](https://help.uber.com/en/ubereats/restaurants/article/large-group-orders-faq?nodeId=5dfdd2a2-ac78-4dd8-81c4-0500ca29cc12)

## Chine — l'achat groupé communautaire (Meituan Youxuan, Pinduoduo) : le modèle le plus proche du nôtre

**Constats** : un "tuanzhang" (chef de groupe communautaire) anime un groupe WeChat de voisins, relaie chaque jour une liste de produits, chacun commande ce qu'il veut sans obligation d'acheter le même article. Le lendemain, tout est livré en un seul lot à un point de collecte unique du quartier (pas de porte-à-porte). Le chef de groupe touche une **commission** (environ 10 % chez Pinduoduo) sur le volume de commandes de son groupe, avec un seuil de volume mensuel à tenir pour rester sur la plateforme. En 2025, Meituan a dû **réduire ces commissions**, le modèle ayant généré des pertes trop importantes à grande échelle.

**Ce qu'on en tire — c'est l'apport le plus direct de ce benchmark** :
1. **Le relais devrait avoir un vrai incitatif financier, pas seulement social.** Notre fonctionnalité de lancement ([06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md)) mise sur l'effet waouh pour pousser le relais à recréer son lien chaque jour. Le modèle chinois montre qu'un incitatif concret (petite commission, ou repas offert après N commandes groupées réussies) démultiplie cette dynamique à très grande échelle. **À tester dès la Phase 0** : proposer au relais une contrepartie simple et mesurer si ça change son comportement de relance, avant de l'automatiser.
2. **Un seuil minimum de participants avant de garantir la livraison, examiné puis écarté — remplacé par un tarif dégressif, jamais bloquant.** Le modèle chinois ne déclenche la livraison qu'une fois un volume atteint ; on a envisagé la même chose pour TocToc (afficher un objectif en direct) avant d'écarter tout blocage — **décision produit : il n'y a pas de seuil, une seule commande sur un lien est livrée comme les autres.** Le modèle chinois protège son économie ainsi parce qu'il opère déjà à très grand volume ; TocToc démarre de zéro dans chaque immeuble, et conditionner la livraison à un seuil casserait la confiance dès les premières semaines. On a gardé l'esprit de la mécanique (un groupe qui grandit obtient un avantage) sous une forme qui ne bloque jamais rien : un **tarif de livraison dégressif par palier**, qui baisse à mesure que le lien grossit sans jamais retarder ou annuler quoi que ce soit — voir [04-modele-economique.md](04-modele-economique.md) et [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md).
3. **Prudence sur la générosité de l'incitatif.** Le recul de Meituan sur les commissions en 2025 est un avertissement direct : l'incitatif au relais doit rester financé par l'économie réelle de coût de livraison groupée, pas être un cadeau qui érode la marge dès qu'on scale. Voir la mise à jour de [04-modele-economique.md](04-modele-economique.md) et [05-risques.md](05-risques.md).

Sources : [How Meituan and Pinduoduo are transforming remote Chinese towns — SCMP](https://www.scmp.com/tech/tech-trends/article/3126942/how-meituan-and-pinduoduo-are-transforming-remote-chinese-towns) · [The battle for China's community group buying market — TechNode](https://technode.com/2020/07/28/the-battle-for-chinas-community-group-buying-market/) · [Reports about the death of community group buying — TechBuzzChina](https://techbuzzchina.substack.com/p/reports-about-the-death-of-community)

## Brésil — iFood Benefícios : la preuve à grande échelle de notre Phase 4

**Constats** : iFood, leader dominant de la livraison au Brésil, opère **iFood Benefícios**, une carte d'avantages multi-soldes (alimentation, repas, mobilité, culture, bien-être) régulée par le programme public brésilien PAT, sans coût pour l'entreprise cliente au-delà du montant des avantages distribués, acceptée dans plus de 11 millions d'établissements.

**Ce qu'on en tire** : notre idée d'avantage-repas numérique décrite comme extension future (Choix 4 de [02-strategie-differenciation.md](02-strategie-differenciation.md)) n'est pas un pari spéculatif — c'est une ligne de métier déjà éprouvée à très grande échelle par le leader du marché de livraison le plus mature d'Amérique latine. Ça ne change rien à notre séquencement (cette brique reste en Phase 4, après la traction organique), mais ça renforce la confiance dans la destination : ce n'est pas une idée exotique, c'est une trajectoire déjà validée ailleurs.

Sources : [iFood Benefícios — vale-alimentação e vale-refeição](https://beneficios.ifood.com.br/produtos/saldo-alimentacao-refeicao) · [iFood Benefícios une os vales em um cartão só](https://institucional.ifood.com.br/noticias/ifood-beneficios-une-os-vales-alimentacao-e-refeicao-em-aplicativo-e-um-cartao-so-sem-taxas/)

## Asie du Sud-Est — Grab traite le "Group Order" et le "Business" comme deux produits séparés

**Constats** : Grab propose à la fois un **GrabFood Group Order** grand public (commande groupée entre particuliers, répartition de l'addition) et un **GrabFood for Business** distinct (commandes facturées à l'entreprise selon des règles de dépense définies). Ce sont deux offres différentes, pas une seule fonctionnalité qui ferait les deux.

**Ce qu'on en tire** : ça valide directement notre séquencement produit — garder la commande groupée individuelle (Phase 1) et le compte entreprise/avantage-repas (Phase 4) comme **deux produits distincts**, pas une seule fonctionnalité fusionnée trop tôt. Ce n'est pas une simplification par manque de moyens de notre part : même le numéro deux mondial du secteur les sépare délibérément.

Source : [GrabFood Group Order — Singapour](https://www.grab.com/sg/grouporder/) · [GrabFood for Business](https://www.grab.com/sg/business/food/)

## Comment les leaders ont vraiment démarré — l'assignation manuelle n'est pas un raccourci amateur

**Constats** : DoorDash n'avait strictement aucune technologie à son lancement en 2013 — un numéro Google Voice, une page HTML listant huit menus de restaurants, un Google Doc pour suivre les commandes, et l'app grand public "Find My Friends" pour suivre... les fondateurs eux-mêmes, qui livraient avec leurs propres voitures. Ils n'ont géré que deux créneaux par jour (le midi et le soir, entre deux cours), et **les 200 premières commandes ont été livrées entièrement à la main par les fondateurs**. Chowdeck, le acteur nigérian aujourd'hui à plusieurs milliards de nairas de ventes, raconte la même histoire à peine dix ans plus tard : ses fondateurs ont commencé avec **trois motos et leurs propres économies**, et ont vite compris que "le problème était plus opérationnel que technique" — ils tenaient des réunions hebdomadaires avec leurs livreurs pour organiser les tournées à la main. Plus largement, la dispatch manuelle ou par algorithme rudimentaire a été la norme chez la plupart des acteurs de livraison à la demande (Postmates y compris) avant que le volume ne justifie un vrai moteur de matching.

**Ce qu'on en tire** : l'assignation manuelle des livreurs par l'équipe TocToc en Phase 1 ([09-workflows.md](09-workflows.md)) n'est pas une solution de repli en attendant "le vrai produit" — c'est exactement la méthode qu'ont suivie DoorDash et Chowdeck à un stade comparable, et ça a fonctionné suffisamment bien pour qu'ils grandissent dessus pendant longtemps avant d'automatiser quoi que ce soit. Le signal de bascule n'est jamais un chiffre magique de commandes, c'est un signal opérationnel concret : le jour où une seule personne à TocToc ne peut plus suivre à l'œil ou sur un tableur toutes les livraisons en cours sans erreur, c'est le moment d'investir dans l'automatisation du matching — pas avant.

Sources : [DoorDash Started With Zero Technology — The Launch Pad](https://thelaunchpadincubator.com/blog/doordash-zero-technology) · [DoorDash doing things that don't scale — Alexander Jarvis](https://www.alexanderjarvis.com/doordash-doing-things-that-dont-scale/) · [Chowdeck: How This Food Delivery Startup Hit ₦30 Billion in Sales](https://www.marketinginaction.xyz/p/chowdeck-marketing-led-growth-case-study) · [Paul Graham — Do Things That Don't Scale](https://www.inc.com/business-insider/paul-grahams-counter-intuitive-startup-advice-do-things-that-dont-scale.html)

## Amérique latine — Rappi, une piste non confirmée à ce stade

La recherche n'a pas permis de confirmer l'existence d'une fonctionnalité de commande groupée spécifique chez Rappi (leur différenciation semble plutôt porter sur l'étendue super-app et les services financiers). Pas de conclusion à en tirer pour l'instant — à revisiter si une source plus précise apparaît, plutôt que d'extrapoler sans preuve.

## Ce qui change concrètement dans le MVP suite à cette recherche

1. **Confirmé, à ne pas relâcher** : rejoindre un lien ne demande aucun compte TocToc — un numéro de téléphone suffit pour payer (aligné sur DoorDash, pas sur Uber Eats).
2. **Écarté puis remplacé** : pas de seuil minimum de commandes pour garantir la livraison — une seule commande sur un lien reste livrée, toujours. À la place : un tarif de livraison dégressif par palier, qui récompense un groupe qui grandit sans jamais bloquer une livraison. Voir [04-modele-economique.md](04-modele-economique.md) et [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md).
3. **Nouveau — à tester en Phase 0** : un incitatif concret pour le relais qui recrée le lien chaque jour, financé par l'économie de coût de livraison réelle et non par une subvention arbitraire. Voir [03-roadmap-phases.md](03-roadmap-phases.md), [04-modele-economique.md](04-modele-economique.md) et [05-risques.md](05-risques.md).
4. **Confirmé** : garder la commande groupée individuelle et le compte entreprise comme deux produits séparés dans le temps (Phase 1 vs Phase 4) — cohérent avec Grab et avec la logique déjà posée dans [02-strategie-differenciation.md](02-strategie-differenciation.md).
5. **Réserve pour plus tard, pas pour le MVP** : plafond de participants par lien (~18, comme Uber Eats) et limite de dépense par personne (comme DoorDash) — utiles mais pas bloquants pour valider l'effet waouh en Phase 0/1.
6. **Confirmé, avec preuve à l'appui** : l'assignation manuelle des livreurs par l'équipe ([09-workflows.md](09-workflows.md)) n'est pas un pis-aller — DoorDash et Chowdeck ont grandi longtemps dessus avant d'automatiser quoi que ce soit. Le signal pour changer, c'est l'incapacité opérationnelle à suivre les livraisons à l'œil, pas un volume de commandes fixé à l'avance.
