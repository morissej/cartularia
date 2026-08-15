# ADR-004 — Noyau multi-actifs et verticale automobile

- Statut : accepté
- Date : 2026-08-14
- Vague : 4

## Contexte

La note technique exige qu’une seconde verticale soit créée sans root Firestore spécialisé et sans duplication des règles générales. Le test d’extensibilité retenu est l’automobile, avec le contrat vertical `car@1.0.0`.

## Décision

`watch` et `car` utilisent la même enveloppe sous `cartularies/{cartularyId}` et les mêmes sous-collections. Les différences métier résident dans des profils versionnés du `schemaCatalog`, pas dans la structure de stockage ni dans l’autorisation.

Le contrat d’un champ vertical est commun : identifiant, section, type, cardinalité, caractère requis, validation, visibilité par défaut, cibles de publication, priorité des sources, droits d’écriture IA, revue humaine et facette Registre.

Le lecteur privé est piloté par le schéma. Un champ inconnu d’une version ultérieure reste affichable par un composant de fallback ; l’absence de composant spécialisé ne rend donc pas le Cartulaire illisible.

La recherche Registre par `assetType`, `collectionId` et `updatedAt` repose sur un index explicite. Les règles Firestore existantes restent génériques et inchangées pour cette verticale.

## Conséquences

- aucune collection racine `cars` ;
- une deuxième verticale sans duplication structurelle ;
- import, journal d’intégrité, idempotence et projection Registre réutilisés ;
- composants spécialisés possibles ultérieurement, avec maintien obligatoire du fallback générique ;
- toute donnée automobile de cette vague est une fixture synthétique non vérifiée.

## Hors périmètre

La vague 4 n’autorise ni publication W, ni génération R automatique, ni déploiement Firebase distant. Elle ne constitue ni expertise mécanique, ni historique réel, ni valorisation d’un véhicule.
