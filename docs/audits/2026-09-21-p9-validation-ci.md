# P9 — Validation globale et CI protectrice

Date : 2026-09-21

Périmètre : F13 de `2026-09-18-assessment-code.md`

État : correction locale validée, non poussée et non déployée

## Résultat

La barrière historique `npm run test:v7`, auparavant arrêtée par trois attentes obsolètes, passe désormais entièrement. La CI est séparée en contrôles statiques, UI, métier et quatre environnements de règles Firebase. Aucun job ne déploie ni ne contacte un projet de production.

## Contrats obsolètes remplacés

### Politique axe

Le test attendait le texte exact d'un ancien `Set` ne contenant qu'une règle. La politique réelle en protège désormais deux : `aria-prohibited-attr` et `aria-valid-attr-value`.

- La liste et le filtrage sont portés par `scripts/lib/accessibility-audit-policy.mjs`.
- Le script d'audit consomme ce module au lieu de redéclarer la règle.
- Le test appelle le filtre avec des résultats axe représentatifs et vérifie que seules les violations ARIA objectivement invalides deviennent bloquantes.
- Le titre actuel de la scène Confidentialité est vérifié sous son intitulé réel, « Politique de protection des données personnelles — Cartularia ».

### Entrées de démonstration

Deux tests cherchaient encore des constantes et libellés dans `HomePage.tsx`, alors que les responsabilités avaient été déplacées vers `publicContent.ts`, `registryReturn.ts` et `PublicChrome.tsx`.

- Les tests Node vérifient maintenant les URL produites par les modules de routage : Cartulaire Submariner, entrée du Registre démo, retour au Registre démo et issues sans session.
- Le test UI rend réellement l'accueil, ouvre son menu et vérifie les liens « Démo Submariner » et « Registre démo · 5 montres ».
- Les contrôles existants de `registry-return.test.ts` continuent de couvrir les retours valides, les replis et le refus des chemins externes.

Les exigences fonctionnelles n'ont pas été retirées ; les assertions ont été rapprochées du module qui porte leur comportement.

## Nouvelle topologie CI

Le workflow `.github/workflows/schema-integrity.yml`, renommé visuellement « Cartularia CI », contient sept jobs indépendants :

| Job | Contenu | Environnement |
| --- | --- | --- |
| `static-integrity` | catalogue IA, schémas, lint, TypeScript et build Vite | Node 22.18 |
| `ui-tests` | suite Vitest complète | Node 22.18 |
| `business-tests` | tests Node métier et sécurité dédupliqués | Node 22.18 |
| `firestore-rules` | règles principales et sonde anonyme | Java 21 + émulateur Firestore |
| `storage-rules` | règles Storage avec leurs lectures Firestore | Java 21 + émulateurs Firestore/Storage |
| `personal-vault-rules` | règles du Coffre personnel | Java 21 + émulateur Firestore dédié |
| `bridge-rules` | règles de la base de correspondance | Java 21 + émulateur Firestore dédié |

Les projets utilisés sont fictifs. Les jobs de règles sont exécutés sur des machines CI distinctes et les configurations Coffre/bridge utilisent déjà leurs ports et projets propres. Aucun test métier ou UI n'est relancé dans les jobs de règles.

Le collecteur métier part des recettes V7 et P2–P8, suit leurs appels `npm run`, ne retient que les fichiers Node et les déduplique avant une invocation unique. La suite obtenue contient 64 fichiers distincts ; les tests Vitest restent exclusivement dans le job UI.

## Émulateurs obligatoires

Les quatre suites de règles utilisent maintenant `requireEmulatorEndpoint`. L'absence ou la forme invalide de `FIRESTORE_EMULATOR_HOST` ou `FIREBASE_STORAGE_EMULATOR_HOST` provoque une erreur immédiate et explicite. Un lancement direct sans émulateur a été vérifié : il échoue avec `FIRESTORE_EMULATOR_HOST absent`, sans test ignoré ni repli silencieux sur un port supposé.

## Régression volontaire détectée

`scripts/verify-ci-rules-regression.mjs` :

1. crée un répertoire temporaire ;
2. copie `firestore.rules` puis remplace uniquement la garde finale `allow read, write: if false` par `true` dans cette copie ;
3. lance un émulateur sur des ports temporaires ;
4. exécute une sonde exigeant le refus d'une lecture anonyme de profil ;
5. exige que la sonde ait réellement atteint l'émulateur et que le test échoue ;
6. supprime le répertoire temporaire.

Résultat : la lecture anonyme élargie fait bien échouer la sonde. Les règles du dépôt ne sont jamais modifiées par cette vérification. Le job Firestore exécute aussi la même sonde sur les règles normales, où elle passe.

## Vérifications exécutées

- `npm run test:v7` : barrière historique entièrement réussie ; 110 fichiers et 712 tests UI, puis tous les lots Node V3–V7.
- `npm run test:ci:static` : catalogue IA de 85 postes, 21 tests de schéma, lint et build réussis.
- `npm run test:ci:ui` : 110 fichiers, 712 tests réussis.
- `npm run test:ci:business` : 64 fichiers Node uniques, 602 tests réussis.
- `npm run test:ci:rules:firestore` : 35 tests réussis, sonde comprise.
- `npm run test:ci:rules:storage` : 22 tests réussis.
- `npm run test:ci:rules:personal` : 6 tests réussis.
- `npm run test:ci:rules:bridge` : 12 tests réussis.
- `npm run test:ci:rules-regression` : la copie volontairement affaiblie est détectée et la commande réussit uniquement parce que l'échec attendu de la sonde est confirmé.
- Le workflow YAML est analysé localement : sept jobs et déclencheurs `pull_request`, `main`, `agent/**` et `feat/**` reconnus.

Les journaux `PERMISSION_DENIED` des suites de règles correspondent aux refus attendus par leurs cas négatifs. Le build conserve l'avertissement Vite existant sur un chunk supérieur à 500 kB.

## Limites et état externe

- Le workflow n'a pas été poussé : aucune exécution GitHub Actions distante n'est revendiquée. Les commandes qu'il appelle ont été exécutées localement avec Node, Java 21 et les émulateurs Firebase.
- Les installations `npm ci --ignore-scripts` de chaque job n'ont pas été rejouées dans sept machines Linux neuves pendant cette intervention ; leur exécution réelle reste à confirmer lors d'une future CI autorisée.
- Les recettes navigateur Chrome et les tests d'intégration Firebase plus larges de P2–P5 ne sont pas ajoutés aux jobs demandés. La CI couvre ici la barrière V7, les tests unitaires consolidés, l'UI et les quatre frontières de règles explicites.
- Aucun commit, push, déploiement, publication, modification de données distantes ou changement de droits n'a été effectué.

## Fichiers du lot P9

- `.github/workflows/schema-integrity.yml`
- `package.json`
- `scripts/audit-accessibility.mjs`
- `scripts/lib/accessibility-audit-policy.mjs`
- `scripts/run-ci-business-tests.mjs`
- `scripts/verify-ci-rules-regression.mjs`
- `tests/cartulary-presentation-contract.test.mjs`
- `tests/demo-account.test.mjs`
- `tests/ui/public-site.test.tsx`
- `tests/helpers/require-emulator.mjs`
- `tests/firestore-rule-regression-probe.test.mjs`
- `tests/firestore.rules.test.mjs`
- `tests/storage.rules.test.mjs`
- `tests/personal-firestore.rules.test.mjs`
- `tests/bridge-firestore.rules.test.mjs`
- `docs/audits/2026-09-21-p9-validation-ci.md`
