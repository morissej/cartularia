import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildRolexDossierState,
  buildRolexImportBundle,
  ROLEX_CARTULARY_ID,
  ROLEX_CREATION_PROFILE,
  ROLEX_IMPORT_ACTOR_ID,
  ROLEX_IMPORT_REQUEST_ID,
  ROLEX_PUBLIC_CODE,
} from '../src/migrations/rolexImport.ts';
import { Timestamp } from 'firebase-admin/firestore';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';
import { buildCreationBundle } from '../scripts/lib/create-cartulary-command.mjs';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { projectRegistryItem } from '../scripts/lib/projection-command.mjs';
import {
  applyRolexDossier,
  describeRolexDossierRun,
  parseRolexDossierArgs,
  planRolexDossier,
  PROJECTION_DRIVING_STATE_KEYS,
  PROJECTION_FIELDS,
  ROLEX_SYNC_REQUEST_REASON,
  runRolexDossier,
  runRolexDossierCli,
  STALE_SYNC_REQUEST_MS,
} from '../scripts/lib/rolex-dossier-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const REAL_UID = 'uid_proprietaire_reel_0001';
const CREATION_DATE = '2026-08-20T10:00:00.000Z';
const SYNC_DATE = '2026-09-08T12:00:00.000Z';
const CLOCK = 1_757_332_800_000;
const ROOT_PATH = `cartularies/${ROLEX_CARTULARY_ID}`;
const ITEM_PATH = `registries/reg_collection_privee/items/${ROLEX_CARTULARY_ID}`;
const REQUEST_PATH = `cartularySyncRequests/${ROLEX_CARTULARY_ID}`;
const draftPath = (uid) => `privateDrafts/${uid}/cartularies/${ROLEX_CARTULARY_ID}`;
const statePath = (uid, key) => `${draftPath(uid)}/state/${key}`;
const STATE_KEYS = [...buildRolexDossierState().keys()];
const FIXTURE = buildRolexDossierState();
const DIGEST_NONCE = 'nonce-de-test-0001';
const applyOptions = { occurredAt: SYNC_DATE, now: () => CLOCK, sleep: async () => {}, pollTimeoutMs: 0, pollIntervalMs: 0, digestNonce: DIGEST_NONCE };
const { organizationId: ORGANIZATION_ID, registryId: REGISTRY_ID } = buildRolexImportBundle().envelope;
const membershipPath = (uid) => `organizations/${ORGANIZATION_ID}/memberships/${uid}`;
/** Demande de synchronisation étrangère (navigateur), datée : `ageMs` avant CLOCK. */
const foreignRequest = ({ status = 'pending', ageMs = 60_000, requestId = 'sync_client_pending_000000000001' } = {}) => ({
  requestDocumentId: ROLEX_CARTULARY_ID, requestId, ownerUid: REAL_UID, cartularyId: ROLEX_CARTULARY_ID, reason: 'private_draft_synchronized', status,
  requestedAt: Timestamp.fromMillis(CLOCK - ageMs - (status === 'processing' ? 1_000 : 0)),
  ...(status === 'processing' ? { processingStartedAt: Timestamp.fromMillis(CLOCK - ageMs) } : {}),
  updatedAt: Timestamp.fromMillis(CLOCK - ageMs),
});
const EMULATOR_ENV = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
const REMOTE_ENV = { GCLOUD_PROJECT: 'cartularia-prod-simule' };

/**
 * Propriétaire simulé : montants et textes DIFFÉRENTS de la fixture (fixture : 21 900 € d'achat,
 * 23 000 € de valeur ; copie éditoriale avec originTitle). Toute assertion « la valeur du
 * propriétaire reste » distingue donc une conservation d'une réécriture.
 */
const OWNER_PROFILE = { ...ROLEX_CREATION_PROFILE, purchasePrice: 19_500, valuationLow: 18_000, valuationMid: 20_000, valuationHigh: 22_000, seller: 'Vendeur du propriétaire', assertedAt: CREATION_DATE };
const OWNER_EDITABLE_COPY = { heroSummary: 'Ma GMT, achetée pour mes quarante ans.', originParagraphs: ['Premier paragraphe personnel.', 'Second paragraphe personnel.'] };
const OWNER_SPECIFICATION_GROUPS = [{ id: 'basic', title: 'Données de base', items: [{ id: 'brand', label: 'Marque', value: 'Rolex' }, { id: 'model', label: 'Modèle', value: 'GMT-Master Mark I Long E' }, { id: 'reference', label: 'Numéro de référence', value: '1675' }, { id: 'year', label: 'Année de fabrication', value: '1969' }] }];
const SECRET_PATTERNS = [/1 982 530/, /19500/, /19 500/, /21900/, /Ma GMT/, /paragraphe personnel/, /Vendeur du propriétaire/, /Nom du propriétaire/, /rue Secrète/, new RegExp(DIGEST_NONCE)];

const catalogUrl = new URL('../firebase/schema-catalog/', import.meta.url);
const artifact = (schemaId, version) => JSON.parse(readFileSync(new URL(`${schemaId}/${version}.json`, catalogUrl), 'utf8'));

// Seeds repris de tests/schema-upgrade.test.mjs (organisation, registre, membership, collection,
// catalogue), avec le droit publication.manage qu'exige la projection Registre.
const seedCatalog = (firestore, schemaId, version) => {
  const schema = artifact(schemaId, version);
  return Promise.all([
    firestore.doc(`schemaCatalog/${schemaId}`).set({ activeVersion: version, latestVersion: version }),
    firestore.doc(`schemaCatalog/${schemaId}/versions/${version}`).set({ schemaId, version, status: 'active', sectionIds: schema.sections, catalogDigest: `sha256:${'b'.repeat(64)}` }),
    ...schema.fields.map((field) => firestore.doc(`schemaCatalog/${schemaId}/versions/${version}/sections/${field.sectionId}/fields/${field.fieldId}`).set({ fieldId: field.fieldId, sectionId: field.sectionId })),
  ]);
};

const seedFoundations = async (firestore, uids) => {
  const { organizationId, registryId, collectionId, schemaId, schemaVersion } = buildRolexImportBundle().envelope;
  await seedCatalog(firestore, schemaId, schemaVersion);
  await firestore.doc(`organizations/${organizationId}`).set({ id: organizationId, status: 'active' });
  await firestore.doc(`registries/${registryId}`).set({ id: registryId, organizationId, status: 'active', itemCount: 0 });
  for (const uid of uids) {
    await firestore.doc(`organizations/${organizationId}/memberships/${uid}`).set({ uid, status: 'active', roles: ['legal_owner'], permissions: ['cartulary.create', 'cartulary.edit', 'publication.manage'], scopes: { registryIds: [registryId] } });
  }
  await firestore.doc(`collections/${collectionId}`).set({ id: collectionId, registryId, organizationId, status: 'active' });
  await firestore.doc(`registries/${registryId}/collections/${collectionId}`).set({ id: collectionId, registryId, organizationId, status: 'active' });
};

const writeState = (firestore, uid, key, value, { revision = 1, deleted = false, clientUpdatedAt = 1_755_684_000_000 } = {}) => firestore.doc(statePath(uid, key)).set({
  ownerUid: uid, cartularyId: ROLEX_CARTULARY_ID, key, value: deleted ? null : JSON.stringify(value), deleted, revision, clientUpdatedAt,
});

/**
 * Racine « créée depuis le Registre » par le vrai propriétaire, puis projetée (révision 2), avec
 * les montants du propriétaire (19 500 € / 20 000 €), et son brouillon : 4 clés de création plus
 * une copie éditoriale personnelle sans originTitle (5 clés).
 */
const seedRootCreatedFromRegistry = async (firestore, { publicCode = ROLEX_PUBLIC_CODE, editableCopy = OWNER_EDITABLE_COPY, withDraft = true, ownerOnlyData = false } = {}) => {
  const { organizationId, registryId } = buildRolexImportBundle().envelope;
  const media = [{ id: 'asset_rolex_main', binaryId: 'bin_rolex_main_0001', type: 'image', name: 'rolex.jpg', mimeType: 'image/jpeg', tags: ['main-photo'], storagePath: `private-drafts/${REAL_UID}/${ROLEX_CARTULARY_ID}/bin_rolex_main_0001/abc/original` }];
  const bundle = buildCreationBundle({ requestData: { cartularyId: ROLEX_CARTULARY_ID, organizationId, registryId, publicCode, ownerUid: REAL_UID }, profile: OWNER_PROFILE, media, schemaVersion: '1.6.0' });
  const imported = await importCartularyBundle({ firestore, bundle, requestId: 'create_rolex_prod_0001', actorId: REAL_UID, expectedRevision: 0, requireActiveCollection: true, occurredAt: CREATION_DATE });
  await projectRegistryItem({ firestore, cartularyId: ROLEX_CARTULARY_ID, actorId: REAL_UID, requestId: 'project_rolex_prod_0001', expectedRevision: imported.revision, occurredAt: CREATION_DATE });
  if (!withDraft) return;
  await firestore.doc(draftPath(REAL_UID)).set({ ownerUid: REAL_UID, cartularyId: ROLEX_CARTULARY_ID, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1', purgeAfter: null });
  await writeState(firestore, REAL_UID, 'cartularia-creation-profile', OWNER_PROFILE);
  await writeState(firestore, REAL_UID, 'cartularia-specification-groups', OWNER_SPECIFICATION_GROUPS);
  await writeState(firestore, REAL_UID, 'cartularia-media-assets-v3', [{ id: 'asset_rolex_main', binaryId: 'bin_rolex_main_0001', type: 'image', name: 'rolex.jpg', tags: ['main-photo'], visibility: 'Secret' }]);
  await writeState(firestore, REAL_UID, 'cartularia-public-code', publicCode);
  if (editableCopy) await writeState(firestore, REAL_UID, 'cartularia-editable-copy', editableCopy);
  if (ownerOnlyData) {
    // Données du propriétaire exclues de l'empreinte par loadDraft (live-sync-command.mjs l.12-19, l.123) : clé interdite + binaire owner_document.
    await writeState(firestore, REAL_UID, 'cartularia-owner-fields', { fullName: 'Nom du propriétaire', address: '1 rue Secrète' });
    await firestore.doc(`${draftPath(REAL_UID)}/binaries/bin_owner_doc_0001`).set({ ownerUid: REAL_UID, cartularyId: ROLEX_CARTULARY_ID, binaryId: 'bin_owner_doc_0001', kind: 'owner_document', deleted: false, revision: 1, sha256: `sha256:${'c'.repeat(64)}`, storagePath: `private-drafts/${REAL_UID}/${ROLEX_CARTULARY_ID}/bin_owner_doc_0001/abc/original`, size: 10, verified: true });
  }
};

const stateDocs = (firestore, uid) => firestore.collection(`${draftPath(uid)}/state`).get().then((snapshot) => new Map(snapshot.docs.map((document) => [document.id, document.data()])));
const actionsByKey = (plan) => Object.fromEntries(plan.state.entries.map((entry) => [entry.key, entry.action]));
const entryOf = (plan, key) => plan.state.entries.find((entry) => entry.key === key);
const moneyOf = (data) => [data.purchasePrice, data.costBasis, data.grossValuation, data.netValuation];
const chainIsValid = async (firestore) => {
  const root = (await firestore.doc(ROOT_PATH).get()).data();
  const events = (await firestore.collection(`${ROOT_PATH}/auditEvents`).get()).docs.map((document) => document.data());
  return verifyAuditChain({ events, integrityHead: root.integrityHead, integritySequence: root.integritySequence });
};
const sink = () => {
  const chunks = [];
  return { write: (text) => { chunks.push(String(text)); return true; }, text: () => chunks.join('') };
};
const runCli = async ({ firestore, argv, env = EMULATOR_ENV, ...overrides }) => {
  const stdout = sink();
  const stderr = sink();
  const { exitCode, report } = await runRolexDossierCli({ argv, env, firestore, stdout, stderr, ...applyOptions, ...overrides });
  const failure = stderr.text().trim() ? JSON.parse(stderr.text().trim()) : null;
  return { exitCode, report, stdout: stdout.text(), failure };
};
const assertNoSecretValue = (report) => {
  const exposed = JSON.stringify({ state: report.state, warnings: report.warnings, draft: report.draft, root: report.root });
  for (const pattern of SECRET_PATTERNS) assert.doesNotMatch(exposed, pattern, `valeur Secret exposée dans le rapport : ${pattern}`);
};

/* ------------------------------------------------------------------------------------------ */
/* Arguments                                                                                   */
/* ------------------------------------------------------------------------------------------ */

test('parseRolexDossierArgs : drapeaux, --key répétable ou --key=, refus de --force seul, de --key seul, d’une clé inconnue et d’une option inconnue', () => {
  const parsed = parseRolexDossierArgs(['--dry-run', '--force', '--key', 'cartularia-editable-copy', '--key=cartularia-comparables', '--key', 'cartularia-editable-copy', '--projection-keys', '--resync', '--allow-create', '--allow-remote'], { CARTULARIA_OWNER_UID: ' uid_x ', GCLOUD_PROJECT: 'p', FIRESTORE_EMULATOR_HOST: 'h' });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.options, { help: false, dryRun: true, force: true, keys: ['cartularia-editable-copy', 'cartularia-comparables'], forceKeys: ['cartularia-editable-copy', 'cartularia-comparables'], projectionOnlyKeys: [], projectionScoped: true, allowRemote: true, projectionKeys: true, resync: true, allowCreate: true, replaceStaleRequest: false, ownerUidOverride: 'uid_x', projectId: 'p', usesEmulator: true });
  // Point 3 : hors émulateur, aucun projet par défaut ; sous émulateur, le défaut du seed local reste.
  assert.deepEqual(parseRolexDossierArgs([], {}).options, { help: false, dryRun: false, force: false, keys: [], forceKeys: [], projectionOnlyKeys: [], projectionScoped: false, allowRemote: false, projectionKeys: false, resync: false, allowCreate: false, replaceStaleRequest: false, ownerUidOverride: null, projectId: null, usesEmulator: false });
  assert.equal(parseRolexDossierArgs([], EMULATOR_ENV).options.projectId, 'cartularia-wave2-local');
  assert.equal(parseRolexDossierArgs([], { FIREBASE_PROJECT_ID: ' projet-b ' }).options.projectId, 'projet-b');
  assert.equal(parseRolexDossierArgs([], { GCLOUD_PROJECT: '', FIREBASE_PROJECT_ID: 'projet-b' }).options.projectId, 'projet-b');
  assert.equal(parseRolexDossierArgs(['--replace-stale-request'], {}).options.replaceStaleRequest, true);
  assert.equal(parseRolexDossierArgs(['-h', '--oops'], {}).options.help, true, 'l’aide prime');
  assert.equal(parseRolexDossierArgs(['--force'], {}).code, 'force_requires_key');
  assert.equal(parseRolexDossierArgs(['--key', 'cartularia-editable-copy'], {}).code, 'key_requires_force');
  assert.equal(parseRolexDossierArgs(['--force', '--key', 'cartularia-inconnue'], {}).code, 'unknown_state_key');
  assert.equal(parseRolexDossierArgs(['--force', '--key'], {}).code, 'invalid_argument');
  assert.equal(parseRolexDossierArgs(['--force', '--key', '--dry-run'], {}).code, 'invalid_argument');
  assert.equal(parseRolexDossierArgs(['--dry-run', '--oops'], {}).code, 'invalid_argument');
  // Point 6 : --projection-keys --key <clé de projection> sans --force restreint la création ; une clé hors projection exige --force.
  const restricted = parseRolexDossierArgs(['--projection-keys', '--key', 'cartularia-watch-status', '--key=cartularia-purchase'], {});
  assert.deepEqual([restricted.ok, restricted.options.force, restricted.options.forceKeys, restricted.options.projectionOnlyKeys], [true, false, [], ['cartularia-watch-status', 'cartularia-purchase']]);
  assert.equal(parseRolexDossierArgs(['--projection-keys', '--key', 'cartularia-editable-copy'], {}).code, 'key_requires_force');
  const both = parseRolexDossierArgs(['--projection-keys', '--force', '--key', 'cartularia-creation-profile', '--key', 'cartularia-editable-copy'], {});
  assert.deepEqual([both.options.forceKeys, both.options.projectionOnlyKeys], [['cartularia-creation-profile', 'cartularia-editable-copy'], ['cartularia-creation-profile']]);
  assert.deepEqual(parseRolexDossierArgs(['--projection-keys'], {}).options.projectionOnlyKeys, [], 'sans --key : toutes les clés de projection');
  // Dès qu’un --key est présent avec --projection-keys, la création de clés de projection est restreinte (aucune si --key ne nomme que des clés hors projection).
  const scopedOut = parseRolexDossierArgs(['--projection-keys', '--force', '--key', 'cartularia-editable-copy'], {});
  assert.deepEqual([restricted.options.projectionScoped, both.options.projectionScoped, scopedOut.options.projectionScoped, scopedOut.options.projectionOnlyKeys, parseRolexDossierArgs(['--projection-keys'], {}).options.projectionScoped], [true, true, true, [], false]);
});

/* ------------------------------------------------------------------------------------------ */
/* Mode create (seed local)                                                                    */
/* ------------------------------------------------------------------------------------------ */

test('racine absente : import, projection, brouillon, 14 clés et synchronisation, comme la séquence de seed locale ; second passage sans effet', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [ROLEX_IMPORT_ACTOR_ID]);

  const { plan, applied, report } = await runRolexDossier({ firestore, ...applyOptions });
  assert.equal(plan.mode, 'create');
  assert.deepEqual(plan.owner, { uid: ROLEX_IMPORT_ACTOR_ID, source: 'fixture' });
  assert.equal(plan.audit, null);
  assert.equal(plan.projection, null);
  assert.deepEqual(plan.state.summary, { create: 14, update: 0, unchanged: 0, kept: 0, kept_projection: 0, conflict_with_root: 0, raced: 0 });
  assert.deepEqual(plan.sync, { expected: 'planned', reason: null });

  assert.deepEqual([applied.imported.revision, applied.imported.replayed, applied.projected.revision], [1, false, 2]);
  assert.equal(applied.draft, 'create');
  assert.equal(applied.state.summary.create, 14);
  assert.deepEqual([applied.sync.status, applied.sync.outcome, applied.sync.revision, applied.sync.processedBy], ['processed', 'updated', 3, 'script']);
  assert.match(applied.sync.requestId, /^sync_[a-z0-9_]{16,96}$/, 'requestId compatible avec les règles Firestore');

  const dump = firestore.dump();
  assert.ok(dump[`${ROOT_PATH}/commandReceipts/${ROLEX_IMPORT_REQUEST_ID}`], 'reçu d’import ADR-029');
  assert.equal(dump[ROOT_PATH].accountHolderId, ROLEX_IMPORT_ACTOR_ID);
  assert.equal(dump[ROOT_PATH].revision, 3);
  assert.deepEqual([dump[REQUEST_PATH].status, dump[REQUEST_PATH].reason], ['processed', ROLEX_SYNC_REQUEST_REASON]);
  const states = await stateDocs(firestore, ROLEX_IMPORT_ACTOR_ID);
  assert.deepEqual([...states.keys()].sort(), [...STATE_KEYS].sort());
  for (const [key, value] of FIXTURE) {
    const record = states.get(key);
    assert.deepEqual(Object.keys(record).sort(), ['cartularyId', 'clientUpdatedAt', 'deleted', 'key', 'ownerUid', 'revision', 'updatedAt', 'value'], `${key} : huit champs exactement`);
    assert.deepEqual([record.revision, record.deleted, record.value, record.ownerUid, record.clientUpdatedAt], [1, false, JSON.stringify(value), ROLEX_IMPORT_ACTOR_ID, CLOCK]);
  }
  const item = dump[ITEM_PATH];
  assert.deepEqual([item.makerName, item.modelName, item.manufactureYear, item.purchasePrice, item.costBasis, item.grossValuation, item.patrimonialStatus], ['Rolex', 'GMT-Master Mark I Long E', 1969, 21_900, 21_900, 23_000, 'Patrimonial']);
  assert.equal(Object.keys(dump).filter((path) => path.startsWith(`${ROOT_PATH}/liveState/`)).length, 14);
  assert.deepEqual((await chainIsValid(firestore)).errors, []);
  assert.deepEqual([report.event, report.ok, report.mode], ['ROLEX_CARTULARY_SEED', true, 'create']);
  assert.ok(report.state.entries.every((entry) => !('serialized' in entry) && entry.result === 'create' && entry.revision === 1));

  // Second passage : la racine existe désormais, tout est inchangé, brouillon à jour, aucune synchronisation, aucune écriture.
  const before = firestore.dump();
  const again = await runRolexDossier({ firestore, ...applyOptions });
  assert.equal(again.plan.mode, 'existing');
  assert.deepEqual(again.plan.owner, { uid: ROLEX_IMPORT_ACTOR_ID, source: 'root' });
  assert.equal(again.plan.state.summary.unchanged, 14);
  assert.equal(again.plan.draft.outOfSync, false, 'empreinte du brouillon égale à root.liveStateDigest');
  assert.deepEqual(again.plan.sync, { expected: 'skipped', reason: 'no_state_change' });
  assert.deepEqual(again.applied.sync, { status: 'skipped', reason: 'no_state_change' });
  assert.equal(again.applied.draft, 'unchanged');
  assert.equal(again.report.ok, true);
  assert.deepEqual(firestore.dump(), before);
});

