# Risques et parades

## Risque le plus fondamental — payer les livreurs moins que leur alternative (taxi-moto)

**Risque** : un conducteur de taxi-moto à Conakry gagne de l'ordre de 200 000 GNF sur une journée complète de travail libre. Si le montant proposé par TocToc pour le créneau du déjeuner (11h–14h30) n'égale pas, voire ne dépasse pas, ce qu'il gagnerait à faire des courses classiques sur ce même créneau, aucun livreur sérieux n'a de raison d'accepter — et sans livreur, rien d'autre dans ce projet ne fonctionne. Notre première estimation de coût livreur (~40 000 GNF, voir [04-modele-economique.md](04-modele-economique.md)) était probablement trop basse.

**Parade** : vérifier sur le terrain, dès la Phase 0, ce qu'un taxi-moto gagne *spécifiquement* sur le créneau 11h–14h30 (pas seulement sa moyenne journalière) avant de fixer un montant — et payer une session garantie plutôt qu'à la course pure, pour que la proposition reste attractive même les jours à faible volume (voir le détail des options dans [04-modele-economique.md](04-modele-economique.md)). Amortir ce coût sur plusieurs immeubles par session, pas un seul, pour que l'économie tienne malgré un coût livreur réévalué à la hausse. Accepter que TocToc perde de l'argent sur ce poste pendant les premières semaines, le temps que le volume rejoigne le montant garanti — ce n'est pas un échec du modèle, c'est le prix de la validation.

## Risques liés à l'offre (cuisinières et traiteurs informels)

**Risque** : incident d'hygiène ou de sécurité alimentaire chez un partenaire non formalisé, qui met en cause la responsabilité de TocToc et sa réputation naissante.

**Parade** : grille minimale d'évaluation et de suivi avant intégration au catalogue (conditions de préparation, régularité, capacité), même informelle au départ. Ne pas attendre d'avoir une équipe qualité dédiée — un fondateur qui visite personnellement chaque nouvelle cuisinière en Phase 0/1 vaut mieux qu'un questionnaire non vérifié.

## Risque de capacité et de régularité

**Risque** : une cuisinière à domicile n'a pas la capacité de production d'un restaurant établi — un pic de commandes un jour donné peut dépasser ce qu'elle peut produire, créant des ruptures qui cassent la confiance des entreprises clientes.

**Parade** : le créneau fixe du déjeuner (commande groupée, heure limite le matin, livraison 11h30–14h30) permet de connaître le volume à produire la veille, contrairement à la demande imprévisible du grand public — c'est justement pourquoi ce segment est plus gérable pour ce type de partenaire. Prévoir un plafond de commandes par partenaire tant que sa capacité n'est pas prouvée.

## Risque sur la confirmation de livraison — connectivité et contournement

**Risque** : le code de confirmation ([09-workflows.md](09-workflows.md)) suppose que le livreur a du réseau au moment de la livraison pour le saisir et le valider côté serveur — pas garanti partout à Conakry. Symétriquement, la sortie de secours (confirmation manuelle par `ADMIN_PLATFORM`) est nécessaire mais pourrait devenir un contournement systématique si elle est trop facile à invoquer, ce qui viderait le code de sa valeur de preuve.

**Parade** : en cas d'absence de réseau sur place, le livreur note l'heure et confirme dès qu'il retrouve du signal (le décalage entre `pickedUpAt` réel et la confirmation enregistrée reste un cas limite acceptable en Phase 1, pas un problème à résoudre par une app hors-ligne dès le départ). Pour éviter que l'override Ops ne devienne la norme : chaque usage crée un `AuditLog` ([08-schema-donnees.md](08-schema-donnees.md)), et un taux d'override anormalement élevé sur un livreur ou un immeuble donné est un signal à surveiller dès la Phase 0, pas à ignorer parce que "ça marche quand même".

## Risque réglementaire — monnaie électronique et flottant

**Risque** : le portefeuille repas numérique (Phase 4) implique de détenir des fonds au nom de tiers avant dépense — c'est une activité de monnaie électronique dans la plupart des juridictions concernées (UEMOA/BCEAO pour Sénégal, Côte d'Ivoire, Bénin ; réglementation guinéenne distincte), qui nécessite un agrément ou un partenariat avec un émetteur agréé (banque, opérateur mobile money).

