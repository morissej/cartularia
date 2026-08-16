# ADR-012 — Journal local révisionné sans réécriture de l’historique

- Statut : accepté pour la vague corrective 1
- Date : 2026-08-15
- Portée : interface React locale du prototype

## Contexte

Le dépôt possède une chaîne d’audit transactionnelle côté Firebase, mais l’interface de démonstration utilisait un autre journal dans `localStorage`. Celui-ci ne scellait pas l’état métier courant, pouvait produire des séquences concurrentes et proposait d’effacer le journal après une rupture. L’indicateur visible ne permettait donc pas d’expliquer précisément ce qui était contrôlé.

## Décision

L’interface construit un instantané JSON du contenu métier puis le sérialise avec le profil `jcs-1`. Toute transition vers une nouvelle empreinte crée une révision et un événement chaîné contenant l’empreinte avant/après. Les actions sans modification du contenu conservent la révision courante.

L’écriture est protégée par une file dans le même contexte JavaScript et, si disponible, par `navigator.locks` entre onglets. Chaque intention peut porter un `requestId` : un rejeu identique retourne le même événement ; la réutilisation du même identifiant pour une intention différente est refusée.

Les événements historiques sont importés comme archive opaque. Leur statut est calculé sans modifier leurs données. Une rupture du journal v2 déclenche un rollover : l’ancienne chaîne est archivée comme rompue, une nouvelle chaîne référence son empreinte, puis l’état métier courant est enregistré en révision 1.

L’export portable inclut l’état canonique, les événements, les archives, les reçus et une racine de Merkle. Il peut être vérifié par `scripts/lib/local-integrity-verifier.mjs`, qui ne dépend pas de l’implémentation TypeScript du navigateur.

## Raisons

- L’empreinte affichée correspond désormais à un état métier déterministe et reproductible.
- Les erreurs de concurrence et les rejeux ne peuvent plus créer deux événements avec la même séquence.
- L’historique douteux reste disponible pour expertise au lieu d’être effacé ou réécrit.
- L’export indépendant prépare un futur scellement externe sans prétendre qu’il existe déjà.

## Conséquences et risques

- Une modification de la structure de l’instantané change son empreinte même si les données visibles paraissent identiques ; toute évolution devra donc versionner son schéma avant usage probatoire durable.
- Le regroupement de 450 ms réduit le bruit mais ne conserve pas chaque frappe individuelle.
- Le verrou local ne remplace pas une transaction serveur multi-client ; la chaîne Firebase demeure l’architecture cible pour l’autorité partagée.
- Tant que la tête n’est ni signée, ni horodatée par un tiers, ni ancrée à l’extérieur, un remplacement coordonné de tout le stockage local reste possible.

## Options rejetées

- Recalculer les empreintes historiques : cela aurait transformé un historique rompu en chaîne apparemment valide.
- Effacer le journal après une rupture : cela aurait détruit une information utile à l’investigation.
- Journaliser chaque `setState` séparément : cela aurait couplé la preuve aux détails d’implémentation React et créé des révisions partielles difficiles à interpréter.
- Revendiquer une preuve blockchain dès cette vague : aucune écriture sur un registre public n’est encore effectuée.
