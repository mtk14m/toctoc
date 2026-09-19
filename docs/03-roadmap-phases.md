# Roadmap — séquence d'exécution

Chaque phase a un objectif unique, des critères de sortie mesurables, et ne s'ouvre pas tant que la précédente n'est pas validée. On ne code pas la phase N+1 avant d'avoir la preuve que la phase N fonctionne.

## Phase 0 — Validation "à la main" du lien de commande groupée (Conakry)

**Objectif** : vérifier que le mécanisme du lien de commande groupée (voir [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md)) déclenche vraiment un effet d'entraînement entre collègues — avant d'écrire une ligne de code. On simule la fonctionnalité à la main pour tester l'effet, pas seulement la demande.

**Le créneau du déjeuner, corrigé avec de vraies données** : les mentions précédentes de "11h30–14h30" dans ce dossier étaient une hypothèse de travail, jamais vérifiée. Un décret présidentiel de novembre 2022 fixe en réalité la pause déjeuner de la fonction publique guinéenne à **12h00–14h00 du lundi au jeudi**, et **13h00–15h00 le vendredi** — décalée d'une heure ce jour-là pour laisser le temps de la prière. La Guinée est un pays à très large majorité musulmane (88 à 95 % selon les sources) : le vendredi n'est pas un jour comme les autres pour la pause déjeuner, et ce n'est pas une nuance à ignorer. Deux conséquences concrètes pour la Phase 0 :
- **Le vendredi a son propre horaire de commande et de livraison** (cutoff et livraison décalés d'environ une heure par rapport aux autres jours) — à tester séparément, pas à traiter comme un jour normal.
- **Ce décret ne s'applique qu'à la fonction publique** — banques, écoles, santé, commerces en sont explicitement exclus. Chaque immeuble ciblé en Phase 0 doit faire vérifier son horaire de pause réel, pas supposer que le décret s'applique partout.
- **Le Ramadan change tout, environ un mois par an** : pendant le jeûne, la grande majorité des collègues visés ne déjeunent pas du tout — l'occasion "déjeuner de bureau" s'effondre mécaniquement. Voir la parade proposée dans [05-risques.md](05-risques.md) (basculer temporairement le même mécanisme de lien groupé sur la rupture du jeûne, en fin de journée, plutôt que d'arrêter le service).

**Actions** :
- Identifier 3 à 5 immeubles/zones de bureaux à Conakry avec une forte densité de salariés (Kaloum, Almamya, zones administratives et sièges d'entreprises) — sans chercher à obtenir un accord de l'employeur, juste une zone géographique dense.
- Trouver dans chacun un ou deux "relais" (des personnes qui déjeunent sur place tous les jours) et simuler le produit à la main dans un groupe WhatsApp : chaque matin, le relais annonce le menu du jour, les collègues répondent dans le fil pour choisir leur plat, un fondateur ou un opérateur **poste manuellement une mise à jour visible à chaque nouvelle commande** ("Aïcha a pris le riz gras — 4/10 places prises avant 10h") pour reproduire l'effet de liste qui se remplit en direct décrit dans [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md), puis relance un rappel à l'approche de l'heure limite.
- Chacun paie sa propre commande en mobile money — jamais l'entreprise, jamais en cash (voir [08-schema-donnees.md](08-schema-donnees.md) : décision produit, trop compliqué à fiabiliser pour un début).
- Observer précisément où l'effet d'entraînement se produit ou pas : est-ce que voir les autres commander en direct fait rejoindre plus de monde ? Est-ce que le compte à rebours avant l'heure limite crée de l'urgence ou de l'anxiété qui fait fuir ? C'est le vrai objet du test, pas seulement "est-ce que les gens ont faim".
- Tester différents horaires de commande (heure limite le matin) et différents types de plats (portion individuelle, facile à manger au bureau) — en distinguant explicitement le lundi-jeudi (livraison ciblée autour de 12h) du vendredi (livraison ciblée autour de 13h), et en vérifiant l'horaire réel de chaque immeuble plutôt que de le supposer.
- Objectif chiffré : au moins un immeuble où un groupe passe de 2-3 commandes à 8-10+ commandes en moins de deux semaines, sans que les fondateurs aient à solliciter individuellement chaque nouveau participant — la preuve que l'effet d'entraînement, pas seulement le service, fonctionne.
- Tester un **incitatif concret pour le relais** (petite commission ou plat offert après N commandes groupées réussies dans la semaine), inspiré du modèle des chefs de groupe communautaires chinois (voir [10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md)) — comparer le comportement de relance avec et sans incitatif sur deux immeubles différents, sans s'engager sur un montant définitif tant que l'économie unitaire n'est pas mesurée (voir [04-modele-economique.md](04-modele-economique.md)).
- En parallèle, recruter et qualifier 5 à 10 cuisinières/traiteurs à domicile capables de tenir une cadence quotidienne, et évaluer avec elles ce qu'il faut standardiser (hygiène, régularité, capacité, types de plats qui se prêtent au déjeuner de bureau).
- **Vérifier directement auprès de plusieurs taxi-motos ce qu'ils gagnent réellement sur le créneau 12h-14h (et séparément sur 13h-15h le vendredi)** (pas leur moyenne journalière) avant de proposer un montant — c'est la condition de base pour recruter un livreur pilote, voir [05-risques.md](05-risques.md). Tester avec eux la formule "session garantie" plutôt qu'un paiement à la course, et ajuster jusqu'à trouver un montant qui les fait revenir chaque jour sans qu'on ait à les convaincre à nouveau.

**Critère de sortie** : l'effet d'entraînement se produit dans au moins un immeuble sans intervention individuelle des fondateurs sur chaque participant, ET au moins 3 cuisinières/traiteurs ou restaurants tiennent la cadence sans rupture, ET au moins un livreur pilote reste fidèle au créneau plus de deux semaines sans qu'on ait à le recruter à nouveau chaque jour — la preuve que le montant proposé bat vraiment son alternative en taxi-moto. Si l'effet d'entraînement ne se produit pas malgré une bonne demande de base, c'est le mécanisme (pas l'occasion déjeuner) qu'il faut revoir avant de construire quoi que ce soit. Si le livreur abandonne ou négocie sans cesse à la hausse, c'est le signal que l'estimation de coût livreur ([04-modele-economique.md](04-modele-economique.md)) est encore trop basse.

## Phase 1 — Une seule fonctionnalité : le lien de commande groupée

**Objectif** : remplacer la simulation manuelle de la Phase 0 par la fonctionnalité elle-même — et rien d'autre. Pas de catalogue étendu, pas de compte utilisateur complexe, pas d'app native obligatoire au départ. Le détail complet de cette fonctionnalité (parcours, moments "waouh" à préserver dans le vrai produit) est dans [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md).

**Périmètre produit minimal, strictement limité à** :
- Choisir un restaurant, puis commander **seul ou en groupe**. Une commande porte sur un seul restaurant ; le groupage ne passe que par un lien partagé ; une commande solo est une commande de groupe d'une personne, ouverte 20 minutes puis livrée comme les autres, de 9h à minuit (voir [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md)).
- Créer un lien de commande groupée pour une adresse et une heure de livraison donnée.
- Rejoindre ce lien depuis un navigateur mobile (pas de téléchargement d'app requis pour rejoindre), voir en direct qui a déjà rejoint et ce qu'il a choisi, choisir son propre plat dans un menu du jour restreint (peu de choix, décision rapide).
- Payer sa propre part indépendamment des autres participants, en mobile money uniquement (pas de cash, voir [08-schema-donnees.md](08-schema-donnees.md)) — avec un frais de livraison dégressif selon le rang de la commande sur le lien (voir [04-modele-economique.md](04-modele-economique.md)).
- Recevoir un rappel automatique à l'approche de l'heure limite.
- Livraison groupée à heure fixe, réceptionnée par le livreur en un seul passage pour toute l'adresse.

**Ce qui reste volontairement hors de ce périmètre en Phase 1** : gestion de plusieurs villes, portefeuille repas, historique de commandes élaboré, chat. Une notation légère du partenaire (score 1-5, pas d'avis textuel) est en revanche incluse — elle sert d'abord le suivi qualité des partenaires, voir [08-schema-donnees.md](08-schema-donnees.md) et [09-workflows.md](09-workflows.md).

**Critère de sortie** : la propagation organique observée à la main en Phase 0 se reproduit avec le vrai produit, dans au moins deux immeubles, sans intervention des fondateurs pour relancer les participants ; coût de livraison par commande inférieur à un seuil défini avec les fondateurs.

## Phase 2 — Extension multi-villes du déjeuner de bureau

**Objectif** : répliquer le modèle validé à Conakry sur un second marché, sans changer le segment.

**Ordre** : Dakar (Sénégal) en premier — voir justification dans [02-strategie-differenciation.md](02-strategie-differenciation.md) — puis Abidjan (Côte d'Ivoire, quartier du Plateau uniquement au départ).

**Point d'attention spécifique** : la Guinée n'étant pas dans l'UEMOA, l'intégration des paiements et la conformité pour le Sénégal et la Côte d'Ivoire (zone XOF, régulation BCEAO) sont un chantier distinct de celui mené en Guinée, pas une simple extension.

**Levier d'entrée à considérer** : Chowdeck a percé à Lagos et Ibadan via un partenariat d'exclusivité avec une enseigne déjà connue localement (Chicken Republic) plutôt qu'en reconstruisant toute la confiance partenaire à partir de zéro ([11-reference-chowdeck.md](11-reference-chowdeck.md)). À évaluer pour Dakar et Abidjan : un accord avec une enseigne locale reconnue peut accélérer la crédibilité initiale, en complément (pas à la place) du travail d'agrégation des cuisinières à domicile qui reste le cœur de la différenciation ([02-strategie-differenciation.md](02-strategie-differenciation.md)).

**Critère de sortie** : le second marché atteint une traction comparable à Conakry en un temps significativement plus court que la première fois (preuve que le playbook, pas la chance, a fonctionné).

## Phase 3 — Ouverture grand public (mêmes villes)

**Objectif** : monétiser la flotte et l'offre déjà construites en dehors du créneau déjeuner — soirée et week-end, livraison classique à la demande pour les particuliers.

**Ce qui est déjà acquis en entrant dans cette phase** : une flotte de livreurs opérationnelle, un catalogue de restaurants/cuisinières déjà signés et évalués, une marque déjà connue localement via le déjeuner de bureau. Le seul problème à résoudre ici est l'acquisition de la demande grand public — un problème bien plus abordable en subvention limitée qu'en partant de zéro.

**Critère de sortie** : la Phase 3 doit rester rentable ou proche de l'équilibre par elle-même dans un délai fixé à l'avance ; si elle nécessite de brûler massivement du capital pour exister, c'est le signal qu'il faut se retirer du grand public dans cette ville et rester concentré sur le déjeuner de bureau (cf. l'échec de Jumia et de Glovo Ghana, voir [01-marche-et-concurrence.md](01-marche-et-concurrence.md)).

## Phase 4 — Bénin et avantage-repas comme upsell

**Objectif double** : entrer sur le marché le plus dur (Bénin, face à Gozem) uniquement avec une vraie traction sur le déjeuner de bureau déjà prouvée ailleurs, et proposer le portefeuille repas décrit dans [02-strategie-differenciation.md](02-strategie-differenciation.md) aux employeurs des immeubles où l'adoption organique est déjà forte sur les marchés matures (Guinée, Sénégal, Côte d'Ivoire).

Cette phase n'a pas de date fixe — elle s'ouvre quand les Phases 1 à 3 tournent sans supervision constante des fondateurs sur au moins deux marchés.

## Ce qui reste volontairement hors scope pour l'instant

- Pas d'agrégation de tout type de commerce (épicerie, pharmacie, colis) — Glovo et Gozem le font déjà, ce n'est pas le combat de TocToc à ce stade.
- Pas de flotte de véhicules en propre — on s'appuie sur des livreurs indépendants (moto), comme l'ensemble des acteurs du secteur.
- Pas d'expansion au-delà des quatre pays cibles avant d'avoir un modèle rentable sur au moins deux d'entre eux.

## Sources

- [Guinée : Mamadi Doumbouya fixe les horaires du travail dans le secteur public — Guinee360](https://www.guinee360.com/03/11/2022/guinee-mamadi-doumbouya-fixe-les-horaires-du-travail-dans-le-secteur-public/)
- [Guinée : Les horaires de travail changent pour les fonctionnaires — Africa Guinee](https://www.africaguinee.com/articles/2022/11/03/guinee-les-horaires-de-travail-changent-pour-les-fonctionnaires)
- [Islam en Guinée — Wikipédia](https://fr.wikipedia.org/wiki/Islam_en_Guin%C3%A9e)
