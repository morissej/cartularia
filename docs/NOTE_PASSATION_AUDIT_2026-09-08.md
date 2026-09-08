# Note de passation — audit « même base pour tous les Cartulaires » (2026-09-07 / 2026-09-08)

Destinataire : toute IA ou personne qui reprend le dossier de travail sans avoir suivi la
session. La note décrit ce qui a été fait, fichier par fichier, et comment revenir en arrière,
en totalité ou par étape.

## 0. Situation de départ et état d’arrivée

- Dépôt : `04_Application/Prototype Antigravity` (clone git, remote `origin` =
  `https://github.com/morissej/cartularia.git`, branche `main`).
- **Commit de référence avant les travaux : `fe3aa90`** (« feat: console d'administration,
  secours du Registre, édition générique et cartulaires de démonstration », poussé le
  2026-09-07). Ce commit contenait déjà tout le dossier de travail antérieur ; `HEAD` = arbre de
  travail à cette date.
- **Rien de ce qui suit n’est commité.** Tout vit dans l’arbre de travail :
  25 fichiers modifiés, 21 fichiers nouveaux (liste exhaustive §5). `git diff --stat` :
  406 insertions, 706 suppressions.
- Aucun déploiement Firebase, aucune écriture en production, aucun `git add`, aucun push.

## 1. Question initiale et diagnostic

Question de Jérôme : lorsqu’on crée un Cartulaire, part-on toujours de la même base ? Tous les
Cartulaires de tous les comptes partagent-ils le même code ? Un changement de la base
s’applique-t-il aux Cartulaires existants ?

Diagnostic (2026-09-07) :

1. Création : un seul pipeline (client → `cartularyCreateRequests` → fonction
   `createCartularyFromPrivateDraft` → `buildCreationBundle`), mais sections codées en dur
   (`watch@1.6.0` puis « patchs » automobile) et version de schéma déclarée à trois endroits.
2. Lecture : **deux lecteurs**. `src/App.tsx` (≈4 000 lignes) pour les montres, IWC et Rolex
   (route `/cartulary`, données du brouillon privé), `GenericCartularyView` pour le reste (route
   `/cartulary-view`, données Firestore + schéma). Aiguillage par type d’objet dans
   `registryCatalog.ts`. 87 conditions `isIwcCartulary | isRolexCartulary | isDemoCartulary` dans
   `App.tsx`. IWC lu depuis un mock codé, Rolex depuis un profil de secours codé.
3. Propagation : l’interface se propage (code partagé), les données non (version de schéma
   épinglée par Cartulaire, aucune commande de remontée).

Cinq recommandations ont été retenues et **toutes réalisées** (§2 à §6 ci-dessous), dans l’ordre
choisi par Jérôme, avec la direction « `App.tsx` absorbe le générique » validée par lui.

## 2. Étape 1 — Lecteur unique (ADR-028)

Décision : `App.tsx` devient le seul lecteur, piloté par l’enveloppe Firestore et le schéma.

Nouveaux fichiers :

- `src/features/cartulary/state/useAuthoritativeCartulary.ts` : hook qui charge
  `cartularies/{id}` (enveloppe + sections), le schéma épinglé par l’enveloppe
  (`loadVerticalSchema`), les médias projetés, les droits (`canEditGenericCartulary`,
  `canPublishGenericCartulary`), le nom de collection ; expose `retry`, `refresh`,
  `reloadAssets`, `saveFields`, `saveMedia`, `uploadMedia`. Logique extraite de
  `GenericCartularyPage.tsx`.
- `src/features/cartulary/state/useGenericSectionEdits.ts` : état d’édition des sections
  génériques (edits, saving, notice, error, `save` avec `validateGenericFieldValue`). Extrait de
  `GenericCartularyView`.
- `src/components/GenericSchemaSection.tsx` : rendu d’une section pilotée par le schéma
  (lecture et saisie). Extrait de `GenericCartularyView` à l’identique.
