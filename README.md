# Cartularia — prototype du Cartulaire

Prototype React/TypeScript du dossier numérique multi-actifs Cartularia, avec une verticale montre complète et une verticale automobile pilote.

Le Cartulaire rassemble dans une interface unique :

- une page d’accueil avec l’identité de la montre, son propriétaire et son stockage ;
- la bibliothèque média, la photo et la vidéo principales, le diaporama et la revue à 360° ;
- l’histoire, les spécifications et les points d’identification de la référence ;
- la description de l’exemplaire, son état, ses rapports, papiers et accessoires ;
- la valorisation, les comparables, le prix de revient, la plus-value et le TRI ;
- une sélection indépendante pour le Watch website et pour le rapport PDF.

L’interface applique le design system Cartularia v2 et le kit logo officiel « Strates du temps » v1.0. Les couleurs de marque sont l’encre `#1A1815`, le repère `#A63A2A`, le papier `#F4F2ED` et le blanc `#FFFFFF`.

## Démarrage local

Prérequis : Node.js et npm.

```bash
npm ci
cp .env.example .env
npm run dev
```

L’application est ensuite accessible à l’adresse indiquée par Vite, généralement `http://127.0.0.1:5173`.

## Configuration Firebase

Copier `.env.example` vers `.env`, puis remplacer les valeurs par la configuration du projet Firebase. Le fichier `.env` est volontairement exclu de Git.

Les règles de développement sont présentes dans `firestore.rules` et `storage.rules`.

Pour le raccordement local continu du Cartulaire au Registre, lancer les émulateurs puis le worker dans un second terminal :

```bash
npm run emulators
FIREBASE_PROJECT_ID=<projet-local> npm run sync:worker
```

L'ingestion pilote des images IWC dans Storage se lance avec `npm run seed:iwc-media` lorsque les variables d'émulateur Firestore et Storage sont définies. `npm run verify:live-connection` contrôle ensuite, avec le compte propriétaire local, le chemin Cartulaire → projection Registre → original Storage. L'architecture et ses limites sont consignées dans [`docs/ADR-019-raccordement-cartulaire-registre.md`](docs/ADR-019-raccordement-cartulaire-registre.md).

## Contrôles

```bash
npm run validate:ai
npm run test:corrective-wave1
npm run test:corrective-wave2
npm run test:retention
npm run test:wave7
npm run lint
npm run build
```

## Fondations Firebase — vague 1

La première vague met en place Auth, organisations, memberships, Registres et le schéma historique `watch@1.3.0` dans un environnement d’émulation sécurisé. Le catalogue conserve désormais cette baseline à 78 champs et publie `watch@1.4.0` à 91 champs comme version active, sans réécriture de l’artefact historique. Les règles restent deny-by-default ; depuis la vague 3, Storage ouvre uniquement un dérivé sous `public/{publicCode}/...` lorsque la publication Firestore correspondante est active.

Le guide d’exécution et les garde-fous de déploiement sont décrits dans [`docs/FOUNDATIONS_WAVE_1.md`](docs/FOUNDATIONS_WAVE_1.md). La décision d’architecture correspondante est consignée dans [`docs/ADR-001-fondations-firebase.md`](docs/ADR-001-fondations-firebase.md).

Le versionnement immuable, les empreintes du catalogue et la coexistence des profils Watch sont définis dans [`docs/ADR-005-versionnement-immuable-schema-watch.md`](docs/ADR-005-versionnement-immuable-schema-watch.md). Utiliser `npm run schema:check` pour un contrôle sans écriture et `npm run schema:export` uniquement pour publier une nouvelle version.

## Cartulaire privé IWC — vague 2

La deuxième vague crée l’enveloppe commune du Cartulaire IWC et importe séparément sections, provenance, médias, observations, valeurs et événements. Toutes les données restent Secrets et non publiées ; les médias fictifs du prototype sont neutralisés jusqu’à leur réingestion.

Le workflow se trouve dans [`docs/CARTULARY_WAVE_2.md`](docs/CARTULARY_WAVE_2.md) et la décision technique dans [`docs/ADR-002-cartulaire-prive-iwc.md`](docs/ADR-002-cartulaire-prive-iwc.md).

## Projections Registre, W/R et Sceau — vague 3

La troisième vague sépare physiquement le Registre privé, les quatre blocs W publics, les rapports R, le Sceau et les dérivés Storage. Toutes les commandes sont transactionnelles, révisionnées, idempotentes et auditées. Le Watch website peut charger une publication Firestore avec `/watch-website?publicCode={publicCode}` ; une publication révoquée ne retombe jamais sur les données locales du prototype.

Le guide d’exécution se trouve dans [`docs/PROJECTIONS_WAVE_3.md`](docs/PROJECTIONS_WAVE_3.md) et la décision d’architecture dans [`docs/ADR-003-projections-registre-wr-sceau.md`](docs/ADR-003-projections-registre-wr-sceau.md).

## Noyau multi-actifs et verticale automobile — vague 4

La quatrième vague ajoute `car@1.0.0` au même catalogue et au même root `cartularies` que les versions Watch. Elle fournit un import automobile de démonstration, la projection Registre filtrable par type et collection, ainsi qu’un lecteur privé générique accessible par `/cartulary-view?cartularyId={cartularyId}`. Aucun root `cars` et aucune règle d’autorisation propre à l’automobile ne sont introduits.

Le guide d’exécution se trouve dans [`docs/MULTI_ASSETS_WAVE_4.md`](docs/MULTI_ASSETS_WAVE_4.md) et la décision d’architecture dans [`docs/ADR-004-noyau-multi-actifs.md`](docs/ADR-004-noyau-multi-actifs.md).

## Communauté isolée — vague 5

