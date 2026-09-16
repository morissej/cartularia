# Exécution V7 — « Performance, hygiène et recette finale » (16 septembre 2026)

Plan : `docs/audits/2026-09-08-plan-actions-par-vagues.md` § V7 (V-B2, V-B4, V-B5 ; décisions en attente ; recette des 49 constats). Branche `feat/lecteur-unique-adr-028-031`, ouverture à `a4ce595` (V6 déployée). Analyse du 16 septembre : cinq lectures avec mesures sur le build (Chrome headless, HTTP/2 local, tailles brotli), deux propositions par point, trois juges, une critique de cohérence (scratchpad `v7/` : `lecture-*.md`, `proposition-*.md`, `brief-*.md`, `coherence.md`, `statut-49-constats.md`).

## 1. Constat mesuré et périmètre

- V-B2 : 94 morceaux JS (1,8 Mo brut) dont 18 icônes lucide en fichiers séparés ; en HTTP/2 le nombre de fichiers pèse ± 10 ms : les 6 à 8 s d'ouverture du Registre démo relèvent du second document (rechargement complet), de l'initialisation Firebase et App Check et des 27 canaux Firestore Listen (mesure V3), non du découpage. Le regroupement des icônes et le préchargement du Registre depuis la page de connexion restent utiles (étape Registre à 0 JS réseau à chaud) mais V7 ne promet pas de secondes.
- V-B5 : trois polices Google (Archivo, JetBrains Mono, Newsreader), deux connexions TLS tierces, 198 ko ; hébergement local = trois `.woff2` latin (35 + 31 + 132 ko) + licence OFL.
- V-B4 : aucun routeur client ; accueil → démo → Registre = trois documents ; un routeur unique touche `cartularyIds.ts`, les singletons de `localVault.ts` et App.tsx : reporté.
- Décisions en attente : (a) manifeste automobile — le statut « active » n'est lu ni par le client ni par le serveur (règle `latest` : `car@1.2.0`), et la production n'a aucun Cartulaire automobile (lecture J0 du 16 septembre : `schemaCatalog/car` latest 1.2.0, active null, versions 1.0.0-1.2.0 ; `watch` active 1.6.0 ; 0 cartulaire `car`) ; (b) codes publics en dur dans `cartularyIds.ts` : aucun producteur de `/cartulary?publicCode=`, alias mort ; (c) copies « 2 » : 375 fichiers sources hors git (124 sous `public/assets/IWC/derivatives/`, 128 livrées en production par le build : à retirer de la livraison) ; (d) IWC `watch@1.6.0` : fait en V1 (révision 8), seuls la skill et la mémoire sont périmées.
- Budget `measure:pf0` : rouge hors barrière depuis V3 (App 330 028 o pour 320 000).
- Recette : 49 constats des deux audits du 8 septembre ; statut au 16 septembre (avant V7) dans `v7/statut-49-constats.md` : visiteur 20 clos, 3 partiels, 3 ouverts (V-B2, V-B4, V-B5) ; propriétaire : voir § H des audits.

## 2. Décisions