- `src/schema/schemaSections.ts` : `emptySchemaSection`, `schemaSectionsForPage` (sections
  d’une page, avec `exclude`). Déplacé hors du composant pour la règle de lint fast-refresh.
- `src/components/GenericSchemaPageSections.tsx` : pour une page, rend les sections du schéma non
  couvertes par un bloc spécialisé, avec les boutons Modifier / Enregistrer / Annuler. Rend
  `null` sans schéma ou sans section.
- `tests/ui/generic-schema-page-sections.test.tsx` (4 tests).

Fichiers modifiés :

- `src/components/GenericCartularyView.tsx` : consomme le hook et le composant ; ajoute un état
  `publicationError` séparé (l’ancien `error` était partagé entre édition et autorisation média).
  Rendu DOM inchangé (17 tests existants au vert).
- `src/components/GenericCartularyPage.tsx` : réécrit sur `useAuthoritativeCartulary` ; garde la
  logique de suivi (registry item + todos).
- `src/App.tsx` :
  - imports du hook, de `useGenericSectionEdits`, de `GenericSchemaPageSections`, du type
    `VerticalSchema` ;
  - constante module `EMPTY_SCHEMA` ;
  - dans `App()` : `authoritative = useAuthoritativeCartulary(ACTIVE_CARTULARY_ID, { enabled:
    !isDemoCartulary && !isWatchWebsite })`, `envelope`, `schema`, `schemaHas(sectionId)`
    (vrai si pas de schéma chargé), `sectionEdits`, `genericPageProps`, `watch` devenu un
    `useMemo` qui surcharge marque / modèle / référence depuis l’enveloppe (l’ancien
    `const watch = mockCartulary.watchInstance;` à ≈ligne 1330 a été supprimé) ;
  - `document.title` dérivé de `watch` ;
  - `navigateTo` réinitialise `sectionEdits` ;
  - 14 blocs spécialisés enveloppés par `{schemaHas('…') && (` … `)}` : `media.hero`,
    `reference.origins`, `reference.specifications`, `reference.checks`,
    `reference.popularity`, `condition.description`, `condition.summary`,
    `condition.documentation`, `condition.reports`, `value.market_depth` (forme
    `!schemaHas(...) ? null : showCompleteContent ? … : …`), `value.comparables`,
    `value.cost_basis`, `value.performance`, `value.sensitivity` ;
  - `<GenericSchemaPageSections page="…" {...genericPageProps} />` inséré juste avant chacune
    des six balises fermantes `</CoverPage>`, `</MediaPage>`, `</ReferencePage>`,
    `</ConditionPage>`, `</ValuePage>`, `</PublicationPage>`.
- `src/features/cartulary/presentation/cartularyPresentationContract.ts` : ajout de
  `SPECIALIZED_CARTULARY_SECTIONS` (27 identifiants de sections rendues par un bloc spécialisé).
- `src/features/registry/registryCatalog.ts` : `buildCartularyHref` envoie tout objet non démo
  vers `/cartulary` (suppression de `usesFullCartulary` et des imports `IWC_CARTULARY_ID`,
  `ROLEX_CARTULARY_ID`).
- `src/RootPage.tsx` : la route `cartulary-view` rend `CartularyApp` (alias) ; suppression du
  lazy `GenericCartularyPage`, de `isDemoCartularyRoute` et de l’import `cartularyIdFromLocation`.
- `src/bootstrap/applicationBootstrap.ts` : `requiresPrivateCartularyHydration` accepte aussi
  `/cartulary-view`.
- Tests ajustés : `tests/registry-catalog.test.mjs` (`/cartulary-view` → `/cartulary`, + un test
  automobile), `tests/ui/application-bootstrap.test.tsx` (ligne `cartulary-view` → `true`),
  `tests/ui/invitation-community-corrections.test.tsx` (car → `/cartulary?`),
  `tests/demo-account.test.mjs` (regex RootPage), `tests/cartulary-presentation-contract.test.mjs`
  (+3 tests ADR-028).

