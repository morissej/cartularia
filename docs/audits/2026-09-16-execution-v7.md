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
