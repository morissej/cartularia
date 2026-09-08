# ADR-029 — IWC et Rolex sortent du code : les Cartulaires pilotes sont des données

- Statut : accepté
- Date : 2026-09-08
- Précise : ADR-026 (gabarit universel), ADR-028 (lecteur unique)

## Contexte

L’audit du 2026-09-07 comptait 87 conditions par identité dans `src/App.tsx`, dont une trentaine
sur `isIwcCartulary` et `isRolexCartulary` : contenus par défaut (points à contrôler, documentation,
spécifications, copie éditoriale, analyse de comparables, grille de sensibilité, titre d’origine),
profil de secours Rolex et comparables Rolex codés dans `src/data/activeCartulary.ts`, cas particulier
IWC dans la Galerie du Registre. Le dossier IWC était pourtant déjà seedé comme données du brouillon
privé par `scripts/update-iwc-dossier.mjs` ; le code ne faisait que le dupliquer. Rolex n’existait
qu’en code.

## Décision

1. **Aucune branche par marque dans l’application.** `App.tsx`, `activeCartulary.ts` et
   `registryGallery.ts` ne testent plus l’identité IWC ou Rolex. Les valeurs par défaut sont
   neutres ; le contenu d’un Cartulaire vient de son brouillon privé et de son enveloppe.
2. **IWC est complété comme données.** `update-iwc-dossier.mjs` écrit désormais aussi
   `cartularia-creation-profile`, `cartularia-public-code`, `cartularia-sensitivity-prices` et le
   titre d’origine (`editableCopy.originTitle`), pour que le Cartulaire complet n’ait plus besoin
   d’aucun repli codé.
3. **Rolex devient une fixture de seed.** `src/migrations/rolexImport.ts` porte le bundle
   autoritaire (mêmes sections et champs que la création depuis le Registre) et l’état du brouillon
   privé ; `scripts/import-rolex-cartulary.mjs` (`npm run import:rolex`) importe, projette et
   synchronise, de façon idempotente. L’application n’importe jamais ce module.
4. **Le titre d’origine est une donnée éditoriale** : `originTitle` s’ajoute à la copie éditable,
   avec le repli neutre « Histoire de la référence … ».
5. **La grille de sensibilité par défaut** se dérive de la profondeur de marché enregistrée.
6. **Les spécifications enregistrées sont fusionnées** dans la structure par défaut pour tout
   Cartulaire, sans exception IWC.

## Ce qui reste, et pourquoi

- `src/data/mockData.ts` reste la fixture du seed IWC (`iwcImport.ts`) et alimente la carte des
  aperçus déjà présents dans le bundle Hosting, indexée par Cartulaire et non par marque.
- `applicationBootstrap.ts` conserve l’hydratation autoritaire datée du dossier IWC
  (`iwc-source-dossier-2026-08-29-v1`) et `localVault.ts` ses migrations de stockage : ce sont des
  migrations à date fixe, pas des branches de présentation.
- `cartularyIds.ts` garde l’identifiant par défaut de `/cartulary` et la correspondance des codes
  publics du pilote ; les déplacer en données relève d’une décision de routage séparée.

## Conséquences