## 3. Étape 2 — IWC et Rolex hors du code (ADR-029)

Décision : plus aucune branche `isIwcCartulary` / `isRolexCartulary` dans l’application ; IWC et
Rolex sont des données seedées.

- `src/App.tsx` : suppression des imports `isIwcCartulary`, `isRolexCartulary` ; branches
  retirées de `DEFAULT_CHECKS`, `DEFAULT_CONDITION_ENTRIES` (pièces jointes vides),
  `DEFAULT_DOCUMENTATION_ITEMS`, `DEFAULT_POPULARITY_RESOURCES`, `DEFAULT_COMPARABLE_ANALYSIS`,
  `BASE_DEFAULT_SPECIFICATION_GROUPS` (16 ternaires), `DEFAULT_EDITABLE_COPY` ;
  `hasDocumentedReferenceProfile = isDemoCartulary` ; `DEFAULT_SENSITIVITY_PRICES` remplacé par
  `defaultSensitivityPrices()` dérivé de `loadMarketDepth()` ; `loadSpecificationGroups` fusionne
  les valeurs enregistrées dans la structure par défaut pour tout Cartulaire (l’exception IWC est
  supprimée, le remplacement « Voir 04 · Valeur » est conservé) ; titre d’origine =
  `editableCopy.originTitle || Histoire de la référence ${watch.reference.reference}` ;
  `EditableCopyData.originTitle?: string` ; `cartularyPublicCode = envelope?.publicCode ||
  mockCartulary.publicCode` et remplacement des 15 `mockCartulary.publicCode` du corps de `App()`.
- `src/data/activeCartulary.ts` : suppression de `rolexFallbackProfile`, `rolexComparables`,
  `isIwcCartulary`, `isRolexCartulary`, de l’import `mockData` ; `placeholderProfile` neutre ;
  `activeCartulary = buildImportedCartulary(activeCreationProfile)` pour tout Cartulaire ;
  `fallbackPublicCode` sans cas Rolex ; versions via `WATCH_SCHEMA_VERSION` (étape 3).
- `src/services/registryGallery.ts` : carte des aperçus du bundle Hosting indexée par
  `${cartularyId}::${assetId}` (clé construite depuis `mockCartulary.id`), plus aucun test sur
  `IWC_CARTULARY_ID`.
- `src/persistence/storedStateValidation.ts` : `originTitle` ajouté au normaliseur
  `editableCopy`.
- `scripts/update-iwc-dossier.mjs` : `editableCopy.originTitle` ; ajout dans `stateValues` de
  `cartularia-creation-profile` (objet `creationProfile` défini juste avant),
  `cartularia-public-code` (`OP-4892-XZ9`), `cartularia-sensitivity-prices`
  (`[3200, 3600, 4000, 4400, 4800]`).
- Nouveaux : `src/migrations/rolexImport.ts` (bundle autoritaire Rolex +
  `buildRolexDossierState()` = état du brouillon privé ; contenu déplacé depuis `App.tsx` et
  `activeCartulary.ts`), `scripts/import-rolex-cartulary.mjs` (`npm run import:rolex` : import
  idempotent, projection Registre, brouillon privé, demande de synchronisation),
  `tests/rolex-import.test.mjs` (4 tests).
- `src/bootstrap/applicationBootstrap.ts` : commentaire « Migration datée (ADR-029) » au-dessus
  de `IWC_AUTHORITATIVE_HYDRATION_ID` (le contrat durci l’exige).
- `tests/corrective-wave7.test.mjs` : `assert.match(source, /isRolexCartulary \? \[/)` →
  `assert.doesNotMatch(source, /isRolexCartulary|isIwcCartulary/)`.
- `package.json` : scripts `import:rolex`, `test:reference-dossiers`.

Restent volontairement : `src/data/mockData.ts` (fixture du seed IWC et des aperçus Hosting),
l’hydratation IWC datée du bootstrap, les migrations de stockage de `localVault.ts`,
l’identifiant par défaut et la correspondance des codes publics dans `cartularyIds.ts`.

