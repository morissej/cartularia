# ADR-022 — Ancrage public OpenTimestamps sur Bitcoin

- Statut : accepté pour le pilote, non déployé
- Date : 2026-08-17
- Décision liée : ADR-006 (architecture de confiance substituable)
- Portée : lot 2 du chantier « Preuve d’intégrité opposable »

## Contexte

Le journal chaîné, le lot Merkle et le reçu RFC 3161 permettent déjà de détecter une altération et de dater une racine. Ils ne fournissent toutefois pas, seuls, une preuve publique indépendante de l’infrastructure Cartularia. Le pilote doit pouvoir remettre à un tiers un export qui se vérifie sans appel au réseau Cartularia.

## Décision

OpenTimestamps est le premier adaptateur d’ancrage public. Il publie une empreinte dans Bitcoin via des serveurs calendrier publics, sans jeton applicatif ni consortium privé. L’adaptateur reste remplaçable : la commande métier ne dépend que de l’opération `anchor` et du résultat normalisé.

Une fonction planifiée traite chaque jour à 03:20 (Europe/Paris) les lots Merkle déjà horodatés. Elle soumet une nouvelle preuve `.ots`, puis tente chaque jour sa mise à niveau jusqu’à ce qu’une attestation Bitcoin soit vérifiable. Aucune preuve en attente n’est présentée comme ancrée.

Les états persistés sont :

- `not_requested` : lot horodaté, pas encore soumis ;
- `processing` : verrou serveur court pendant l’appel externe ;
- `pending_confirmation` : reçu OpenTimestamps portable obtenu, confirmation Bitcoin non démontrée ;
- `anchored` : attestation Bitcoin vérifiée, hauteur et date du bloc conservées ;
- `failed` : échec temporaire, retenté au cycle quotidien suivant.

## Charge publique et confidentialité

La charge canonique d’ancrage contient exclusivement :

- l’algorithme Merkle ;
- la version de canonicalisation ;
- la racine Merkle ;
- le nombre de feuilles.

OpenTimestamps reçoit l’empreinte SHA-256 de cette charge JCS. Aucun identifiant de Cartulaire ou de personne, numéro de série, valeur, localisation, document ou média n’est publié. La preuve d’inclusion reste privée et n’est remise qu’au titulaire autorisé dans son export.

## Idempotence et concurrence

Chaque couple lot/fournisseur possède un document unique `publicAnchors/opentimestamps`. Un verrou transactionnel à durée limitée empêche deux exécutions concurrentes. Une preuve en attente est mise à niveau, jamais recréée. Une preuve `anchored` est terminale et rejouée sans nouvel appel au fournisseur.

## Export et vérification indépendante

L’export propriétaire `cartularia-portable-1` inclut, pour chaque lot concernant le Cartulaire :

- les métadonnées non secrètes du lot ;
- la feuille privée et son chemin d’inclusion ;
- les reçus RFC 3161 ;
- la preuve `.ots` et ses métadonnées Bitcoin.

Le vérificateur local recalcule successivement les empreintes de l’export, la chaîne d’audit, la feuille, le chemin Merkle, le reçu RFC 3161 et la preuve OpenTimestamps. La vérification OpenTimestamps utilise la chaîne Bitcoin publique ; elle n’appelle aucun service Cartularia.

## Sécurité et limites

Une confirmation démontre qu’un état empreinté existait au plus tard à la date du bloc Bitcoin vérifié. Elle ne démontre ni l’authenticité physique de l’objet, ni la véracité des données sources, ni l’identité d’une personne, ni la propriété légale.

Le client JavaScript officiel OpenTimestamps disponible sur npm est ancien (`0.4.9`) et entraîne des dépendances historiques dépréciées. Il est donc isolé côté serveur derrière l’adaptateur, exclu du bundle navigateur et couvert par un test de contrat. Une migration vers un client maintenu ou un adaptateur CLI compatible ne modifiera pas le contrat métier ni le format public.

## Exploitation

Ce lot ajoute le code et les règles nécessaires mais n’autorise aucun déploiement Firebase. L’activation de la fonction planifiée et tout appel réseau de production feront l’objet d’une validation et d’un déploiement séparés.