- En production, le Cartulaire IWC lit son contenu depuis le brouillon privé déjà seedé ; les trois
  clés ajoutées (`cartularia-creation-profile`, `cartularia-public-code`,
  `cartularia-sensitivity-prices`) et `originTitle` de `cartularia-editable-copy` se complètent avec
  `update:iwc-profile-keys` : `--dry-run --allow-remote` (plan, aucune écriture) puis
  `--apply --request-sync --allow-remote` (transaction unique, demande `cartularySyncRequests/{id}`
  pending avec `reason: iwc_profile_keys_adr029`, valeur hors de l'énumération client de
  `firestore.rules`, écrite par le SDK Admin comme `production_deployment_verification` de
  `request-cartulary-sync.mjs`, pour que la trace d'audit porte la raison de l'opération). Sans
  Storage ni réécriture des médias ; propriétaire déduit de `accountHolderId` et relu dans la
  transaction (`owner_changed`, `cartulary_gone`) ; cible par défaut `IWC_CARTULARY_ID`, un autre
  identifiant exige `--cartulary <id>` (une seule fois, sinon erreur d'usage ;
  `CARTULARIA_CARTULARY_ID` n'est pas lu) et la racine doit porter le code public IWC (`publicCode`
  ou `objectCode` = `OP-4892-XZ9`, ou à défaut un `makerName` IWC), sinon `not_iwc_cartulary` sans
  écriture. Une clé déjà présente avec une autre valeur (ou le même contenu sous une autre
  sérialisation, signalé « (sérialisation différente, contenu identique) ») ou supprimée n'est
  jamais écrasée (`skip_existing`) : `--apply` est alors refusé sans rien écrire (code 1), sauf
  `--allow-partial` qui n'écrit que les clés non contestées ; le contrôle après
  `--apply --allow-partial` se fait avec `--dry-run --allow-partial` (code 0), `--dry-run` seul
  rendant 1 tant que la clé contestée subsiste. Le plan n'expose aucune valeur d'état (digests
  tronqués, tailles, noms de champs) ; le rapport porte en revanche les montants de la racine
  (`root.valuation`) et la présence des clés monétaires du brouillon (`draft.valuationKeys`) : il
  est classé `Secret`. Effet monétaire à connaître : sans montant sur la racine ni
  `cartularia-purchase` / `cartularia-retained-valuation` exploitable, la synchronisation dérive
  `purchasePrice`, `costBasis` et `grossValuation` de la racine et de la projection du Registre
  depuis `cartularia-creation-profile` (`purchasePrice`, `valuationMid`) : l'avertissement
  `creation_profile_drives_valuation` l'annonce, à faire valider par le propriétaire avant
  `--apply`. Précondition de synchronisation lue, jamais écrite :
  `organizations/{organizationId}/memberships/{uid}` actif, rôle `legal_owner`, permission
  `cartulary.edit`, registre dans `scopes.registryIds` (avertissement `owner_membership_missing`).
  Une demande pending jamais traitée (Cloud Function `syncCartularyToRegistry` absente ou en échec)
  se traite avec le worker du dépôt (`npm run sync:worker -- --allow-remote`, lancé via
  `node scripts/run-with-firebase-cli-adc.mjs -- node scripts/run-cartulary-sync-worker.mjs
  --allow-remote` avec `GCLOUD_PROJECT` ; il traite toute demande pending du projet), jamais en
  réécrivant la demande à la main. Hors émulateur, `update:iwc-profile-keys` se lance de même via
  `node scripts/run-with-firebase-cli-adc.mjs -- node scripts/update-iwc-profile-keys.mjs …` :
  `applicationDefault()` ne lit pas la session Firebase CLI seule. Risque côté propriétaire : une copie locale non poussée (`cartularia-sensitivity-prices`
  persistée au montage, `cartularia-editable-copy` éditée) sera signalée « conflict » par le client
  à sa prochaine session ; le prévenir avant `--apply`. Les valeurs IWC vivent dans
  `scripts/lib/iwc-dossier-values.mjs`, partagé avec `update:iwc-dossier`. Sans elles, l'identité
  et le code public viennent de l'enveloppe (ADR-028) et la sensibilité de la profondeur de marché
  enregistrée.