/* ------------------------------------------------------------------------------------------ */
/* Mode existing : propriétaire réel, clés de projection protégées (D1), montants conservés (D8) */
/* ------------------------------------------------------------------------------------------ */

test('racine créée depuis le Registre : sans --projection-keys, les clés de projection sont kept_projection ; après synchronisation les montants de la racine et de l’item restent ceux du propriétaire', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const rootBefore = (await firestore.doc(ROOT_PATH).get()).data();
  assert.deepEqual([rootBefore.revision, ...moneyOf(rootBefore)], [2, 19_500, 19_500, 20_000, null], 'seed : montants du propriétaire, différents de la fixture');
  assert.equal(rootBefore.liveStateDigest, undefined);

  const { plan, applied, report } = await runRolexDossier({ firestore, ...applyOptions });
  assert.equal(plan.mode, 'existing');
  assert.deepEqual(plan.owner, { uid: REAL_UID, source: 'root' });
  assert.deepEqual([plan.root.revision, plan.root.accountHolderId, plan.root.publicCode], [2, REAL_UID, ROLEX_PUBLIC_CODE]);
  assert.equal(plan.audit.valid, true);
  assert.equal(plan.draft.action, 'unchanged');
  assert.deepEqual(plan.state.summary, { create: 6, update: 0, unchanged: 1, kept: 1, kept_projection: 6, conflict_with_root: 0, raced: 0 });
  const actions = actionsByKey(plan);
  assert.deepEqual(PROJECTION_DRIVING_STATE_KEYS.map((key) => actions[key]), Array(6).fill('kept_projection'));
  assert.deepEqual([actions['cartularia-public-code'], actions['cartularia-editable-copy'], actions['cartularia-comparables']], ['unchanged', 'kept', 'create']);
  assert.ok(plan.state.entries.every((entry) => entry.drivesProjection === PROJECTION_DRIVING_STATE_KEYS.includes(entry.key)));
  assert.deepEqual(plan.warnings.map((warning) => warning.code), ['first_authoritative_sync', 'keys_kept_without_force', 'projection_keys_kept']);
  assert.deepEqual(plan.warnings[2].keys.sort(), [...PROJECTION_DRIVING_STATE_KEYS].sort());
  assert.deepEqual([plan.firstAuthoritativeSync, plan.genericOperationPending], [true, null]);
  assert.deepEqual(plan.sync, { expected: 'planned', reason: null });

  assert.equal(applied.imported, null);
  assert.equal(applied.projected, null);
  assert.equal(applied.draft, 'unchanged');
  assert.deepEqual(applied.state.summary, { create: 6, update: 0, unchanged: 1, kept: 1, kept_projection: 6, conflict_with_root: 0, raced: 0 });
  assert.deepEqual([applied.sync.status, applied.sync.outcome, applied.sync.revision], ['processed', 'updated', 3]);

  const dump = firestore.dump();
  assert.equal(dump[`${ROOT_PATH}/commandReceipts/${ROLEX_IMPORT_REQUEST_ID}`], undefined, 'aucun reçu ADR-029 créé');
  assert.equal(dump[ROOT_PATH].accountHolderId, REAL_UID);
  assert.equal(dump[ROOT_PATH].revision, 3);
  assert.deepEqual(moneyOf(dump[ROOT_PATH]), [19_500, 19_500, 20_000, null], 'racine : montants du propriétaire conservés');
  assert.deepEqual(moneyOf(dump[ITEM_PATH]), [19_500, 19_500, 20_000, null], 'item Registre : montants du propriétaire conservés');
  assert.equal(dump[draftPath(ROLEX_IMPORT_ACTOR_ID)], undefined, 'aucun brouillon fantôme wave1-owner');
  const states = await stateDocs(firestore, REAL_UID);
  assert.equal(states.size, 11, '5 clés du propriétaire + 6 clés ajoutées');
  for (const key of PROJECTION_DRIVING_STATE_KEYS) assert.equal(states.has(key), ['cartularia-creation-profile', 'cartularia-specification-groups'].includes(key), `${key} : ni créée ni réécrite`);
  assert.equal(states.get('cartularia-creation-profile').value, JSON.stringify(OWNER_PROFILE), 'le profil du propriétaire est conservé');
  assert.equal(states.get('cartularia-editable-copy').value, JSON.stringify(OWNER_EDITABLE_COPY), 'la copie éditoriale du propriétaire est conservée');
  assert.deepEqual([states.get('cartularia-comparables').revision, states.get('cartularia-comparables').ownerUid, states.get('cartularia-comparables').clientUpdatedAt], [1, REAL_UID, CLOCK]);
  assert.deepEqual([dump[REQUEST_PATH].status, dump[REQUEST_PATH].ownerUid, dump[REQUEST_PATH].reason], ['processed', REAL_UID, ROLEX_SYNC_REQUEST_REASON]);
  assert.equal(typeof dump[ROOT_PATH].liveStateDigest, 'string');
  assert.deepEqual((await chainIsValid(firestore)).errors, []);
  assert.equal(report.state.entries.find((entry) => entry.key === 'cartularia-purchase').result, 'kept_projection');
  assert.equal(report.ok, true);
  assertNoSecretValue(report);

  // Point 3 (m90) : le bloc projection est présent dans le rapport d'EXÉCUTION, avec les champs réellement portés après synchronisation.
  assert.ok(report.projection, 'bloc projection dans le rapport appliqué');
  assert.deepEqual(report.projection.changesAfterPlan, []);
  assert.deepEqual(report.projection.classification, 'Secret');
  for (const field of PROJECTION_FIELDS) {
    assert.deepEqual(dump[ROOT_PATH][field] ?? null, report.projection.afterPlan[field], `racine.${field} égale à afterPlan`);
    assert.deepEqual(dump[ITEM_PATH][field] ?? null, report.projection.afterPlan[field], `item.${field} égale à afterPlan`);
  }
  assert.deepEqual(report.projection.applied, { root: report.projection.afterPlan, registryItem: report.projection.afterPlan, revision: 3, changesFromCurrent: [], matchesAfterPlan: true });
  assert.deepEqual(moneyOf(report.projection.applied.root), [19_500, 19_500, 20_000, null]);
});

test('--projection-keys : les clés de projection absentes sont créées, celles du propriétaire restent kept ; la synchronisation recalcule les montants (19 500 → 21 900, 20 000 → 23 000) exactement comme l’aperçu du plan l’annonçait', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);

  const dry = await runRolexDossier({ firestore, dryRun: true, projectionKeys: true });
  assert.deepEqual(dry.plan.state.summary, { create: 10, update: 0, unchanged: 1, kept: 3, kept_projection: 0, conflict_with_root: 0, raced: 0 });
  const actions = actionsByKey(dry.plan);
  assert.deepEqual([actions['cartularia-creation-profile'], actions['cartularia-specification-groups'], actions['cartularia-editable-copy'], actions['cartularia-purchase'], actions['cartularia-retained-valuation']], ['kept', 'kept', 'kept', 'create', 'create']);
  assert.deepEqual(dry.plan.warnings.map((warning) => warning.code), ['first_authoritative_sync', 'keys_kept_without_force', 'projection_will_change']);
  assert.deepEqual(dry.plan.warnings[2].keys, ['cartularia-watch-status', 'cartularia-retained-valuation', 'cartularia-purchase', 'cartularia-purchase-expenses']);
  const { projection } = dry.plan;
  assert.deepEqual(projection.fields, [...PROJECTION_FIELDS]);
  assert.deepEqual(moneyOf(projection.current), [19_500, 19_500, 20_000, null]);
  assert.deepEqual(moneyOf(projection.registryItem), [19_500, 19_500, 20_000, null]);
  assert.deepEqual(moneyOf(projection.afterPlan), [21_900, 21_900, 23_000, 23_000]);
  assert.deepEqual([projection.afterPlan.makerName, projection.afterPlan.modelName, projection.afterPlan.manufactureYear, projection.afterPlan.patrimonialStatus, projection.afterPlan.valuationCurrency], ['Rolex', 'GMT-Master Mark I Long E', 1969, 'Patrimonial', 'EUR']);
  assert.deepEqual(projection.changesAfterPlan, ['purchasePrice', 'costBasis', 'grossValuation', 'netValuation']);

  const { applied } = await runRolexDossier({ firestore, projectionKeys: true, ...applyOptions });
  assert.deepEqual([applied.sync.status, applied.sync.revision], ['processed', 3]);
  const dump = firestore.dump();
  for (const field of PROJECTION_FIELDS) {
    assert.deepEqual(dump[ROOT_PATH][field], projection.afterPlan[field], `racine.${field} conforme à l’aperçu`);
    assert.deepEqual(dump[ITEM_PATH][field], projection.afterPlan[field], `item.${field} conforme à l’aperçu`);
  }
  const states = await stateDocs(firestore, REAL_UID);
  assert.equal(states.size, 15);
  assert.equal(states.get('cartularia-creation-profile').value, JSON.stringify(OWNER_PROFILE), 'profil du propriétaire toujours conservé');
  assert.equal(states.get('cartularia-purchase').value, JSON.stringify(FIXTURE.get('cartularia-purchase')));
  assert.deepEqual((await chainIsValid(firestore)).errors, []);
});