## 4. Étape 3 — Création dérivée du catalogue (ADR-030)

- Nouveau `scripts/lib/creation-profile-map.mjs` (+ `.d.mts`) : `CREATION_PROFILE_DEFINITIONS`
  (watch, car : libellés, `minYear`, `requires`, sections avec `fields` / `extensions` /
  `when` / `foldInto`), `mappedSchemaSections`, `materializeCreationSections`.
- `scripts/lib/create-cartulary-command.mjs` : `buildCreationBundle({ requestData, profile,
  media, schemaVersion? })` réécrit sur la table (l’ancienne table `definitions` et les
  « patchs » automobile sont supprimés ; enveloppe, sources, assets, valuations, ownerRelations,
  events inchangés) ; nouvelle `resolveCreationSchemaVersion({ firestore, schemaId,
  requestedVersion })` : `activeVersion` → `latestVersion` → version demandée si publiée, et
  vérification que `sectionIds` de la version couvre la table ; `processCartularyCreateRequest`
  l’appelle avant `buildCreationBundle`.
- `src/domain/cartularyCreation.ts` : `SUPPORTED_CREATION_PROFILES = CREATION_PROFILE_DEFINITIONS`,
  `schemaVersion: string` (plus d’union `'1.5.0' | '1.6.0' | '1.2.0'`).
- `src/services/schemaCatalog.ts` : `loadCreationSchemaVersion(schemaId)` (même règle).
- `src/services/cartularyCreation.ts` : `createCartulary` résout la version via
  `loadCreationSchemaVersion` avant d’écrire le profil.
- `src/persistence/storedStateValidation.ts` : version acceptée si `x.y.z`.
- `tests/fixtures/creation-bundles.json` : 5 bundles figés **avant** le refactor (parité).
  Une seule différence volontaire : dans `car_full`, la section `value.purchase` passe de
  `schemaSectionId: 'value.cost_basis'` (section inexistante dans le schéma automobile, défaut
  préexistant révélé par le contrôle) à `'value.provenance'`.
- `tests/creation-profile-map.test.mjs` (4 tests) ; `package.json` : ajouté à `test:create:unit`.

## 5. Étape 4 — Remontée de schéma (ADR-031)

- Nouveau `scripts/lib/schema-upgrade-command.mjs` : `resolveUpgradeTarget`,
  `loadCatalogSchemaVersion`, `planSchemaUpgrade` (pur : champs inconnus → extensions, sections
  retirées → `imported_unmapped` + `retiredFromSchema`, refus de rétrogradation et de changement
  de verticale), `listCartulariesToUpgrade`, `upgradeCartularySchema` (transaction : révision + 1,
  `previousSchemaVersion`, `schemaUpgradedAt`, `schemaDigest`, événement d’audit
  `cartulary.schema.upgraded`, `dryRun`).
- Nouveau `scripts/upgrade-cartulary-schema.mjs` (`npm run schema:upgrade -- --cartulary <id>` ou
  `--all --schema watch`, `--target`, `--dry-run`, `--allow-remote`).
- `src/domain/cartulary.ts` : `CartularySectionDocument.retiredFromSchema?`.
- `src/schema/schemaSections.ts` : les sections `retiredFromSchema` ne sont plus rendues.
- `src/features/registry/registryIntegrity.ts` : libellé de l’action
  `cartulary.schema.upgraded`.
- Nouveaux tests : `tests/schema-upgrade.test.mjs` (4 tests) et
  `tests/helpers/memory-firestore.mjs` (Firestore en mémoire : `doc/collection/get/set/update/
  create/delete`, `where ==`, `runTransaction`, `batch`, `dump`).
- `package.json` : scripts `schema:upgrade`, `test:schema-upgrade`.

## 6. Étape 5 — Contrat durci (ADR-026, section « Durcissement »)