**Parade** : ne pas construire cette brique en interne sans validation juridique — s'appuyer sur un partenariat avec un émetteur de monnaie électronique déjà agréé (Wave, Orange Money) plutôt que de demander son propre agrément dès la Phase 4. C'est un chantier de partenariat, pas seulement un chantier technique. Dès la Phase 1, le schéma de données applique déjà ce principe : `Payment` (ce qu'un client verse) et `Payout` (ce que TocToc reverse à un partenaire, un livreur ou un relais) sont chacun attribués à une transaction précise chez un opérateur agréé — jamais à un solde interne que TocToc détiendrait lui-même. Voir [08-schema-donnees.md](08-schema-donnees.md).

## Risque de fragmentation monétaire et réglementaire entre pays

**Risque** : la Guinée (GNF, hors UEMOA) et les trois autres pays (XOF, UEMOA/BCEAO) n'ont ni la même monnaie ni le même régulateur — traiter l'expansion comme une simple traduction de l'app sous-estimerait le travail de conformité, de trésorerie et d'intégration de paiement à chaque nouveau pays.

**Parade** : budgétiser et planifier chaque entrée pays (Phase 2) comme un chantier de conformité et d'intégration de paiement à part entière, pas comme une itération produit mineure. Voir [03-roadmap-phases.md](03-roadmap-phases.md).

## Risque concurrentiel — réaction des acteurs en place

**Risque** : si l'occasion "déjeuner de bureau" de TocToc fonctionne visiblement, un acteur mieux capitalisé (Gozem, qui a déjà une flotte et une trésorerie, ou Glovo/Yassir) peut ajouter un menu déjeuner ou une fonction de commande groupée avec plus de moyens.

**Parade** : la vraie défense n'est pas la vitesse d'exécution seule, c'est le moat construit en Phase 4 — une fois l'upsell avantage-repas vendu à un employeur, l'intégration à la paie et aux processus RH de l'entreprise cliente est un coût de changement qu'un concurrent ne peut pas copier du jour au lendemain, contrairement à une fonctionnalité de commande groupée. Prioriser la profondeur de la relation (menu spécialisé, habitude quotidienne, puis upsell RH) plutôt que la seule fonctionnalité produit, qui reste copiable.

## Risque d'adoption bottom-up qui ne démarre pas

**Risque** : le modèle repose sur une adoption organique à l'intérieur d'un immeuble (un relais entraîne ses collègues) — si aucun relais naturel n'émerge dans un immeuble donné, l'adoption reste plate malgré une bonne offre.

**Parade** : en Phase 0/1, recruter activement un ou deux "relais" identifiés (personnes sociables, qui déjeunent tous les jours au bureau) plutôt que d'attendre que la viralité se déclenche seule — un petit coup de pouce initial (offre de lancement, présence physique des fondateurs le premier jour) débloque souvent l'effet de groupe. Ne pas ouvrir un nouvel immeuble tant que celui en cours n'a pas montré ce déclenchement.

## Risque d'un incitatif au relais qui devient intenable économiquement

**Risque** : un incitatif financier au relais qui crée le lien chaque jour ([10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md)) peut générer de l'engagement à court terme mais éroder la marge si son montant n'est pas ancré dans une économie réelle — c'est précisément ce qui a forcé Meituan à réduire ses commissions aux chefs de groupe communautaires en 2025.

**Parade** : plafonner l'incitatif à une fraction de l'économie de coût de livraison réellement réalisée par la commande groupée (voir [04-modele-economique.md](04-modele-economique.md)), jamais à un montant fixe déconnecté du volume. Le tester à petite échelle en Phase 0 avant de l'inscrire dans un modèle permanent.

## Risque de friction sur le paiement de la commande groupée

**Risque** : dans une commande groupée entre collègues, si chacun doit payer séparément via mobile money, la friction de coordination (qui valide, qui paie en premier, que faire si quelqu'un ne paie pas à temps) peut décourager l'usage répété.

**Parade** : concevoir le panier partagé pour que chaque participant paie sa propre part indépendamment et confirme son propre article, sans dépendre de la validation des autres — pas un système où un seul paiement collectif bloque toute la commande si une personne traîne.

## Risque de désintermédiation — correctement recadré : ce n'est pas la mise en relation qui est en jeu

**Précision produit** : le groupe, ce sont des collègues qui se connaissent déjà — TocToc ne les met pas en relation entre eux, il ne fait que **grouper leurs commandes**. Le risque de désintermédiation ne porte donc pas sur "vont-ils continuer à se parler sans nous nous" (ils n'ont jamais eu besoin de nous pour ça), mais sur deux choses bien réelles et bien plus concrètes : **l'accès au partenaire** (le catalogue, la commande, le paiement) et **la livraison** (quelqu'un qui va chercher la commande et l'apporte à l'heure). C'est là, et seulement là, que réside la valeur durable de TocToc.

**Risque** : si le groupe connaît déjà le nom et le numéro de la cuisinière une fois qu'elle a livré plusieurs fois, rien n'empêche de l'appeler directement et de s'organiser soi-même pour la livraison (un collègue qui passe la chercher, ou la cuisinière qui livre elle-même) — en coupant TocToc des deux bouts à la fois.

**Parade** : la livraison reste la partie la plus difficile à reproduire soi-même — un groupe de collègues n'a ni la moto, ni le temps, ni l'envie d'organiser un aller-retour chaque midi ; c'est précisément ce que TocToc leur évite. Tant que TocToc reste le moyen le plus simple d'accéder au partenaire (commander, payer chacun sa part) **et** le moyen le plus fiable de faire venir la commande à heure fixe, la désintermédiation n'a pas d'intérêt réel pour le groupe — le jour où livrer soi-même ou commander en direct devient plus simple que passer par le lien, c'est le vrai signal d'alerte à surveiller dès la Phase 0.

## Risque de saisonnalité et de dépendance à un seul créneau

**Risque** : l'occasion déjeuner de bureau dépend de la présence physique des salariés au bureau — vacances, jours fériés, généralisation du télétravail dans certains secteurs réduisent le volume de façon prévisible mais réelle.

**Parade** : c'est un argument de plus pour ouvrir la Phase 3 (grand public, soir et week-end) dès que la flotte et l'offre le permettent — cela lisse la dépendance à un seul créneau, sans attendre que la saisonnalité du déjeuner devienne un problème de trésorerie.

## Risque d'exécution — recruter et fidéliser les livreurs

**Risque** : comme pour tous les acteurs du secteur, les livreurs sont en général des indépendants (moto) — turnover élevé possible, dépendance à leur disponibilité aux heures de pointe du déjeuner.

**Parade** : le créneau fixe et prévisible du déjeuner permet de planifier les tournées à l'avance et de proposer un revenu régulier (contrairement au grand public où l'attente d'une course est aléatoire) — c'est un argument de recrutement et de fidélisation des livreurs à mettre en avant dès la Phase 0.