/* ------------------------------------------------------------------------------------------ */
/* Simulation et rapport clé par clé (D3)                                                      */
/* ------------------------------------------------------------------------------------------ */

test('mode simulation : aucune écriture ; empreintes, tailles et champs différents exposés pour kept / kept_projection / unchanged, jamais les valeurs ; aperçu de projection current / afterPlan / ifFixture', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const before = firestore.dump();

  const { plan, applied, report } = await runRolexDossier({ firestore, dryRun: true, projectId: 'projet-test', usesEmulator: false });
  assert.equal(applied, null);
  assert.deepEqual(firestore.dump(), before);
  assert.deepEqual([report.dryRun, report.force, report.projectId, report.usesEmulator, report.ok], [true, false, 'projet-test', false, true]);
  assert.deepEqual(report.sync, { status: 'dry_run', expected: 'planned', reason: null });
  assert.ok(report.state.entries.every((entry) => entry.result === null && !('serialized' in entry)));
  assert.ok(report.state.entries.every((entry) => /^[0-9a-f]{12}$/.test(entry.fixtureDigest) && entry.fixtureBytes > 0));
  assertNoSecretValue(report);

  const profile = entryOf(plan, 'cartularia-creation-profile');
  assert.equal(profile.action, 'kept_projection');
  assert.match(profile.existingDigest, /^[0-9a-f]{12}$/);
  assert.notEqual(profile.existingDigest, profile.fixtureDigest);
  assert.ok(profile.existingBytes > 0);
  assert.deepEqual(profile.differingFields, ['assertedAt', 'purchasePrice', 'seller', 'valuationHigh', 'valuationLow', 'valuationMid']);
  assert.deepEqual(profile.existing, { revision: 1, clientUpdatedAt: 1_755_684_000_000, deleted: false });

  const copy = entryOf(plan, 'cartularia-editable-copy');
  assert.equal(copy.action, 'kept');
  assert.deepEqual(copy.differingFields, ['conditionFacts', 'conditionSummary', 'heroSummary', 'originKnowledge', 'originParagraphs', 'originTitle', 'watchDescription']);

  const groups = entryOf(plan, 'cartularia-specification-groups');
  assert.deepEqual([groups.action, groups.differingFields, groups.existingLength, groups.fixtureLength], ['kept_projection', ['length'], 1, 6]);

  const code = entryOf(plan, 'cartularia-public-code');
  assert.deepEqual([code.action, code.existingDigest === code.fixtureDigest, code.differingFields], ['unchanged', true, []]);

  const absent = entryOf(plan, 'cartularia-purchase');
  assert.deepEqual([absent.action, absent.existingDigest, absent.existingBytes, absent.differingFields, absent.existing], ['kept_projection', null, null, null, null]);

  const { projection } = plan;
  assert.deepEqual(moneyOf(projection.current), [19_500, 19_500, 20_000, null]);
  assert.deepEqual(moneyOf(projection.afterPlan), [19_500, 19_500, 20_000, null], 'sans --projection-keys, rien ne change');
  assert.deepEqual(projection.changesAfterPlan, []);
  assert.deepEqual(moneyOf(projection.ifFixture), [21_900, 21_900, 23_000, 23_000]);
  assert.deepEqual(projection.changesIfFixture, ['purchasePrice', 'costBasis', 'grossValuation', 'netValuation']);
});

test('valeur égale mais sérialisée dans un autre ordre de clés : unchanged (comparaison canonique)', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const reordered = Object.fromEntries(Object.entries(FIXTURE.get('cartularia-market-depth')).reverse());
  await writeState(firestore, REAL_UID, 'cartularia-market-depth', reordered);
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(FIXTURE.get('cartularia-market-depth')));
  const plan = await planRolexDossier({ firestore });
  assert.equal(entryOf(plan, 'cartularia-market-depth').action, 'unchanged');
});

/* ------------------------------------------------------------------------------------------ */
/* --force --key (D2, D8)                                                                      */
/* ------------------------------------------------------------------------------------------ */

test('--force --key cartularia-editable-copy : seule cette clé est réécrite (revision 2), le warning documente la perte des textes du propriétaire ; sans --key elle reste kept', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);

  await runRolexDossier({ firestore, ...applyOptions });
  let states = await stateDocs(firestore, REAL_UID);
  assert.equal(states.get('cartularia-editable-copy').value, JSON.stringify(OWNER_EDITABLE_COPY), 'sans --key, les textes du propriétaire restent');

  const forced = await runRolexDossier({ firestore, forceKeys: ['cartularia-editable-copy'], ...applyOptions });
  assert.deepEqual(forced.plan.state.summary, { create: 0, update: 1, unchanged: 7, kept: 0, kept_projection: 6, conflict_with_root: 0, raced: 0 });
  const warning = forced.plan.warnings.find((candidate) => candidate.code === 'keys_forced');
  assert.deepEqual(warning.keys, [{ key: 'cartularia-editable-copy', differingFields: ['conditionFacts', 'conditionSummary', 'heroSummary', 'originKnowledge', 'originParagraphs', 'originTitle', 'watchDescription'], existingDeleted: false }]);
  assert.match(warning.message, /textes du propriétaire .*perdus/);
  assert.equal(forced.applied.state.summary.update, 1);
  states = await stateDocs(firestore, REAL_UID);
  assert.deepEqual([states.get('cartularia-editable-copy').revision, states.get('cartularia-editable-copy').value], [2, JSON.stringify(FIXTURE.get('cartularia-editable-copy'))]);
  assert.equal(states.get('cartularia-creation-profile').value, JSON.stringify(OWNER_PROFILE), 'les autres clés du propriétaire restent');
  assert.equal(states.get('cartularia-specification-groups').revision, 1);
  assert.equal(states.get('cartularia-comparables').revision, 1, 'clé créée au premier passage intacte');
  assert.deepEqual([forced.applied.sync.status, forced.applied.sync.revision], ['processed', 4]);
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [19_500, 19_500, 20_000, null], 'montants intacts');
  assert.deepEqual((await chainIsValid(firestore)).errors, []);
});

test('--force --key sur une clé de projection : sans --projection-keys elle reste kept_projection (force_key_without_effect) ; avec, elle est réécrite', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);

  const guarded = await planRolexDossier({ firestore, forceKeys: ['cartularia-creation-profile'] });
  assert.equal(entryOf(guarded, 'cartularia-creation-profile').action, 'kept_projection');
  assert.deepEqual(guarded.warnings.find((warning) => warning.code === 'force_key_without_effect').keys, [{ key: 'cartularia-creation-profile', action: 'kept_projection' }]);

  const forced = await runRolexDossier({ firestore, forceKeys: ['cartularia-creation-profile'], projectionKeys: true, ...applyOptions });
  assert.equal(entryOf(forced.plan, 'cartularia-creation-profile').action, 'update');
  assert.equal(entryOf(forced.plan, 'cartularia-specification-groups').action, 'kept');
  const states = await stateDocs(firestore, REAL_UID);
  assert.deepEqual([states.get('cartularia-creation-profile').revision, states.get('cartularia-creation-profile').value], [2, JSON.stringify(FIXTURE.get('cartularia-creation-profile'))]);
  assert.deepEqual([states.get('cartularia-specification-groups').revision, states.get('cartularia-specification-groups').value], [1, JSON.stringify(OWNER_SPECIFICATION_GROUPS)]);
});

test('clé d’état supprimée (deleted:true) : kept sans --key, réécrite avec --force --key', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await writeState(firestore, REAL_UID, 'cartularia-comparables', null, { deleted: true, revision: 3 });

  const plan = await planRolexDossier({ firestore });
  const entry = entryOf(plan, 'cartularia-comparables');
  assert.deepEqual([entry.action, entry.existing, entry.existingDigest, entry.differingFields], ['kept', { revision: 3, clientUpdatedAt: 1_755_684_000_000, deleted: true }, null, null]);
  await applyRolexDossier({ firestore, plan, ...applyOptions });
  assert.deepEqual([(await stateDocs(firestore, REAL_UID)).get('cartularia-comparables').deleted, (await stateDocs(firestore, REAL_UID)).get('cartularia-comparables').revision], [true, 3]);

  const forced = await runRolexDossier({ firestore, forceKeys: ['cartularia-comparables'], ...applyOptions });
  assert.equal(entryOf(forced.plan, 'cartularia-comparables').action, 'update');
  const record = (await stateDocs(firestore, REAL_UID)).get('cartularia-comparables');
  assert.deepEqual([record.deleted, record.revision, record.value], [false, 4, JSON.stringify(FIXTURE.get('cartularia-comparables'))]);
});

test('code public de la racine différent de la fixture : cartularia-public-code n’est jamais écrite, même avec --force --key', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore, { publicCode: 'ROL-AUTRE001' });

  const { plan, applied } = await runRolexDossier({ firestore, forceKeys: ['cartularia-public-code'], ...applyOptions });
  assert.deepEqual(plan.state.summary, { create: 6, update: 0, unchanged: 0, kept: 1, kept_projection: 6, conflict_with_root: 1, raced: 0 });
  const entry = entryOf(plan, 'cartularia-public-code');
  assert.deepEqual([entry.action, entry.rootPublicCode, entry.differingFields], ['conflict_with_root', 'ROL-AUTRE001', ['value']]);
  assert.match(plan.warnings.find((warning) => warning.code === 'public_code_conflict_with_root').message, /Attendu en production/);
  assert.deepEqual(plan.warnings.find((warning) => warning.code === 'force_key_without_effect').keys, [{ key: 'cartularia-public-code', action: 'conflict_with_root' }]);
  assert.equal(applied.state.results.find((result) => result.key === 'cartularia-public-code').result, 'conflict_with_root');
  const states = await stateDocs(firestore, REAL_UID);
  assert.deepEqual([states.get('cartularia-public-code').revision, states.get('cartularia-public-code').value], [1, JSON.stringify('ROL-AUTRE001')]);
  assert.equal((await firestore.doc(ROOT_PATH).get()).data().publicCode, 'ROL-AUTRE001');
});

/* ------------------------------------------------------------------------------------------ */
/* Gardes (D8)                                                                                 */
/* ------------------------------------------------------------------------------------------ */

test('gardes du plan : Cartulaire supprimé, propriétaire inconnu (aucun repli fixture), brouillon d’un autre propriétaire, brouillon supprimé — refus sans écriture', async () => {
  const base = async () => {
    const firestore = createMemoryFirestore();
    await seedFoundations(firestore, [REAL_UID, ROLEX_IMPORT_ACTOR_ID]);
    await seedRootCreatedFromRegistry(firestore);
    return firestore;
  };
  const rejects = async (firestore, code, options = {}) => {
    const before = firestore.dump();
    await assert.rejects(runRolexDossier({ firestore, ...applyOptions, ...options }), (error) => error.code === code, code);
    assert.deepEqual(firestore.dump(), before, `${code} : aucune écriture`);
  };

  const deleted = await base();
  await deleted.doc(ROOT_PATH).set({ deletedAt: '2026-09-01T00:00:00.000Z' }, { merge: true });
  await rejects(deleted, 'cartulary_deleted');

  const unknown = await base();
  await unknown.doc(ROOT_PATH).set({ accountHolderId: null }, { merge: true });
  await rejects(unknown, 'owner_unknown');
  assert.equal(unknown.dump()[draftPath(ROLEX_IMPORT_ACTOR_ID)], undefined, 'jamais de repli sur wave1-owner');
  await rejects(unknown, 'owner_unknown', { ownerUidOverride: ROLEX_IMPORT_ACTOR_ID });

  const foreign = await base();
  await foreign.doc(draftPath(REAL_UID)).set({ ownerUid: 'uid_autre_personne' }, { merge: true });
  await rejects(foreign, 'draft_owner_mismatch');

  const removed = await base();
  await removed.doc(draftPath(REAL_UID)).set({ status: 'deleted' }, { merge: true });
  await rejects(removed, 'draft_deleted');
});

test('CARTULARIA_OWNER_UID différent du propriétaire de la racine (ou de la fixture) : refus sans écriture ; identique : accepté (source env)', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID, ROLEX_IMPORT_ACTOR_ID]);
  const emptyBefore = firestore.dump();
  await assert.rejects(runRolexDossier({ firestore, ownerUidOverride: 'quelqu-un-d-autre', ...applyOptions }), (error) => error.code === 'owner_mismatch');
  assert.deepEqual(firestore.dump(), emptyBefore);

  await seedRootCreatedFromRegistry(firestore);
  const before = firestore.dump();
  await assert.rejects(runRolexDossier({ firestore, ownerUidOverride: ROLEX_IMPORT_ACTOR_ID, ...applyOptions }), (error) => error.code === 'owner_mismatch');
  assert.deepEqual(firestore.dump(), before);
  const explicit = await planRolexDossier({ firestore, ownerUidOverride: REAL_UID });
  assert.deepEqual(explicit.owner, { uid: REAL_UID, source: 'env' });
});

