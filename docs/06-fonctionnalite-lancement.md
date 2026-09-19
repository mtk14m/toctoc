# La fonctionnalité de lancement — le lien de commande groupée

Décision actée : TocToc ne démarre pas avec une application de livraison complète. Il démarre avec **une seule fonctionnalité** : un lien à partager entre collègues, où chacun choisit son plat, et paie sa propre part — ou se le fait offrir par celui qui a créé le lien. Tout le reste (catalogue étendu, comptes élaborés, avantage-repas) vient après, une fois que cette fonctionnalité a fait ses preuves — voir [03-roadmap-phases.md](03-roadmap-phases.md).

Cette fonctionnalité doit être conçue pour produire un **effet waouh** — pas seulement fonctionner, mais surprendre agréablement et donner envie d'en parler. C'est ce qui transforme une commande groupée ordinaire en mécanique virale bottom-up (voir l'insight de [00-vision.md](00-vision.md)) : sans le waouh, ce n'est qu'un panier partagé de plus, copiable en un sprint par n'importe quel concurrent.

## Le principe : un restaurant, puis solo ou groupé

Décidé le 2026-09-20. Le parcours commence par **le choix d'un restaurant** (ou d'une cuisinière) parmi les partenaires de TocToc. Ensuite, deux façons de commander chez lui, **livrées au même créneau** :

- **Seul.** Une commande d'une personne, sans partager quoi que ce soit.
- **En groupe.** La personne qui commence partage son lien à ses collègues, qui la rejoignent. **Le groupage ne se fait que par ce lien** : l'application ne propose pas de « groupes ouverts » à rejoindre (à réévaluer une fois observé si les gens se regroupent d'eux-mêmes).

**Une commande porte sur un seul restaurant, jamais deux.** Quelqu'un qui veut un autre restaurant lance sa propre commande, que d'autres peuvent à leur tour rejoindre. Plusieurs commandes coexistent donc dans un même immeuble, une par restaurant (voir [08-schema-donnees.md](08-schema-donnees.md)). La raison est concrète : un lien, c'est un seul retrait chez le restaurant et un seul passage du livreur — c'est aussi ce qui rend possible le tarif de livraison dégressif ([04-modele-economique.md](04-modele-economique.md)).

**Le mode solo n'est pas une livraison à la demande.** C'est une commande de groupe dont personne d'autre n'a rejoint le lien : même créneau de livraison, même heure limite, frais de livraison du premier palier (le plus élevé, ce qui donne une raison de se regrouper). La livraison à la demande reste une Phase 3 ([03-roadmap-phases.md](03-roadmap-phases.md)).

## Le parcours, étape par étape

### 1. Créer et partager

Quelqu'un (souvent le même "relais" chaque jour dans un bureau donné) ouvre TocToc, choisit l'adresse de livraison (son bureau), une heure de livraison, et génère un lien unique. Il le partage dans le groupe WhatsApp de ses collègues — pas de nouvelle app à faire installer à ce stade pour les autres participants.

**Un choix à faire à la création, pas après** : qui paie ? Par défaut, chacun règle sa propre part (`SPLIT`). Mais si un patron veut offrir le déjeuner à son équipe, ou qu'un collègue veut inviter les autres, il peut choisir "je paie pour tout le monde" (`HOST_PAYS`) dès la création du lien — exactement ce que proposent déjà DoorDash et Uber Eats sur leurs commandes groupées ([10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md)). Ce choix ne se change pas en cours de route : les participants doivent savoir dès qu'ils rejoignent s'ils vont payer ou non.

**Exigence produit** : créer un lien doit prendre moins de 15 secondes, choix du mode de paiement inclus — un simple interrupteur "chacun paie / j'invite tout le monde", pas un formulaire. Si c'est plus long, personne ne le refait le lendemain.

### 2. Rejoindre et choisir — le moment waouh n°1

Chaque collègue clique le lien depuis son téléphone. Il atterrit directement sur une page web légère, sans compte à créer ni app à télécharger, qui affiche :
- Un menu du jour volontairement restreint (peu de choix = décision rapide, pas de paralysie).
- **La liste des collègues qui ont déjà rejoint et ce qu'ils ont choisi, mise à jour en direct.** C'est le cœur de l'effet waouh : voir "Aïcha — riz gras", "Mamadou — attiéké poisson" s'afficher en temps réel donne un sentiment d'événement collectif, pas une simple commande solitaire. C'est ce qui pousse la 5ᵉ, 8ᵉ, 10ᵉ personne à rejoindre par entraînement social, sans que personne n'ait eu à les convaincre individuellement. **En mode `SPLIT`, seules les commandes payées apparaissent sur cette liste** — pas de ligne "en attente" qui laisserait croire au groupe que quelqu'un est dedans alors que son paiement n'est pas passé. **En mode `HOST_PAYS`, tout le monde apparaît "en attente" ensemble** jusqu'à la charge unique du créateur à l'heure limite ([09-workflows.md](09-workflows.md)) — ce n'est pas la même ambiguïté, puisque personne n'est faussement en avance sur les autres : le groupe entier est dans le même état, transparent, jusqu'au règlement final.