`tests/cartulary-presentation-contract.test.mjs` parcourt tout `src/**/*.ts(x)` (hors copies
« 2 ») et refuse : `isIwcCartulary|isRolexCartulary|IWC_CARTULARY_ID|ROLEX_CARTULARY_ID|
cart_iwc_flieger|cart_rolex_gmt|ROL-487D9CAD|OP-4892-XZ9` et toute condition
`brand|makerName|maker ===|!== 'littéral'` (sauf `'all'`). Liste blanche :
`src/domain/cartularyIds.ts`, `src/bootstrap/applicationBootstrap.ts`,
`src/persistence/localVault.ts`, `src/data/mockData.ts`, `src/migrations/*` ;
`src/security/fileValidation.ts` exempté du motif « brand » (champ de conteneur QuickTime). Le
mode démo ne peut conditionner ni une page, ni `CartularyTodoBoard`, ni
`GenericSchemaPageSections`.

## 7. Liste exhaustive des fichiers touchés

Modifiés (25) : `docs/ADR-026-gabarit-universel-cartulaire.md`, `package.json`,
`scripts/lib/create-cartulary-command.mjs`, `scripts/update-iwc-dossier.mjs`, `src/App.tsx`,
`src/RootPage.tsx`, `src/bootstrap/applicationBootstrap.ts`,
`src/components/GenericCartularyPage.tsx`, `src/components/GenericCartularyView.tsx`,
`src/data/activeCartulary.ts`, `src/domain/cartulary.ts`, `src/domain/cartularyCreation.ts`,
`src/features/cartulary/presentation/cartularyPresentationContract.ts`,
`src/features/registry/registryCatalog.ts`, `src/features/registry/registryIntegrity.ts`,
`src/persistence/storedStateValidation.ts`, `src/services/cartularyCreation.ts`,
`src/services/registryGallery.ts`, `src/services/schemaCatalog.ts`,
`tests/cartulary-presentation-contract.test.mjs`, `tests/corrective-wave7.test.mjs`,
`tests/demo-account.test.mjs`, `tests/registry-catalog.test.mjs`,
`tests/ui/application-bootstrap.test.tsx`, `tests/ui/invitation-community-corrections.test.tsx`.

Nouveaux (21) : `docs/ADR-028-lecteur-unique-cartulaire.md`,
`docs/ADR-029-iwc-rolex-hors-du-code.md`, `docs/ADR-030-creation-derivee-du-catalogue.md`,
`docs/ADR-031-remontee-de-schema.md`, `scripts/import-rolex-cartulary.mjs`,
`scripts/lib/creation-profile-map.d.mts`, `scripts/lib/creation-profile-map.mjs`,
`scripts/lib/schema-upgrade-command.mjs`, `scripts/upgrade-cartulary-schema.mjs`,
`src/components/GenericSchemaPageSections.tsx`, `src/components/GenericSchemaSection.tsx`,
`src/features/cartulary/state/useAuthoritativeCartulary.ts`,
`src/features/cartulary/state/useGenericSectionEdits.ts`, `src/migrations/rolexImport.ts`,
`src/schema/schemaSections.ts`, `tests/creation-profile-map.test.mjs`,
`tests/fixtures/creation-bundles.json`, `tests/helpers/memory-firestore.mjs`,
`tests/rolex-import.test.mjs`, `tests/schema-upgrade.test.mjs`,
`tests/ui/generic-schema-page-sections.test.tsx`, et cette note.

Hors dépôt (modifiés pendant la session, sans effet sur le code) :

- Skill Claude `~/.claude/skills/cartularia-dev/SKILL.md` : routes (`/cartulary` lecteur unique),
  séquence de seed (+ `npm run import:rolex`), tableau « Où modifier quoi » (table de création,
  remontée de schéma, Firestore en mémoire), §5 annoté « corrigé » (pointeur de version active
  dans `manifest.json`, création épingle `watch@1.6.0` / `car@1.2.0`).
- Mémoire Claude du projet (`~/.claude/projects/…/memory/`) : `deux-lecteurs-cartulaire.md`,
  `catalogue-schemas-version-active.md`, `dossier-travail-non-commite.md`, `MEMORY.md`.