test('brouillon relu à l’application : supprimé entre le plan et l’application → refus avant toute écriture ; racine modifiée → plan_stale', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);

  const plan = await planRolexDossier({ firestore });
  await firestore.doc(draftPath(REAL_UID)).set({ status: 'deleted' }, { merge: true });
  const before = firestore.dump();
  await assert.rejects(applyRolexDossier({ firestore, plan, ...applyOptions }), (error) => error.code === 'draft_not_ready');
  assert.deepEqual(firestore.dump(), before);

  await firestore.doc(draftPath(REAL_UID)).set({ status: 'active' }, { merge: true });
  const stale = await planRolexDossier({ firestore });
  await firestore.doc(ROOT_PATH).set({ revision: 99 }, { merge: true });
  await assert.rejects(applyRolexDossier({ firestore, plan: stale, ...applyOptions }), (error) => error.code === 'plan_stale');
});

test('course avec le lecteur : une clé poussée entre le plan et l’application est sautée (raced) ; clientUpdatedAt vient de l’horloge injectée (entier > 0)', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);

  const plan = await planRolexDossier({ firestore });
  await writeState(firestore, REAL_UID, 'cartularia-comparables', [{ id: 'saisie-du-proprietaire' }], { clientUpdatedAt: 2 });
  const applied = await applyRolexDossier({ firestore, plan, ...applyOptions });
  assert.equal(applied.state.results.find((result) => result.key === 'cartularia-comparables').result, 'raced');
  assert.deepEqual([applied.state.summary.raced, applied.state.summary.create], [1, 5]);
  // Point 8 : une clé prévue non écrite est signalée et le rapport appliqué est ok:false.
  const report = describeRolexDossierRun({ plan, applied });
  assert.deepEqual([report.ok, report.warnings.find((warning) => warning.code === 'keys_raced')?.keys], [false, ['cartularia-comparables']]);
  const states = await stateDocs(firestore, REAL_UID);
  assert.deepEqual([states.get('cartularia-comparables').revision, states.get('cartularia-comparables').value], [1, JSON.stringify([{ id: 'saisie-du-proprietaire' }])]);
  for (const key of ['cartularia-identification-checks', 'cartularia-market-depth']) {
    const record = states.get(key);
    assert.ok(Number.isInteger(record.clientUpdatedAt) && record.clientUpdatedAt > 0);
    assert.equal(record.clientUpdatedAt, CLOCK, `${key} : horloge injectée`);
  }
  assert.equal(applied.sync.status, 'processed');
});

test('horloge injectée invalide (clientUpdatedAt ≤ 0) : écriture refusée, aucune clé écrite', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const plan = await planRolexDossier({ firestore });
  const before = firestore.dump();
  await assert.rejects(applyRolexDossier({ firestore, plan, ...applyOptions, now: () => 0 }), (error) => error.code === 'invalid_clock');
  assert.deepEqual(firestore.dump(), before);
});

test('chaîne d’audit invalide : signalée en simulation, application refusée avant toute écriture', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await firestore.doc(ROOT_PATH).set({ integrityHead: `sha256:${'f'.repeat(64)}` }, { merge: true });
  const before = firestore.dump();
  const plan = await planRolexDossier({ firestore });
  assert.equal(plan.audit.valid, false);
  assert.deepEqual(plan.sync, { expected: 'blocked', reason: 'audit_chain_invalid' });
  assert.equal(plan.warnings[0].code, 'audit_chain_invalid');
  await assert.rejects(applyRolexDossier({ firestore, plan, ...applyOptions }), (error) => error.code === 'audit_chain_invalid');
  assert.deepEqual(firestore.dump(), before);
  // Points 7 et 19 : la simulation rend le même verdict que l'exécution (ok:false, exit 1).
  assert.equal(describeRolexDossierRun({ plan, projectId: 'p' }).ok, false, 'un rapport de simulation bloqué est ok:false');
  const dry = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.ok, dry.report.sync], [1, false, { status: 'dry_run', expected: 'blocked', reason: 'audit_chain_invalid' }]);
  assert.deepEqual(firestore.dump(), before);
});

/* ------------------------------------------------------------------------------------------ */
/* Synchronisation (D4, D7, point 1)                                                           */
/* ------------------------------------------------------------------------------------------ */

test('point 1 : demande de synchronisation en cours (pending) alors que des clés sont à écrire → plan blocked (request_in_flight), dry-run exit 1, application refusée avant toute écriture, demande du lecteur intacte', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const pending = foreignRequest({ status: 'pending', ageMs: 30_000 });
  await firestore.doc(REQUEST_PATH).set(pending);
  const before = firestore.dump();

  const dry = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.ok, dry.report.sync], [1, false, { status: 'dry_run', expected: 'blocked', reason: 'request_in_flight' }]);
  assert.deepEqual(dry.report.syncRequest, { exists: true, status: 'pending', requestId: pending.requestId, reason: 'private_draft_synchronized', inFlight: true, ageMs: 30_000, stale: false, failed: false, errorCode: null, errorMessage: null });
  const warning = dry.report.warnings.find((candidate) => candidate.code === 'sync_request_in_flight');
  assert.deepEqual([warning.blocking, warning.replace, warning.stale], [true, false, false]);
  assert.match(warning.message, /--replace-stale-request/);

  const refused = await runCli({ firestore, argv: ['--allow-remote'], env: REMOTE_ENV });
  assert.deepEqual([refused.exitCode, refused.failure.code, refused.report], [1, 'request_in_flight', null]);
  assert.deepEqual(firestore.dump(), before, 'rien n’est écrit tant qu’une demande est en cours');
  assert.equal((await stateDocs(firestore, REAL_UID)).size, 5);

  // --resync seul ne force pas : même refus.
  const resync = await runCli({ firestore, argv: ['--allow-remote', '--resync'], env: REMOTE_ENV });
  assert.deepEqual([resync.exitCode, resync.failure.code], [1, 'request_in_flight']);
  // --replace-stale-request sur une demande récente (30 s < 15 min) : toujours bloqué, ancienneté expliquée.
  const young = await runCli({ firestore, argv: ['--dry-run', '--replace-stale-request'], env: REMOTE_ENV });
  assert.deepEqual([young.exitCode, young.report.sync.expected, young.report.sync.reason, young.report.flags.replaceStaleRequest], [1, 'blocked', 'request_in_flight', true]);
  assert.match(young.report.warnings.find((candidate) => candidate.code === 'sync_request_in_flight').message, /sans effet/);
  assert.deepEqual(firestore.dump(), before);
});

test('point 1 : demande en cours mais rien à synchroniser (brouillon déjà synchronisé, aucune clé à écrire) → skipped non bloquant, ok:true, demande intacte', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await runRolexDossier({ firestore, ...applyOptions });
  const pending = foreignRequest({ status: 'pending', ageMs: 5_000 });
  await firestore.doc(REQUEST_PATH).set(pending);
  const before = firestore.dump();

  const { plan, applied, report } = await runRolexDossier({ firestore, ...applyOptions });
  assert.deepEqual([plan.state.summary.create, plan.draft.outOfSync, plan.syncRequired], [0, false, false]);
  assert.deepEqual(plan.sync, { expected: 'skipped', reason: 'request_in_flight' });
  assert.equal(plan.warnings.find((candidate) => candidate.code === 'sync_request_in_flight').blocking, false);
  assert.deepEqual(applied.sync, { status: 'skipped', reason: 'no_state_change' });
  assert.equal(report.ok, true);
  assert.deepEqual(firestore.dump(), before);
});

test('point 1 : demande bloquée (pending ancienne, processing sans issue) → sync_required bloqué sans drapeau ; --replace-stale-request la remplace après le seuil et synchronise (pending et processing)', async () => {
  for (const status of ['pending', 'processing']) {
    const firestore = createMemoryFirestore();
    await seedFoundations(firestore, [REAL_UID]);
    await seedRootCreatedFromRegistry(firestore);
    await runRolexDossier({ firestore, ...applyOptions });
    // Le lecteur pousse une clé puis sa demande reste bloquée (Cloud Function tuée, retry:false).
    await writeState(firestore, REAL_UID, 'cartularia-todos', [{ id: 'todo-1', text: 'Faire réviser', dueAt: '2026-12-01', status: 'planned' }]);
    const stuck = foreignRequest({ status, ageMs: STALE_SYNC_REQUEST_MS + 1_000, requestId: 'sync_client_bloquee_00000000001' });
    await firestore.doc(REQUEST_PATH).set(stuck);
    const before = firestore.dump();

    const blocked = await runCli({ firestore, argv: ['--dry-run', '--resync'], env: REMOTE_ENV });
    assert.deepEqual([blocked.exitCode, blocked.report.syncRequired, blocked.report.draft.outOfSync, blocked.report.sync], [1, true, true, { status: 'dry_run', expected: 'blocked', reason: 'request_in_flight' }], status);
    assert.deepEqual([blocked.report.syncRequest.status, blocked.report.syncRequest.stale, blocked.report.syncRequest.ageMs], [status, true, STALE_SYNC_REQUEST_MS + 1_000]);
    const refused = await runCli({ firestore, argv: ['--allow-remote', '--resync'], env: REMOTE_ENV });
    assert.deepEqual([refused.exitCode, refused.failure.code], [1, 'request_in_flight'], status);
    assert.deepEqual(firestore.dump(), before);

    const dry = await runCli({ firestore, argv: ['--dry-run', '--resync', '--replace-stale-request'], env: REMOTE_ENV });
    assert.deepEqual([dry.exitCode, dry.report.ok, dry.report.sync], [0, true, { status: 'dry_run', expected: 'planned', reason: 'replace_stale_request' }], status);
    assert.equal(dry.report.warnings.find((candidate) => candidate.code === 'sync_request_in_flight').replace, true);
    assert.deepEqual(firestore.dump(), before, 'simulation sans écriture');

    const replaced = await runCli({ firestore, argv: ['--allow-remote', '--resync', '--replace-stale-request'], env: REMOTE_ENV });
    assert.deepEqual([replaced.exitCode, replaced.report.ok, replaced.report.state.applied.create, replaced.report.sync.status, replaced.report.sync.outcome, replaced.report.sync.revision, replaced.report.sync.replacedRequestId], [0, true, 0, 'processed', 'updated', 4, stuck.requestId], status);
    const request = firestore.dump()[REQUEST_PATH];
    assert.deepEqual([request.status, request.reason, request.requestId === stuck.requestId], ['processed', ROLEX_SYNC_REQUEST_REASON, false]);
    assert.equal(firestore.dump()[`${ROOT_PATH}/reminders/todo-1`].title, 'Faire réviser', 'l’édition du propriétaire est projetée');
    assert.equal((await runRolexDossier({ firestore, ...applyOptions })).plan.draft.outOfSync, false);
  }
});

test('point 1 : --replace-stale-request relit l’ancienneté dans la transaction : une demande fraîche apparue entre le plan (bloquée, ancienne) et l’application n’est pas remplacée → blocked, ok:false', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await runRolexDossier({ firestore, ...applyOptions });
  await writeState(firestore, REAL_UID, 'cartularia-todos', [{ id: 'todo-1', text: 'Faire réviser', dueAt: '2026-12-01', status: 'planned' }]);
  await firestore.doc(REQUEST_PATH).set(foreignRequest({ status: 'processing', ageMs: STALE_SYNC_REQUEST_MS * 2, requestId: 'sync_client_bloquee_00000000001' }));
  const fresh = foreignRequest({ status: 'pending', ageMs: 2_000, requestId: 'sync_client_fraiche_00000000002' });
  let armed = false;
  const wrapped = { ...firestore, runTransaction: async (operation) => firestore.runTransaction(async (transaction) => operation({ ...transaction, get: async (ref) => { if (armed && ref.path === REQUEST_PATH) { await firestore.doc(REQUEST_PATH).set(fresh); armed = false; } return transaction.get(ref); } })) };

  const plan = await planRolexDossier({ firestore: wrapped, resync: true, replaceStaleRequest: true, ...applyOptions });
  assert.deepEqual([plan.syncRequest.stale, plan.sync], [true, { expected: 'planned', reason: 'replace_stale_request' }]);
  armed = true;
  const applied = await applyRolexDossier({ firestore: wrapped, plan, ...applyOptions });
  assert.deepEqual([applied.sync.status, applied.sync.reason, applied.sync.requestId, applied.sync.requestStatus, applied.sync.ageMs], ['blocked', 'request_in_flight', fresh.requestId, 'pending', 2_000]);
  assert.equal(describeRolexDossierRun({ plan, applied }).ok, false);
  const current = (await firestore.doc(REQUEST_PATH).get()).data();
  assert.deepEqual([current.requestId, current.status], [fresh.requestId, 'pending'], 'la demande fraîche du lecteur est intacte');
});

test('point 1 : demande apparue entre le plan et l’application → clés écrites mais synchronisation non demandée : sync blocked, warning bloquant, ok:false, exit 1 ; la relance signale sync_required', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const pending = foreignRequest({ status: 'pending', ageMs: 1_000 });
  let armed = false;
  const wrapped = { ...firestore, runTransaction: async (operation) => firestore.runTransaction(async (transaction) => operation({ ...transaction, get: async (ref) => { if (armed && ref.path === REQUEST_PATH) { await firestore.doc(REQUEST_PATH).set(pending); armed = false; } return transaction.get(ref); } })) };

  const plan = await planRolexDossier({ firestore: wrapped, ...applyOptions });
  assert.deepEqual(plan.sync, { expected: 'planned', reason: null });
  armed = true;
  const applied = await applyRolexDossier({ firestore: wrapped, plan, ...applyOptions });
  assert.deepEqual([applied.state.summary.create, applied.sync.status, applied.sync.reason, applied.sync.requestId, applied.sync.requestStatus], [6, 'blocked', 'request_in_flight', pending.requestId, 'pending']);
  const report = describeRolexDossierRun({ plan, applied });
  assert.equal(report.ok, false);
  const warning = report.warnings.find((candidate) => candidate.code === 'sync_request_in_flight');
  assert.deepEqual([warning.blocking, warning.status], [true, 'pending']);
  assert.match(warning.message, /6 clé\(s\) ont été écrites/);
  const current = (await firestore.doc(REQUEST_PATH).get()).data();
  assert.deepEqual([current.status, current.requestId, current.reason], ['pending', pending.requestId, 'private_draft_synchronized'], 'la demande du lecteur est intacte');
  assert.equal((await firestore.doc(ROOT_PATH).get()).data().revision, 2, 'pas de synchronisation');

  // La demande étrangère se termine : le brouillon est en avance sur root.liveStateDigest ? La racine n'a pas encore de liveStateDigest → la relance passe par sync_required uniquement si la racine a été synchronisée ; ici, elle planifie la synchronisation avec --resync.
  await firestore.doc(REQUEST_PATH).set({ ...pending, status: 'processed' });
  const relaunch = await runCli({ firestore, argv: ['--allow-remote', '--resync'], env: REMOTE_ENV });
  assert.deepEqual([relaunch.exitCode, relaunch.report.sync.status, relaunch.report.sync.revision], [0, 'processed', 3]);
});

