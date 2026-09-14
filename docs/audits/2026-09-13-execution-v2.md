# Cartularia — Journal d’exécution de la vague V2

Date : 13-14 septembre 2026. Plan de référence : [plan d’action par vagues](2026-09-08-plan-actions-par-vagues.md), vague V2 « Parcours visiteur complet sans écran vide ni message technique ». Branche `feat/lecteur-unique-adr-028-031`, point de départ `6feceb5`. Critique de cohérence préalable (scratchpad `v2/coherence.md`) : cinq plans, un intégrateur unique pour `App.tsx`, décisions tranchées avant tout code. Journal frère du seed : [enrichissement démo v2](2026-09-13-demo-enrichment-v2.md).

Aucune action distante n’a été exécutée par les agents : ni seed, ni publication, ni déploiement, ni règles. Tout ce qui touche la production figure au § 3 et relève de Jérôme.

## 1. Décisions

| | Décision | Conséquence dans le code |
|---|---|---|
| (a) | Le seed démo v2 (`--data-only`) reste rejouable après la publication réelle d’un objet démo : `publicationStatus ∈ {'none','published'}`, événements `publication.published` / `publication.revoked` d’acteur `demo_seed` tolérés, chaîne d’audit toujours vérifiée. Ordre P1 (seed v2) → P2 (publication). | `scripts/lib/demo-data-repair.mjs` (seed-demo) ; `scripts/lib/demo-publication-command.mjs` écrit exactement la forme d’événement attendue (publication-demo). |
| (b) | La page Publication en lecture est un rendu « lecture » des quatre structures communes (mini-site, Collection, Cercle, rapport PDF) pour tout lecteur qui ne peut pas éditer/publier (`canManage` faux), démonstration comprise. Pas de branche démo sur la structure ; seulement sur les textes contextuels. Titres et numéros 01-04 conservés. | `App.tsx` : `const canManagePublication = authoritative.canManage;` puis `{canManagePublication ? (<div className="publication-center">…branche éditeur inchangée…</div>) : (<PublicationReadOnlySummary … demonstration={isDemoCartulary} />)}`. Verrouillé par `tests/cartulary-presentation-contract.test.mjs`. |
| (c) | Le bouton « Rapport PDF » (`handleReportPrint`) reste disponible en lecture ; en démonstration il ne journalise rien localement. | `App.tsx` : `if (isDemoCartulary) return; // démonstration : aucune journalisation locale` avant `journal.logEvent('EXPORT_PDF', …)` ; gardes identiques sur `reconcileSnapshot`, `handleDeleteAllData` et — extension de l’intégrateur — sur l’événement `ACCESS_CARTULARY` à l’ouverture (sinon la consultation démo écrivait dans le navigateur du visiteur). |
| (d) | Code public, QR et tout lien « mini-site » d’un Cartulaire (Preuves, Publication, Registre) ne s’affichent que si la publication réelle est constatée à l’exécution via `loadPublicPublicationStatuses` ; jamais de faux « publié ». | `App.tsx` : état `websitePublished` (effet `loadPublicPublicationSummaries([cartularyPublicCode])` — extension de `loadPublicPublicationStatuses` qui lit aussi `blockIds`, tour 2 § 2.8 —, permission-denied ⇒ faux, hors `/watch-website`) ; `publishedWebsiteUrl = websitePublished ? publicShareUrl : null` transmis à `PublicationReadOnlySummary` et `AuditPanel`. `DEMO_SUBMARINER_PUBLIC_CODE` (exporté pour les tests) n’est pas une source de « publié » — le test `demo-account` vérifie qu’`App.tsx` ne l’importe pas. |
| (e) | Un seul objet démo publié : Submariner, `DEMO-ROL-124060`. Les quatre autres restent non publiés, liens masqués par (d). | `tests/demo-account.test.mjs` (« un seul objet démo est publié en V2 »). |
| (f) | Obligatoires : `loadPublicProjection` traite permission-denied comme absence (retour `null`) ; `/cartulary-demo` sans identifiant charge la Submariner ; aucun message technique anglais ni « Connexion requise » dans le parcours visiteur. | `src/services/projections.ts`, `src/domain/cartularyIds.ts`, `src/components/AuditPanel.tsx` (messages-techniques). |
| (g) | Règles Firestore/Storage non déployées en V2 : aucune dépendance introduite. | Lectures `publications/{code}` déjà autorisées pour les documents publiés ; tout refus est traité comme une absence. |