**Exigence produit** : le temps entre "cliquer le lien" et "avoir choisi son plat" doit être minimal — quelques secondes. C'est le principal levier de viralité, il ne doit jamais être sacrifié pour ajouter une fonctionnalité annexe.

### 3. Payer — indépendamment des autres, sans double authentification (ou pas payer du tout, si on est invité)

En mode `SPLIT` (le défaut), chacun paie sa propre part en mobile money au moment où il choisit, sans dépendre de la validation ou du paiement des autres participants (voir le risque identifié dans [05-risques.md](05-risques.md)). Personne n'attend qu'un tiers valide ou avance l'argent.

En mode `HOST_PAYS`, choisir son plat suffit — **aucune étape de paiement pour le participant**, encore plus rapide que le mode par défaut. Le créateur du lien règle la totalité en une seule fois à l'heure limite ([09-workflows.md](09-workflows.md)). Une bonne nouvelle mérite d'être dite simplement : la page affiche clairement "Offert par [nom du créateur]" pour que personne ne se demande s'il doit sortir son téléphone pour payer.

**Point de vigilance sur la vitesse réelle** : l'exigence "quelques secondes" du parcours n'a de sens que si on ne rajoute pas de friction inutile. Un participant qui rejoint un lien une fois n'a pas besoin d'un code OTP TocToc en plus de la confirmation déjà demandée par son opérateur mobile money (USSD, code PIN) — lui demander les deux, c'est doubler la friction pour une sécurité qui ne protège pas grand-chose sur une commande à faible montant. L'OTP par téléphone (voir [08-schema-donnees.md](08-schema-donnees.md)) garde du sens pour le **relais**, qui revient chaque jour et a un intérêt à protéger son compte — pas pour un participant occasionnel qui ne fait que choisir et payer.

**Si le paiement échoue, la personne doit le comprendre immédiatement — pour elle, pas pour le groupe.** Si toi tu ne paies pas mais que tes collègues si, tu ne reçois pas de repas — et l'interface doit te le dire sans ambiguïté à toi (par exemple "Paiement non abouti — vous ne recevrez pas de commande sur ce lien tant que ce n'est pas réglé, réessayez avant l'heure limite"), pas te laisser croire que tu es dans le groupe alors que ton nom n'apparaîtra jamais sur la liste que les autres voient. Deux publics, deux messages : le groupe ne voit que les commandes confirmées ([08-schema-donnees.md](08-schema-donnees.md)) ; la personne elle-même voit toujours l'état réel de sa propre commande.

### 4. Le tarif qui baisse — le moment waouh n°2

Le frais de livraison affiché dépend du rang de sa commande sur le lien : les premiers paient un peu plus, et à mesure que d'autres collègues rejoignent, le tarif affiché aux suivants baisse par palier (voir [04-modele-economique.md](04-modele-economique.md)). Contrairement au seuil de blocage de l'achat groupé chinois qu'on a examiné puis écarté ([10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md)), ce mécanisme ne conditionne jamais la livraison — il ne fait que récompenser un groupe qui grandit. C'est aussi une bonne raison concrète, au-delà du plaisir social, de recruter d'autres collègues sur le lien.

**Exigence produit** : le tarif d'une personne, une fois payé, ne change plus — jamais de recalcul rétroactif qui rendrait la commande de quelqu'un "trop chère après coup" parce que d'autres ont rejoint plus tard.

### 5. Le compte à rebours commun — le moment waouh n°3

Une heure limite claire et partagée par tout le groupe ("Commande fermée à 10h30"), avec un rappel automatique à l'approche de l'échéance. Ce n'est pas qu'une contrainte opérationnelle (elle permet de planifier la production et la tournée du livreur) — c'est un ressort d'habitude quotidienne : le rituel se répète chaque jour ouvré, à la même heure, dans le même groupe.

### 6. La livraison groupée — le moment waouh n°4