test('échec du traitement : la demande est marquée failed, ok:false ; la relance signale sync_request_failed et exige --resync sans écriture (ok:false), puis --resync synchronise', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const boom = Object.assign(new Error('quota atteint'), { code: 'rate_limited' });

  const first = await runRolexDossier({ firestore, ...applyOptions, processSyncRequest: async () => { throw boom; } });
  assert.deepEqual([first.applied.sync.status, first.applied.sync.code, first.applied.sync.processedBy], ['failed', 'rate_limited', 'script']);
  assert.equal(first.report.ok, false);
  const request = (await firestore.doc(REQUEST_PATH).get()).data();
  assert.deepEqual([request.status, request.errorCode, request.requestId], ['failed', 'rate_limited', first.applied.sync.requestId]);
  assert.equal((await stateDocs(firestore, REAL_UID)).size, 11, 'les clés ont bien été écrites avant l’échec');

  // Point 1 : la relance ne conclut plus no_state_change / ok:true.
  const relaunch = await runRolexDossier({ firestore, ...applyOptions });
  assert.deepEqual([relaunch.plan.syncRequest.failed, relaunch.plan.syncRequest.errorCode, relaunch.plan.syncRequired], [true, 'rate_limited', true]);
  assert.deepEqual(relaunch.plan.sync, { expected: 'required', reason: 'sync_required' });
  assert.deepEqual(relaunch.plan.warnings.map((warning) => warning.code), ['sync_request_failed', 'sync_required', 'first_authoritative_sync', 'keys_kept_without_force', 'projection_keys_kept']);
  assert.deepEqual(relaunch.applied.sync, { status: 'not_requested', reason: 'sync_required' });
  assert.equal(relaunch.report.ok, false);
  assert.equal((await firestore.doc(REQUEST_PATH).get()).data().requestId, first.applied.sync.requestId, 'sans --resync, aucune demande émise');

  // Point 4 (m40) : en --dry-run aussi, sync_required est bloquant (exit 1).
  const dry = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.ok, dry.report.sync], [1, false, { status: 'dry_run', expected: 'required', reason: 'sync_required' }]);
  assert.ok(dry.report.warnings.some((warning) => warning.code === 'sync_required'));

  const resynced = await runRolexDossier({ firestore, resync: true, ...applyOptions });
  assert.deepEqual(resynced.plan.sync, { expected: 'planned', reason: 'resync' });
  assert.deepEqual([resynced.applied.state.summary.create, resynced.applied.sync.status, resynced.applied.sync.outcome, resynced.applied.sync.revision, resynced.applied.sync.processedBy], [0, 'processed', 'updated', 3, 'script']);
  assert.notEqual(resynced.applied.sync.requestId, first.applied.sync.requestId);
  assert.equal(resynced.report.ok, true);
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [19_500, 19_500, 20_000, null]);
  assert.deepEqual((await chainIsValid(firestore)).errors, []);
});

test('brouillon en avance sur root.liveStateDigest (clé poussée par le lecteur sans synchronisation) : sync_required sans écriture ; --resync synchronise même sans écriture', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await runRolexDossier({ firestore, ...applyOptions });
  const synced = await runRolexDossier({ firestore, ...applyOptions });
  assert.deepEqual([synced.plan.draft.outOfSync, synced.applied.sync.reason, synced.report.ok], [false, 'no_state_change', true]);

  await writeState(firestore, REAL_UID, 'cartularia-todos', [{ id: 'todo-1', text: 'Faire réviser', dueAt: '2026-12-01', status: 'planned' }]);
  const stale = await runRolexDossier({ firestore, ...applyOptions });
  assert.deepEqual([stale.plan.draft.outOfSync, stale.plan.syncRequired, stale.plan.sync.expected], [true, true, 'required']);
  const warning = stale.plan.warnings.find((candidate) => candidate.code === 'draft_out_of_sync');
  assert.match(warning.draftDigest, /^[0-9a-f]{12}$/);
  assert.notEqual(warning.draftDigest, warning.rootLiveStateDigest);
  assert.deepEqual([stale.applied.sync.status, stale.report.ok], ['not_requested', false]);
  assert.equal((await firestore.doc(ROOT_PATH).get()).data().revision, 3);

  const resynced = await runRolexDossier({ firestore, resync: true, ...applyOptions });
  assert.deepEqual([resynced.applied.state.summary.create, resynced.applied.sync.status, resynced.applied.sync.outcome, resynced.applied.sync.revision, resynced.report.ok], [0, 'processed', 'updated', 4, true]);
  assert.equal(firestore.dump()[`${ROOT_PATH}/reminders/todo-1`].title, 'Faire réviser');
  assert.equal((await runRolexDossier({ firestore, ...applyOptions })).plan.draft.outOfSync, false);
});

test('course avec la Cloud Function : verdict ignored puis demande observée processed via sleep/now injectés → ok:true, processedBy remote', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  let clock = CLOCK;
  const sleeps = [];
  const processSyncRequest = async () => ({ requestDocumentId: ROLEX_CARTULARY_ID, status: 'ignored', reason: 'in_progress' });
  const sleep = async (milliseconds) => {
    sleeps.push(milliseconds);
    clock += milliseconds;
    const current = (await firestore.doc(REQUEST_PATH).get()).data();
    await firestore.doc(REQUEST_PATH).set({ ...current, status: 'processed', outcome: 'updated', sourceRevision: 42, auditEventId: 'evt_remote_0001' });
  };
  const { applied, report } = await runRolexDossier({ firestore, occurredAt: SYNC_DATE, now: () => clock, sleep, processSyncRequest, pollTimeoutMs: 10_000, pollIntervalMs: 2_000 });
  assert.deepEqual(applied.sync, { status: 'processed', outcome: 'updated', revision: 42, auditEventId: 'evt_remote_0001', requestId: applied.sync.requestId, processedBy: 'remote', reason: 'in_progress' });
  assert.deepEqual(sleeps, [2_000]);
  assert.equal(report.ok, true);
});

test('point 2 (tour 3) : course avec la Cloud Function, ignored puis délai dépassé → timeout, demande du seed marquée failed (sync_timeout), ok:false, exit 1 ; la relance signale sync_request_failed puis --resync synchronise', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  let clock = CLOCK;
  const sleeps = [];
  const { exitCode, report } = await runCli({
    firestore,
    argv: [],
    now: () => clock,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); clock += milliseconds; },
    processSyncRequest: async () => ({ status: 'ignored', reason: 'in_progress' }),
    pollTimeoutMs: 4_000,
    pollIntervalMs: 2_000,
  });
  assert.deepEqual([exitCode, report.ok, report.sync.status, report.sync.requestStatus, report.sync.markedFailed, report.sync.processedBy], [1, false, 'timeout', 'pending', true, 'remote']);
  assert.deepEqual(sleeps, [2_000, 2_000]);
  const request = (await firestore.doc(REQUEST_PATH).get()).data();
  assert.deepEqual([request.status, request.errorCode, request.requestId, request.reason], ['failed', 'sync_timeout', report.sync.requestId, ROLEX_SYNC_REQUEST_REASON]);
  assert.match(request.errorMessage, /4 s/);
  const warning = report.warnings.find((candidate) => candidate.code === 'sync_timeout');
  assert.deepEqual([warning.markedFailed, warning.requestId], [true, report.sync.requestId]);
  assert.match(warning.message, /--resync/);
  assert.equal((await stateDocs(firestore, REAL_UID)).size, 11, 'les clés écrites restent');

  // La relance n'est plus bloquée par une demande en cours : sync_required, puis --resync la traite.
  const relaunch = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([relaunch.exitCode, relaunch.report.syncRequest.status, relaunch.report.syncRequest.errorCode, relaunch.report.sync], [1, 'failed', 'sync_timeout', { status: 'dry_run', expected: 'required', reason: 'sync_required' }]);
  const resynced = await runCli({ firestore, argv: ['--resync'] });
  assert.deepEqual([resynced.exitCode, resynced.report.sync.status, resynced.report.sync.outcome, resynced.report.sync.revision], [0, 'processed', 'updated', 3]);
});

test('point 2 (tour 3) : au délai dépassé, une demande déjà traitée par la Cloud Function entre-temps n’est pas marquée failed (markedFailed false, verdict à relire)', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  let clock = CLOCK;
  // markSyncRequestFailed relit le statut : simulé « processed » juste avant le marquage.
  const markSyncRequestFailed = async ({ requestId }) => {
    const current = (await firestore.doc(REQUEST_PATH).get()).data();
    assert.equal(current.requestId, requestId);
    await firestore.doc(REQUEST_PATH).set({ ...current, status: 'processed', outcome: 'updated', sourceRevision: 7 });
  };
  const { applied, report } = await runRolexDossier({ firestore, occurredAt: SYNC_DATE, now: () => clock, sleep: async (ms) => { clock += ms; }, processSyncRequest: async () => ({ status: 'ignored', reason: 'in_progress' }), markSyncRequestFailed, pollTimeoutMs: 2_000, pollIntervalMs: 2_000 });
  assert.deepEqual([applied.sync.status, applied.sync.markedFailed, report.ok], ['timeout', false, false]);
  assert.match(report.warnings.find((candidate) => candidate.code === 'sync_timeout').message, /n’a pas pu être marquée failed/);
  assert.equal((await firestore.doc(REQUEST_PATH).get()).data().status, 'processed');
});

test('course avec la Cloud Function : demande remplacée par une autre (superseded) → ok:false', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const processSyncRequest = async () => {
    await firestore.doc(REQUEST_PATH).set({ requestDocumentId: ROLEX_CARTULARY_ID, requestId: 'sync_client_autre_000000000002', ownerUid: REAL_UID, cartularyId: ROLEX_CARTULARY_ID, reason: 'manual_retry', status: 'pending' });
    return { status: 'ignored', reason: 'superseded' };
  };
  const { applied, report } = await runRolexDossier({ firestore, ...applyOptions, processSyncRequest });
  assert.deepEqual([applied.sync.status, applied.sync.reason, report.ok], ['superseded', 'superseded', false]);
});

/* ------------------------------------------------------------------------------------------ */
/* Points relevés au tour 2 (préconditions, empreinte du brouillon, brouillon absent, formules)  */
/* ------------------------------------------------------------------------------------------ */

test('point 6 : membership du propriétaire insuffisante (cartulary.edit absent, registre hors scope, membership absente) ou registre absent / hors tenant → plan blocked, dry-run exit 1, application refusée avant toute écriture', async () => {
  const scenarios = [
    ['owner_not_editor', async (firestore) => firestore.doc(membershipPath(REAL_UID)).set({ permissions: ['cartulary.create'] }, { merge: true }), { cartularyEdit: false }],
    ['owner_not_editor', async (firestore) => firestore.doc(membershipPath(REAL_UID)).set({ scopes: { registryIds: ['reg_autre'] } }, { merge: true }), { registryInScope: false }],
    ['owner_not_editor', async (firestore) => firestore.doc(membershipPath(REAL_UID)).set({ roles: ['viewer'] }, { merge: true }), { legalOwner: false }],
    ['owner_not_editor', async (firestore) => firestore.doc(membershipPath(REAL_UID)).set({ status: 'suspended' }, { merge: true }), { membershipActive: false }],
    ['owner_not_editor', async (firestore) => firestore.doc(membershipPath(REAL_UID)).delete(), { membershipExists: false }],
    ['registry_not_ready', async (firestore) => firestore.doc(`registries/${REGISTRY_ID}`).set({ organizationId: 'org_autre' }, { merge: true }), { registrySameTenant: false }],
    ['registry_not_ready', async (firestore) => firestore.doc(`registries/${REGISTRY_ID}`).delete(), { registryExists: false }],
  ];
  for (const [reason, mutate, expectedChecks] of scenarios) {
    const firestore = createMemoryFirestore();
    await seedFoundations(firestore, [REAL_UID]);
    await seedRootCreatedFromRegistry(firestore);
    await mutate(firestore);
    const before = firestore.dump();
    const label = `${reason}:${Object.keys(expectedChecks)[0]}`;

    const dry = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
    assert.deepEqual([dry.exitCode, dry.report.ok, dry.report.sync], [1, false, { status: 'dry_run', expected: 'blocked', reason }], label);
    assert.deepEqual([dry.report.editor.ok, dry.report.editor.blockReason], [false, reason], label);
    for (const [check, value] of Object.entries(expectedChecks)) assert.equal(dry.report.editor[check], value, `${label} ${check}`);
    assert.equal(dry.report.warnings[0].code, reason, label);
    assert.deepEqual(firestore.dump(), before, label);

    const refused = await runCli({ firestore, argv: ['--allow-remote'], env: REMOTE_ENV });
    assert.deepEqual([refused.exitCode, refused.failure.code, refused.report], [1, reason, null], label);
    assert.deepEqual(firestore.dump(), before, `${label} : rien n’est écrit`);
    assert.equal((await stateDocs(firestore, REAL_UID)).size, 5, label);
  }

  // Préconditions réunies : editor.ok et chemin exposé sans valeur Secret.
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const { plan } = await runRolexDossier({ firestore, dryRun: true });
  assert.deepEqual(plan.editor, { organizationId: ORGANIZATION_ID, registryId: REGISTRY_ID, membershipPath: membershipPath(REAL_UID), membershipExists: true, membershipActive: true, legalOwner: true, cartularyEdit: true, registryInScope: true, registryExists: true, registrySameTenant: true, ok: true, blockReason: null });
});

test('point 2 (m38/m39) : clé interdite (cartularia-owner-fields) et binaire owner_document dans le brouillon → l’empreinte du plan égale celle de loadDraft : après synchronisation, outOfSync false et syncRequired false, ok:true', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore, { ownerOnlyData: true });
  assert.ok((await stateDocs(firestore, REAL_UID)).has('cartularia-owner-fields'));

  const first = await runRolexDossier({ firestore, ...applyOptions });
  assert.deepEqual([first.applied.sync.status, first.applied.sync.outcome, first.report.ok], ['processed', 'updated', true]);
  assert.equal(typeof firestore.dump()[ROOT_PATH].liveStateDigest, 'string');
  assert.equal(firestore.dump()[`${ROOT_PATH}/liveState/cartularia-owner-fields`], undefined, 'la clé interdite n’est jamais projetée');

  const second = await runRolexDossier({ firestore, ...applyOptions });
  assert.deepEqual([second.plan.draft.outOfSync, second.plan.syncRequired, second.plan.draft.digest === firestore.dump()[ROOT_PATH].liveStateDigest], [false, false, true], 'même empreinte que loadDraft');
  assert.deepEqual([second.plan.sync, second.applied.sync, second.report.ok], [{ expected: 'skipped', reason: 'no_state_change' }, { status: 'skipped', reason: 'no_state_change' }, true]);
  assertNoSecretValue(second.report);
});

