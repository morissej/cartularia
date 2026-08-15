# ADR-005 — Versionnement immuable du schéma Watch

Date : 15 août 2026
Statut : adopté

## Décision

Le catalogue conserve définitivement `watch@1.3.0` avec ses 78 champs et 25 sections. Les 13 nouveaux champs de valorisation sont publiés dans un nouveau profil `watch@1.4.0`, composé de 91 champs et 26 sections. Aucune commande ne peut réécrire un artefact existant sous la même version.

Le passage à `1.4.0` est une évolution additive et opt-in : les nouveaux champs obligatoires s'appliquent uniquement aux nouveaux Cartulaires qui déclarent cette version. Ils ne rendent pas rétroactivement invalides les Cartulaires `1.3.0`. Une suppression, un renommage, un changement de type ou de cardinalité incompatible imposera une version majeure.

## Cycle de vie

- `baseline` désigne une version historique encore acceptée à l'import ;
- `active` désigne la version recommandée pour les nouveaux Cartulaires ;
- `deprecated` reste lisible pour les Cartulaires existants mais n'est plus acceptée pour un nouvel import ;
- le document `schemaCatalog/{schemaId}` porte `latestVersion` et `activeVersion` ;
- un schéma vertical ne peut compter plus d'une version `active` lors du seed.

`watch@1.4.0` est active. `watch@1.3.0` reste baseline pour préserver l'import IWC historique. `car@1.0.0` reste inchangé et suit la même règle d'immuabilité.

## Empreintes et publication

`firebase/schema-catalog/manifest.json` épingle deux empreintes SHA-256 par version :

- l'empreinte canonique de l'artefact JSON complet ;
- l'empreinte canonique du contrat, indépendante du statut de cycle de vie.

`npm run schema:check` compare le code courant, les JSON publiés et le manifeste sans écrire dans le dépôt. `npm run schema:export` peut créer une nouvelle version et compléter le manifeste, mais refuse d'écraser une version existante.

Le seed vérifie le contrat réellement présent dans Firestore avant toute écriture. Une version absente est créée avec son empreinte ; une version identique est seulement vérifiée ; une version divergente bloque le seed. L'import inscrit l'empreinte du schéma dans le Cartulaire et la combine avec l'empreinte du bundle dans le premier événement d'audit lorsque le catalogue Firestore fournit cette empreinte.

## Compatibilité et migration

Les Cartulaires `watch@1.3.0` ne sont ni renommés ni migrés automatiquement. Leurs projections doivent utiliser l'artefact `1.3.0`, tandis que les nouveaux Cartulaires `1.4.0` utilisent l'artefact courant. Toute migration future devra produire une nouvelle révision explicite et un nouvel événement d'audit ; elle ne pourra jamais remplacer silencieusement la version scellée.

Les 13 nouveaux champs restent Secrets par défaut. `value.sensitivity` est une nouvelle section. Aucun index Firestore supplémentaire n'est requis tant qu'aucune requête n'est ajoutée sur ces champs. Les projections continuent d'utiliser des listes positives et un profil correspondant exactement à la version du Cartulaire.

## Preuves automatisées

- `npm run test:schema` vérifie le manifeste, les artefacts historiques et le refus d'écrasement ;
- `npm run test:seed` exécute deux seeds consécutifs dans les émulateurs ;
- `npm run test:cartulary` vérifie la coexistence 1.3/1.4, la persistance des 13 champs et le scellement de l'empreinte du schéma ;
- le workflow GitHub Actions `Schema integrity` exécute validation IA, schémas, lint et build.