Le livreur arrive à l'heure annoncée avec tous les repas de l'adresse en un seul passage, identifiés par personne. Ce moment doit être visible et reconnaissable au bureau — l'arrivée groupée devient un petit événement social répété ("c'est l'heure de TocToc"), pas une livraison anonyme parmi d'autres. **Aucun seuil minimum de participants n'est requis** : une seule commande sur un lien est livrée comme n'importe quelle autre, TocToc ne bloque ni ne conditionne jamais une livraison au nombre de commandes atteint (voir la décision produit dans [10-benchmark-produit-mondial.md](10-benchmark-produit-mondial.md), où l'idée d'un seuil inspiré de l'achat groupé chinois a été examinée puis écartée).

**La même page se met à jour une dernière fois.** Dès que le livreur quitte le partenaire, la page du lien que tout le monde a déjà ouverte affiche "Livraison en route" et un code à donner au livreur à son arrivée — pas une notification séparée à construire, le même mécanisme temps réel que la liste qui se remplissait le matin ([09-workflows.md](09-workflows.md)). C'est aussi ce qui garantit, concrètement, qu'une livraison marquée comme faite l'a vraiment été.

### 7. Après coup — noter le partenaire, d'abord pour la qualité

Une fois livré, chacun peut noter le partenaire (1 à 5, pas d'avis à rédiger) — mais la raison d'être n'est pas de rendre l'expérience plus sociale, c'est de garder un signal de qualité sur chaque partenaire ([05-risques.md](05-risques.md)) et d'aider le relais à savoir s'il recommande ce partenaire la prochaine fois. Que ça rende aussi le moment un peu plus agréable pour le groupe est un effet secondaire bienvenu, pas la justification de la fonctionnalité — voir [09-workflows.md](09-workflows.md).

### 8. Le lendemain — recommencer doit être plus rapide que la première fois

Le relais qui a créé le lien la veille doit pouvoir le recréer pour le lendemain en un geste (rejouer le même groupe, la même adresse, la même heure), pas repartir de zéro. C'est ce qui transforme un test ponctuel en habitude installée.

### S'inscrire reste toujours facultatif — mais on peut le proposer, honnêtement

Rejoindre et payer ne demande jamais de créer un compte ([08-schema-donnees.md](08-schema-donnees.md)) — ça reste vrai en toutes circonstances. Ça n'empêche pas d'**encourager** l'inscription au bon moment (par exemple juste après avoir noté le partenaire, une fois la commande terminée) : "Garder votre numéro pour rejoindre plus vite la prochaine fois ?" Pour que ce soit honnête, pas juste facultatif sur le papier :
- Jamais de case pré-cochée — un choix actif, pas une option qu'il faut décocher.
- Le refus doit être aussi visible et aussi facile qu'un clic que l'acceptation — pas un petit lien gris caché sous un gros bouton coloré.
- La proposition arrive après que la personne a déjà eu ce qu'elle est venue chercher (son repas confirmé) — jamais comme condition ou comme frein avant de pouvoir commander.

## Ce qui ne doit surtout pas arriver au lancement

- **Exiger le téléchargement d'une app pour rejoindre un lien.** C'est la première barrière à la viralité : celui qui reçoit le lien doit pouvoir choisir et payer en quelques clics depuis son navigateur, sans friction d'installation. L'app, si elle existe, peut venir plus tard pour le créateur de groupes ou l'usage répété.
- **Une inscription présentée comme obligatoire alors qu'elle ne l'est pas, ou rendue difficile à refuser.** Voir le principe ci-dessus.
- **Un menu trop large.** Plus de choix ralentit la décision et casse l'effet "c'est rapide et évident" qui fait le waouh.
- **Un paiement qui bloque tout le groupe si une personne tarde.** Chaque paiement doit être indépendant (voir [05-risques.md](05-risques.md)).
- **Repousser le "en direct" à une version 2.** La liste qui se remplit en temps réel n'est pas un détail cosmétique ajoutable plus tard — c'est le mécanisme même de l'effet d'entraînement social qui fait la différence entre "une app de livraison de plus" et "le truc que tout le monde utilise dans mon bureau".

## Comment on saura que le waouh fonctionne

Pas seulement "est-ce que les gens commandent", mais des signaux plus précis :
- Un lien créé un jour est-il **partagé plus loin que le groupe initial** (un collègue le renvoie à un autre service, à un autre étage) ?
- Le nombre de participants à un même lien **augmente-t-il de lui-même** au fil des jours, sans relance des fondateurs ?
- Le relais qui a créé le premier lien **recrée-t-il le lien de lui-même** le lendemain, sans qu'on le lui rappelle ?

Ces trois signaux, plus que le volume brut de commandes, disent si la fonctionnalité a le potentiel viral recherché — voir les métriques de Phase 0 dans [03-roadmap-phases.md](03-roadmap-phases.md).