test('point 15 (m63) : racine existante sans brouillon → brouillon créé au nom de accountHolderId (pas de l’acteur de la fixture), actif, puis synchronisé', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID, ROLEX_IMPORT_ACTOR_ID]);
  await seedRootCreatedFromRegistry(firestore, { withDraft: false });
  assert.equal(firestore.dump()[draftPath(REAL_UID)], undefined);

  const { plan, applied, report } = await runRolexDossier({ firestore, ...applyOptions });
  assert.deepEqual([plan.mode, plan.owner.uid, plan.draft.exists, plan.draft.action, plan.state.summary.create, plan.state.summary.kept_projection], ['existing', REAL_UID, false, 'create', 8, 6]);
  assert.equal(applied.draft, 'create');
  const draft = firestore.dump()[draftPath(REAL_UID)];
  assert.deepEqual([draft.ownerUid, draft.cartularyId, draft.status, draft.retentionPolicyVersion, draft.purgeAfter], [REAL_UID, ROLEX_CARTULARY_ID, 'active', 'inactive-plus-2y-v1', null]);
  assert.equal(firestore.dump()[draftPath(ROLEX_IMPORT_ACTOR_ID)], undefined, 'aucun brouillon au nom de la fixture');
  const states = await stateDocs(firestore, REAL_UID);
  assert.equal(states.size, 8);
  assert.ok([...states.values()].every((record) => record.ownerUid === REAL_UID));
  assert.deepEqual([applied.sync.status, applied.sync.revision, report.ok, report.draft.action], ['processed', 3, true, 'create']);
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [19_500, 19_500, 20_000, null], 'montants du propriétaire conservés (clés de projection non créées)');
});

test('point 12 : édition du propriétaire non synchronisée (cartularia-retained-valuation 26 000 poussée par le lecteur) → draft_out_of_sync nomme les champs de projection que la synchronisation du seed appliquera, et l’exécution les applique bien', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await runRolexDossier({ firestore, ...applyOptions });
  await writeState(firestore, REAL_UID, 'cartularia-retained-valuation', { amount: 26_000, saleCostAmount: 0, taxAmount: 0 });

  const { plan } = await runRolexDossier({ firestore, dryRun: true, resync: true, ...applyOptions });
  assert.deepEqual([plan.draft.outOfSync, plan.sync], [true, { expected: 'planned', reason: 'resync' }]);
  assert.equal(entryOf(plan, 'cartularia-retained-valuation').action, 'kept_projection');
  assert.deepEqual(moneyOf(plan.projection.current), [19_500, 19_500, 20_000, null]);
  assert.deepEqual(moneyOf(plan.projection.afterPlan), [19_500, 19_500, 26_000, 26_000], 'l’édition du propriétaire est dans l’aperçu même sans écriture du seed');
  const warning = plan.warnings.find((candidate) => candidate.code === 'draft_out_of_sync');
  assert.deepEqual(warning.changesAfterPlan, ['grossValuation', 'netValuation']);
  assert.match(warning.message, /modifications du propriétaire non synchronisées/);
  assert.match(warning.message, /grossValuation, netValuation/);

  const { applied, report } = await runRolexDossier({ firestore, resync: true, ...applyOptions });
  assert.deepEqual([applied.sync.status, applied.sync.outcome, report.ok], ['processed', 'updated', true]);
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [19_500, 19_500, 26_000, 26_000]);
  assert.deepEqual(report.projection.applied, { root: report.projection.afterPlan, registryItem: report.projection.afterPlan, revision: 4, changesFromCurrent: ['grossValuation', 'netValuation'], matchesAfterPlan: true });
});

test('point 16 (m08/m09) : dépenses d’achat et frais de vente du propriétaire → l’aperçu afterPlan (costBasis 19 750, netValuation 19 000) égale la racine et l’item après synchronisation', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await writeState(firestore, REAL_UID, 'cartularia-purchase', { purchasePrice: 19_500, purchaseDate: '2020-01-01' });
  await writeState(firestore, REAL_UID, 'cartularia-purchase-expenses', [{ id: 'e1', amount: 250, label: 'Révision' }]);
  await writeState(firestore, REAL_UID, 'cartularia-retained-valuation', { amount: 20_000, saleCostAmount: 1_000, taxAmount: 0 });

  const dry = await runRolexDossier({ firestore, dryRun: true, ...applyOptions });
  assert.deepEqual(moneyOf(dry.plan.projection.afterPlan), [19_500, 19_750, 20_000, 19_000]);
  assert.deepEqual(dry.plan.projection.changesAfterPlan, ['costBasis', 'netValuation']);
  const { applied, report } = await runRolexDossier({ firestore, ...applyOptions });
  assert.equal(applied.sync.status, 'processed');
  const dump = firestore.dump();
  for (const field of PROJECTION_FIELDS) {
    assert.deepEqual(dump[ROOT_PATH][field] ?? null, dry.plan.projection.afterPlan[field], `racine.${field}`);
    assert.deepEqual(dump[ITEM_PATH][field] ?? null, dry.plan.projection.afterPlan[field], `item.${field}`);
  }
  assert.deepEqual([dump[ROOT_PATH].costBasis, dump[ROOT_PATH].netValuation, report.projection.applied.matchesAfterPlan], [19_750, 19_000, true]);
});

test('point 17 : brouillon supprimé entre deux transactions de clés → la relecture par clé refuse la suite (draft_not_ready), les clés déjà écrites restent, aucune synchronisation', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const plan = await planRolexDossier({ firestore, ...applyOptions });
  const toWrite = plan.state.entries.filter((entry) => entry.action === 'create').map((entry) => entry.key);
  assert.equal(toWrite.length, 6);
  // Le propriétaire supprime son brouillon juste après la deuxième transaction de clé.
  let keyTransactions = 0;
  const wrapped = {
    ...firestore,
    runTransaction: async (operation) => {
      const result = await firestore.runTransaction(operation);
      if (result && typeof result === 'object' && 'key' in result) {
        keyTransactions += 1;
        if (keyTransactions === 2) await firestore.doc(draftPath(REAL_UID)).set({ status: 'deleted' }, { merge: true });
      }
      return result;
    },
  };
  await assert.rejects(applyRolexDossier({ firestore: wrapped, plan, ...applyOptions }), (error) => error.code === 'draft_not_ready' && /écriture de cartularia-/.test(error.message));
  const states = await stateDocs(firestore, REAL_UID);
  assert.deepEqual(toWrite.map((key) => states.has(key)), [true, true, false, false, false, false]);
  assert.equal(firestore.dump()[REQUEST_PATH], undefined, 'aucune demande de synchronisation');
  assert.equal(firestore.dump()[ROOT_PATH].revision, 2);
});

/* ------------------------------------------------------------------------------------------ */
/* Points levés au tour 3 (opération générique, première synchronisation, gardes prouvées)     */
/* ------------------------------------------------------------------------------------------ */

const GENERIC_TOKEN = 'op_token_lecteur_0000000001';
/** Le lecteur unique enregistre une saisie générique : état + marqueur dans la même transaction (genericCartulary.ts l.78-89). */
const writeGenericSectionsEdit = async (firestore, { baseRevision, amount = 25_000, token = GENERIC_TOKEN, revision = 1 }) => {
  const { schemaId, schemaVersion } = buildRolexImportBundle().envelope;
  await writeState(firestore, REAL_UID, 'cartularia-generic-sections', { version: 1, schemaId, schemaVersion, baseRevision, edits: [{ fieldId: 'value.retained.amount', value: { amount, currency: 'EUR' } }] }, { revision, clientUpdatedAt: CLOCK - 60_000 });
  await writeState(firestore, REAL_UID, 'cartularia-generic-operation', { kind: 'sections', token }, { revision, clientUpdatedAt: CLOCK - 60_000 });
};
/** Catalogue complet pour value.retained.amount (loadGenericSectionPatches valide le champ et le profil). */
const seedRetainedAmountField = async (firestore) => {
  const { schemaId, schemaVersion } = buildRolexImportBundle().envelope;
  const field = artifact(schemaId, schemaVersion).fields.find((candidate) => candidate.fieldId === 'value.retained.amount');
  await firestore.doc(`schemaCatalog/${schemaId}/versions/${schemaVersion}`).set({ assetType: 'watch' }, { merge: true });
  // loadGenericSectionPatches énumère les documents de sections du catalogue avant leurs champs.
  await firestore.doc(`schemaCatalog/${schemaId}/versions/${schemaVersion}/sections/${field.sectionId}`).set({ id: field.sectionId, schemaId, version: schemaVersion });
  await firestore.doc(`schemaCatalog/${schemaId}/versions/${schemaVersion}/sections/${field.sectionId}/fields/${field.fieldId}`).set(field);
};

test('point 1 (tour 3) : édition générique du lecteur en attente (value.retained.amount 25 000, baseRevision courante) → generic_operation_pending non bloquant, plan.genericOperationPending, aperçu non simulé ; la synchronisation l’applique (grossValuation 25 000, netValuation null), projection_differs_from_preview signalé, ok:true', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await seedRetainedAmountField(firestore);
  await runRolexDossier({ firestore, ...applyOptions });
  assert.equal(firestore.dump()[ROOT_PATH].revision, 3);
  await writeGenericSectionsEdit(firestore, { baseRevision: 3 });
  const before = firestore.dump();

  const dry = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.sync], [1, { status: 'dry_run', expected: 'required', reason: 'sync_required' }], 'brouillon en avance : sync_required sans --resync');
  assert.deepEqual(dry.report.genericOperationPending, { valid: true, kind: 'sections', draftKey: 'cartularia-generic-sections', baseRevision: 3, rootRevision: 3, stale: false, fieldIds: ['value.retained.amount'], changeCount: null });
  const warning = dry.report.warnings.find((candidate) => candidate.code === 'generic_operation_pending');
  assert.deepEqual([warning.blocking, warning.stale, warning.kind, warning.fieldIds], [false, false, 'sections', ['value.retained.amount']]);
  assert.match(warning.message, /ne simule pas cette édition/);
  assert.match(warning.message, /netValuation à null/);
  assert.match(dry.report.projection.note, /opération générique en attente/);
  assert.deepEqual(moneyOf(dry.report.projection.afterPlan), [19_500, 19_500, 20_000, null], 'l’aperçu ne voit pas l’édition générique');
  assert.deepEqual(firestore.dump(), before);
  assertNoSecretValue(dry.report);
  assert.doesNotMatch(JSON.stringify(dry.report), /25000|25 000/, 'le montant édité n’est pas exposé');

  const resync = await runCli({ firestore, argv: ['--resync'] });
  assert.deepEqual([resync.exitCode, resync.report.ok, resync.report.sync.status, resync.report.sync.outcome, resync.report.sync.revision], [0, true, 'processed', 'updated', 4]);
  const root = firestore.dump()[ROOT_PATH];
  assert.deepEqual([root.grossValuation, root.netValuation, root.lastGenericOperationToken], [25_000, null, GENERIC_TOKEN], 'live-sync-command.mjs l.275-281 : editedValue force grossValuation et met netValuation à null');
  assert.deepEqual([resync.report.projection.applied.matchesAfterPlan, resync.report.projection.applied.changesFromCurrent], [false, ['grossValuation']]);
  assert.match(resync.report.warnings.find((candidate) => candidate.code === 'projection_differs_from_preview').message, /generic_operation_pending/);
  const section = Object.entries(firestore.dump()).find(([path, data]) => path.startsWith(`${ROOT_PATH}/sections/`) && data.schemaSectionId === 'value.retained_value')?.[1];
  assert.deepEqual([section?.fields?.['value.retained.amount']?.value, section?.fields?.['value.retained.amount']?.assertedBy], [{ amount: 25_000, currency: 'EUR' }, REAL_UID], 'la section générique porte la saisie du propriétaire');
  // Une fois appliquée (token porté par la racine), l'opération n'est plus en attente.
  const after = await runRolexDossier({ firestore, dryRun: true, ...applyOptions });
  assert.deepEqual([after.plan.genericOperationPending, after.plan.draft.outOfSync, after.plan.sync], [null, false, { expected: 'skipped', reason: 'no_state_change' }]);
});

test('point 1 (tour 3) : édition générique en attente avec baseRevision périmée → plan blocked (generic_operation_stale) avant toute écriture, dry-run exit 1, application refusée, dump identique ; média générique périmé : même garde', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await seedRetainedAmountField(firestore);
  await runRolexDossier({ firestore, ...applyOptions });
  await writeGenericSectionsEdit(firestore, { baseRevision: 2 });
  const before = firestore.dump();

  const dry = await runCli({ firestore, argv: ['--dry-run', '--resync'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.ok, dry.report.sync], [1, false, { status: 'dry_run', expected: 'blocked', reason: 'generic_operation_stale' }]);
  assert.deepEqual([dry.report.genericOperationPending.stale, dry.report.genericOperationPending.baseRevision, dry.report.genericOperationPending.rootRevision], [true, 2, 3]);
  const warning = dry.report.warnings.find((candidate) => candidate.code === 'generic_operation_pending');
  assert.deepEqual([warning.blocking, warning.stale], [true, true]);
  assert.match(warning.message, /baseRevision 2 ≠ révision 3/);
  assert.match(warning.message, /revision_conflict/);
  assert.deepEqual(firestore.dump(), before);

  for (const argv of [['--allow-remote', '--resync'], ['--allow-remote']]) {
    const refused = await runCli({ firestore, argv, env: REMOTE_ENV });
    assert.deepEqual([refused.exitCode, refused.failure.code, refused.report], [1, 'generic_operation_stale', null], argv.join(' '));
    assert.deepEqual(firestore.dump(), before, `${argv.join(' ')} : rien n’est écrit`);
  }
  // Même sans --resync et avec des clés à écrire (première passe), la garde précède toute écriture.
  const fresh = createMemoryFirestore();
  await seedFoundations(fresh, [REAL_UID]);
  await seedRootCreatedFromRegistry(fresh);
  await writeGenericSectionsEdit(fresh, { baseRevision: 1 });
  const freshBefore = fresh.dump();
  const plan = await planRolexDossier({ firestore: fresh });
  assert.deepEqual([plan.state.summary.create, plan.sync], [6, { expected: 'blocked', reason: 'generic_operation_stale' }]);
  await assert.rejects(applyRolexDossier({ firestore: fresh, plan, ...applyOptions }), (error) => error.code === 'generic_operation_stale');
  assert.deepEqual(fresh.dump(), freshBefore);
  assert.equal((await stateDocs(fresh, REAL_UID)).size, 7);

  // Média générique : même baseRevision relue (generic-media-command.mjs l.12).
  const media = createMemoryFirestore();
  await seedFoundations(media, [REAL_UID]);
  await seedRootCreatedFromRegistry(media);
  await writeState(media, REAL_UID, 'cartularia-generic-media', { version: 1, baseRevision: 1, changes: [{ id: 'asset_rolex_main', name: 'Renommée' }], removeIds: [] });
  await writeState(media, REAL_UID, 'cartularia-generic-operation', { kind: 'media', token: GENERIC_TOKEN });
  const mediaPlan = await planRolexDossier({ firestore: media });
  assert.deepEqual([mediaPlan.genericOperationPending.kind, mediaPlan.genericOperationPending.changeCount, mediaPlan.genericOperationPending.stale, mediaPlan.sync.reason], ['media', 1, true, 'generic_operation_stale']);
});

