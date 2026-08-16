# ADR-010 — Agrégats du Registre calculés à la lecture

Date : 15 août 2026
Statut : adopté et implémenté localement

## Décision

Les agrégats de la Vague 3 sont calculés dans le client à partir des documents autorisés de `registries/{registryId}/items`. Aucun document d’agrégat supplémentaire n’est persisté dans Firestore.

Cette décision évite une seconde source de vérité, une dérive de compteur et surtout la mémorisation durable d’une visibilité que le Registre n’a pas autorité à décider.

## Données admissibles

Les calculs utilisent uniquement le noyau de la projection Registre : `assetType`, `collectionId`, `lifecycleStatus`, `possessionStatus`, `completenessLevel`, `sourceRevision` et `updatedAt`.

Les valeurs, propriétaires, preuves, médias, archives, rapports et événements du Cartulaire ne sont pas lus par le tableau de bord.

## Paliers de complétude

La complétude est affichée par paliers nommés et accompagnée du nombre de Cartulaires concernés. Aucun pourcentage isolé ni score de qualité inventé n’est présenté.

Un Cartulaire est compté une seule fois dans l’indicateur À revoir lorsqu’il porte un cycle `review`, un palier `imported_unreviewed`, ou les deux.

## Évolutivité

Le calcul à la lecture convient au volume pilote déjà retenu pour le Catalogue. Au-delà d’une limite de page future, le même contrat pourra être exécuté côté serveur sur les projections autorisées, sans modifier la définition des indicateurs.

Une future synthèse de valeur devra être une projection propre du Cartulaire, avec devise, date, méthode, portée et autorisation explicites. Elle ne pourra pas être déduite localement par le Registre.