## 2. Réalisé par point

### 2.1 seed-demo (V2.3) — livré et vérifié par son agent
`src/domain/cartulary.ts` (type `CartularyCompletenessLevel`), `src/data/demoCartularyDocuments.ts` (`DEMO_REVIEWED_AT`, dossiers « complete », 6 rappels, 3 accès), `scripts/lib/demo-data-repair.mjs` (migration `demo-data-enrichment-v2`, grammaire d’audit décision (a), `--expect-no-writes`), `scripts/seed-demo-account.mjs`, tests (`demo-data-repair`, `demo-account`, `registry-aggregates`, émulateur), `package.json`, journal 2026-09-13-demo-enrichment-v2.md. Effet Registre démo attendu : « À revoir 0 », « Échéances en retard 1 » (Tudor), Catalogue 5 × « Complet », Suivi 6 rappels, Accès 3 accès, Preuves 3 événements par Cartulaire (4 pour la Submariner après P2).

### 2.2 publication-demo (V2.4) — livré et vérifié par son agent
`scripts/lib/demo-publication-command.mjs`, `scripts/publish-demo-website.mjs`, `tests/demo-publication-command.test.mjs` (15 tests en mémoire). Simulation par défaut, application sur `--apply --confirm-demo-publication`, `--revoke`, idempotence, rollback des copies, dérivés WebP sans EXIF, eyebrow « Démonstration · données fictives », événement `publication.published` d’acteur `{ uid démo, role 'demo_seed' }`, jamais d’écriture `users/*` ni `memberships/*`.

### 2.3 retours-demo (V-A4 / V-A5) — livré, branché par l’intégrateur
Module pur `src/features/registry/registryReturn.ts` ; `BarreDossier`, `CommunityPage`, `CollectionWebsitePage`, `GenericCartularyPage` ; tests vitest. Branchement `App.tsx` : `resolveRegistryReturn(routeParameters.get('returnTo'), { demo: isDemoCartulary })`, `returnHref={registryReturnHref}` sur `BarreDossier`, libellé `registryReturn.label[language]` (« Retour au Registre démo » en démo sans `returnTo`). `RegistryApp.tsx` : `RegistrySignIn({ demoRequested })` avec bloc « Registre de démonstration » (« Ouvrir le Registre démo » → `/account/sign-in?demo=1`, « Retour à l’accueil ») quand la route vise `reg_cartularia_demo`. `HomePage.tsx` : `DEMO_REGISTRY_HREF = DEMO_REGISTRY_ENTRY_HREF` (une seule source de vérité ; l.487 inchangée vers `/cartulary-demo…#publication`).

### 2.4 publication-lecture-seule (Lot A rendu lecture, Lot B Comparaison) — livré, branché par l’intégrateur
`PublicationReadOnlySummary.tsx` (composant pur : quatre articles 01-04, une seule table contenus × destinations, « Publié · Ouvrir le mini-site » seulement si `publishedWebsiteUrl`, sinon « Ce qui serait publié », bouton Rapport PDF), entrée « Comparaison » dans la barre latérale du Registre avec pastille de sélection (R8 conservé). Branchement `App.tsx` § 1 (b) ; bloc CSS `.publication-summary*` et règles mobiles fusionnés dans `src/index.css`.

### 2.5 messages-techniques — livré, branché par l’intégrateur
`AuditPanel.tsx` (props additives `readOnly`, `demoRegistryProofsHref`, `publishedWebsiteUrl`, rendu `ReadOnlyProofs` sans bouton ni observation de session), `cartularyIds.ts` (repli `/cartulary-demo` → Submariner), `projections.ts` (permission-denied → `null`). Branchement `App.tsx` : `readOnly={isDemoCartulary}`, `demoRegistryProofsHref={isDemoCartulary ? registryHref(DEMO_ACCOUNT.registryId, 'integrity') : null}`, `publishedWebsiteUrl={publishedWebsiteUrl}` ; bloc CSS `.audit-panel--read-only …` fusionné dans `src/index.css`.