test('point 4 (tour 3) : racine sans liveStateDigest → first_authoritative_sync tant qu’une synchronisation est prévue ; absent après la première synchronisation et en mode create', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await writeState(firestore, REAL_UID, 'cartularia-todos', [{ id: 'todo-1', text: 'Faire réviser', dueAt: '2026-12-01', status: 'planned' }]);

  const dry = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.firstAuthoritativeSync, dry.report.root.liveStateDigest], [0, true, null]);
  const warning = dry.report.warnings.find((candidate) => candidate.code === 'first_authoritative_sync');
  assert.match(warning.message, /première synchronisation autoritaire/);
  assert.match(warning.message, /médias legacy/);
  assert.match(warning.message, /todos/);
  assert.match(warning.message, /sections génériques/);

  const applied = await runCli({ firestore, argv: [] });
  assert.deepEqual([applied.exitCode, applied.report.firstAuthoritativeSync, applied.report.sync.status], [0, true, 'processed']);
  assert.equal(firestore.dump()[`${ROOT_PATH}/reminders/todo-1`].title, 'Faire réviser', 'tout le brouillon est synchronisé, pas seulement les clés créées');
  const again = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([again.report.firstAuthoritativeSync, again.report.warnings.some((candidate) => candidate.code === 'first_authoritative_sync')], [false, false]);

  const local = createMemoryFirestore();
  await seedFoundations(local, [ROLEX_IMPORT_ACTOR_ID]);
  const created = await runCli({ firestore: local, argv: ['--dry-run'] });
  assert.deepEqual([created.report.mode, created.report.firstAuthoritativeSync, created.report.warnings.some((candidate) => candidate.code === 'first_authoritative_sync')], ['create', false, false]);
});

test('point 5 (M56) : mode create sous émulateur, brouillon de l’acteur fixture actif au plan puis archivé avant l’application → draft_not_ready avant import et projection, dump identique', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [ROLEX_IMPORT_ACTOR_ID]);
  await firestore.doc(draftPath(ROLEX_IMPORT_ACTOR_ID)).set({ ownerUid: ROLEX_IMPORT_ACTOR_ID, cartularyId: ROLEX_CARTULARY_ID, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1', purgeAfter: null });
  const plan = await planRolexDossier({ firestore });
  assert.deepEqual([plan.mode, plan.draft.exists, plan.draft.action, plan.sync], ['create', true, 'unchanged', { expected: 'planned', reason: null }]);
  await firestore.doc(draftPath(ROLEX_IMPORT_ACTOR_ID)).set({ status: 'archived' }, { merge: true });
  const before = firestore.dump();
  await assert.rejects(applyRolexDossier({ firestore, plan, ...applyOptions }), (error) => error.code === 'draft_not_ready');
  assert.deepEqual(firestore.dump(), before);
  assert.equal(firestore.dump()[ROOT_PATH], undefined, 'aucun import');
  assert.equal(firestore.dump()[`${ROOT_PATH}/commandReceipts/${ROLEX_IMPORT_REQUEST_ID}`], undefined, 'aucun reçu');
  assert.equal(firestore.dump()[ITEM_PATH], undefined, 'aucune projection');
});

test('point 5 (M59) : clé forcée (--force --key cartularia-editable-copy) marquée deleted:true par le lecteur entre le plan et l’application, révision inchangée → raced, suppression conservée', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await runRolexDossier({ firestore, ...applyOptions });
  const plan = await planRolexDossier({ firestore, forceKeys: ['cartularia-editable-copy'] });
  const entry = entryOf(plan, 'cartularia-editable-copy');
  assert.deepEqual([entry.action, entry.existing], ['update', { revision: 1, clientUpdatedAt: 1_755_684_000_000, deleted: false }]);
  // Le lecteur supprime la clé sans incrémenter la révision (seul `deleted` change).
  await writeState(firestore, REAL_UID, 'cartularia-editable-copy', null, { deleted: true, revision: 1 });
  const applied = await applyRolexDossier({ firestore, plan, ...applyOptions });
  assert.deepEqual([applied.state.results.find((result) => result.key === 'cartularia-editable-copy').result, applied.state.summary.raced, applied.state.summary.update], ['raced', 1, 0]);
  const record = (await stateDocs(firestore, REAL_UID)).get('cartularia-editable-copy');
  assert.deepEqual([record.deleted, record.revision, record.value], [true, 1, null], 'la suppression du lecteur est conservée');
  assert.equal(describeRolexDossierRun({ plan, applied }).ok, false);
});

test('point 5 (M90) : brouillon absent au plan puis créé par le lecteur (actif, avec une clé) avant l’application → plan_stale, dump identique', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore, { withDraft: false });
  const plan = await planRolexDossier({ firestore });
  assert.deepEqual([plan.draft.exists, plan.draft.action, plan.state.summary.create], [false, 'create', 8]);
  await firestore.doc(draftPath(REAL_UID)).set({ ownerUid: REAL_UID, cartularyId: ROLEX_CARTULARY_ID, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1' });
  await writeState(firestore, REAL_UID, 'cartularia-comparables', [{ id: 'saisie-du-proprietaire' }]);
  const before = firestore.dump();
  await assert.rejects(applyRolexDossier({ firestore, plan, ...applyOptions }), (error) => error.code === 'plan_stale');
  assert.deepEqual(firestore.dump(), before);
  assert.equal((await stateDocs(firestore, REAL_UID)).size, 1);
  assert.equal(firestore.dump()[REQUEST_PATH], undefined);
});

/* ------------------------------------------------------------------------------------------ */
/* CLI en mémoire (D5, D6)                                                                     */
/* ------------------------------------------------------------------------------------------ */

test('CLI --dry-run : dump identique avec et sans --allow-remote, rapport sur stdout, exit 0', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const before = firestore.dump();

  const remote = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([remote.exitCode, remote.failure, remote.report.dryRun, remote.report.usesEmulator, remote.report.projectId, remote.report.mode], [0, null, true, false, 'cartularia-prod-simule', 'existing']);
  assert.deepEqual(firestore.dump(), before, 'dry-run distant sans --allow-remote : aucune écriture');
  assert.equal(JSON.parse(remote.stdout).event, 'ROLEX_CARTULARY_SEED');
  assert.equal(remote.report.classification, 'Secret');

  const allowed = await runCli({ firestore, argv: ['--dry-run', '--allow-remote'], env: REMOTE_ENV });
  assert.deepEqual([allowed.exitCode, allowed.report.dryRun], [0, true]);
  assert.deepEqual(firestore.dump(), before, 'dry-run --allow-remote : aucune écriture');
  assert.deepEqual(allowed.report.state, remote.report.state, 'même nonce injecté : rapports identiques');
  assert.equal(allowed.report.sync.status, 'dry_run');
});

test('point 5 : les empreintes sont à clé aléatoire par exécution (nonce jamais exposé) : une valeur Secret à faible entropie ne se retrouve pas par force brute depuis le rapport ; l’égalité reste vérifiable dans un même rapport', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  await writeState(firestore, REAL_UID, 'cartularia-purchase', { date: '2026-07-01', purchasePrice: 19_500 });

  const first = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV, digestNonce: undefined });
  const second = await runCli({ firestore, argv: ['--dry-run'], env: REMOTE_ENV, digestNonce: undefined });
  const purchaseFirst = first.report.state.entries.find((entry) => entry.key === 'cartularia-purchase');
  const purchaseSecond = second.report.state.entries.find((entry) => entry.key === 'cartularia-purchase');
  assert.match(purchaseFirst.existingDigest, /^[0-9a-f]{12}$/);
  assert.notEqual(purchaseFirst.existingDigest, purchaseSecond.existingDigest, 'même valeur, deux exécutions : empreintes différentes (clé aléatoire)');
  assert.notEqual(purchaseFirst.fixtureDigest, purchaseSecond.fixtureDigest);
  // Oracle de force brute : l'empreinte non salée de la valeur du propriétaire ne doit apparaître nulle part.
  const { sha256Digest } = await import('../scripts/lib/canonical-json.mjs');
  const unsalted = sha256Digest({ date: '2026-07-01', purchasePrice: 19_500 }).slice(7, 19);
  assert.doesNotMatch(JSON.stringify(first.report), new RegExp(unsalted));
  assert.doesNotMatch(JSON.stringify(first.report), /nonce/i);
  // Égalité dans un même rapport : clé identique à la fixture → existingDigest === fixtureDigest.
  const code = first.report.state.entries.find((entry) => entry.key === 'cartularia-public-code');
  assert.deepEqual([code.action, code.existingDigest === code.fixtureDigest], ['unchanged', true]);
  assert.deepEqual([purchaseFirst.action, purchaseFirst.existingDigest === purchaseFirst.fixtureDigest, purchaseFirst.differingFields], ['kept_projection', false, ['date', 'purchasePrice']]);
  assertNoSecretValue(first.report);
});

test('CLI hors émulateur sans --allow-remote ni --dry-run : remote_not_allowed, fabrique Firestore jamais appelée', async () => {
  let created = 0;
  const { exitCode, failure, report, stdout } = await runCli({ firestore: () => { created += 1; return createMemoryFirestore(); }, argv: [], env: REMOTE_ENV });
  assert.deepEqual([exitCode, failure.code, failure.event, report, stdout, created], [1, 'remote_not_allowed', 'ROLEX_CARTULARY_SEED_FAILED', null, '', 0]);
});

test('point 3 (tour 3) : hors émulateur sans GCLOUD_PROJECT ni FIREBASE_PROJECT_ID, même en --dry-run → project_required, exit 1, fabrique jamais appelée ; avec projet explicite la fabrique reçoit projectId et usesEmulator', async () => {
  let created = 0;
  const calls = [];
  const factory = (options) => { created += 1; calls.push(options); return createMemoryFirestore(); };
  for (const argv of [['--dry-run'], ['--allow-remote'], ['--dry-run', '--allow-remote']]) {
    const { exitCode, failure, report, stdout } = await runCli({ firestore: factory, argv, env: {} });
    assert.deepEqual([exitCode, failure.code, report, stdout, created], [1, 'project_required', null, '', 0], argv.join(' '));
    assert.match(failure.message, /GCLOUD_PROJECT ou FIREBASE_PROJECT_ID/);
    assert.match(failure.message, /Utilisation/);
  }
  const { exitCode, report } = await runCli({ firestore: factory, argv: ['--dry-run'], env: { FIREBASE_PROJECT_ID: 'projet-explicite' } });
  assert.deepEqual([exitCode, report.projectId, report.usesEmulator, created, calls], [1, 'projet-explicite', false, 1, [{ projectId: 'projet-explicite', usesEmulator: false }]], 'base vide : mode create bloqué hors émulateur, mais le projet explicite est accepté');
  assert.equal(report.sync.reason, 'create_not_allowed_remote');
  const seeded = createMemoryFirestore();
  await seedFoundations(seeded, [ROLEX_IMPORT_ACTOR_ID]);
  const local = await runCli({ firestore: (options) => { calls.push(options); return seeded; }, argv: ['--dry-run'], env: EMULATOR_ENV });
  assert.deepEqual([local.exitCode, local.report.mode, local.report.projectId, calls.at(-1)], [0, 'create', 'cartularia-wave2-local', { projectId: 'cartularia-wave2-local', usesEmulator: true }], 'sous émulateur, défaut du seed local');
});

test('CLI --allow-remote : écrit les clés non protégées seulement, synchronise, exit 0 ; les montants du propriétaire restent', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);

  const { exitCode, report } = await runCli({ firestore, argv: ['--allow-remote'], env: REMOTE_ENV });
  assert.deepEqual([exitCode, report.ok, report.dryRun, report.mode, report.usesEmulator], [0, true, false, 'existing', false]);
  assert.deepEqual(report.state.applied, { create: 6, update: 0, unchanged: 1, kept: 1, kept_projection: 6, conflict_with_root: 0, raced: 0 });
  assert.deepEqual([report.sync.status, report.sync.revision], ['processed', 3]);
  const states = await stateDocs(firestore, REAL_UID);
  assert.equal(states.size, 11);
  assert.equal(states.get('cartularia-editable-copy').value, JSON.stringify(OWNER_EDITABLE_COPY));
  assert.equal(states.has('cartularia-purchase'), false);
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [19_500, 19_500, 20_000, null]);
  assertNoSecretValue(report);
});

test('CLI --force sans --key : refus (exit 1, rien écrit) ; --force --key X : seule X réécrite', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const before = firestore.dump();

  const refused = await runCli({ firestore, argv: ['--allow-remote', '--force'], env: REMOTE_ENV });
  assert.deepEqual([refused.exitCode, refused.failure.code, refused.report], [1, 'force_requires_key', null]);
  assert.match(refused.failure.message, /--key/);
  assert.deepEqual(firestore.dump(), before);

  const forced = await runCli({ firestore, argv: ['--allow-remote', '--force', '--key', 'cartularia-editable-copy'], env: REMOTE_ENV });
  assert.deepEqual([forced.exitCode, forced.report.ok, forced.report.flags.forceKeys, forced.report.force], [0, true, ['cartularia-editable-copy'], true]);
  assert.deepEqual(forced.report.state.applied, { create: 6, update: 1, unchanged: 1, kept: 0, kept_projection: 6, conflict_with_root: 0, raced: 0 });
  const states = await stateDocs(firestore, REAL_UID);
  assert.deepEqual([states.get('cartularia-editable-copy').revision, states.get('cartularia-editable-copy').value], [2, JSON.stringify(FIXTURE.get('cartularia-editable-copy'))]);
  assert.equal(states.get('cartularia-creation-profile').value, JSON.stringify(OWNER_PROFILE));
  assert.equal(states.get('cartularia-specification-groups').revision, 1);
});

