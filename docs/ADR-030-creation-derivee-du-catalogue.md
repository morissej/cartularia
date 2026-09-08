# ADR-030 — La création d’un Cartulaire est dérivée du catalogue de schémas

- Statut : accepté
- Date : 2026-09-08
- Précise : ADR-004 (noyau multi-actifs), ADR-005 (versionnement immuable), ADR-028, ADR-029

## Contexte

La version de schéma d’un nouveau Cartulaire était déclarée à trois endroits qui devaient rester
alignés à la main : le client (`SUPPORTED_CREATION_PROFILES`, `watch@1.6.0`, `car@1.2.0`), la
fonction serveur (liste des versions acceptées, chaînes `watch@1.6.0` codées dans chaque section,
puis « patchs » automobile appliqués après coup) et le catalogue lui-même. Les sections et champs
produits à la création n’étaient contrôlés par rien : la section d’acquisition d’une automobile
pointait vers `value.cost_basis`, une section qui n’existe que dans le schéma montre.

## Décision

1. **Une table de création par verticale**, `scripts/lib/creation-profile-map.mjs`, partagée par
   le client (libellés, types proposés, règles de saisie) et la fonction serveur. Elle décrit,
   par section du schéma, la provenance de chaque champ (clé du profil, constante, montant,
   paragraphe, listes parallèles) et les conditions d’émission. Elle ne cite aucune version.
2. **La version de création est résolue dans le catalogue**, avec la même règle des deux côtés :
   version active désignée par `schemaCatalog/{schemaId}`, à défaut dernière version publiée, à
   défaut la version demandée si elle est publiée. Le serveur vérifie que la version retenue
   connaît toutes les sections de la table (`resolveCreationSchemaVersion`). Le client lit la
   même version au moment de créer (`loadCreationSchemaVersion`) ; le serveur reste maître.
3. **Le catalogue contrôle la table.** `tests/creation-profile-map.test.mjs` vérifie que chaque
   section et chaque champ cités existent dans l’artefact publié de la version de création, et
   que le bundle produit est identique, à la fixture près, à celui du code précédent
   (`tests/fixtures/creation-bundles.json`).
4. **Correction constatée** : l’acquisition d’une automobile est rangée en extensions de
   `value.provenance`, section existante du schéma automobile.

## Conséquences

- Publier une nouvelle version active suffit à faire créer les nouveaux Cartulaires sur cette
  version, sans toucher au client ni au serveur, tant que les sections de la table y existent.
- Une demande de création en attente sur une version antérieure est créée sur la version active
  au moment de son traitement : « on part toujours de la même base ».
- Le schéma automobile n’a pas de version active dans le manifeste (`car@1.2.0` est `baseline`) :
  la règle « dernière version publiée » s’applique. Activer une version reste une décision de
  publication (ADR-005).
- Les Cartulaires existants gardent leur version épinglée ; leur remontée fait l’objet de
  l’étape suivante de l’audit.

## Contrôle

`npm run test:create:unit` (dont `creation-profile-map.test.mjs`) et `npm run test:reference-dossiers`.
Le test avec émulateur `tests/cartulary-create.test.mjs` reste valide : sans document pointeur,
la version demandée publiée est acceptée.