### 2.6 Intégration (fichiers de l’intégrateur)
- `src/App.tsx` : quinze remplacements en lignes croissantes (imports ; retour ; `canManagePublication` ; état `websitePublished` ; gardes démo `ACCESS_CARTULARY`, `reconcileSnapshot`, `EXPORT_PDF`, `handleDeleteAllData` ; effet de publication réelle ; `returnHref` ; libellé ; bascule de la page Publication ; props `AuditPanel`). La branche éditeur est enveloppée, pas modifiée : `href={localPublicationPreviewUrl}`, `<PublicWebsitePublicationPanel … blocks={websiteDraftRequest(websiteDraft)}`, « Valider au niveau Collection », « Valider la publication dans Le Cercle », les quatre `renderPublicationBlockSelector(` restent tels quels.
- `src/features/registry/RegistryApp.tsx` : patch RegistrySignIn (import, signature, bloc démo, appel `demoRequested={shouldOfferDemoRegistryEntry(route.registryId)}`).
- `src/features/public/HomePage.tsx` : import `DEMO_REGISTRY_ENTRY_HREF`.
- `src/data/demoCartularies.ts` : `export const DEMO_SUBMARINER_PUBLIC_CODE`.
- `src/index.css` : deux blocs livrés + deux règles `@media (max-width: 767px)`.
- `tests/cartulary-presentation-contract.test.mjs` : six assertions dans le test de la page Publication (l’assertion livrée « 5 appels » corrigée à 4 : la définition s’écrit `= (` et n’est pas comptée) ; deux nouveaux tests (« décision (b) … sans branche démo sur les structures communes », « le panneau Preuves reçoit le mode lecture … »), dont le verrou : aucune structure de `<PublicationPage>` conditionnée par `isDemoCartulary`, quatre `publication-scope--*` dans la branche éditeur, `demonstration={isDemoCartulary}` seulement, `PublicationReadOnlySummary` sans Firebase ni `isDemoCartulary`, six `journal.logEvent(` au total dont deux gardés en démo.
- `tests/demo-account.test.mjs` : trois tests ajoutés (garde-fous statiques de la commande de publication ; objet unique publié ; branchement V-A4/V-A5).

### 2.8 Tour 2 — correcteur (points des relecteurs, 14 septembre)
Trois points levés, chacun prouvé par un test ; aucun réseau, aucune règle, aucun émulateur.