La cinquième vague fournit un cercle communautaire authentifié et admis : memberships propres à la communauté, profils pseudonymes, projections `community` par champs autorisés, posts, commentaires, réactions agrégées et suspension par la modération. La surface `/community` ne charge jamais le Cartulaire maître et disparaît pour un utilisateur non admis ou lorsqu’une publication est suspendue.

Le guide d’exécution se trouve dans [`docs/COMMUNITY_WAVE_5.md`](docs/COMMUNITY_WAVE_5.md) et la décision d’architecture dans [`docs/ADR-005-communaute-isolee.md`](docs/ADR-005-communaute-isolee.md).

## Confiance blockchain-ready — vague 6

La sixième vague ajoute la canonisation `jcs-1`, la vérification du journal chaîné, les lots Merkle multi-actifs, un adaptateur d’horodatage de test non qualifié et l’export propriétaire portable. L’ancrage sur une chaîne publique reste explicitement différé et aucune donnée personnelle n’entre dans sa future charge utile.

Le guide d’exécution se trouve dans [`docs/TRUST_WAVE_6.md`](docs/TRUST_WAVE_6.md) et la décision d’architecture dans [`docs/ADR-006-confiance-blockchain-ready.md`](docs/ADR-006-confiance-blockchain-ready.md).

## Intégrité de l’interface locale — vague corrective 1

Le Cartulaire React scelle désormais un instantané canonique de ses données métier et de ses sélections W/R/C dans un journal local révisionné. La chaîne gère la concurrence et les rejeux, conserve les journaux historiques sans les réécrire et produit un export JSON vérifiable indépendamment avec `npm run integrity:verify-local`.

Cette couche détecte les incohérences mais ne revendique encore ni horodatage qualifié, ni ancrage blockchain, ni preuve de vérité des données. Le contrat, les tests et les limites sont décrits dans [`docs/CORRECTIVE_WAVE_1_INTEGRITY.md`](docs/CORRECTIVE_WAVE_1_INTEGRITY.md) et [`docs/ADR-012-journal-local-revisionne.md`](docs/ADR-012-journal-local-revisionne.md).

## Production et readiness — vague 7

La septième vague ajoute la sauvegarde/restauration vérifiable, T-20 avec fichier binaire, les sondes de charge et volumétrie, un calculateur de coûts paramétrique, les contrôles privacy/credentials, l’observabilité expurgée et les runbooks d’exploitation. Le rapport sépare la construction terminée de l’autorisation effective de mise en service.

Le guide se trouve dans [`docs/PRODUCTION_WAVE_7.md`](docs/PRODUCTION_WAVE_7.md) et la décision dans [`docs/ADR-007-production-readiness.md`](docs/ADR-007-production-readiness.md). Les décisions encore ouvertes sont versionnées dans `config/production-policy.json` et ne peuvent être contournées par le rapport automatique.

## Persistance hybride — vague corrective 2

Les formulaires sont désormais doublés dans IndexedDB et les originaux importés y sont conservés avec leur empreinte SHA-256. Une session Firebase existante active une synchronisation privée Firestore/Storage bornée au compte, avec détection de conflit sans écrasement silencieux. Le panneau Intégrité affiche séparément l’état du coffre local et celui de la copie cloud, et propose une suppression volontaire à confirmation textuelle.

La conservation des brouillons privés suit la décision « compte actif, puis deux ans après passage inactif ». `npm run retention:private` est un dry-run ; toute purge exige `--execute`, et une purge distante exige en plus `--allow-remote --confirm-private-purge`. Le contrat et ses limites sont décrits dans [`docs/CORRECTIVE_WAVE_2_PERSISTENCE.md`](docs/CORRECTIVE_WAVE_2_PERSISTENCE.md).

## Publication contrôlée — vague corrective 3

Les marqueurs W/R/C ouvrent désormais un acte de validation explicite, conditionné par une marque, un modèle et une photo principale. Chaque décision est liée à une révision et à une empreinte de source ; une modification impose une nouvelle validation. Le contrat est décrit dans [`docs/CORRECTIVE_WAVE_3_PUBLICATION.md`](docs/CORRECTIVE_WAVE_3_PUBLICATION.md).

## Horodatage externe — vague corrective 4

Le panneau Intégrité peut obtenir un vrai jeton RFC 3161 sur la racine Merkle, vérifié côté serveur avec son nonce, sa signature et sa chaîne de certificats. Seule l'empreinte quitte le Cartulaire. Le QR de partage encode une URL réelle et le rapport R expose la preuve complète ou signale qu'elle ne couvre plus le contenu courant.

Un jeton RFC 3161 vérifié n'est pas présenté comme qualifié eIDAS sans preuve `QTSA` issue d'une liste de confiance. L'ancrage blockchain public reste différé. Le contrat et les avertissements de déploiement se trouvent dans [`docs/CORRECTIVE_WAVE_4_TIMESTAMPING.md`](docs/CORRECTIVE_WAVE_4_TIMESTAMPING.md) et [`docs/ADR-017-horodatage-rfc3161-externe.md`](docs/ADR-017-horodatage-rfc3161-externe.md).

## Préparation au remplissage par IA

Le catalogue typé des postes se trouve dans `src/ai/fieldCatalog.ts`. Chaque champ de l’interface possède un identifiant stable, une description, des consignes de remplissage, une hiérarchie de sources, une validation et un niveau de confidentialité.

Le workflow d’intégration recommandé est documenté dans `src/ai/AI_AUTOFILL_GUIDE.md`. L’IA devra produire des propositions sourcées soumises à validation humaine ; elle ne pourra pas publier de contenu ni activer les marqueurs W/R de manière autonome.

## Données

Les données et médias présents dans ce dépôt servent de démonstration au prototype. Ils ne constituent ni un certificat d’authenticité ni une évaluation engageante.
