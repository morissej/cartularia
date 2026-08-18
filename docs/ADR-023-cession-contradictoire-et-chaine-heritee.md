# ADR-023 — Cession contradictoire et continuité de la chaîne héritée

- Statut : accepté pour le pilote, non déployé
- Date : 2026-08-17
- Décisions liées : ADR-003 (cloisonnement des projections), ADR-006 (architecture de confiance), ADR-012 (rollover sans réécriture), ADR-021 (horodatage RFC 3161), ADR-022 (ancrage public)
- Portée : lot 3 du chantier « Preuve d’intégrité opposable »

## Contexte

Un Cartulaire peut changer de propriétaire sans que son historique probatoire soit effacé, recalculé ou réattribué. La cession ne peut toutefois pas résulter de la seule action du cédant ou de l’acquéreur. Elle doit lier deux décisions humaines à une révision déterminée, sceller la dernière tête placée sous l’autorité du cédant, puis continuer la même chaîne sous l’autorité de l’acquéreur.

Le changement de propriétaire ne doit pas non plus livrer au successeur les données personnelles et patrimoniales propres au cédant, ni reconduire tacitement ses choix de publication.

## Décision

La cession est une machine d’états serveur persistée dans `cartularyTransfers/{transferId}`. Ses événements canoniques sont :

- `cartulary.transfer.proposed` : proposition confirmée humainement par le propriétaire courant ;
- `cartulary.transfer.accepted` : acceptation confirmée humainement par l’acquéreur ;
- `cartulary.transfer.completed` : changement de propriétaire effectif après scellement ;
- `cartulary.transfer.rejected` : refus confirmé par l’acquéreur ;
- `cartulary.transfer.expired` : fermeture serveur après expiration.

Chaque proposition porte `expectedRevision`, puis enregistre la révision obtenue comme `sourceRevision`. Toute évolution du Cartulaire entre la proposition et l’acceptation invalide l’opération. Les deux décisions portent obligatoirement `decisionSource: human_confirmed`. Un `requestId` rejoué avec la même intention retourne le reçu existant ; sa réutilisation avec une autre intention est refusée.

Le navigateur écrit exclusivement une intention minimale dans `cartularyTransferRequests`. Les règles interdisent l’écriture directe du transfert, de l’enveloppe, du journal, des relations de propriété et des preuves. Le cédant ne peut pas déposer une acceptation à la place de l’acquéreur.

## Autorité de propriété

L’autorité sur un Cartulaire résulte de la combinaison suivante :

- la capacité organisationnelle `legal_owner` et les permissions actives dans le Registre concerné ;
- `cartularies/{id}.accountHolderId`, qui désigne le propriétaire légal courant de ce Cartulaire ;
- la relation `ownerRelations` courante, qui documente cette qualité dans le temps.

L’acquéreur doit déjà posséder la capacité organisationnelle `legal_owner` dans le bon périmètre. À l’achèvement, `accountHolderId` et `legalOwnerRelationId` basculent vers l’acquéreur, l’ancienne relation devient `transferred` et une nouvelle relation `legal_owner/current` est créée. Le cédant perd donc immédiatement toute commande de propriétaire sur ce Cartulaire, sans perdre un éventuel rôle organisationnel nécessaire à ses autres Cartulaires.

## Point de passage scellé

Après les deux consentements et avant le changement effectif :

1. l’événement d’acceptation devient la dernière tête sous l’autorité du cédant ;
2. un lot Merkle dédié inclut cette tête ;
3. la racine est horodatée par RFC 3161 ;
4. elle est soumise à OpenTimestamps ;
5. l’événement `completed` référence explicitement la tête héritée et le lot de scellement.

Le changement peut devenir effectif lorsque la preuve OpenTimestamps est au minimum soumise et portable (`pending_confirmation`) ; l’interface doit alors la présenter comme en attente, jamais comme confirmée. Une preuve `anchored` conserve également la hauteur et la date Bitcoin vérifiées.

La chaîne serveur n’est ni coupée ni réécrite : l’événement d’achèvement a pour `previousEventHash` la tête acceptée. Cette continuité applique le principe de l’ADR-012 : l’historique antérieur est conservé tel quel et le point de passage le référence. L’acquéreur est ajouté aux lecteurs du lot de scellement et peut vérifier la chaîne héritée et ses preuves. Un export portable ultérieur contient les événements antérieurs, la preuve d’inclusion, le reçu RFC 3161 et la preuve OpenTimestamps ; le vérificateur indépendant détecte toute modification d’un événement précédent.

## Confidentialité et disposition des données

L’acquéreur reçoit les informations attachées à l’objet : identité, caractéristiques, documentation technique, médias transmissibles, provenance déclarée, événements et preuves d’intégrité.

Il ne reçoit pas les informations propres au cédant :

- prix et base de coût d’acquisition ;
- coordonnées personnelles ;
- assurances ;
- adresses et lieux de stockage ;
- rappels personnels ;
- rapports et projections R du cédant ;
- décisions de publication antérieures ;
- localisateurs et chemins binaires privés contenant l’identité du cédant.

Avant le basculement, le serveur inspecte récursivement les sections pour détecter ces catégories. Les documents concernés sont déplacés vers `transferPrivateArchives/{transferId}`, dont le manifeste est empreinté et dont la lecture est réservée au cédant. Les localisateurs et chemins binaires privés conservés dans le Cartulaire sont neutralisés et devront être réingérés par le successeur. Les brouillons locaux privés ne font jamais partie de la cession.

Cette classification est volontairement conservatrice. Toute nouvelle catégorie de données personnelles ou tout nouveau schéma vertical devra étendre les marqueurs et les tests avant activation en production.

## Publications W, R et Sceau

Les décisions du cédant ne sont pas héritées tacitement :

- une publication W active est révoquée, ses blocs sont supprimés et une nouvelle revue est exigée ;
- les projections et validations R sont placées dans l’archive privée du cédant ;
- un Sceau actif est révoqué et marqué à réexaminer ;
- le Registre indique `publicationStatus: review_required`.

L’acquéreur devra créer ses propres décisions `human_confirmed` pour republier W, produire R ou demander un nouveau Sceau.

## Historique déclaratif

La rubrique `cartularia-ownership-history` (« Propriétaires précédents ») demeure une déclaration de provenance distincte. Elle peut être utile à l’expertise mais ne déclenche aucun droit et ne remplace pas le protocole de cession. Les événements de la chaîne d’audit serveur et les `ownerRelations` sont les sources d’autorité du changement de propriétaire. L’interface expose explicitement cette distinction.

## Sécurité, expiration et exploitation

Une tâche quotidienne ferme les propositions expirées. Les transferts et leurs preuves sont lisibles uniquement par leurs participants ; l’archive privée reste lisible uniquement par le cédant. Les écritures restent réservées aux commandes Admin transactionnelles.

Le pilote limite à 350 le nombre de documents privés archivés ou neutralisés dans une cession afin de rester sous les limites transactionnelles. Une industrialisation devra paginer ou orchestrer les dossiers plus volumineux sans relâcher le verrou de révision.

Ce lot ajoute le code, les règles, l’interface et les tests, mais n’autorise aucun déploiement Firebase. L’activation des fonctions de cession et d’expiration fera l’objet d’une validation et d’un déploiement séparés.