test('CLI CARTULARIA_OWNER_UID différent : owner_mismatch, exit 1, rien écrit ; identique : accepté', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const before = firestore.dump();
  const refused = await runCli({ firestore, argv: ['--allow-remote'], env: { ...REMOTE_ENV, CARTULARIA_OWNER_UID: 'wave1-owner' } });
  assert.deepEqual([refused.exitCode, refused.failure.code, refused.report], [1, 'owner_mismatch', null]);
  assert.deepEqual(firestore.dump(), before);
  const accepted = await runCli({ firestore, argv: ['--dry-run'], env: { ...REMOTE_ENV, CARTULARIA_OWNER_UID: REAL_UID } });
  assert.deepEqual([accepted.exitCode, accepted.report.owner], [0, { uid: REAL_UID, source: 'env' }]);
});

test('CLI --projection-keys : crée les clés de projection absentes et recalcule les montants ; --resync : synchronise sans écriture', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);

  const projected = await runCli({ firestore, argv: ['--allow-remote', '--projection-keys'], env: REMOTE_ENV });
  assert.deepEqual([projected.exitCode, projected.report.flags.projectionKeys, projected.report.state.applied.create, projected.report.state.applied.kept_projection], [0, true, 10, 0]);
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [21_900, 21_900, 23_000, 23_000]);
  assert.deepEqual(moneyOf(firestore.dump()[ITEM_PATH]), [21_900, 21_900, 23_000, 23_000]);

  const idle = await runCli({ firestore, argv: ['--allow-remote'], env: REMOTE_ENV });
  assert.deepEqual([idle.exitCode, idle.report.sync], [0, { status: 'skipped', reason: 'no_state_change' }]);
  const revisionBefore = firestore.dump()[ROOT_PATH].revision;
  const resynced = await runCli({ firestore, argv: ['--allow-remote', '--resync'], env: REMOTE_ENV });
  assert.deepEqual([resynced.exitCode, resynced.report.flags.resync, resynced.report.state.applied.create, resynced.report.sync.status, resynced.report.sync.outcome, resynced.report.sync.revision], [0, true, 0, 'processed', 'no_change', revisionBefore]);
  assert.notEqual(firestore.dump()[REQUEST_PATH].requestId, idle.report.syncRequest.requestId, 'une nouvelle demande a été émise');
});

test('sémantique --force --key <clé hors projection> --projection-keys : aucune clé de projection créée ni réécrite, seule la clé nommée est remplacée, montants du propriétaire intacts', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const before = firestore.dump();

  const dry = await runCli({ firestore, argv: ['--dry-run', '--force', '--key', 'cartularia-editable-copy', '--projection-keys'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.flags.projectionKeys, dry.report.flags.projectionScoped, dry.report.flags.projectionOnlyKeys, dry.report.flags.forceKeys], [0, true, true, [], ['cartularia-editable-copy']]);
  assert.deepEqual(dry.report.state.summary, { create: 6, update: 1, unchanged: 1, kept: 0, kept_projection: 6, conflict_with_root: 0, raced: 0 });
  assert.ok(dry.report.warnings.some((candidate) => candidate.code === 'projection_keys_without_effect'), 'avertissement : --projection-keys sans clé de projection nommée');
  assert.equal(dry.report.warnings.find((candidate) => candidate.code === 'projection_will_change'), undefined, 'aucune clé de projection écrite');
  assert.deepEqual(moneyOf(dry.report.projection.afterPlan), [19_500, 19_500, 20_000, null]);
  assert.deepEqual(firestore.dump(), before);

  const applied = await runCli({ firestore, argv: ['--allow-remote', '--force', '--key', 'cartularia-editable-copy', '--projection-keys'], env: REMOTE_ENV });
  assert.deepEqual([applied.exitCode, applied.report.ok, applied.report.state.applied.create, applied.report.state.applied.update, applied.report.state.applied.kept_projection, applied.report.sync.status], [0, true, 6, 1, 6, 'processed']);
  const states = await stateDocs(firestore, REAL_UID);
  assert.deepEqual([states.has('cartularia-purchase'), states.has('cartularia-retained-valuation'), states.has('cartularia-watch-status'), states.has('cartularia-purchase-expenses')], [false, false, false, false]);
  assert.equal(states.get('cartularia-editable-copy').value, JSON.stringify(FIXTURE.get('cartularia-editable-copy')), 'seule la clé nommée est remplacée');
  assert.equal(states.get('cartularia-creation-profile').value, JSON.stringify(OWNER_PROFILE), 'le profil du propriétaire est intact');
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [19_500, 19_500, 20_000, null], 'racine : montants du propriétaire intacts');
  assert.deepEqual(moneyOf(firestore.dump()[ITEM_PATH]), [19_500, 19_500, 20_000, null], 'item Registre : montants du propriétaire intacts');
});

test('point 6 (tour 3) : CLI --projection-keys --key cartularia-watch-status (sans --force) : watch-status seule est créée, purchase et retained-valuation restent kept_projection, montants du propriétaire intacts après synchronisation ; sans --key : toutes', async () => {
  const firestore = createMemoryFirestore();
  await seedFoundations(firestore, [REAL_UID]);
  await seedRootCreatedFromRegistry(firestore);
  const before = firestore.dump();

  const dry = await runCli({ firestore, argv: ['--dry-run', '--projection-keys', '--key', 'cartularia-watch-status'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.flags.projectionKeys, dry.report.flags.projectionOnlyKeys, dry.report.flags.forceKeys, dry.report.force], [0, true, ['cartularia-watch-status'], [], false]);
  assert.deepEqual(dry.report.state.summary, { create: 7, update: 0, unchanged: 1, kept: 1, kept_projection: 5, conflict_with_root: 0, raced: 0 });
  const actions = Object.fromEntries(dry.report.state.entries.map((entry) => [entry.key, entry.action]));
  assert.deepEqual([actions['cartularia-watch-status'], actions['cartularia-purchase'], actions['cartularia-retained-valuation'], actions['cartularia-purchase-expenses'], actions['cartularia-creation-profile'], actions['cartularia-specification-groups']], ['create', 'kept_projection', 'kept_projection', 'kept_projection', 'kept_projection', 'kept_projection']);
  assert.deepEqual(dry.report.warnings.find((candidate) => candidate.code === 'projection_will_change').keys, ['cartularia-watch-status']);
  assert.deepEqual(dry.report.warnings.find((candidate) => candidate.code === 'projection_keys_kept').keys.sort(), ['cartularia-creation-profile', 'cartularia-purchase', 'cartularia-purchase-expenses', 'cartularia-retained-valuation', 'cartularia-specification-groups']);
  assert.deepEqual(moneyOf(dry.report.projection.afterPlan), [19_500, 19_500, 20_000, null]);
  assert.deepEqual(firestore.dump(), before);

  const applied = await runCli({ firestore, argv: ['--allow-remote', '--projection-keys', '--key', 'cartularia-watch-status'], env: REMOTE_ENV });
  assert.deepEqual([applied.exitCode, applied.report.ok, applied.report.state.applied.create, applied.report.state.applied.kept_projection, applied.report.sync.status], [0, true, 7, 5, 'processed']);
  const states = await stateDocs(firestore, REAL_UID);
  assert.deepEqual([states.size, states.has('cartularia-watch-status'), states.has('cartularia-purchase'), states.has('cartularia-retained-valuation'), states.has('cartularia-purchase-expenses')], [12, true, false, false, false]);
  assert.equal(states.get('cartularia-watch-status').value, JSON.stringify(FIXTURE.get('cartularia-watch-status')));
  assert.equal(states.get('cartularia-creation-profile').value, JSON.stringify(OWNER_PROFILE));
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [19_500, 19_500, 20_000, null], 'racine : montants du propriétaire intacts');
  assert.deepEqual(moneyOf(firestore.dump()[ITEM_PATH]), [19_500, 19_500, 20_000, null], 'item Registre : montants du propriétaire intacts');
  assert.equal(firestore.dump()[ROOT_PATH].patrimonialStatus, applied.report.projection.afterPlan.patrimonialStatus);

  // Sans --key : comportement inchangé, toutes les clés de projection absentes sont créées (montants recalculés).
  const all = await runCli({ firestore, argv: ['--allow-remote', '--projection-keys'], env: REMOTE_ENV });
  assert.deepEqual([all.exitCode, all.report.flags.projectionOnlyKeys, all.report.state.applied.create, all.report.state.applied.kept_projection], [0, [], 3, 0]);
  assert.deepEqual(moneyOf(firestore.dump()[ROOT_PATH]), [21_900, 21_900, 23_000, 23_000]);

  // --force --key <clé de projection> --projection-keys : la liste --key limite aussi les clés de projection touchées.
  const forcedOnly = createMemoryFirestore();
  await seedFoundations(forcedOnly, [REAL_UID]);
  await seedRootCreatedFromRegistry(forcedOnly);
  const forced = await runCli({ firestore: forcedOnly, argv: ['--dry-run', '--projection-keys', '--force', '--key', 'cartularia-creation-profile'], env: REMOTE_ENV });
  const forcedActions = Object.fromEntries(forced.report.state.entries.map((entry) => [entry.key, entry.action]));
  assert.deepEqual([forced.report.flags.forceKeys, forced.report.flags.projectionOnlyKeys, forcedActions['cartularia-creation-profile'], forcedActions['cartularia-purchase'], forcedActions['cartularia-specification-groups']], [['cartularia-creation-profile'], ['cartularia-creation-profile'], 'update', 'kept_projection', 'kept_projection']);
});

test('CLI mode create hors émulateur : refusé sans --allow-create (rien écrit, exit 1), signalé en --dry-run, accepté avec --allow-create ; sous émulateur inchangé', async () => {
  const remote = createMemoryFirestore();
  await seedFoundations(remote, [ROLEX_IMPORT_ACTOR_ID]);
  const before = remote.dump();

  const refused = await runCli({ firestore: remote, argv: ['--allow-remote'], env: REMOTE_ENV });
  assert.deepEqual([refused.exitCode, refused.failure.code, refused.report], [1, 'create_not_allowed_remote', null]);
  assert.deepEqual(remote.dump(), before);

  const dry = await runCli({ firestore: remote, argv: ['--dry-run'], env: REMOTE_ENV });
  assert.deepEqual([dry.exitCode, dry.report.ok, dry.report.mode, dry.report.flags.createAllowed, dry.report.sync], [1, false, 'create', false, { status: 'dry_run', expected: 'blocked', reason: 'create_not_allowed_remote' }]);
  assert.equal(dry.report.warnings[0].code, 'create_not_allowed_remote');
  assert.deepEqual(remote.dump(), before);

  const created = await runCli({ firestore: remote, argv: ['--allow-remote', '--allow-create'], env: REMOTE_ENV });
  assert.deepEqual([created.exitCode, created.report.ok, created.report.mode, created.report.imported.revision, created.report.sync.status], [0, true, 'create', 1, 'processed']);
  assert.equal(remote.dump()[ROOT_PATH].accountHolderId, ROLEX_IMPORT_ACTOR_ID);

  const local = createMemoryFirestore();
  await seedFoundations(local, [ROLEX_IMPORT_ACTOR_ID]);
  const seeded = await runCli({ firestore: local, argv: [], env: EMULATOR_ENV });
  assert.deepEqual([seeded.exitCode, seeded.report.mode, seeded.report.usesEmulator, seeded.report.flags.createAllowed, seeded.report.state.applied.create], [0, 'create', true, true, 14]);
  const again = await runCli({ firestore: local, argv: [], env: EMULATOR_ENV });
  assert.deepEqual([again.exitCode, again.report.mode, again.report.state.summary.unchanged, again.report.sync], [0, 'existing', 14, { status: 'skipped', reason: 'no_state_change' }]);
});

test('CLI : drapeau inconnu, --key sans --force, clé inconnue → exit 1 sans Firestore ; --help → aide sur stdout, exit 0', async () => {
  let created = 0;
  const firestore = () => { created += 1; return createMemoryFirestore(); };
  for (const [argv, code] of [[['--dry-run', '--oops'], 'invalid_argument'], [['--key', 'cartularia-editable-copy'], 'key_requires_force'], [['--force', '--key', 'cartularia-nope'], 'unknown_state_key']]) {
    const { exitCode, failure, report, stdout } = await runCli({ firestore, argv, env: EMULATOR_ENV });
    assert.deepEqual([exitCode, failure.code, report, stdout], [1, code, null, ''], argv.join(' '));
    assert.match(failure.message, /Utilisation/);
  }
  const help = await runCli({ firestore, argv: ['--help'], env: {} });
  assert.deepEqual([help.exitCode, help.report, help.failure], [0, null, null]);
  assert.match(help.stdout, /--projection-keys/);
  assert.match(help.stdout, /--resync/);
  assert.match(help.stdout, /--allow-create/);
  assert.match(help.stdout, /--replace-stale-request/);
  assert.equal(created, 0);
});

test('le script CLI refuse d’écrire hors émulateur sans --allow-remote, documente son usage et rejette une option inconnue sans initialiser Firebase', () => {
  const script = fileURLToPath(new URL('../scripts/import-rolex-cartulary.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.FIRESTORE_EMULATOR_HOST;
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  delete env.GCLOUD_PROJECT;
  delete env.FIREBASE_PROJECT_ID;
  const refused = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stderr.trim()).code, 'remote_not_allowed');
  assert.equal(refused.stdout, '');
  // Point 3 (tour 3) : --dry-run hors émulateur sans projet explicite → project_required avant toute initialisation Firebase.
  const noProject = spawnSync(process.execPath, [script, '--dry-run'], { env, encoding: 'utf8' });
  assert.equal(noProject.status, 1);
  assert.equal(JSON.parse(noProject.stderr.trim()).code, 'project_required');
  assert.equal(noProject.stdout, '');
  const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--dry-run/);
  assert.match(help.stdout, /--allow-remote/);
  assert.match(help.stdout, /--force --key/);
  const unknown = spawnSync(process.execPath, [script, '--dry-run', '--oops'], { env, encoding: 'utf8' });
  assert.equal(unknown.status, 1);
  assert.equal(JSON.parse(unknown.stderr.trim()).code, 'invalid_argument');
  const forced = spawnSync(process.execPath, [script, '--allow-remote', '--force'], { env, encoding: 'utf8' });
  assert.equal(forced.status, 1);
  assert.equal(JSON.parse(forced.stderr.trim()).code, 'force_requires_key');
});