1. **Libellés techniques anglais sur la page Preuves du Registre démo.** `REGISTRY_AUDIT_ACTION_LABELS` (`src/features/registry/registryIntegrity.ts`) ignorait les trois actions de la chaîne démo ; le repli rendait « Cartulary · Demo · Created », « … Data_repaired », « … Enriched » en `<strong>` pour chaque événement, contre la décision (f). Ajout de `cartulary.demo.created` → « Cartulaire de démonstration créé », `cartulary.demo.data_repaired` → « Données de démonstration réparées », `cartulary.demo.enriched` → « Données de démonstration enrichies ». Preuve : `tests/registry-integrity.test.mjs` extrait par expression régulière toutes les `action: '…'` écrites par `seed-demo-account.mjs`, `demo-data-repair.mjs` et `demo-publication-command.mjs` et exige pour chacune un libellé FR sans repli technique (le test casse si un script ajoute une action non libellée). L’acteur `demo_seed` / `demo_data_repair` / `demo_data_enrichment` reste rendu « Acteur autorisé » (français, inchangé).
2. **Faux compte « 14 contenus en ligne » sur la page Publication de la Submariner.** Le résumé lecture affichait le compte de la sélection démo (`PUBLISHED_BLOCK_IDS` filtrés, 14) alors que le mini-site réellement publié compte 8 blocs (`DEFAULT_DEMO_WEBSITE_BLOCKS`). Correctif : `loadPublicPublicationSummaries` (`src/services/projections.ts`) lit `publications/{code}` une seule fois et renvoie `{ published, blockIds }` (`loadPublicPublicationStatuses` en dérive, signature et appelants Registre/Collection inchangés ; permission-denied ⇒ non publié). `App.tsx` garde l’état `websitePublished` et ajoute `publishedWebsiteBlockIds` (`string[] | null`) transmis à `PublicationReadOnlySummary`. Dans le composant, quand la publication est constatée et la liste connue, la destination Mini-site (compte d’en-tête, « Publié : 8 contenus en ligne. », colonne Mini-site de la table) reflète les blocs en ligne ; Collection, Cercle et Rapport gardent « ce qui serait publié » (une vérité par destination, note « La colonne Mini-site de la table reflète les contenus effectivement en ligne. »). Publication constatée sans liste (document sans `blockIds`) : « Publié : ouvrez le mini-site pour consulter les contenus en ligne. », aucun chiffre. Aucune branche démo ajoutée (décision (b)) ; aucune règle requise (lecture déjà autorisée pour un document publié, décision (g)). Preuves : `tests/ui/publication-read-only-summary.test.tsx` (6 tests : « 8 contenus en ligne », plus aucun « 14 » dans l’article Mini-site, `Bibliothèque média` incluse / `Diaporama` exclu dans la colonne Mini-site, cas sans liste) ; `tests/cartulary-presentation-contract.test.mjs` (appel `loadPublicPublicationSummaries([cartularyPublicCode])`, `setPublishedWebsiteBlockIds(summary?.published === true ? summary.blockIds : null)`, prop transmise).
3. **Mutant S26 survivant et trou de sûreté du seed complet.** `demoRepairOptions` acceptait `['--allow-remote']` hors émulateurs avec `dataOnly:false` : un oubli de `--data-only` en P1 aurait rejoué contre la production `auth.updateUser` puis `batch.set` des cinq racines à revision 1 (chaîne v1/v2 et publication écrasées). Correctif : `requireValue(dataOnly || firestoreEmulator, 'le seed complet est réservé aux émulateurs ; utilisez --data-only.')` dans `scripts/lib/demo-data-repair.mjs`, avant le calcul de `projectId` ; le seed complet sur émulateurs (`test:demo-account:full`) reste accepté. Preuves : `tests/demo-data-repair.test.mjs` (cas refusés `['--allow-remote']`, `[]`, `['--allow-remote']` avec Firestore seul émulé ; cas accepté émulateurs complets) ; `tests/demo-account.test.mjs` (assertion statique `if (!usesEmulator && !allowRemote) {` et `demoRepairOptions(process.argv…)` lu avant `initializeApp(`). Sonde : la mutation `if (false) {` sur `seed-demo-account.mjs:31` fait désormais échouer `tests/demo-account.test.mjs` (1 échec), script restauré à l’identique ; la garde du script est redondante avec celle, testée, de `demoRepairOptions`.

### 2.7 Changements de comportement à connaître (hors démo)
- Un lecteur non connecté sur `/cartulary` (pilote IWC, coffre local, statut `signed-out`) reçoit désormais le rendu lecture de la page Publication au lieu de l’éditeur local : conforme à la décision (b) « tout lecteur qui ne peut pas éditer/publier ». Les cinq autres pages ne changent pas.
- Un propriétaire connecté peut voir brièvement le rendu lecture avant l’éditeur : `canManage` est faux pendant le chargement du hook autoritaire puis jusqu’au retour de `canEditGenericCartulary`. Onglet Publication non affiché par défaut : fenêtre négligeable ; à revoir si l’audit V7 le relève (le hook n’expose pas encore « droits résolus »).
- `/cartulary-demo?cartularyId=<identifiant privé valide>` retombe sur la Submariner (aucun chemin vers un Cartulaire privé depuis la route démo).
- L’effet de publication réelle interroge `publications/{code}` pour tout Cartulaire hors `/watch-website` (un `getDoc`, refus ou hors-ligne ⇒ « non publié », sans message) ; le même `getDoc` fournit `blockIds`, donc pour un propriétaire non éditeur le résumé lecture affiche aussi le compte réellement en ligne.

## 3. Séquence de production à lancer par Jérôme (jamais par les agents ; depuis `04_Application/Prototype Antigravity`)

Empreintes des deux modules d’écriture : `scripts/lib/demo-data-repair.mjs` SHA-256 `9266ed3726189902decedd5e0167958ef08b7a6bc6f4acf4eeeb0eb4f244d13a` (remplace le gel `276aadb3…` du 6 septembre) ; `scripts/lib/demo-publication-command.mjs` MD5 `d28414f9dd067be6f8699ebfec6a19db`. Ordre **P1 → P2 impératif** : la simulation de publication attend la révision courante 3 après v2 (si elle affiche 2 et `requestId …_3`, P1 n’a pas été appliqué : s’arrêter).