## 8. Comment inverser

**Toujours relever l’état avant et après :** `git status --porcelain | awk '{print $1}' | sort | uniq -c`.
Ne jamais utiliser `git reset`, `git checkout` de branche, `git stash`, `git clean` sans demande
explicite de Jérôme : l’arbre de travail est la référence du projet.

### 8.1 Inversion totale (retour exact au commit `fe3aa90`)

Les modifications ne concernent que les fichiers listés au §7 ; les copies « `* 2.*` » et les
autres fichiers non suivis d’avant la session ne sont pas touchés.

```bash
cd '/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/04_Application/Prototype Antigravity'
git checkout -- docs/ADR-026-gabarit-universel-cartulaire.md package.json scripts/lib/create-cartulary-command.mjs scripts/update-iwc-dossier.mjs src/App.tsx src/RootPage.tsx src/bootstrap/applicationBootstrap.ts src/components/GenericCartularyPage.tsx src/components/GenericCartularyView.tsx src/data/activeCartulary.ts src/domain/cartulary.ts src/domain/cartularyCreation.ts src/features/cartulary/presentation/cartularyPresentationContract.ts src/features/registry/registryCatalog.ts src/features/registry/registryIntegrity.ts src/persistence/storedStateValidation.ts src/services/cartularyCreation.ts src/services/registryGallery.ts src/services/schemaCatalog.ts tests/cartulary-presentation-contract.test.mjs tests/corrective-wave7.test.mjs tests/demo-account.test.mjs tests/registry-catalog.test.mjs tests/ui/application-bootstrap.test.tsx tests/ui/invitation-community-corrections.test.tsx
rm -f docs/ADR-028-lecteur-unique-cartulaire.md docs/ADR-029-iwc-rolex-hors-du-code.md docs/ADR-030-creation-derivee-du-catalogue.md docs/ADR-031-remontee-de-schema.md scripts/import-rolex-cartulary.mjs scripts/lib/creation-profile-map.d.mts scripts/lib/creation-profile-map.mjs scripts/lib/schema-upgrade-command.mjs scripts/upgrade-cartulary-schema.mjs src/components/GenericSchemaPageSections.tsx src/components/GenericSchemaSection.tsx src/features/cartulary/state/useAuthoritativeCartulary.ts src/features/cartulary/state/useGenericSectionEdits.ts src/migrations/rolexImport.ts src/schema/schemaSections.ts tests/creation-profile-map.test.mjs tests/fixtures/creation-bundles.json tests/helpers/memory-firestore.mjs tests/rolex-import.test.mjs tests/schema-upgrade.test.mjs tests/ui/generic-schema-page-sections.test.tsx
rmdir tests/fixtures tests/helpers 2>/dev/null
```

Puis `npm run lint && npm run build && npm run test:ui` doivent repasser sur l’état `fe3aa90`.

### 8.2 Inversion par étape (de la dernière à la première)

Les étapes sont empilées ; inverser une étape sans les suivantes exige de traiter d’abord
celles qui la suivent. Ordre conseillé : 5 → 4 → 3 → 2 → 1.

- **Étape 5** : dans `tests/cartulary-presentation-contract.test.mjs`, supprimer les trois
  imports ajoutés (`readdirSync`, `node:path`, `node:url`) et tout ce qui suit le commentaire
  « ADR-026, durcissement du 2026-09-08 » ; retirer la section « Durcissement » de l’ADR-026.
- **Étape 4** : supprimer `scripts/lib/schema-upgrade-command.mjs`,
  `scripts/upgrade-cartulary-schema.mjs`, `tests/schema-upgrade.test.mjs`,
  `tests/helpers/memory-firestore.mjs`, `docs/ADR-031-…` ; retirer `retiredFromSchema` de
  `src/domain/cartulary.ts` et la fonction `superseded` de `src/schema/schemaSections.ts` ;
  retirer la ligne `cartulary.schema.upgraded` de `registryIntegrity.ts` ; retirer les scripts
  `schema:upgrade` et `test:schema-upgrade` de `package.json`.