| # | Décision | Retenu |
|---|---|---|
| D1 | Polices : trois `.woff2` latin à déposer dans `src/assets/fonts/` + `OFL.txt` | **En attente de l'accord explicite de Jérôme** (téléchargement ≈ 198 ko depuis fonts.gstatic.com et github.com/google/fonts) |
| D2 | Copies « 2 » : archivage hors iCloud par `rsync --remove-source-files` (simulation `-n` d'abord) | Commande remise à Jérôme ; livraison protégée entre-temps par un greffon de build et `hosting.ignore` |
| D3 | Manifeste automobile | A : ne rien faire (verrou `hygiene-v7`) ; J0 fait |
| D4 | Routeur client (V-B4) | Reporté (V8) avec ticket d'entrée : partition mesurée des surfaces navigables en place / liées au document |
| D5 | Codes publics en dur | Retirés (−3 lignes), `readOnlyPreview` explicite, test |
| D6 | Budget `measure:pf0` | Relevé à 340 000 (gzip 92 000), cause datée, rattaché à `verify:v7` |
| D7 | Découpage Vite | Deux groupes `react` + `icons` (`build.rolldownOptions.output.codeSplitting.groups`) |
| D8 | Gardes contre les copies numérotées | Greffon `closeBundle` + `hosting.ignore "**/* [0-9].*"` (firebase.json, firebase.personal.json) |
| D9 | Assertion « 0 copie dans public/ » dans `test:v7` | Non (constat par `find` au journal) |
| D10 | Préchargement du Registre | À l'inactivité, 1,5 à 2,5 s après le premier rendu de la page de connexion, annulé au démontage |
| D11 | Coffre personnel | `assetsInlineLimit` + preload + ignore seulement |
| D12 | Mise à jour des audits | Section finale « H. Statut des constats (recette V7) » par audit |
| D13 | Six exceptions axe `until: "V7"` | Reportées V8, datées ; dette « contrôle mécanique de `until` » |
| D14 | Résidu V-A2 (App Check sur toute surface) | Reporté, écrit dans l'audit § H |
| D15 | Documents hors dépôt (skill § 5, mémoire) | Mis à jour |
| D16 | Déploiement | Un seul Hosting groupé après C4 (polices) ; si les polices tardent, décision explicite |

## 3. Ordre d'intégration

C1 découpage react/icons + `dist` sans copie numérotée + `measure:pf0` étendu + `measure:surfaces` + `test:v7`/`verify:v7` → C2 préchargement du Registre → C3 décisions (codes publics, copies jamais livrées, documents (a)-(d)) → [J1 polices par Jérôme] → C4 polices hébergées → C5 fusion (seuils, relevé `docs/audits/perf/`, allowlist axe, journal, section H des audits) → [R0 mesure « avant » de B2 par Jérôme] → J4 déploiement groupé → R1 recette anonyme (assistant) → R2 recette propriétaire et téléphone (Jérôme) → R3/C6 statut des 49 constats.

## 4. Implémentation (16 septembre) — quatre commits, C4 (polices) en attente de J1

Ordre réel des commits (l'autre piste a livré C3 avant C1) ; tous sur `feat/lecteur-unique-adr-028-031`, au-dessus de `96a2a36` (ouverture du journal), non poussés. Vocabulaire : **mesuré** (relevé par un outil sur `dist/`, Chrome 152 headless par CDP, serveur `node:http` sans compression avec les en-têtes de `firebase.json`, réseau coupé hors `127.0.0.1` + Google Fonts) ; **vérifié** (lu dans le dépôt) ; **supposé** (déduit).

| Commit | Lot | Contenu |
|---|---|---|
| `d45e959` | C3 décisions (D3, D5, D15) | Codes publics retirés de `cartularyIds.ts` (−3 lignes, ADR-029) ; `readOnlyPreview: isDemoCartulary \|\| isWatchWebsite` (`App.tsx:667`, 0 ligne nette : le mini-site public n'ouvre plus l'écoute `cartularies/{id}/reminders`) ; `tests/hygiene-v7.test.mjs` (verrous (a) manifeste automobile inchangé, (b) mini-site sans écoute des rappels ; (c) `hosting.ignore` vit dans `performance-v7`, (d) constat sans test) ; `interface-state` +11 lignes ; contrat ADR-029 (+1 test) ; documents (a)-(d) : plan § V7.2, ADR-029, `NOTE_PASSATION:357`, `README:58` ; skill `cartularia-dev` § 5 et mémoire hors dépôt (D15) |
| `f5ea262` | C1 bundle (D6, D7, D8, D11) | `vite.config.ts` : deux groupes `codeSplitting` `react` (priorité 2) + `icons` (priorité 1), greffon `cartularia-copies-numerotees` (`closeBundle`, récursif, avertit sans échouer), `assetsInlineLimit` refusant `.woff2` (aussi dans `vite.personal.config.ts`) ; `hosting.ignore "**/* [0-9].*"` dans `firebase.json` et `firebase.personal.json` (mesuré avec `listFiles` de firebase-tools) ; `measure:pf0` étendu (`initial`, `app` 340 000 / gzip 92 000 avec cause datée, `javascriptFiles ≤ 65`, `reactChunk`, `iconsChunk`, `iconDefinitionFiles === 1`, `numberedCopies === 0`) ; `scripts/measure-surfaces.mjs` (quatre surfaces × deux fenêtres + parcours à chaud, `--check`, `--fonts`) ; `tests/performance-v7.test.mjs` ; `test:v7` / `verify:v7` |
| `7ce17e9` | C2 préchargement (D10) | `src/features/public/registryPreload.ts` (`import()` de `RegistryApp.tsx` et `RegistryItems.tsx` dans `Promise.allSettled`, `setTimeout` 1 500 ms puis `requestIdleCallback({ timeout: 1000 })`, annulation au démontage) ; `AccountAccessPage.tsx` : `useEffect` gardé par `!creation && requestedSpace !== 'vault' && (demoRequested \|\| returnTo.startsWith('/registry'))` ; `tests/ui/registry-preload.test.tsx` ; seuil du parcours à chaud (étape Registre : 0 JS réseau, ≤ 3 requêtes) |
| ce commit | C5 fusion (K8, K9, K13, D12, D13, D14) | `test:v7` définitif (+ `hygiene-v7`) ; seuils de `measure:surfaces` fixés depuis le relevé fusionné ; relevé sans port éphémère ; test « V7 (fusion) » du contrat ; `docs/audits/perf/2026-09-16.{json,md}` ; six exceptions axe reportées à V8, datées ; section H des deux audits ; ce paragraphe |

### 4.1 Mesures avant / après (V-B2)

Avant = HEAD `a4ce595` (`dist/` = production V6, empreinte `index-DAVpr6jE.js`), lecture bundle du 16 septembre (`scratchpad/v7/bundle-sizes.txt`, `net-*.json` : serveur local brotli, cache froid, 1 440 × 900). Après = build fusionné C1-C3 (`docs/audits/perf/2026-09-16.md`, `scratchpad/v7/c5/pf0-pre.json`). Les octets « avant » des surfaces sont des octets sur le fil en brotli, les octets « après » sont bruts avec gzip recalculé depuis `dist/` : seuls les comptes se comparent directement.

| Mesure | Avant (`a4ce595`) | Après (C1-C3) | Note |
|---|---|---|---|
| Morceaux JS dans `dist/assets` | 94 (dont 36 icônes lucide livrées seules + 1 `createLucideIcon-*`) | 60, 0 icône seule | mesuré ; `javascriptFiles ≤ 65` dans `measure:pf0` |
| JS total (brut / gzip) | 1 822,7 ko / 550,1 ko | 1 814,6 ko (1 858 111 o) / 541,5 ko | mesuré ; le regroupement n'ajoute pas d'octets |
| Entrée `index-*.js` | 210 244 o | 19 518 o (`index-254gF_q7.js`) | React sort de l'entrée : `react-DHQQvKuQ.js` 189 589 o / 58 945 gzip, empreinte stable entre builds (mesuré sur quatre builds du 16 septembre) — un déploiement applicatif ne l'invalide plus |
| `initial` (entrée + `modulepreload` runtime + react) | — | 209 823 o / 66 521 gzip (budget 250 000) | nouveau contrôle (K7) |
| `icons-*.js` | — | `icons-CaennByB.js` 27 076 o / 8 806 gzip, n'importe que le runtime et `react-*`, importé par 22 morceaux | mesuré ; une seule définition d'icône dans tout `dist/` (`iconDefinitionFiles`) |
| `App-*.js` | 330 028 o (budget 320 000 dépassé depuis V3, hors barrière) | 327 837 o / 88 621 gzip (budget 340 000 / 92 000, dans `verify:v7`) | D6 |
| `RegistryApp-*.js` | 44 716 o | 37 201 o / 10 727 gzip | effet de C3 (codes publics) et du groupe icons |
| Plus gros morceau | `index.esm-DRo0ZM8h.js` 460 963 o | identique | Firestore + App Check, hors périmètre (résidu V-A2) |
| Fichiers dans `dist/` | 554 (dont 124 copies « N » + 4 résidus racine) | 392, 0 copie numérotée (124 retirées par le greffon à chaque build tant que J3 n'est pas faite) | mesuré ; liste de déploiement `listFiles` : 554 → 426 sur le `dist` V6, 392 = 392 sur le build fusionné |
| Accueil `/` (froid) | 21 JS, 33 requêtes (29 même origine + CSS Google + 3 `.woff2`) | 8 JS (296,8 ko brut / 93,5 ko gzip), 20 requêtes dont 4 Google Fonts | identique à 390 |
| Connexion `/account/sign-in` (froid) | 18 JS, 29 requêtes | 12 JS initiaux (22 avec les 10 préchargés après le premier rendu), 34 requêtes | le préchargement du Registre s'ajoute après le rendu (C2) |
| Démo `#cover` (froid) | 43 JS, 56 requêtes | 29 JS (1 386,4 ko brut / 404,0 ko gzip), 42 requêtes | — |
| Registre `/registry` déconnecté (froid) | 29 JS, 40 requêtes | 17 JS (963,7 ko / 291,0 ko gzip), 28 requêtes | — |
| Parcours à chaud accueil → connexion → `/registry/reg_cartularia_demo/items` | non mesuré avant V7 (C1, sans préchargement : étape Registre 5 JS réseau, 9 requêtes réseau, 51,5 ko) | étape Registre : 27 requêtes dont 23 servies par le cache, 3 réseau (11,6 ko : `index.html`, logo, manifeste — tous `no-cache`), **0 JS réseau** | mesuré, seuil de `verify:v7` |
| Rendu prêt (local) | 384-766 ms | 505-513 ms | bruit local, jamais contrôlé |

Effet du nombre de fichiers sur la durée (lecture bundle § 3.3, HTTP/2 local, latence émulée 150 ms) : démo 43 → 28 scripts, dernier JS à 541 → 526 ms ; Registre 29 → 16, 528 → 534 ms. Le nombre de morceaux ne pèse que ± 10 ms en HTTP/2 : les 6-8 s du constat B2 ne viennent pas du découpage.

### 4.2 Requalification du constat V-B2

- **Nombre de fichiers : clos** (icônes regroupées, 94 → 60 morceaux, étape Registre à 0 JS réseau depuis la page de connexion).
- **Durée d'ouverture (6-8 s) : imputée** au second document (`/account/sign-in` → `/registry/…/items` par `window.location.assign`, aucun routeur), à la ré-initialisation de Firebase et d'App Check (reCAPTCHA Enterprise, `enterprise.js`) et aux 27 canaux Firestore Listen (mesure V3 § 13.2) — pas au découpage. Cette part n'est mesurable qu'en production dans un Chrome réel (score reCAPTCHA) : R0 (avant déploiement) puis R2 (après), même protocole (§ 4.4 de la cohérence : chrono clic → catalogue, `/assets/*.js` réseau, canaux Listen, `enterprise.js`, cache vidé puis chaud, × 3).
- **Suite : V-B4 reporté (V8)**, décision reprise après R0/R2 avec le ticket d'entrée ci-dessous.

### 4.3 Partition des surfaces (ticket d'entrée de V-B4, D4)

Parcours statique des imports depuis chaque surface de `RootPage.tsx` (`scratchpad/v7/reach-static.mjs`, rejoué le 16 septembre sur le build fusionné ; `import()` ignorés). Modules « liés au document » : `cartularyIds.ts` (`ACTIVE_CARTULARY_ID` figé à l'import), `localVault.ts` (singletons), `activeCartulary.ts`, `useHybridPersistence.ts`, `codeHandoffCapture.ts`. `firebase.ts` est atteint par toutes les surfaces connectées : c'est un singleton partageable entre documents, pas un obstacle.

| Groupe | Surfaces (modules statiques atteints) | Verdict |
|---|---|---|
| Navigables en place sans refonte | `home` (7), `service-information` (2), `account-sign-in` / `account-create` (9, via `firebase.ts`), `account-recovery` (8), `registry` (24) et `registry/items` (14), `invitation` (8), `community` (18), `collection-website` (13), `administration` (11), `not-found` | aucun module lié au document |
| Liées au document | `cartulary`, `cartulary-demo`, `cartulary-view`, `watch-website` (`App.tsx`, 108 modules : `cartularyIds.ts` ← `localVault.ts` ← `useCartularyFollowUp.ts`, `activeCartulary.ts`, `useHybridPersistence.ts`) ; `personal-vault` (22) et `code-handoff-return` (4) (`codeHandoffCapture.ts`) | rechargement complet obligatoire tant que `ACTIVE_CARTULARY_ID` et les singletons de `localVault.ts` ne sont pas résolus à l'exécution |
| Cas mixte à instruire | `registry/new` (`NewCartularyPage.tsx`, 22 modules) atteint `cartularyIds.ts` par `localVault.ts` ← `cartularyCreation.ts` | l'option minimale « famille publique + Registre » doit soit exclure la page de création du routage en place, soit sortir `cartularyCreation.ts` de `localVault.ts` |

Options pour V8 (proposition polices-routeur structurelle § lot C) : S-M, racine réactive pour la famille publique + Registre (`navigateApplication` unique, `key={route}`), accueil → démo → Registre reste à trois documents (le Cartulaire est lié au document) ; L, routeur unique conditionné à la sortie des singletons de `cartularyIds.ts` / `localVault.ts`, à instruire avec ADR-029 (même fichier). Aucune des deux n'est mesurable en local (App Check).

### 4.4 Décisions appliquées, barrières, dettes

- Appliquées : D3 (A, J0 consigné § 1), D5, D6, D7, D8, D10, D11, D12, D13, D14 (écrit § H), D15 (hors dépôt, C3). D9 : non (constat par `find` : 375 copies « N » dans les sources le 16 septembre après C5, dont 124 sous `public/assets/IWC/derivatives/` ; `dist/` en compte 0). D2 : commande d'archivage remise à Jérôme (J3, avant le build de déploiement). D1 / C4 : en attente du dépôt des polices (J1) ; D16 : si J1 tarde, déployer C1-C3 + C5 sans C4 est une décision explicite (seconde invalidation du cache, ≈ 281 ko brotli par visiteur de retour), pas un défaut. D4 : reporté (§ 4.3).
- `test:v7` = `test:v6` + `test:performance-hygiene` + `node --test tests/performance-v7.test.mjs tests/hygiene-v7.test.mjs` (K8 ; `interface-state` et le contrat sont déjà dans `test:v3` ; les 11 tests orphelins hors émulateur de la lecture barrières restent dehors, dette D24 de cette lecture) ; `verify:v7` = `test:v7` puis `audit:a11y` (construit `dist/`) puis `measure:pf0` puis `measure:surfaces --check --fonts` (`--fonts` retiré par C4). Seuils K9, marge +2 requêtes / +1 morceau sur le relevé fusionné : accueil ≤ 22 requêtes / ≤ 9 JS, connexion ≤ 13 JS initiaux, démo ≤ 30 JS, Registre ≤ 18 JS, 0 icône seule, étape Registre à chaud 0 JS / ≤ 3 requêtes. Contrat : test « V7 (fusion) » (scripts figés, 13 dépendances, groupes et greffon, `hosting.ignore` ×2, `numberedCopies` dans `measure:pf0`, relevé daté sans port, six exceptions axe « V8 » datées) ; `test:v6`, `audit:a11y`, `verify:v6` intacts à l'octet.
- Relevé `docs/audits/perf/2026-09-16.{json,md}` (mesuré par `verify:v7` sur le build fusionné) : `measure:pf0` tout vert ; `measure:surfaces --check` 0 dépassement ; ports éphémères retirés du relevé (les liens `modulepreload` injectés par Vite portaient l'origine locale) — seuls les temps (`readyAfterMs`, DCL, load, LCP) varient d'une exécution à l'autre.
- Barrière C5 : `tsc -b`, `lint`, `validate:ai`, `test:ui` 538 vitest (92 fichiers), node `test:v3` 182 · `test:v4` 46 · démo-publication 15 · `test:v5` 86 · `test:v6` 18 · hygiène 10 · `performance-v7` + `hygiene-v7` 12 · contrat 34 tests ; `audit:a11y` : 0 violation bloquante, 0 assertion en échec, 419 nœuds à vérifier (identique à V6), exceptions tolérées inchangées (12 `aria-required-children` sur `demo-value`, `region`, `heading-order`, `aria-allowed-role`) ; relevé `docs/audits/a11y/2026-09-16.{json,md}` régénéré par `verify:v7`, seul le motif des exceptions change (date du report D13) ; `git diff --check` propre ; `App.tsx` 3 471 lignes ; `dependencies` 13.
- Dettes consignées : contrôle mécanique de `until` ≥ vague courante dans la liste d'exceptions axe (D13 : le contrat vérifie seulement qu'aucune échéance ne reste « V7 ») ; `dist-personal/` reçoit encore les copies de `public/` (pas de greffon, D11 ; couvert au déploiement par `firebase.personal.json`, M10) ; 11 tests orphelins hors barrière (D24 barrières) ; cause des copies « 2 » supposée (iCloud), à tarir hors dépôt (`.nosync` ou déplacement) ; résidu V-A2 (App Check sur toute surface) et les six exceptions axe : V8.

### 4.5 Étapes de Jérôme avant la recette (ordre)

1. **J1** — polices (D1) : dépôt des trois `.woff2` + `OFL.txt` ou autorisation explicite de téléchargement ; puis C4 par l'assistant (`presentation-derivatives:205-211` réécrit, `--fonts` retiré, « 0 requête tierce » activé, contrôle visuel J2 par paires de captures).
2. **J3** — archivage des copies « 2 » (D2, simulation `-n` d'abord), avant le build de déploiement : le journal du build ne doit plus afficher « 124 copie(s) numérotée(s) retirée(s) ».
3. **R0** — mesure « avant » de V-B2 en production, Chrome réel, session démo (§ 4.2), consignée ici.
4. **J4** — feu vert : `rm -rf dist && npm run verify:v7 && firebase deploy --only hosting` (déploiement groupé, D16 ; sans C4 = décision explicite).
5. **R1** (assistant, anonyme) puis **R2** (Jérôme, propriétaire et téléphone, objet de test neuf puis `npm run purge:test-cartulary`) → **R3 / C6** : colonnes de recette du § H des deux audits, § 5 de ce journal, `statut-49-constats.md` clos.