**P0 (assistant, lecture seule, sur autorisation)** : constater l’état d’entrée en production (bundle `9d60495`, Registre démo sans « Voir le mini-site », `/watch-website?publicCode=DEMO-ROL-124060` → indisponible, Suivi/Accès démo vides sans erreur) et le consigner ici.

**P1 — seed démo v2 (`--data-only`)**
```
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/seed-demo-account.mjs --data-only --allow-remote
```
Attendu : dry-run, `applied:false`, exactement 24 opérations (5 update `cartularies/{id}` ; 5 update `registries/reg_cartularia_demo/items/{id}` ; 5 create `auditEvents` `evt_demo_data_enrichment_v2_<20 hex>` séquence 3 ; 6 create `reminders` ; 3 create `accesses`), 0 opération assets/Collection. Puis, hors dépôt, `mkdir -p "…/Projet Cartularia/cartularia-demo-repair-20260913"` et
```
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/seed-demo-account.mjs --data-only --allow-remote --apply --backup-dir="/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/cartularia-demo-repair-20260913"
```
Attendu : `applied:true`, 24 écritures, sous-répertoire `demo-data-enrichment-v2-*` + `backup.json`. Re-simulation → `writes: []`. Ne jamais lancer le seed complet sans `--data-only` contre la production.

**P2 — publication démo de la Submariner**
P2.a simulation (aucune écriture) :
```
GCLOUD_PROJECT=studio-2614005370-a3e51 FIREBASE_STORAGE_BUCKET=studio-2614005370-a3e51.firebasestorage.app \
node scripts/run-with-firebase-cli-adc.mjs -- node scripts/publish-demo-website.mjs --cartulary cart_demo_rolex_submariner_124060 --allow-remote
```
Attendu (JSON unique) : `DEMO_PUBLICATION_PLAN`, `dryRun true`, `ok true`, `blockers []`, root `{ revision 3, integritySequence 3, publicationStatus 'none' }`, audit `{ valid true, eventCount 3 }`, `publication.exists false`, `seal.exists false`, `storage.existingFileCount 0`, `requestId demo_publish_cart_demo_rolex_submariner_124060_4`, `approvalId approval_b6758101e98e43063c1cf33e`, `eventId evt_97c1b092315e6d6abac15202`, `blockCount 8`, `derivativeCount 3` (≈ 236 ko), 23 chemins d’écriture. `blockers` non vide ⇒ ne pas continuer.
P2.b application :
```
GCLOUD_PROJECT=studio-2614005370-a3e51 FIREBASE_STORAGE_BUCKET=studio-2614005370-a3e51.firebasestorage.app \
node scripts/run-with-firebase-cli-adc.mjs -- node scripts/publish-demo-website.mjs --cartulary cart_demo_rolex_submariner_124060 --allow-remote --apply --confirm-demo-publication
```
Attendu : `DEMO_PUBLICATION_APPLIED`, `applied.status 'published'`, `applied.revision 4`, 3 fichiers `public/DEMO-ROL-124060/…`, sceau `S-05BB8C0F`. Relance ⇒ `already_published` sans écriture. Le seed v2 `--data-only --expect-no-writes` reste rejouable ensuite (décision (a)).
P2.c vérification anonyme (navigateur privé) : `https://studio-2614005370-a3e51.web.app/watch-website?publicCode=DEMO-ROL-124060` → « Mini-site publié · DEMO-ROL-124060 », 4 pages, 3 images, eyebrow « Démonstration · données fictives », footer `DEMO-ROL-124060 · S-05BB8C0F` ; `…?publicCode=DEMO-AP-15510ST` → publication absente, sans message technique.
P2.d retrait si non conforme : mêmes commandes avec `--revoke` (simulation) puis `--revoke --apply --confirm-demo-publication` (audit append-only, revision 5, republication possible).

**P4 — déploiement Hosting unique de la vague (assistant, sur autorisation explicite, après barrière verte et P2.c)**
```
npm run build && ./node_modules/.bin/firebase deploy --only hosting --project studio-2614005370-a3e51 --non-interactive
```
Aucune fonction, règle ni index (décision (g)). Grâce à la lecture à l’exécution (décision (d)), le client est déployable même si P2 est différé : sans publication, aucun lien n’est annoncé.

