# V2.3 — enrichissement des données de démonstration (v2)

Date : 13 septembre 2026. Point « seed-demo » de la vague V2 (branche `feat/lecteur-unique-adr-028-031`). Périmètre : code, builders et tests locaux ; aucune écriture distante, aucun émulateur lancé par l'agent. L'application en production est décrite en fin de rapport et reste à exécuter par Jérôme, **avant** la publication démo (P1 puis P2).

Ce journal remplace explicitement le gel du module documenté le 6 septembre (`docs/audits/2026-09-06-demo-data-only-repair.md`, SHA-256 `276aadb3…`). Le module `scripts/lib/demo-data-repair.mjs` est de nouveau modifié ; ses nouvelles empreintes figurent au § « Empreintes ».

## Constat corrigé

- V-C2 « À revoir 5 » / cartes « Données à vérifier » : les builders figeaient `completenessLevel: 'imported_unreviewed'` (racine et projection) ; `registryAggregates.ts` compte chaque item non revu ; aucun chemin serveur ou UI ne fait passer un dossier en « revu ».
- V-C1 « 0 rappel » : aucun document `cartularies/{id}/reminders` n'était seedé et le compte démo (sans `cartulary.edit`) ne peut pas en créer.
- V-C1 « 0 accès » : aucune projection `registries/reg_cartularia_demo/accesses/*` ; la voie normale (`createRegistryInvitation`) exige un éditeur, un e-mail réel et un envoi de mail.

## Résultat

Une migration démo v2 (`DEMO_ENRICHMENT_VERSION = 'demo-data-enrichment-v2'`) greffée sur la voie `--data-only` existante, additive, déterministe et rejouable :

