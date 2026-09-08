# Cartularia — Journal d’exécution de la vague V0

Date : 8 septembre 2026. Plan de référence : [plan d’action par vagues](2026-09-08-plan-actions-par-vagues.md), vague V0 « Base saine, sécurisée et déployable ». Autorisations : commit sur branche dédiée et push (plan validé), téléchargement de Java 21 et rétablissement du drapeau émulateurs (accord explicite du 8 septembre).

## 1. App Check — diagnostic du 403 (V-A2)

**Constat d’origine.** Dans le navigateur intégré utilisé pour l’audit visiteur, la console affichait à chaque surface `@firebase/app-check: AppCheck: 403 error`, puis une mise en veille des tentatives pendant 24 h, et le script reCAPTCHA (346 ko) était chargé même pour un visiteur.

**Configuration constatée.**

- Client : `src/firebase.ts` initialise App Check avec `ReCaptchaEnterpriseProvider` dès que `VITE_FIREBASE_APP_CHECK_SITE_KEY` est défini au build, hors émulateurs. La clé publique embarquée dans le bundle déployé (`assets/firebase-BSpJTzWD.js`) est `6LdNnIstAAAAAD0NmDEW34ZWxt9KqyAsB1mRiFXj`. Le `.env` local ne contient pas cette variable : un build local ne l’activerait pas.
- Serveur : `scripts/firebase-functions.mjs` déclare `enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true'` sur les fonctions appelables (invitations, collections, administration, publication de mini-site) ; seules les fonctions de secours sont en `enforceAppCheck: false`. **En production, un jeton App Check invalide fait donc échouer ces appels.**

**Reproduction contrôlée.** Depuis l’origine `studio-2614005370-a3e51.web.app`, exécution manuelle de la même séquence que le SDK : `grecaptcha.enterprise.execute(siteKey, { action: 'fire_app_check' })` puis `POST content-firebaseappcheck.googleapis.com/v1/projects/studio-2614005370-a3e51/apps/1:27274402949:web:fce503a37799f78eadddec:exchangeRecaptchaEnterpriseToken`. Résultat : **200, jeton App Check délivré, durée de vie 3600 s.** La clé est donc valide pour le domaine, l’application est enregistrée et l’API est active.

**Contre-épreuve dans Chrome réel.** Session propriétaire puis visiteur dans Chrome : aucune erreur App Check en console, aucun échec de requête, parcours complet de création réussi.

**Conclusion.** Le 403 n’est pas un défaut de configuration. Il est propre au navigateur automatisé de l’audit, dont le score reCAPTCHA Enterprise est bas : le serveur App Check refuse alors l’attestation, et le SDK se met en veille 24 h. Le constat V-A2 est **requalifié** : pas de panne, mais deux risques réels à suivre.

1. Tout client à faible score reCAPTCHA (navigation privée agressive, extension anti-pistage, automatisation) perd les fonctions appelables pendant 24 h sans message compréhensible. À vérifier dans la console Firebase App Check (métriques « requêtes non vérifiées ») ; prévoir un message d’erreur explicite côté client sur `failed-precondition`.
2. Le script reCAPTCHA de 346 ko se charge sur les surfaces publiques alors qu’aucune fonction appelable n’y est utilisée. Décision à prendre en V7 : n’initialiser App Check qu’après connexion.

Aucune action de configuration Firebase n’a été faite. Aucune clé privée n’a été lue.

## 2. Branche et commits

- Branche `feat/lecteur-unique-adr-028-031` créée depuis `main` (`fe3aa90`) sans modification de l’arbre de travail, poussée sur `origin`.
- `302b1b0` — travaux d’architecture des ADR-028 à ADR-031 et contrat ADR-026 durci : 25 fichiers modifiés, 21 fichiers nouveaux, note de passation incluse.
- `13f6148` — audits navigateur visiteur et propriétaire du 8 septembre, plan d’action par vagues.
- Arbre de travail propre après les deux commits (hors fichiers ignorés par git).

## 3. Environnement de recette local

- Java 21 : runtime Eclipse Temurin 21.0.12.1 (JRE, aarch64) téléchargé depuis les versions officielles Adoptium, empreinte SHA-256 vérifiée contre celle publiée par l’API Adoptium, installé sans droits administrateur dans `~/.cartularia/jre21/Contents/Home`. Emplacement persistant, contrairement à `/private/tmp` utilisé auparavant. Le guide `cartularia-dev` est mis à jour.
- `.env` : `VITE_USE_FIREBASE_EMULATORS=true` et les hôtes et ports d’émulateurs rétablis à partir de `.env.example` ; sauvegarde `.env.bak-2026-09-08` (fichiers ignorés par git). Le build de production continue de forcer `VITE_USE_FIREBASE_EMULATORS=false`.
- Recette émulateur : voir §5, complété après les corrections d’hygiène.

## 4. Corrections d’hygiène

Réalisées par orchestration (analyse, correction, deux relecteurs contradictoires par correction, suites complètes, critique de complétude), puis relues et complétées. Commit `e433a1d` sur la branche.