**P5 — recette visiteur** : accueil → Submariner → Publication (quatre articles 01-04 en lecture, une table, compteurs 14/14/20/23, aucune case à cocher, mini-site « Publié » + « Ouvrir le mini-site » pour la Submariner seulement, bouton « Préparer le rapport PDF ») ; Preuves (FR puis EN : aucun « Connexion requise », aucun bouton, « Chaîne fictive de démonstration », lien « Voir les preuves du Registre démo », code public + QR seulement après P2) ; « Retour au Registre démo » → écran de connexion avec « Ouvrir le Registre démo » → Registre démo (Catalogue « Complet », « Aucun signal de revue », 1 échéance en retard, Suivi 6, Accès 3, Comparaison dans la barre latérale, Preuves 3-4 événements) ; `/community` et `/collection-website` anonymes → liens démo/accueil ; `/cartulary-demo` sans paramètre → Submariner. Commit par Jérôme ou sur son autorisation.

**P6 (option)** : publication des quatre autres objets démo, simulation d’abord ; les gardes client masquent leurs liens tant qu’ils ne sont pas publiés.

### Limites connues à déclarer en recette (pas des régressions)
- Onglet Suivi du Cartulaire démo vide (`readOnlyPreview`) ; seule la page Suivi du Registre démontre les rappels.
- Mini-site Submariner sans bloc « L’objet en mouvement » (ffmpeg absent, fixture webm hors liste blanche) ; le héros n’a pas de paragraphe (`heroSummary` et un paragraphe de description contiennent « propriétaire », marqueur privé de `public-text-policy.mjs`) — reformulation possible dans `demoCartularies.ts` avant P2, sinon écart accepté.
- Rappel Submariner planifié au 2026-12-15 : passera « en retard » après cette date.
- Compte démo sans admission au Cercle (« Admission au Cercle requise » + « Retour au Registre »).
- Propriétaire connecté ouvrant un Cartulaire démo depuis l’accueil : « Retour au Registre démo » → « Contexte non autorisé » + « Choisir un autre Registre » (impasse honnête ; étape optionnelle non retenue).
- Hors V2 : onglets 04/05/Preuves hors écran sur mobile (V-D3), Valorisation déborde (V-D4), bannière démo en français seul (V-D9).

## 4. Barrière

Exécutée par l’intégrateur après la passe unique, sans réseau ni émulateur :

| Contrôle | Résultat |
|---|---|
| `npm run lint` | exit 0, aucun avertissement |
| `npx tsc -p tsconfig.app.json --noEmit` | exit 0 |
| `npm run test:ui` (vitest) | 62 fichiers, 269 tests au vert |
| `node --test` — cartulary-presentation-contract, demo-account, interface-state, integrity-convergence, corrective-wave7, registry-catalog, session-security, performance-wave5, performance-pf5, navigation-accessibility, follow-up-coordination, publication-sites, report-rendering, rolex-import, registry-navigation, registry-comparison, registry-pilot, demo-data-repair, registry-aggregates, demo-publication-command | 135 tests au vert (toutes les suites qui lisent `App.tsx` incluses) |
| `npm run build` | exit 0 |

Rejouée par le correcteur après le tour 2 (§ 2.8), mêmes conditions :

| Contrôle | Résultat |
|---|---|
| `npm run lint` | exit 0 |
| `npx tsc -p tsconfig.app.json --noEmit` | exit 0 |
| `npm run test:ui` (vitest) | 62 fichiers, 270 tests au vert |
| `node --test` — mêmes suites + registry-integrity | 139 tests au vert |
| `npm run build` | exit 0 |
| Sonde mutant S26 (`if (false) {` dans `seed-demo-account.mjs`) | `tests/demo-account.test.mjs` : 1 échec (mutant tué), script restauré |

Restent à rejouer par l’orchestrateur (émulateurs interdits aux agents) : `npm run test:demo-account:full` (seed complet puis `--data-only --expect-no-writes`, lectures anonymes ; bloc de publication émulateur facultatif livré par publication-demo, non intégré). `package.json` (propriété seed-demo) : `test:demo-account` ne joue pas `tests/demo-publication-command.test.mjs` (joué ici en direct par `node --test`) ; `test:registry-navigation` livré par publication-lecture-seule non ajouté. Règle CSS facultative `.registry-auth-demo` (registry.css, propriété publication-lecture-seule) non ajoutée : la grille `.registry-auth-panel > div` existante suffit.