- En production, le Cartulaire Rolex existe déjà (créé depuis le Registre, révision 13, propriétaire
  réel, brouillon privé actif) et aucun reçu `adr029-import-rolex-v1` n'existe.
  `scripts/import-rolex-cartulary.mjs` s'appuie sur `scripts/lib/rolex-dossier-command.mjs`
  (`planRolexDossier` en lecture seule, puis `applyRolexDossier`, CLI testé en mémoire par
  `runRolexDossierCli`) : racine absente (seed local sous émulateur, ou `--allow-create` explicite
  hors émulateur) : import + projection avec l'acteur de la fixture, puis brouillon, état et
  synchronisation ; racine présente (production) : ni import ni projection ; le propriétaire est
  tiré de `accountHolderId` (`CARTULARIA_OWNER_UID` n'est plus requis ; s'il est fourni il doit
  coïncider, sinon `owner_mismatch` sans écriture ; jamais de repli sur la fixture :
  `owner_unknown`) ; seul le brouillon privé de ce propriétaire est complété (créé s'il manque, à
  son nom). Hors émulateur, `GCLOUD_PROJECT` ou `FIREBASE_PROJECT_ID` est obligatoire, même en
  `--dry-run` (`project_required`, code 1, Firebase jamais initialisé) : aucun projet distant n'est
  ciblé par défaut avec les identifiants ADC. Règle de non-écrasement : une clé absente est créée ;
  une clé égale (comparaison canonique) est `unchanged` ; une clé existante différente ou supprimée
  reste `kept` et n'est réécrite qu'avec `--force --key <clé>` (répétable ; `--force` seul est
  refusé, code 1) ; les six clés qui pilotent la projection Registre (`cartularia-creation-profile`,
  `-specification-groups`, `-watch-status`, `-purchase`, `-purchase-expenses`,
  `-retained-valuation`) ne sont ni créées ni réécrites sans `--projection-keys` (`kept_projection`)
  : les montants de la racine et de l'item Registre restent ceux du propriétaire ;
  `--projection-keys --key <clé>` (sans `--force`) limite la création aux clés de projection
  nommées, les autres restant `kept_projection` (sans `--key` : toutes ; dès qu'un `--key` est
  présent, y compris avec `--force`, seules les clés de projection nommées sont concernées, aucune
  si `--key` ne nomme que des clés hors projection : avertissement `projection_keys_without_effect`)
  ; `cartularia-public-code` n'est jamais réécrite si elle contredit le code public de la racine
  (`conflict_with_root`), cas attendu en production. Les documents d'état ne portent aucune trace
  d'auteur : rien ne distingue une clé seedée d'une saisie du propriétaire, d'où la conservation par
  défaut. Une réécriture incrémente la révision : le lecteur fait un pull si sa copie locale est
  propre et signale un conflit sinon. Rapport (`--dry-run` autorisé sans émulateur ni
  `--allow-remote`, mêmes contenus en exécution) : mode, propriétaire, révision et code public de la
  racine, validité de la chaîne d'audit, préconditions de la synchronisation (`editor` : membership
  `legal_owner` active avec `cartulary.edit` et le registre dans ses scopes), action par clé
  (`create`, `update`, `unchanged`, `kept`, `kept_projection`, `conflict_with_root`, `raced`) avec
  empreintes sha256 salées par une clé aléatoire propre à l'exécution (comparables dans un même
  rapport seulement ; entre deux rapports, comparer actions, `differingFields` et tailles), tailles
  et noms des champs différents, jamais une valeur, bloc `projection` (`current`, `afterPlan`,
  `ifFixture`, `changesAfterPlan`, `changesIfFixture`, `applied` après exécution) et bloc `notes`
  (empreintes, second passage attendu, quota) : le rapport porte les montants de la racine, c'est
  une donnée Secret, à ne pas joindre à un ticket ni commiter. Opération générique du lecteur unique
  : si `cartularia-generic-operation` porte un token que la racine n'a pas encore absorbé
  (`lastGenericOperationToken`), le plan expose `genericOperationPending` (genre, `fieldId` édités,
  `baseRevision`) et avertit (`generic_operation_pending`) que l'aperçu de projection ne simule pas
  cette édition (la synchronisation l'appliquera : une édition de `value.retained.amount` force
  `grossValuation` et met `netValuation` à `null`, `projection.applied` peut alors différer de
  `projection.afterPlan`) ; si sa `baseRevision` n'est plus la révision de la racine, le plan est
  `blocked` (`generic_operation_stale`, code 1, rien n'est écrit) car la synchronisation échouerait
  en `revision_conflict`. `first_authoritative_sync` prévient qu'une racine sans `liveStateDigest`
  recevra, par la synchronisation du seed, la première synchronisation autoritaire de tout le
  brouillon (médias legacy, todos, sections génériques), pas seulement des clés créées.
  Synchronisation : demande `cartularySyncRequests/{id}` avec `reason` `rolex_dossier_seed_adr029`
  (hors de l'énumération de firestore.rules, qui ne s'applique qu'au navigateur), traitée par le
  script ou attendue si la Cloud Function l'a réclamée (150 s au plus, la fonction étant déployée à
  120 s ; au-delà la demande est marquée `failed` avec `sync_timeout`, sans double traitement
  puisque la transaction finale de `processCartularySyncRequest` relit `status === 'processing'`, et
  la relance signale `sync_required`). La synchronisation consomme le quota `cartulary_sync` du
  propriétaire (120 par heure) et l'événement d'audit `cartulary.live_state.synced` est attribué au
  propriétaire (`actor.uid`) : seule la `reason` de la demande trace le seed. `sync_required`
  (demande précédente `failed`, ou empreinte du brouillon ≠ `root.liveStateDigest`) rend `ok:false`
  (code 1) sans `--resync` ; `--resync` synchronise même sans écriture et applique aussi les
  modifications non synchronisées du propriétaire (`draft_out_of_sync.changesAfterPlan`). Une
  demande `pending`/`processing` n'est jamais écrasée : si le plan doit synchroniser, il est
  `blocked` (`request_in_flight`, code 1, rien n'est écrit) ; seul `--replace-stale-request`
  remplace une demande bloquée depuis plus de 15 minutes. Le plan est aussi `blocked` si la chaîne
  d'audit est invalide, si la membership ou le registre ne permettraient pas la synchronisation
  (`owner_not_editor`, `registry_not_ready`) ou en mode create hors émulateur sans `--allow-create`.
  Chaque clé est écrite dans sa propre transaction après relecture de sa révision, de son drapeau
  `deleted` et du statut du brouillon (`raced` sinon) ; un brouillon `deleted` ou archivé n'est
  jamais réactivé (`draft_not_ready` avant import et projection) ; un brouillon apparu ou une racine
  modifiée depuis le plan rend `plan_stale`. Séquence : `GCLOUD_PROJECT=<projet> node
  scripts/run-with-firebase-cli-adc.mjs -- node scripts/import-rolex-cartulary.mjs --dry-run`,
  contrôle du JSON (attendu au premier passage : `conflict_with_root` 1, `kept_projection` 6,
  `create` 6 ou 7, `editor.ok` true, `genericOperationPending` null, `projection.changesAfterPlan`
  vide, `sync.expected` planned ; au second passage : `unchanged` 6 ou 7, `kept` 1 ou 0,
  `kept_projection` 6, `conflict_with_root` 1, sync `skipped`, jamais un `unchanged` plus élevé),
  puis `--allow-remote` ; `--projection-keys [--key]`, `--force --key`, `--resync` et
  `--replace-stale-request` seulement sur décision explicite après un `--dry-run` portant le même
  drapeau.
- En local, ajouter `npm run import:rolex` à la séquence de seed (second passage sans effet).

## Contrôle

`tests/rolex-import.test.mjs` : bundle Secret et conforme au catalogue, sections identiques à la
création depuis le Registre, couverture des clés lues par le lecteur, absence de branche par marque
dans `App.tsx`, `activeCartulary.ts` et `registryGallery.ts`. `tests/rolex-dossier-command.test.mjs` (52 tests, Firestore en mémoire, propriétaire simulé dont les
montants et les textes diffèrent de la fixture) : racine absente, racine créée depuis le Registre
(kept_projection, montants conservés, bloc projection), --projection-keys avec et sans --key (y
compris `--force --key` hors projection : aucune clé de projection touchée), simulation sans
écriture, --force --key, conflit de code public, gardes (brouillon archivé avant import, clé
supprimée entre plan et application, brouillon apparu entre plan et application), préconditions de
synchronisation, projet obligatoire hors émulateur, première synchronisation autoritaire, opération
générique en attente (aperçu non simulé, baseRevision périmée bloquante), demande en cours, échec de
traitement, délai de la Cloud Function (demande marquée failed), --resync, brouillon en avance,
course avec la Cloud Function, CLI en mémoire et en sous-processus. `tests/corrective-wave7.test.mjs`
interdit désormais `isIwcCartulary` et `isRolexCartulary`.
`tests/iwc-profile-keys.test.mjs` (Firestore en mémoire) : propriétaire déduit de `accountHolderId`,
clés absentes créées en révision 1, `originTitle` existant conservé, clé divergente laissée et
signalée, dry-run sans écriture, conflit de révision refusé, demande de synchronisation seulement
avec `--request-sync` ; `update-iwc-dossier.mjs` importe bien le module partagé.