**P-B4 — forme des groupes de spécifications.** Cause établie : le service de création écrivait le groupe avec `label: 'Identification'` alors que le normaliseur du lecteur (`src/persistence/storedStateValidation.ts`) exige `title` ; la lecture matérialisait `title: ''` et signalait `invalid-shape` à chaque ouverture, sans perte de valeur. Correction : constructeur pur `buildCreationSpecificationGroups` dans `src/domain/cartularyCreation.ts`, utilisé par le service ; tests de relecture sans réparation pour la création et pour le seed Rolex, test de compatibilité de l’ancienne forme (toujours réparable, jamais rejetée) ; garde-fou textuel dans `tests/cartulary-create-wiring.test.mjs`. Résidu : les brouillons déjà créés en production portent l’ancienne forme jusqu’à leur prochaine persistance depuis le lecteur. L’avertissement attribué à l’IWC pendant l’audit propriétaire était un artefact de lecture du journal console, qui persiste dans l’onglet entre navigations : les six messages portaient tous l’horodatage de l’ouverture de l’objet de test. Vérification dans Chrome le 8 septembre : les cinq états locaux de spécifications (IWC, Rolex, démo, objet de test) portent la forme `title` et l’ouverture de l’IWC n’émet aucun message.

**P-D5 — troncature des identifiants.** `slugifyCartularyLabel` (domaine, limite 44) tronque sur une frontière de mot, jamais de `_` final ; même règle pour le slug des Collections (limite 64), identique côté client (`src/domain/collections.ts`) et serveur (`scripts/lib/collection-policy.mjs`), défaut de même nature relevé par la critique de complétude. Un relecteur avait réfuté la première version des tests, qui ne prouvait pas la coupe en milieu de mot ; le test utilise désormais un cas réel avec assertion exacte, qu’une coupe brute ferait échouer.

**V-B6 — requalifié.** Ni `src/` ni le bundle déployé n’instancient de `PerformanceObserver` ni n’appellent `getEntriesByType` sur un type hors chronologie ; Chromium émet « Deprecated API for given entry type » depuis `performance.getEntriesByType('largest-contentful-paint')` et `('layout-shift')`, exactement les deux appels du script de mesure de l’audit visiteur (constat B5). Le constat est donc un artefact de mesure. Livrables : sonde d’audit `scripts/lib/web-vitals-probe.mjs` (`observe({ type, buffered: true })` par type, protégée par `supportedEntryTypes`) et garde-fou `tests/performance-api-hygiene.test.mjs` (`npm run test:performance-hygiene`), dont la détection reste ligne par ligne. Audit et plan mis à jour.

Vérification après corrections : `tsc`, `oxlint`, `npm run build`, `git diff --check` sans erreur ; vitest 56 fichiers, 233 tests ; suites node du périmètre 95 tests, dont 14 nouveaux.

## 5. Recette avec émulateurs

Exécutée le 8 septembre avec Java 21, chaque suite lançant ses propres émulateurs (`firebase emulators:exec`), journal complet conservé dans l’espace de travail de session. Durée totale : 1 min 30.

| Suite | Contenu | Résultat |
|---|---|---|
| `test:wave1` | catalogue IA, schémas, règles Firestore, règles Storage, seed rejoué deux fois | 21 + 22 + 16 tests, 0 échec |
| `test:cartulary` | import IWC, projections, multi-actifs, Cercle, confiance | 33 tests, 0 échec après correction (voir ci-dessous) |
| `test:import` | chaîne complète de seed rejouée deux fois : fondations, IWC, projection IWC, car-démo, projection car, **import Rolex (nouveau)**, Cercle, modération, confiance, production | 0 échec ; import Rolex : création puis rejeu idempotent, 14 clés d’état écrites, synchronisation `processed` |
| `test:create` | création depuis brouillon privé, automobile, édition autoritaire, médias | 0 échec |
| `test:live-sync`, `test:production`, `test:retention`, `test:invitation`, `test:transfer`, `test:timestamp-gateway`, `test:public-anchor` | synchronisation, production, rétention, invitations, cession, horodatage, ancrage | 0 échec |

Les lignes `PERMISSION_DENIED` du journal sont attendues : ce sont les refus vérifiés par les tests de règles.

**Un échec, antérieur à cette session.** `tests/cartulary-import.test.mjs` attendait 22 médias dans le bundle IWC alors que la fixture `src/data/mockData.ts` en porte 20 depuis la révision du 7 septembre (`fe3aa90`) ; les trois fichiers concernés n’ont pas changé depuis, et l’attente de 22 datait du 15 août. La suite n’avait jamais été rejouée depuis. Le test suit désormais la fixture (`mockCartulary.assets.length`, au moins 20) ; l’invariant vérifié reste la neutralisation des médias.

Non réalisé : ouverture de l’interface locale avec un compte propriétaire pour voir une automobile dans le lecteur unique (ADR-028). Le compte de fixture du seed exige la saisie d’un mot de passe, que l’auditeur ne fait jamais ; à faire par Jérôme lors de la recette V1, sur `http://127.0.0.1:5175` après `npm run emulators` et la séquence de seed.

## 6. État de V0

| Point du plan | État |
|---|---|
| App Check (V-A2) | Requalifié : configuration valide, 403 propre au navigateur automatisé ; deux risques consignés pour V7 |
| Commit des ADR-028 à 031 | Fait, branche `feat/lecteur-unique-adr-028-031` poussée (commits `302b1b0`, `13f6148`, `e433a1d`, puis celui-ci) |
| Environnement local | Java 21 persistant, `.env` rétabli, seeds et suites émulateur rejoués |
| Hygiène (V-B6, P-B4, P-D5) | V-B6 requalifié avec sonde et garde-fou ; P-B4 et P-D5 corrigés, Collections comprises |

V0 est close. V1 peut commencer : build de production sans le drapeau émulateurs, déploiement Hosting sur autorisation explicite, puis rejeu en distant de `update:iwc-dossier` et `import:rolex` sur autorisation.