- **Étape 3** : `git checkout -- scripts/lib/create-cartulary-command.mjs
  src/domain/cartularyCreation.ts src/services/cartularyCreation.ts src/services/schemaCatalog.ts`
  (attention : `storedStateValidation.ts` et `activeCartulary.ts` contiennent aussi des
  changements des étapes 2 et 4 ; y rétablir à la main `['1.5.0', '1.6.0'].includes(...)` et
  `schemaVersion: '1.6.0'`) ; supprimer `scripts/lib/creation-profile-map.{mjs,d.mts}`,
  `tests/creation-profile-map.test.mjs`, `tests/fixtures/`, `docs/ADR-030-…` ; retirer
  `tests/creation-profile-map.test.mjs` de `test:create:unit`.
- **Étape 2** : `git checkout -- src/data/activeCartulary.ts src/services/registryGallery.ts
  scripts/update-iwc-dossier.mjs tests/corrective-wave7.test.mjs` ; dans `App.tsx`, rétablir les
  branches IWC/Rolex (le plus simple est `git checkout -- src/App.tsx` puis réappliquer l’étape 1,
  décrite au §2) ; retirer `originTitle` de `storedStateValidation.ts` ; supprimer
  `src/migrations/rolexImport.ts`, `scripts/import-rolex-cartulary.mjs`,
  `tests/rolex-import.test.mjs`, `docs/ADR-029-…` ; retirer `import:rolex` et
  `test:reference-dossiers` de `package.json` ; retirer le commentaire « Migration datée » du
  bootstrap.
- **Étape 1** : équivaut alors à l’inversion totale (§8.1) pour les fichiers restants.

### 8.3 Données Firestore

Aucune écriture n’a été faite dans un projet Firebase, ni local ni distant. Les scripts
`import:rolex`, `update:iwc-dossier` (clés ajoutées) et `schema:upgrade` n’ont **jamais été
exécutés**. Si quelqu’un les exécute ensuite :

- `import:rolex` sous émulateur (racine absente) crée la racine Rolex, son item de Registre et le
  brouillon privé de l'acteur de la fixture (`wave1-owner`) ; `CARTULARIA_OWNER_UID` n'est plus
  requis (autre valeur → `owner_mismatch`, code 1). Si la racine existe, seul le brouillon de son
  `accountHolderId` est complété ; hors émulateur, `GCLOUD_PROJECT` ou `FIREBASE_PROJECT_ID` est
  obligatoire même en `--dry-run` (`project_required`) ;
- `schema:upgrade` est tracé dans `auditEvents` du Cartulaire (`cartulary.schema.upgraded`) avec
  `previousSchemaVersion` sur la racine : la version précédente est donc retrouvable, mais la
  chaîne d’intégrité interdit une inversion silencieuse ; revenir en arrière suppose une nouvelle
  décision tracée.

## 9. Vérification de l’état livré

Commandes passées au vert le 2026-09-08 :

```bash
npx tsc -p tsconfig.app.json --noEmit
npm run lint
npm run build
npm run test:ui                     # 56 fichiers, 233 tests
npm run test:create:unit            # 12
npm run test:reference-dossiers     # 15
npm run test:schema-upgrade         # 4
npm run test:corrective-wave5 && npm run test:corrective-wave6 && npm run test:corrective-wave7
npm run test:registry-views && npm run test:ux-wave2 && npm run test:demo-account
npm run test:schema && npm run test:public-account && npm run test:integrity-convergence
git diff --check
```

## 10. Ce qui n’a pas été vérifié et ce qui reste à décider

- **Aucun test avec les émulateurs Firebase** : le runtime Java (`/private/tmp/cartularia-jre21`)
  n’existe plus sur la machine et `.env` ne contient plus `VITE_USE_FIREBASE_EMULATORS=true`.
  Les suites `test:create`, `test:cartulary`, `test:import`, `test:live-sync` n’ont pas tourné.
  L’interface n’a pas été ouverte dans un navigateur.