- `src/domain/cartulary.ts` : `CartularyCompletenessLevel = 'imported_unreviewed' | 'partial' | 'complete'` (type exporté) ; le statut de section n'est pas touché (non affiché).
- `src/data/demoCartularyDocuments.ts` : `DEMO_REVIEWED_AT = '2026-09-01T09:00:00.000Z'` ; enveloppe et projection démo en `completenessLevel: 'complete'` / `lastVerifiedAt: DEMO_REVIEWED_AT` ; `buildDemoReminderDocuments(cartulary, accountUid)` (6 rappels, clés exactement celles du contrat `firestore.rules`) ; `buildDemoAccessDocuments()` (3 projections, forme d'`invitation-command.mjs`, dates ISO, domaine `.invalid`).
- `scripts/lib/demo-data-repair.mjs` : plan v2 (racine revue, projection revue, rappels absents, événement `cartulary.demo.enriched` acteur `demo_data_enrichment`, accès absents au niveau Registre sans événement), gardes étendues (rappels et accès hors périmètre refusés, destinataire non masqué refusé, divergence après v2 refusée), grammaire d'audit élargie, option `--expect-no-writes`, `buildDemoAccessProjections()` (Timestamp + `contentHash`).
- `scripts/seed-demo-account.mjs` (voie émulateur) : écrit rappels et accès dans le même batch ; en-tête documentant que seule `--data-only` est autorisée contre la production.
- `package.json` : `test:demo-account` (élargi aux trois suites en mémoire), `test:demo-account:full` (émulateurs : seed complet puis `--data-only --expect-no-writes` puis test émulateur), `test:demo-data-repair`, et pour publication-demo `demo:publish-website`, `test:demo-publication`.

### Décision (a) de l'orchestrateur : rejouable après la publication réelle

`verifyAuditChain` accepte désormais, après le seed et les migrations v1/v2, les événements `publication.published` / `publication.revoked` dont l'acteur est `{ uid: <compte démo>, role: 'demo_seed' }` et la ressource `{ type: 'publication', id: <publicCode> }` (forme exacte de `createDemoAuditEvent` dans `scripts/lib/demo-publication-command.mjs`). La chaîne reste intégralement vérifiée (hash de chaque événement, séquence, tête, révision) ; `publicationStatus` de la racine doit refléter le dernier événement de publication (`none` / `published` / `revoked`), tout autre statut est refusé. La projection du Registre peut rester en retard d'une révision (la publication ne reprojette pas le Registre). La v2 ne touche jamais `publicationStatus`. Un enrichissement demandé après une publication reste possible (événement suivant). Borne de lecture : 12 événements par Cartulaire.

### Grammaire d'audit acceptée

1. `cartulary.demo.created` (seed, séquence 1, acteur `demo_seed`).
2. `cartulary.demo.data_repaired` (v1, uniquement en position 2, acteur `demo_data_repair`).
3. `cartulary.demo.enriched` (v2, au plus une fois, acteur `demo_data_enrichment`, `requestId = demo-data-enrichment-v2_<id>`).
4. `publication.published` / `publication.revoked` (acteur `demo_seed`, un retrait exige une publication active).

## Plan attendu en production : 24 opérations

État d'entrée constaté le 6 septembre : cinq racines en revision 2 / integritySequence 2, deux événements par Cartulaire, médias et codes réparés, Collection « Les cinq icônes ». Le plan v1 doit être vide ; le plan v2 vaut exactement :

| Cible | Opération | Nombre |
| --- | --- | ---: |
| `cartularies/{id}` | update `{ completenessLevel: 'complete', lastVerifiedAt, revision: 3, integritySequence: 3, integrityHead }` | 5 |
| `registries/reg_cartularia_demo/items/{id}` | update `{ completenessLevel: 'complete', sourceRevision: 3, contentHash }` | 5 |
| `cartularies/{id}/auditEvents/evt_demo_data_enrichment_v2_<20 hex>` | create (séquence 3) | 5 |
| `cartularies/{id}/reminders/rem_demo_<mediaSlug>_<suffixe>` | create | 6 |
| `registries/reg_cartularia_demo/accesses/acc_demo_*` | create (`generatedAt`/`updatedAt` serveur) | 3 |

Identifiants déterministes :

| Cartulaire | Événement v2 | Rappels (statut, échéance) |
| --- | --- | --- |
| `cart_demo_rolex_submariner_124060` | `evt_demo_data_enrichment_v2_f449b06a884199b18461` | `rem_demo_rolex-submariner_insurance` (planned, 2026-12-15) ; `rem_demo_rolex-submariner_photos` (completed, 2026-08-20) |
| `cart_demo_ap_royal_oak_15510st` | `evt_demo_data_enrichment_v2_1b95e37cafd2a31259ce` | `rem_demo_audemars-piguet-royal-oak_service` (planned, 2027-03-31) |
| `cart_demo_tudor_black_bay_chrono_79360n` | `evt_demo_data_enrichment_v2_d772fbac0623e0097eb9` | `rem_demo_tudor-black-bay-chrono_waterproof` (active, 2026-06-30 — volontairement en retard) |
| `cart_demo_jlc_reverso_tribute_q397848j` | `evt_demo_data_enrichment_v2_67014c767032868a243a` | `rem_demo_jaeger-lecoultre-reverso_strap` (planned, 2027-01-20) |
| `cart_demo_breguet_classique_5157bb` | `evt_demo_data_enrichment_v2_03a364811daad1347ac3` | `rem_demo_breguet-classique_valuation` (dismissed, 2026-10-01) |

Accès : `acc_demo_invitation_expert` (invitation, pending, Submariner, `e***@cartularia.invalid`) ; `acc_demo_mandate_assureur` (mandate, active sans échéance, Collection « Les cinq icônes », 3 consultations) ; `acc_demo_link_revoked` (shared_link, revoked, Breguet). Empreintes `contentHash` : `sha256:b12dd4dc…`, `sha256:4ebb8b05…`, `sha256:52242e96…` (recalculées identiques à chaque appel).

Attendu après application dans le Registre démo : Vue d'ensemble « À revoir 0 », aucun signal de revue, « Échéances en retard 1 » ; Catalogue : cinq cartes « Complet » ; Suivi : 6 rappels (1 en retard, 3 planifiés, 1 terminé, 1 écarté) ; Accès : 3 accès, aucun bouton Révoquer ; Preuves : chaîne valide, 3 événements par Cartulaire (4 pour la Submariner après P2).

## Garde-fous (en plus de ceux du 6 septembre, tous conservés)

1. Lecture bornée des rappels (n attendus + 1 par Cartulaire) et des accès (3 + 1) : tout document dont l'identifiant n'est pas dans les builders arrête le lot (« hors périmètre démo »).
2. Tout rappel ou accès existant doit être égal au builder hors horodatages ; titre modifié, `createdBy` étranger, champ supplémentaire, compteur ou libellé différent : arrêt.
3. `recipientLabel` ressemblant à une adresse lisible (`local@domaine` sans masque) : arrêt, même pour un accès attendu.
4. Divergence après v2 (racine ou projection revenue à « à vérifier » alors que l'événement d'enrichissement existe) : arrêt, « nouvelle migration explicite nécessaire ». Valeur `partial` ou `lastVerifiedAt` inattendu : arrêt.
5. Événement d'audit d'action inconnue, doublon v2, réparation v1 hors position 2, retrait sans publication, acteur/ressource étrangers, `requestId` vide, hash ou tête altérés, `publicationStatus` incohérent : arrêt.
6. `--expect-no-writes` : simulation qui échoue si une écriture reste nécessaire (preuve d'idempotence entre seed complet et `--data-only` sous émulateur).
7. Horodatages serveur ciblés : `createdAt`/`updatedAt` sur les créations, `updatedAt` sur les mises à jour, `generatedAt`/`updatedAt` sur les accès, aucun sur les événements (datés par `occurredAt`).

## Validation locale

```sh
npm run lint
npx tsc -p tsconfig.app.json --noEmit
node --test tests/demo-data-repair.test.mjs tests/demo-account.test.mjs tests/registry-aggregates.test.mjs
```

Résultat : lint propre, tsc sans erreur, **35 tests passés** (18 + 12 + 5) dont 7 nouveaux dans `demo-data-repair` (plan de 24 opérations sur l'état de production simulé, chaîne revérifiée par `scripts/lib/audit-verifier.mjs`, idempotence, cas émulateur en séquence 2, 15 refus ciblés, décision (a) acceptée puis 10 refus de ses limites, `--expect-no-writes` et horodatages) ; 4 nouveaux dans `demo-account` ; 1 nouveau dans `registry-aggregates`. `git diff --check` propre.

Non exécuté par l'agent (interdit dans ce lot) : `npm run test:demo-account:full` (émulateurs Auth + Firestore : seed complet, `--data-only --expect-no-writes`, puis `tests/demo-account-emulator.test.mjs` étendu aux rappels, accès, `completenessLevel` et refus d'écriture d'un accès) — à rejouer par l'orchestrateur. `firebase.demo-test.json` n'est pas modifié (aucun émulateur Storage requis par ce point).

## Empreintes

| Fichier | SHA-256 |
| --- | --- |
| `scripts/lib/demo-data-repair.mjs` | `9266ed3726189902decedd5e0167958ef08b7a6bc6f4acf4eeeb0eb4f244d13a` |
| `scripts/seed-demo-account.mjs` | `e017c75f77a9dd036e810aa01d06d89cbfb75968f4077049956643b7e520b133` |
| `src/data/demoCartularyDocuments.ts` | `b8e4304c8b8c79b16fd9bc5c055666b6a91bffb670937b8b0120bfd62fef105e` |

Le journal de la publication démo (publication-demo) doit consigner à son tour l'empreinte de `scripts/lib/demo-publication-command.mjs` : deux acteurs d'écriture Admin se succèdent sur les mêmes racines, dans l'ordre P1 (v2) puis P2 (publication).

## Actions de production (Jérôme, jamais l'agent)

Ordre impératif : **seed v2 (P1) avant la publication démo (P2)**. Le module accepte aussi une v2 après publication, mais la simulation de publication attend la révision courante 3 (post-v2).

1. Simulation, depuis la racine du prototype, Node ≥ 22.18, session Firebase CLI active, aucune variable d'émulateur :

```sh
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/seed-demo-account.mjs --data-only --allow-remote
```

Attendu : `mode: dry-run`, `applied: false`, exactement 24 opérations (5 racines, 5 projections, 5 auditEvents, 6 reminders, 3 accesses), aucune opération sur assets ni Collection.

2. Répertoire de sauvegarde hors dépôt et hors Hosting, par exemple `mkdir -p "/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/cartularia-demo-repair-20260913"`.

3. Application après revue du plan :

```sh
GCLOUD_PROJECT=studio-2614005370-a3e51 node scripts/run-with-firebase-cli-adc.mjs -- node scripts/seed-demo-account.mjs --data-only --allow-remote --apply --backup-dir="/Users/jeromemorisseau/Documents/Mes documents PaperPort/Projet/Projet Cartularia/cartularia-demo-repair-20260913"
```

Attendu : `applied: true`, 24 écritures, sous-répertoire `demo-data-enrichment-v2-*` et `backup.json` (0600) créés.

4. Contrôle : relancer la simulation (ou `--expect-no-writes` sous émulateur uniquement ; en production, `--allow-remote` sans `--apply` suffit) → `writes: []`. Puis parcours Registre démo décrit ci-dessus. Après P2, relancer la simulation : elle doit rester vide (décision (a)).

Ne jamais rejouer `npm run seed:demo-account` sans `--data-only` contre la production. Tout refus s'investigue en lecture seule ; ne pas assouplir les gardes.

## Limites connues

- Dates fixes : le rappel Submariner « planned » du 2026-12-15 passera en retard après cette date ; à rafraîchir dans une v3 ou à documenter dans la recette.
- L'onglet Suivi du Cartulaire démo (`/cartulary-demo`, `readOnlyPreview`) reste vide par conception ; seule la page Suivi du Registre montre les rappels. À signaler dans la recette V2 pour ne pas le compter en régression.
- Les règles Firestore de HEAD ne sont pas déployées (V2 (g)) : la lecture des rappels et accès par le compte démo repose sur les règles en production, inférées de l'audit du 8 septembre (états vides sans erreur). En cas de « Suivi indisponible », diagnostiquer en lecture seule.
- Valeur « revu » retenue : `'complete'` (dossiers fictifs intégralement documentés) plutôt que `'partial'`.
