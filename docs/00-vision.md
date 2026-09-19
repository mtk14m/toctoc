# Vision — pourquoi TocToc, pourquoi maintenant

## Le constat de départ

Deux populations vendent de la nourriture en Afrique de l'Ouest francophone et sont mal servies par les plateformes existantes :

- **Les restaurants**, déjà ciblés par Glovo, Yassir ou Gozem là où ces acteurs sont présents — mais mis en concurrence frontale sur le prix et la vitesse, un jeu qui favorise celui qui a le plus de capital à brûler.
- **Les cuisinières et cuisiniers à domicile, traiteurs informels** — un pan énorme de l'économie alimentaire réelle (les "mamans" qui nourrissent un quartier, un bureau, une cité) — que ces plateformes n'agrègent quasiment jamais, parce que c'est opérationnellement plus dur (pas de régularité, pas de registre de commerce, contrôle qualité difficile) que de brancher une API sur un restaurant déjà structuré.

TocToc part de l'idée que la seconde population est un avantage d'approvisionnement que les géants n'iront pas chercher en premier, parce que ce n'est pas leur jeu (volume, vitesse, marketplace ouverte).

## L'erreur à ne pas reproduire

Jumia a fermé son activité de livraison de repas dans sept marchés africains fin 2023, dont la **Côte d'Ivoire**, en expliquant que des rivaux "aux poches profondes" rendaient le modèle intenable sans capital illimité. Glovo a fait la même chose au **Ghana** en 2024, après y avoir investi 3,7 millions de dollars. Le schéma est clair : la livraison de repas à la demande, grand public, en marketplace ouverte, est un jeu de subvention et de guerre des prix que seul celui qui a le plus de cash gagne à court terme.

**TocToc ne peut pas gagner ce jeu-là en 2026 face à Glovo, Yassir ou Gozem. Il ne faut donc pas le jouer.**

## L'insight stratégique

Le vrai point de bascule du produit n'est pas géographique, ce n'est pas non plus "qui paie" — **ce n'est pas l'entreprise qui paie**. C'est le choix d'une occasion précise plutôt que "n'importe qui a faim, n'importe quand" :

> **Le déjeuner de bureau : un salarié seul, ou un petit groupe de collègues qui commandent ensemble, mangent à heure fixe sur leur lieu de travail — et chacun paie sa propre commande.**

Ce n'est pas un choix de facilité, c'est un choix de défendabilité, construit sur deux leviers produit très concrets : **l'horaire** et **le type de plat** — pas sur un contrat commercial.

- La demande est **prévisible dans le temps** : un créneau de commande (le matin, avant une heure limite) et un créneau de livraison (la pause déjeuner) — l'inverse du chaos du "tout, tout de suite" que les géants doivent absorber avec du capital et une flotte surdimensionnée en permanence.
- La livraison est **groupable de façon organique** : dans un même immeuble de bureaux, plusieurs personnes commandent au même moment sans qu'il y ait besoin d'un accord d'entreprise pour ça — une fonctionnalité de **commande groupée par lien partagé** (chacun rejoint, choisit et paie sa part) transforme ce comportement naturel en avantage de coût de livraison, sans dépendre d'une vente B2B. C'est la toute première fonctionnalité que TocToc construit, détaillée dans [06-fonctionnalite-lancement.md](06-fonctionnalite-lancement.md) — pensée pour produire un effet waouh qui déclenche l'adoption virale décrite ci-dessous, pas juste un panier partagé de plus.
- Le **menu est spécialisé pour ce moment précis** : des plats pensés pour être mangés au bureau (portion individuelle, pratique à manger à un poste de travail, prix soutenable au quotidien, préparables en volume par une cuisinière à domicile dans la fenêtre du matin) — pas le catalogue généraliste d'un restaurant classique. C'est un axe de différenciation qu'une marketplace généraliste (Glovo, Yassir, Gozem) n'a aucune raison de travailler puisqu'elle sert tous les repas, à toute heure, pour tout le monde.
- L'occasion est **quotidienne et habituelle** : quelqu'un qui déjeune au bureau le fait presque tous les jours ouvrés. C'est une fréquence naturelle de réachat très élevée, obtenue par l'habitude, pas par un contrat qui lie l'entreprise.
- **Aucun cycle de vente B2B à mener** pour démarrer : pas de procurement, pas de décideur RH à convaincre avant de pouvoir servir le premier client. L'adoption se fait individu par individu ou petit groupe par petit groupe, immeuble par immeuble — un collègue qui commande via TocToc en fait voir d'autres commander, un effet viral bottom-up à l'échelle d'un bureau.

Le grand public au sens large (soir, week-end, tous types de repas) reste l'objectif final (c'est un marché bien plus grand), mais on y arrive en Phase 3, une fois la flotte, l'offre (restaurants + cuisinières) et la réputation construites sur le créneau du déjeuner de bureau — voir [03-roadmap-phases.md](03-roadmap-phases.md).

## Une extension possible, plus tard : l'employeur comme sponsor, pas comme point d'entrée

Une fois qu'un immeuble ou une entreprise donnée montre une adoption organique forte (beaucoup de salariés qui commandent déjà régulièrement, sans qu'on le leur ait vendu), TocToc peut alors proposer à l'employeur de **prendre en charge tout ou partie de la note** de ses salariés déjà utilisateurs — un peu comme un ticket-restaurant numérique (modèle Swile/Edenred), mais vendu avec la preuve d'usage déjà en main plutôt qu'en pari commercial à froid. C'est beaucoup plus facile à vendre qu'un contrat B2B classique, parce que la demande existe déjà avant la conversation avec l'employeur. Voir le détail dans [02-strategie-differenciation.md](02-strategie-differenciation.md) — mais ceci est une extension de monétisation ultérieure, **pas** le mécanisme de démarrage.

## Ce que TocToc est, en une phrase

**Un service de déjeuner de bureau pour l'Afrique de l'Ouest francophone — restaurants et cuisinières à domicile, livrés à heure fixe à des individus et des petits groupes de collègues qui commandent et paient chacun pour eux-mêmes — qui s'étend ensuite à la livraison grand public élargie une fois la flotte et la confiance construites.**