- **`.env` sans drapeau émulateurs** : ne pas lancer `npm run dev` sans l’avoir vérifié, sous
  peine d’écrire en production.
- **Production** : le Cartulaire Rolex de production n'a son contenu éditorial qu'après
  `GCLOUD_PROJECT=<projet> npm run import:rolex:dry-run` (avec `run-with-firebase-cli-adc.mjs`,
  contrôle du rapport, donnée Secret, code 0 ; `first_authoritative_sync` et
  `generic_operation_pending` à lire s'ils apparaissent, `generic_operation_stale` bloque) puis `npm
  run import:rolex -- --allow-remote` ; propriétaire déduit de `accountHolderId` ; clés de
  projection et montants du propriétaire intacts sans `--projection-keys` (`--projection-keys --key
  <clé>` pour une seule clé de projection) ; `cartularia-public-code` attendue en
  `conflict_with_root` ; au délai de la Cloud Function la demande passe `failed` et `npm run
  import:rolex:resync` la rejoue ; la synchronisation consomme le quota du propriétaire et l'audit
  lui est attribué (seule `reason` trace le seed) ; les trois clés IWC ajoutées et `originTitle` se
  complètent avec `update:iwc-profile-keys` (`--dry-run --allow-remote` puis `--apply --request-sync
  --allow-remote`, sans Storage ni réécriture des médias ; propriétaire déduit de `accountHolderId`
  et relu dans la transaction ; cible par défaut `cart_iwc_flieger_utc_2002`, garde
  `not_iwc_cartulary`, `--cartulary <id>` obligatoire et unique pour toute autre cible ; code 1 =
  rien n'a été écrit ; `--allow-partial` seulement sur décision explicite, puis contrôle par
  `--dry-run --allow-partial` (0) et non `--dry-run` seul (1) ; vérifier `ownerMembership.ok` ;
  vérifier l'absence de `creation_profile_drives_valuation` (sinon faire valider par le propriétaire
  les montants du profil qui alimenteraient le Registre) ; rapport classé Secret (`root.valuation`)
  ; prévenir le propriétaire du risque de « conflict » client ; demande pending jamais traitée :
  `npm run sync:worker -- --allow-remote` via `run-with-firebase-cli-adc.mjs` ; tests : `npm run
  test:iwc-profile-keys`) ; le pilote IWC reste en `watch@1.3.0` tant que `schema:upgrade` n’a pas
  été lancé. Toute action distante exige une autorisation explicite de Jérôme.
- **Décisions ouvertes** : activer une version automobile dans le manifeste (aujourd’hui
  `car@1.2.0` est `baseline`, la règle « dernière publiée » s’applique) ; sortir de
  `cartularyIds.ts` la correspondance des codes publics du pilote ; supprimer ou archiver les
  174 fichiers « `* 2.*` » (ignorés par git, 50 divergents) ; commiter les travaux sur une
  branche dédiée.

## 11. Mise à jour du 8 septembre 2026 (soir)

Les §9 et §10 décrivent l’état au commit `302b1b0`. Depuis : branche
`feat/lecteur-unique-adr-028-031` poussée ; vague V0 close (Java 21 persistant dans
`~/.cartularia/jre21`, `.env` avec `VITE_USE_FIREBASE_EMULATORS=true`, onze suites émulateur au
vert, App Check requalifié) ; vague V1 en cours (deux déploiements Hosting, cinq fonctions
appelables créées en production, publication et retrait d’un mini-site vérifiés de bout en bout,
scripts `import:rolex` et `update:iwc-profile-keys` rendus sûrs pour une racine existante avec
trois tours de relecture contradictoire). Journaux : `docs/audits/2026-09-08-execution-v0.md` et
`docs/audits/2026-09-08-execution-v1.md`, qui font foi sur l’état courant.
