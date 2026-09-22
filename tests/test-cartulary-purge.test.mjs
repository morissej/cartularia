import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IWC_CARTULARY_ID, ROLEX_CARTULARY_ID } from '../src/domain/cartularyIds.ts';
import {
  applyTestCartularyPurge,
  isTestCartularyId,
  parseTestCartularyPurgeArgs,
  planTestCartularyPurge,
  runTestCartularyPurgeCli,
  TEST_CARTULARY_PURGE_USAGE,
} from '../scripts/lib/test-cartulary-purge-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const ID = 'cart_audit_cartularia_parcours_proprietaire_2026__d2adb72533ad';
const CODE = 'AUD-A3DA4019';
const OWNER = 'wave1-owner';
const REGISTRY = 'reg_collection_privee';
const ORGANIZATION = 'org_demo';
const OTHER_ID = 'cart_test_autre_objet_0001';
const ROOT = `cartularies/${ID}`;
const DRAFT = `privateDrafts/${OWNER}/cartularies/${ID}`;
const ITEM = `registries/${REGISTRY}/items/${ID}`;
const REMOTE_ENV = { GCLOUD_PROJECT: 'cartularia-prod-simule' };
const EMULATOR_ENV = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' };
const BASE_ARGS = ['--cartulary', ID, '--expect-public-code', CODE, '--expect-owner', OWNER];

/** Faux bucket Storage mémoire : seules getFiles({ prefix }) et deleteFiles({ prefix, force }) sont utilisées par la lib. */
const createMemoryBucket = (names = []) => {
  const files = new Set(names);
  return {
    files,
    calls: [],
    getFiles: async ({ prefix }) => [[...files].filter((name) => name.startsWith(prefix)).sort().map((name) => ({ name }))],
    deleteFiles: async ({ prefix, force }) => {
      if (force !== true) throw new Error('deleteFiles attend force: true (suppression par préfixe tolérante aux absents).');
      for (const name of [...files]) if (name.startsWith(prefix)) files.delete(name);
    },
  };
};

const root = (id, code, overrides = {}) => ({
  id, revision: 9, publicCode: code, objectCode: code, registryId: REGISTRY, organizationId: ORGANIZATION, accountHolderId: OWNER,
  schemaVersion: 'watch@1.6.0', lifecycleStatus: 'active', publicationStatus: 'revoked', integrityHead: 'sha256:aa', ...overrides,
});
const item = (id, code) => ({ cartularyId: id, registryId: REGISTRY, organizationId: ORGANIZATION, objectCode: code, projectionStatus: 'active', sourceRevision: 9 });

/** Firestore mémoire : IWC, Rolex et un autre objet de test partagent la base avec l'objet AUD-A3DA4019. */
const seedFirestore = ({ withObject = true } = {}) => {
  const documents = {
    [`organizations/${ORGANIZATION}`]: { id: ORGANIZATION, status: 'active' },
    [`organizations/${ORGANIZATION}/memberships/${OWNER}`]: { uid: OWNER, status: 'active', permissions: ['cartulary.edit'] },
    [`users/${OWNER}`]: { uid: OWNER, status: 'active' },
    [`registries/${REGISTRY}`]: { id: REGISTRY, organizationId: ORGANIZATION, itemCount: 4, updatedAt: 'avant' },
    [`cartularies/${IWC_CARTULARY_ID}`]: root(IWC_CARTULARY_ID, 'OP-4892-XZ9'),
    [`cartularies/${IWC_CARTULARY_ID}/auditEvents/evt_1`]: { cartularyId: IWC_CARTULARY_ID, sequence: 1 },
    [`cartularies/${IWC_CARTULARY_ID}/assets/a1/derivatives/d1`]: { derivativeId: 'd1' },
    [`registries/${REGISTRY}/items/${IWC_CARTULARY_ID}`]: item(IWC_CARTULARY_ID, 'OP-4892-XZ9'),
    [`integrityProjections/${IWC_CARTULARY_ID}`]: { cartularyId: IWC_CARTULARY_ID },
    [`privateDrafts/${OWNER}/cartularies/${IWC_CARTULARY_ID}`]: { ownerUid: OWNER, status: 'active' },
    [`privateDrafts/${OWNER}/cartularies/${IWC_CARTULARY_ID}/state/cartularia-public-code`]: { value: 'OP-4892-XZ9' },
    [`publications/OP-4892-XZ9`]: { cartularyId: IWC_CARTULARY_ID, status: 'published' },
    [`publications/OP-4892-XZ9/blocks/hero`]: { blockId: 'hero' },
    // Un sceau actif porte le statut 'issued' (scripts/lib/projection-command.mjs), jamais 'published'.
    [`seals/OP-4892-XZ9`]: { cartularyId: IWC_CARTULARY_ID, publicCode: 'OP-4892-XZ9', status: 'issued' },
    [`cartularies/${ROLEX_CARTULARY_ID}`]: root(ROLEX_CARTULARY_ID, 'ROL-487D9CAD'),
    [`cartularies/${ROLEX_CARTULARY_ID}/auditEvents/evt_1`]: { cartularyId: ROLEX_CARTULARY_ID, sequence: 1 },
    [`registries/${REGISTRY}/items/${ROLEX_CARTULARY_ID}`]: item(ROLEX_CARTULARY_ID, 'ROL-487D9CAD'),
    [`integrityProjections/${ROLEX_CARTULARY_ID}`]: { cartularyId: ROLEX_CARTULARY_ID },
    [`privateDrafts/${OWNER}/cartularies/${ROLEX_CARTULARY_ID}`]: { ownerUid: OWNER, status: 'active' },
    [`privateDrafts/${OWNER}/cartularies/${ROLEX_CARTULARY_ID}/binaries/b1`]: { storagePath: `private-drafts/${OWNER}/${ROLEX_CARTULARY_ID}/b1/${'0'.repeat(64)}/original` },
    [`cartularySyncRequests/${ROLEX_CARTULARY_ID}`]: { cartularyId: ROLEX_CARTULARY_ID, ownerUid: OWNER, status: 'processed' },
    [`timestampRequests/ts_rolex`]: { cartularyId: ROLEX_CARTULARY_ID, ownerUid: OWNER, status: 'processed' },
    [`timestampReceipts/ts_rolex`]: { cartularyId: ROLEX_CARTULARY_ID },
    [`integrityBatches/batch_rolex/receipts/leaf_0000`]: { cartularyId: ROLEX_CARTULARY_ID },
    [`cartularies/${OTHER_ID}`]: root(OTHER_ID, 'AUD-00000001'),
    [`registries/${REGISTRY}/items/${OTHER_ID}`]: item(OTHER_ID, 'AUD-00000001'),
    [`timestampRateLimits/${OWNER}/windows/2026-09-08T10`]: { count: 3 },
  };
  if (withObject) Object.assign(documents, {
    [ROOT]: root(ID, CODE),
    [`${ROOT}/sections/identity`]: { sectionId: 'identity' },
    [`${ROOT}/sections/provenance`]: { sectionId: 'provenance' },
    [`${ROOT}/sections/valuation`]: { sectionId: 'valuation' },
    [`${ROOT}/assets/a1`]: { assetId: 'a1' },
    [`${ROOT}/assets/a1/derivatives/presentation-v2`]: { derivativeId: 'presentation-v2' },
    [`${ROOT}/assets/a2`]: { assetId: 'a2' },
    [`${ROOT}/assets/a2/derivatives/presentation-v2`]: { derivativeId: 'presentation-v2' },
    [`${ROOT}/assets/a3`]: { assetId: 'a3' },
    [`${ROOT}/assets/a4`]: { assetId: 'a4' },
    [`${ROOT}/sources/src_1`]: { sourceId: 'src_1' },
    [`${ROOT}/auditEvents/evt_1`]: { cartularyId: ID, sequence: 1 },
    [`${ROOT}/auditEvents/evt_2`]: { cartularyId: ID, sequence: 2 },
    [`${ROOT}/auditEvents/evt_3`]: { cartularyId: ID, sequence: 3 },
    [`${ROOT}/commandReceipts/req_1`]: { command: 'importCartularyBundle' },
    [`${ROOT}/commandReceipts/req_2`]: { command: 'projectRegistryItem' },
    [`${ROOT}/liveState/current`]: { digest: 'sha256:bb' },
    [`${ROOT}/reminders/rem_1`]: { title: 'Tâche' },
    [`${ROOT}/websiteCleanup/req_9`]: { paths: [] },
    [`${ROOT}/websiteOperations/req_8`]: { previousPaths: [] },
    [ITEM]: item(ID, CODE),
    [`integrityProjections/${ID}`]: { cartularyId: ID, sourceRevision: 9 },
    [DRAFT]: { ownerUid: OWNER, status: 'active' },
    [`${DRAFT}/state/cartularia-public-code`]: { value: CODE },
    [`${DRAFT}/state/cartularia-creation-profile`]: { value: { secret: true } },
    [`${DRAFT}/state/cartularia-generic-sections`]: { value: [] },
    [`${DRAFT}/binaries/b1`]: { storagePath: `private-drafts/${OWNER}/${ID}/b1/${'1'.repeat(64)}/original` },
    [`${DRAFT}/binaries/b2`]: { storagePath: `private-drafts/${OWNER}/${ID}/b2/${'2'.repeat(64)}/original` },
    [`${DRAFT}/binaries/b3`]: { storagePath: `private-drafts/${OWNER}/${ID}/b3/${'3'.repeat(64)}/original` },
    [`${DRAFT}/binaries/b4`]: { storagePath: `private-drafts/${OWNER}/${ID}/b4/${'4'.repeat(64)}/original` },
    [`cartularyCreateRequests/${ID}`]: { cartularyId: ID, ownerUid: OWNER, status: 'processed' },
    [`cartularySyncRequests/${ID}`]: { cartularyId: ID, ownerUid: OWNER, status: 'processed' },
    [`timestampRequests/ts_aud_1`]: { cartularyId: ID, ownerUid: OWNER, status: 'processed' },
    [`timestampReceipts/ts_aud_1`]: { cartularyId: ID, tokenDigest: 'sha256:cc' },
    [`publications/${CODE}`]: { cartularyId: ID, status: 'revoked' },
    [`publications/${CODE}/blocks/hero`]: { blockId: 'hero' },
    [`publications/${CODE}/mediaAccess/a1`]: { derivativeIds: ['presentation-v2'] },
    [`seals/${CODE}`]: { cartularyId: ID, publicCode: CODE, status: 'revoked' },
  });
  return createMemoryFirestore(documents);
};
const OBJECT_FILES = [
  ...['b1', 'b2', 'b3', 'b4'].map((binary, index) => `private-drafts/${OWNER}/${ID}/${binary}/${String(index + 1).repeat(64)}/original`),
  ...['b1', 'b2', 'b3', 'b4'].map((binary) => `private-derivatives/${OWNER}/${ID}/${binary}/presentation-v2.webp`),
];
const FOREIGN_FILES = [
  `private-drafts/${OWNER}/${ROLEX_CARTULARY_ID}/b1/${'0'.repeat(64)}/original`,
  `private-derivatives/${OWNER}/${IWC_CARTULARY_ID}/b1/presentation-v2.webp`,
  'public/OP-4892-XZ9/a1/presentation-v2.webp',
];
const seedBucket = (extra = []) => createMemoryBucket([...OBJECT_FILES, ...FOREIGN_FILES, ...extra]);
const isObjectPath = (path) => path.includes(ID) || path.startsWith(`publications/${CODE}`) || path === `seals/${CODE}` || /^timestamp(Requests|Receipts)\/ts_aud_/.test(path);
const objectPaths = (dump) => Object.keys(dump).filter(isObjectPath).sort();
const foreignDump = (dump) => Object.fromEntries(Object.entries(dump).filter(([path]) => !isObjectPath(path) && path !== `registries/${REGISTRY}`));
const runCli = async ({ argv, env = REMOTE_ENV, firestore, bucket }) => {
  let stdout = '';
  let stderr = '';
  const result = await runTestCartularyPurgeCli({ argv, env, firestore, bucket, stdout: { write: (chunk) => { stdout += chunk; } }, stderr: { write: (chunk) => { stderr += chunk; } } });
  return { ...result, stdout, stderr, failure: stderr ? JSON.parse(stderr.trim()) : null };
};

/* ------------------------------------------------------------------ arguments */

test('gardes d’identifiant : seuls cart_audit_* et cart_test_* passent ; IWC, Rolex et cart_demo_* sont refusés', () => {
  assert.equal(isTestCartularyId(ID), true);
  assert.equal(isTestCartularyId('cart_test_x'), true);
  for (const refused of [IWC_CARTULARY_ID, ROLEX_CARTULARY_ID, 'cart_demo_car_2026', 'cart_audit_Maj', 'cart_audit_', 'cart_prod_x', '']) {
    assert.equal(isTestCartularyId(refused), false, refused);
    const parsed = parseTestCartularyPurgeArgs(['--cartulary', refused, '--expect-public-code', CODE], REMOTE_ENV);
    assert.equal(parsed.ok, false, refused);
    assert.equal(parsed.code, refused ? 'not_a_test_cartulary' : 'invalid_argument', refused);
  }
});

test('gardes d’arguments : --cartulary et --expect-public-code obligatoires, drapeau inconnu, --execute sans --confirm-test-purge, formes --clé=valeur, --help', () => {
  assert.equal(parseTestCartularyPurgeArgs([], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseTestCartularyPurgeArgs(['--cartulary', ID], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseTestCartularyPurgeArgs(['--cartulary'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseTestCartularyPurgeArgs([...BASE_ARGS, '--oops'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseTestCartularyPurgeArgs([...BASE_ARGS, '--expect-owner', 'uid avec espace'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseTestCartularyPurgeArgs([...BASE_ARGS, '--expect-public-code', 'aud-minuscule'], REMOTE_ENV).code, 'invalid_argument');
  assert.equal(parseTestCartularyPurgeArgs([...BASE_ARGS, '--execute'], REMOTE_ENV).code, 'confirmation_required');
  const parsed = parseTestCartularyPurgeArgs([`--cartulary=${ID}`, `--expect-public-code=${CODE}`, '--allow-remote', '--execute', '--confirm-test-purge', '--purge-publication'], REMOTE_ENV);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.options, {
    help: false, cartularyId: ID, expectedPublicCode: CODE, expectedOwner: null, allowRemote: true, execute: true, confirmTestPurge: true,
    purgePublication: true, projectId: 'cartularia-prod-simule', usesEmulator: false,
  });
  assert.equal(parseTestCartularyPurgeArgs(['--help'], {}).options.help, true);
  assert.equal(parseTestCartularyPurgeArgs([], EMULATOR_ENV).code, 'invalid_argument');
  assert.equal(parseTestCartularyPurgeArgs(BASE_ARGS, EMULATOR_ENV).options.projectId, 'cartularia-wave2-local');
  assert.match(TEST_CARTULARY_PURGE_USAGE, /run-with-firebase-cli-adc\.mjs -- node scripts\/purge-test-cartulary\.mjs[\s\S]*--execute --confirm-test-purge/);
});

/* ------------------------------------------------------------------ plan (simulation) */

test('simulation : inventaire exact et compté, aucune écriture (dump et bucket identiques), publication et sceau conservés', async () => {
  const firestore = seedFirestore();
  const bucket = seedBucket();
  const before = firestore.dump();
  const filesBefore = [...bucket.files].sort();
  const plan = await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE, expectedOwner: OWNER });
  assert.deepEqual(firestore.dump(), before);
  assert.deepEqual([...bucket.files].sort(), filesBefore);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.alreadyPurged, false);
  assert.equal(plan.publicCodeProof, 'root');
  assert.deepEqual({ ...plan.root, subcollections: undefined }, {
    path: ROOT, exists: true, revision: 9, publicCode: CODE, registryId: REGISTRY, organizationId: ORGANIZATION, accountHolderId: OWNER,
    schemaVersion: 'watch@1.6.0', lifecycleStatus: 'active', publicationStatus: 'revoked', descendantCount: 19, subcollections: undefined,
  });
  assert.deepEqual(plan.root.subcollections, [
    { path: `${ROOT}/assets`, count: 4 },
    { path: `${ROOT}/assets/a1/derivatives`, count: 1 },
    { path: `${ROOT}/assets/a2/derivatives`, count: 1 },
    { path: `${ROOT}/auditEvents`, count: 3 },
    { path: `${ROOT}/commandReceipts`, count: 2 },
    { path: `${ROOT}/liveState`, count: 1 },
    { path: `${ROOT}/reminders`, count: 1 },
    { path: `${ROOT}/sections`, count: 3 },
    { path: `${ROOT}/sources`, count: 1 },
    { path: `${ROOT}/websiteCleanup`, count: 1 },
    { path: `${ROOT}/websiteOperations`, count: 1 },
  ]);
  assert.deepEqual(plan.registry, { registryId: REGISTRY, path: `registries/${REGISTRY}`, exists: true, itemCount: 4, itemPath: ITEM, itemExists: true, projectionStatus: 'active', decrement: true });
  assert.deepEqual(plan.integrityProjection, { path: `integrityProjections/${ID}`, exists: true });
  assert.deepEqual({ ...plan.draft, subcollections: undefined }, { ownerUid: OWNER, path: DRAFT, exists: true, status: 'active', stateCount: 3, binaryCount: 4, descendantCount: 7, subcollections: undefined });
  assert.deepEqual(plan.storage, { available: true, prefixes: [
    { prefix: `private-drafts/${OWNER}/${ID}/`, kind: 'private', fileCount: 4, action: 'delete' },
    { prefix: `private-derivatives/${OWNER}/${ID}/`, kind: 'private', fileCount: 4, action: 'delete' },
    { prefix: `public/${CODE}/`, kind: 'public', fileCount: 0, action: 'keep' },
  ] });
  assert.deepEqual(plan.requests, {
    create: { path: `cartularyCreateRequests/${ID}`, exists: true, status: 'processed' },
    sync: { path: `cartularySyncRequests/${ID}`, exists: true, status: 'processed' },
    timestamp: [{ path: 'timestampRequests/ts_aud_1', status: 'processed' }],
  });
  assert.deepEqual(plan.receipts, [{ path: 'timestampReceipts/ts_aud_1' }]);
  assert.deepEqual(plan.publication, { path: `publications/${CODE}`, exists: true, status: 'revoked', blockCount: 1, mediaAccessCount: 1, action: 'keep' });
  assert.deepEqual(plan.seal, { path: `seals/${CODE}`, exists: true, status: 'revoked', action: 'keep' });
  assert.deepEqual(plan.references, { anchoringReceipts: [], exports: [], community: [], collectionPublications: [] });
  assert.deepEqual(plan.residues, { rootDescendants: 19, registryItem: 1, integrityProjection: 1, draft: 8, privateFiles: 8, publicFiles: 0, requests: 3, receipts: 1, publication: 0 });
  assert.equal(plan.residueCount, 41);
  // Jamais de valeur d'état ni de contenu Secret dans le plan.
  assert.doesNotMatch(JSON.stringify(plan), /secret|sha256:bb|sha256:cc/);
});

/* ------------------------------------------------------------------ exécution */

test('exécution : seuls les documents et fichiers de l’objet disparaissent ; IWC, Rolex, autre item, organisation, timestampRateLimits intacts ; itemCount décrémenté une seule fois ; public/ et publication conservés', async () => {
  const firestore = seedFirestore();
  const bucket = seedBucket();
  const before = firestore.dump();
  const plan = await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE, expectedOwner: OWNER });
  const applied = await applyTestCartularyPurge({ firestore, bucket, plan });
  const after = firestore.dump();
  assert.equal(applied.ok, true);
  assert.deepEqual(foreignDump(after), foreignDump(before));
  assert.deepEqual(objectPaths(after), [`publications/${CODE}`, `publications/${CODE}/blocks/hero`, `publications/${CODE}/mediaAccess/a1`, `seals/${CODE}`]);
  assert.equal(after[`registries/${REGISTRY}`].itemCount, 3);
  assert.deepEqual([...bucket.files].sort(), [...FOREIGN_FILES].sort());
  assert.deepEqual(applied.steps.map(({ step, status }) => [step, status]), [
    ['registry_item', 'deleted'], ['integrity_projection', 'deleted'], ['cartulary_root', 'deleted'], ['private_draft', 'deleted'],
    ['storage', 'deleted'], ['storage', 'deleted'], ['storage', 'kept'],
    ['create_request', 'deleted'], ['sync_request', 'deleted'], ['timestamp_requests', 'deleted'], ['timestamp_receipts', 'deleted'],
    ['publication', 'kept'], ['seal', 'kept'],
  ]);
  assert.deepEqual(applied.steps[0], { step: 'registry_item', status: 'deleted', path: ITEM, itemCountBefore: 4, itemCountAfter: 3 });
  assert.equal(applied.steps[2].documentCount, 20);
  assert.equal(applied.steps[3].documentCount, 8);
  assert.equal(applied.summary.deleted, 10);

  // Second passage : tout absent, itemCount inchangé (jamais décrémenté deux fois), déjà purgé.
  const second = await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE, expectedOwner: OWNER });
  assert.equal(second.ok, true);
  assert.equal(second.alreadyPurged, true);
  assert.equal(second.residueCount, 0);
  assert.deepEqual(second.registry, { registryId: null, path: null, exists: false, itemCount: null, itemPath: null, itemExists: false, projectionStatus: null, decrement: false }, 'plus aucun item : registre non résolu, aucune décrémentation possible');
  const appliedAgain = await applyTestCartularyPurge({ firestore, bucket, plan: second });
  assert.deepEqual(appliedAgain.steps.filter(({ status }) => status !== 'absent' && status !== 'kept'), []);
  assert.equal(firestore.dump()[`registries/${REGISTRY}`].itemCount, 3);
  assert.deepEqual(firestore.dump(), after);
});

test('--purge-publication : publications/{code} (blocks, mediaAccess), seals/{code} et public/{code}/ sont aussi supprimés', async () => {
  const firestore = seedFirestore();
  const bucket = seedBucket([`public/${CODE}/a1/presentation-v2.webp`]);
  const before = firestore.dump();
  const plan = await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE, expectedOwner: OWNER, purgePublication: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.storage.prefixes[2].action, 'delete');
  assert.equal(plan.residues.publication, 4);
  assert.equal(plan.residues.publicFiles, 1);
  const applied = await applyTestCartularyPurge({ firestore, bucket, plan });
  const after = firestore.dump();
  assert.deepEqual(objectPaths(after), []);
  assert.deepEqual(foreignDump(after), foreignDump(before));
  assert.deepEqual([...bucket.files].sort(), [...FOREIGN_FILES].sort());
  assert.deepEqual(applied.steps.filter(({ step }) => ['publication', 'seal'].includes(step)).map(({ status }) => status), ['deleted', 'deleted']);
  assert.equal(applied.steps.find(({ step }) => step === 'publication').documentCount, 3);
  assert.equal((await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE, purgePublication: true })).alreadyPurged, true);
});

test('racine absente avec résidus (item orphelin, brouillon, demandes) : les résidus sont nettoyés et itemCount décrémenté ; racine absente sans résidu : déjà purgé, code 0', async () => {
  const firestore = seedFirestore();
  const bucket = seedBucket();
  await firestore.doc(ROOT).delete();
  const plan = await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE });
  assert.equal(plan.ok, true);
  assert.equal(plan.root.exists, false);
  assert.equal(plan.root.descendantCount, 19);
  assert.equal(plan.registryId, REGISTRY, 'registre retrouvé par collectionGroup(items)');
  assert.equal(plan.ownerUid, OWNER, 'propriétaire retrouvé par la demande de création');
  assert.equal(plan.alreadyPurged, false);
  const applied = await applyTestCartularyPurge({ firestore, bucket, plan });
  assert.equal(applied.steps[0].itemCountAfter, 3);
  assert.equal(applied.steps[2].documentCount, 20, 'sous-collections orphelines et racine manquante retirées');
  assert.deepEqual(objectPaths(firestore.dump()), [`publications/${CODE}`, `publications/${CODE}/blocks/hero`, `publications/${CODE}/mediaAccess/a1`, `seals/${CODE}`]);

  const empty = seedFirestore({ withObject: false });
  const emptyBucket = createMemoryBucket(FOREIGN_FILES);
  const result = await runCli({ argv: [...BASE_ARGS, '--allow-remote'], firestore: empty, bucket: emptyBucket });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.event, 'TEST_CARTULARY_PURGE_PLAN');
  assert.equal(result.report.alreadyPurged, true);
  assert.equal(result.report.registry.registryId, null);
  const executed = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge'], firestore: empty, bucket: emptyBucket });
  assert.deepEqual([executed.exitCode, executed.report.event, executed.report.applied, executed.report.alreadyPurged], [0, 'TEST_CARTULARY_PURGE_PLAN', null, true]);
});

test('itemCount jamais négatif : Registre à itemCount 0 (ou sans compteur) avec item présent → item supprimé, compteur inchangé, decrement false', async () => {
  for (const itemCount of [0, undefined, 'quatre']) {
    const firestore = seedFirestore();
    const bucket = seedBucket();
    await firestore.doc(`registries/${REGISTRY}`).set({ id: REGISTRY, organizationId: ORGANIZATION, updatedAt: 'avant', ...(itemCount === undefined ? {} : { itemCount }) });
    const registryBefore = firestore.dump()[`registries/${REGISTRY}`];
    const plan = await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE, expectedOwner: OWNER });
    const expectedCount = itemCount === 0 ? 0 : null;
    assert.deepEqual(plan.registry, { registryId: REGISTRY, path: `registries/${REGISTRY}`, exists: true, itemCount: expectedCount, itemPath: ITEM, itemExists: true, projectionStatus: 'active', decrement: false }, String(itemCount));
    const applied = await applyTestCartularyPurge({ firestore, bucket, plan });
    assert.deepEqual(applied.steps[0], { step: 'registry_item', status: 'deleted', path: ITEM, itemCountBefore: expectedCount, itemCountAfter: expectedCount }, String(itemCount));
    const after = firestore.dump();
    assert.equal(after[ITEM], undefined, 'item supprimé');
    assert.deepEqual(after[`registries/${REGISTRY}`], registryBefore, `registre intact (itemCount ${String(itemCount)} jamais décrémenté sous zéro, updatedAt inchangé)`);
    assert.equal(after[`registries/${REGISTRY}/items/${IWC_CARTULARY_ID}`] !== undefined && after[`registries/${REGISTRY}/items/${ROLEX_CARTULARY_ID}`] !== undefined, true);
  }
});

test('décrémentation seulement si l’item existe : racine présente (registryId connu) et item jamais projeté → step registry_item absent, itemCount intact', async () => {
  const firestore = seedFirestore();
  const bucket = seedBucket();
  await firestore.doc(ITEM).delete();
  const before = firestore.dump();
  const plan = await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE, expectedOwner: OWNER });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.registry, { registryId: REGISTRY, path: `registries/${REGISTRY}`, exists: true, itemCount: 4, itemPath: ITEM, itemExists: false, projectionStatus: null, decrement: false });
  assert.equal(plan.residues.registryItem, 0);
  const applied = await applyTestCartularyPurge({ firestore, bucket, plan });
  assert.deepEqual(applied.steps[0], { step: 'registry_item', status: 'absent', path: ITEM, itemCountBefore: 4, itemCountAfter: 4 });
  const after = firestore.dump();
  assert.deepEqual(after[`registries/${REGISTRY}`], before[`registries/${REGISTRY}`], 'itemCount 4 conservé, updatedAt inchangé');
  assert.deepEqual(foreignDump(after), foreignDump(before));
  assert.equal(after[ROOT], undefined);
});

test('rapprochement du sceau : racine absente, code d’un autre Cartulaire, publication absente, sceau étranger issued + --purge-publication → bloqué, sceau et public/{code}/ intacts', async () => {
  const firestore = seedFirestore({ withObject: false });
  const foreignCode = 'AUD-ETRANGER1';
  await firestore.doc(`seals/${foreignCode}`).set({ cartularyId: OTHER_ID, publicCode: foreignCode, status: 'issued' });
  await firestore.doc(`cartularyCreateRequests/${ID}`).set({ cartularyId: ID, ownerUid: OWNER, status: 'processed' });
  const bucket = createMemoryBucket([...FOREIGN_FILES, `public/${foreignCode}/a1/presentation-v2.webp`]);
  const before = firestore.dump();
  const filesBefore = [...bucket.files].sort();
  const result = await runCli({ argv: ['--cartulary', ID, '--expect-public-code', foreignCode, '--allow-remote', '--execute', '--confirm-test-purge', '--purge-publication'], firestore, bucket });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.applied, null);
  assert.equal(result.report.publicCodeProof, null);
  assert.deepEqual(result.report.blockers.map(({ code, path }) => [code, path]).sort(), [
    ['public_code_mismatch', `seals/${foreignCode}`],
    ['public_code_unproven', `public/${foreignCode}/`],
    ['seal_published', `seals/${foreignCode}`],
  ]);
  assert.deepEqual(firestore.dump(), before);
  assert.deepEqual([...bucket.files].sort(), filesBefore);

  // Même sceau étranger mais révoqué : le rapprochement cartularyId bloque seul.
  await firestore.doc(`seals/${foreignCode}`).update({ status: 'revoked' });
  const revoked = await runCli({ argv: ['--cartulary', ID, '--expect-public-code', foreignCode, '--allow-remote', '--purge-publication'], firestore, bucket });
  assert.deepEqual(revoked.report.blockers.map(({ code }) => code).sort(), ['public_code_mismatch', 'public_code_unproven']);
  assert.deepEqual([...bucket.files].sort(), filesBefore);
});

test('code non prouvé : racine absente, ni publication ni sceau, public/{code}/ non vide → --purge-publication refusé ; sans le drapeau public_storage_not_empty ; préfixe vide et rien sous le code → déjà purgé', async () => {
  const firestore = seedFirestore({ withObject: false });
  const bucket = createMemoryBucket([...FOREIGN_FILES, `public/${CODE}/a1/presentation-v2.webp`]);
  const filesBefore = [...bucket.files].sort();
  const withFlag = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge', '--purge-publication'], firestore, bucket });
  assert.deepEqual([withFlag.exitCode, withFlag.report.applied, withFlag.report.publicCodeProof], [1, null, null]);
  assert.deepEqual(withFlag.report.blockers, [{ code: 'public_code_unproven', path: `public/${CODE}/`, count: 1, message: 'Racine absente et ni publications/{code} ni seals/{code} ne rattache le code public à --cartulary : --purge-publication refusé, rien n’est écrit.' }]);
  assert.deepEqual([...bucket.files].sort(), filesBefore);
  const withoutFlag = await runCli({ argv: [...BASE_ARGS, '--allow-remote'], firestore, bucket });
  assert.deepEqual([withoutFlag.exitCode, withoutFlag.report.blockers.map(({ code }) => code)], [1, ['public_storage_not_empty']]);

  // Sceau sans cartularyId (aucun rattachement possible) : refusé aussi, même révoqué.
  await firestore.doc(`seals/${CODE}`).set({ status: 'revoked' });
  const unowned = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--purge-publication'], firestore: firestore, bucket: createMemoryBucket(FOREIGN_FILES) });
  assert.deepEqual([unowned.exitCode, unowned.report.blockers.map(({ code }) => code)], [1, ['public_code_unproven']]);

  // Rien sous le code et préfixe vide : --purge-publication n'a rien à refuser, déjà purgé.
  const empty = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--purge-publication'], firestore: seedFirestore({ withObject: false }), bucket: createMemoryBucket(FOREIGN_FILES) });
  assert.deepEqual([empty.exitCode, empty.report.alreadyPurged, empty.report.blockers], [0, true, []]);
});

test('preuve par la publication ou le sceau : racine absente, publications/{code}.cartularyId (ou seals/{code}.cartularyId) = --cartulary → --purge-publication accepté, tout retiré', async () => {
  for (const proof of ['publication', 'seal']) {
    const firestore = seedFirestore();
    const bucket = seedBucket([`public/${CODE}/a1/presentation-v2.webp`]);
    await firestore.doc(ROOT).delete();
    if (proof === 'seal') {
      for (const path of [`publications/${CODE}`, `publications/${CODE}/blocks/hero`, `publications/${CODE}/mediaAccess/a1`]) await firestore.doc(path).delete();
    }
    const before = firestore.dump();
    const result = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge', '--purge-publication'], firestore, bucket });
    assert.deepEqual([result.exitCode, result.report.event, result.report.publicCodeProof, result.report.blockers], [0, 'TEST_CARTULARY_PURGE_APPLIED', proof, []], proof);
    const after = firestore.dump();
    assert.deepEqual(objectPaths(after), [], proof);
    assert.deepEqual(foreignDump(after), foreignDump(before), proof);
    assert.deepEqual([...bucket.files].sort(), [...FOREIGN_FILES].sort(), proof);
    assert.equal(after[`registries/${REGISTRY}`].itemCount, 3, proof);
  }
});

/* ------------------------------------------------------------------ bloquants */

const BLOCKING_CASES = [
  ['anchoring_receipt_reference', { 'integrityBatches/batch_aud/receipts/leaf_0001': { cartularyId: ID, index: 1 } }],
  ['export_reference', { 'cartularyExports/export_aud_1': { cartularyId: ID, status: 'ready' } }],
  ['community_reference', { 'communityPublications/community_aud_1': { cartularyId: ID, status: 'revoked' } }],
  ['collection_publication_reference', { [`collectionPublications/${REGISTRY}--col_1/items/${ID}`]: { cartularyId: ID, collectionId: 'col_1' } }],
  ['publication_published', { [`publications/${CODE}`]: { cartularyId: ID, status: 'published' } }],
  // Sceau actif : statut 'issued' (valeur du produit) ; tout statut autre que 'revoked' bloque.
  ['seal_published', { [`seals/${CODE}`]: { cartularyId: ID, status: 'issued' } }],
  ['seal_published', { [`seals/${CODE}`]: { cartularyId: ID, status: 'published' } }],
  ['seal_published', { [`seals/${CODE}`]: { cartularyId: ID } }],
  ['public_code_mismatch', { [`seals/${CODE}`]: { cartularyId: OTHER_ID, status: 'revoked' } }],
  ['request_in_flight', { [`cartularyCreateRequests/${ID}`]: { cartularyId: ID, ownerUid: OWNER, status: 'pending' } }],
  ['request_in_flight', { [`cartularySyncRequests/${ID}`]: { cartularyId: ID, ownerUid: OWNER, status: 'processing' } }],
  ['request_in_flight', { 'timestampRequests/ts_aud_2': { cartularyId: ID, ownerUid: OWNER, status: 'pending' } }],
  ['public_code_mismatch', { [ROOT]: root(ID, 'AUD-AUTRECODE') }],
  ['public_code_mismatch', { [`publications/${CODE}`]: { cartularyId: OTHER_ID, status: 'revoked' } }],
  ['owner_mismatch', { [ROOT]: root(ID, CODE, { accountHolderId: 'autre-proprietaire' }) }],
];

for (const [code, extra] of BLOCKING_CASES) {
  test(`bloquant ${code} (${Object.keys(extra)[0]}) : code 1, rien n’est écrit, même avec --execute --confirm-test-purge`, async () => {
    const firestore = seedFirestore();
    for (const [path, data] of Object.entries(extra)) await firestore.doc(path).set(data);
    const bucket = seedBucket();
    const before = firestore.dump();
    const filesBefore = [...bucket.files].sort();
    const result = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge'], firestore, bucket });
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.event, 'TEST_CARTULARY_PURGE_PLAN');
    assert.equal(result.report.ok, false);
    assert.equal(result.report.applied, null);
    assert.ok(result.report.blockers.some((entry) => entry.code === code && entry.path === Object.keys(extra)[0]), JSON.stringify(result.report.blockers));
    assert.deepEqual(firestore.dump(), before);
    assert.deepEqual([...bucket.files].sort(), filesBefore);
    await assert.rejects(applyTestCartularyPurge({ firestore, bucket, plan: await planTestCartularyPurge({ firestore, bucket, cartularyId: ID, expectedPublicCode: CODE, expectedOwner: OWNER }) }), { code: 'plan_blocked' });
    assert.deepEqual(firestore.dump(), before);
  });
}

test('bloquant public_storage_not_empty : public/{code}/ non vide sans --purge-publication → code 1, rien n’est écrit ; avec le drapeau le plan passe', async () => {
  const firestore = seedFirestore();
  const bucket = seedBucket([`public/${CODE}/a1/presentation-v2.webp`, `public/${CODE}/a2/presentation-v2.webp`]);
  const before = firestore.dump();
  const result = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge'], firestore, bucket });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.report.blockers, [{ code: 'public_storage_not_empty', path: `public/${CODE}/`, count: 2, message: `2 fichier(s) sous public/${CODE}/ sans --purge-publication : rien n’est écrit.` }]);
  assert.deepEqual(firestore.dump(), before);
  assert.equal(bucket.files.size, OBJECT_FILES.length + FOREIGN_FILES.length + 2);
  const allowed = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--purge-publication'], firestore, bucket });
  assert.deepEqual([allowed.exitCode, allowed.report.ok, allowed.report.storage.prefixes[2].fileCount], [0, true, 2]);
});

/* ------------------------------------------------------------------ CLI */

test('CLI : simulation par défaut (dump identique), exécution avec --execute --confirm-test-purge → TEST_CARTULARY_PURGE_APPLIED, second passage « absent » code 0', async () => {
  const firestore = seedFirestore();
  const bucket = seedBucket();
  const before = firestore.dump();
  const simulated = await runCli({ argv: [...BASE_ARGS, '--allow-remote'], firestore, bucket });
  assert.deepEqual([simulated.exitCode, simulated.report.event, simulated.report.dryRun, simulated.report.applied, simulated.stderr], [0, 'TEST_CARTULARY_PURGE_PLAN', true, null, '']);
  assert.deepEqual(JSON.parse(simulated.stdout), simulated.report);
  assert.deepEqual(firestore.dump(), before);
  const simulatedConfirmedOnly = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--confirm-test-purge'], firestore, bucket });
  assert.deepEqual([simulatedConfirmedOnly.exitCode, simulatedConfirmedOnly.report.applied], [0, null]);
  assert.deepEqual(firestore.dump(), before);

  const executed = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge'], firestore, bucket });
  assert.deepEqual([executed.exitCode, executed.report.event, executed.report.dryRun, executed.report.ok, executed.report.projectId, executed.report.usesEmulator], [0, 'TEST_CARTULARY_PURGE_APPLIED', false, true, 'cartularia-prod-simule', false]);
  assert.equal(executed.report.applied.summary.deleted, 10);
  assert.deepEqual(foreignDump(firestore.dump()), foreignDump(before));
  assert.equal(firestore.dump()[`registries/${REGISTRY}`].itemCount, 3);

  const again = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge'], firestore, bucket });
  assert.deepEqual([again.exitCode, again.report.event, again.report.alreadyPurged, again.report.applied, again.report.residueCount], [0, 'TEST_CARTULARY_PURGE_PLAN', true, null, 0]);
  assert.equal(firestore.dump()[`registries/${REGISTRY}`].itemCount, 3);
});

test('CLI : refus avant toute lecture — --execute sans --confirm-test-purge, sans --allow-remote (même en simulation), sans projet, mauvais code public, IWC/Rolex/demo', async () => {
  let created = 0;
  const factory = () => { created += 1; return seedFirestore(); };
  const cases = [
    [[...BASE_ARGS, '--allow-remote', '--execute'], REMOTE_ENV, 'confirmation_required'],
    [BASE_ARGS, REMOTE_ENV, 'remote_not_allowed'],
    [[...BASE_ARGS, '--allow-remote'], {}, 'project_required'],
    [[...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge'], {}, 'project_required'],
    [['--cartulary', IWC_CARTULARY_ID, '--expect-public-code', 'OP-4892-XZ9', '--allow-remote'], REMOTE_ENV, 'not_a_test_cartulary'],
    [['--cartulary', ROLEX_CARTULARY_ID, '--expect-public-code', 'ROL-487D9CAD', '--allow-remote'], REMOTE_ENV, 'not_a_test_cartulary'],
    [['--cartulary', 'cart_demo_car_2026', '--expect-public-code', 'CAR-00000001', '--allow-remote'], REMOTE_ENV, 'not_a_test_cartulary'],
    [['--cartulary', ID, '--allow-remote'], REMOTE_ENV, 'invalid_argument'],
    [[...BASE_ARGS, '--allow-remote', '--oops'], REMOTE_ENV, 'invalid_argument'],
  ];
  for (const [argv, env, code] of cases) {
    const result = await runCli({ argv, env, firestore: factory, bucket: factory });
    assert.deepEqual([result.exitCode, result.report, result.stdout, result.failure.event, result.failure.code], [1, null, '', 'TEST_CARTULARY_PURGE_FAILED', code], argv.join(' '));
  }
  assert.equal(created, 0, 'fabriques Firestore et Storage jamais appelées');

  // Mauvais code public : le plan lit la base, ne l'écrit pas, code 1.
  const firestore = seedFirestore();
  const before = firestore.dump();
  const mismatch = await runCli({ argv: ['--cartulary', ID, '--expect-public-code', 'AUD-FFFFFFFF', '--allow-remote', '--execute', '--confirm-test-purge'], firestore, bucket: seedBucket() });
  assert.deepEqual([mismatch.exitCode, mismatch.report.ok, mismatch.report.blockers[0].code], [1, false, 'public_code_mismatch']);
  assert.deepEqual(firestore.dump(), before);

  // Sous émulateur : ni projet ni --allow-remote requis.
  const emulated = await runCli({ argv: BASE_ARGS, env: EMULATOR_ENV, firestore: seedFirestore(), bucket: null });
  assert.deepEqual([emulated.exitCode, emulated.report.projectId, emulated.report.usesEmulator, emulated.report.storage.available, emulated.report.warnings[0].code], [0, 'cartularia-wave2-local', true, false, 'storage_unavailable']);
});

test('CLI réel (scripts/purge-test-cartulary.mjs) : aide, refus sans projet, sans --allow-remote et identifiant protégé, Firebase jamais initialisé', () => {
  const script = fileURLToPath(new URL('../scripts/purge-test-cartulary.mjs', import.meta.url));
  const env = { ...process.env, GCLOUD_PROJECT: '', FIREBASE_PROJECT_ID: '', FIRESTORE_EMULATOR_HOST: '', GOOGLE_APPLICATION_CREDENTIALS: '' };
  const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--confirm-test-purge/);
  const noProject = spawnSync(process.execPath, [script, ...BASE_ARGS, '--allow-remote'], { env, encoding: 'utf8' });
  assert.equal(noProject.status, 1);
  assert.equal(JSON.parse(noProject.stderr.trim()).code, 'project_required');
  const refused = spawnSync(process.execPath, [script, ...BASE_ARGS], { env: { ...env, GCLOUD_PROJECT: 'cartularia-prod-simule' }, encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stderr.trim()).code, 'remote_not_allowed');
  const protectedId = spawnSync(process.execPath, [script, '--cartulary', ROLEX_CARTULARY_ID, '--expect-public-code', 'ROL-487D9CAD', '--allow-remote', '--execute', '--confirm-test-purge'], { env: { ...env, GCLOUD_PROJECT: 'cartularia-prod-simule' }, encoding: 'utf8' });
  assert.equal(protectedId.status, 1);
  assert.equal(JSON.parse(protectedId.stderr.trim()).code, 'not_a_test_cartulary');
});

test('repli sans index de groupe : collectionGroup indisponible → parcours explicite des registres, publications de Collection et lots d’ancrage, bloquants toujours détectés, warning signalé', async () => {
  const withoutGroups = (firestore) => ({ ...firestore, collectionGroup: () => ({ where: () => ({ get: async () => { const error = new Error('9 FAILED_PRECONDITION: index requis'); error.code = 9; throw error; } }) }) });
  const clean = withoutGroups(seedFirestore());
  const plan = await planTestCartularyPurge({ firestore: clean, bucket: seedBucket(), cartularyId: ID, expectedPublicCode: CODE, expectedOwner: OWNER });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.warnings.map(({ code, group }) => [code, group]), [['collection_group_fallback', 'items'], ['collection_group_fallback', 'receipts']]);
  assert.deepEqual([plan.registryId, plan.registry.itemExists, plan.registry.decrement], [REGISTRY, true, true]);

  const orphan = seedFirestore();
  await orphan.doc(ROOT).delete();
  const orphanPlan = await planTestCartularyPurge({ firestore: withoutGroups(orphan), bucket: seedBucket(), cartularyId: ID, expectedPublicCode: CODE });
  assert.deepEqual([orphanPlan.registryId, orphanPlan.registry.itemExists], [REGISTRY, true], 'item orphelin retrouvé en parcourant registries/*');

  const blocked = seedFirestore();
  await blocked.doc('integrityBatches/batch_aud/receipts/leaf_0001').set({ cartularyId: ID, index: 1 });
  await blocked.doc(`collectionPublications/${REGISTRY}--col_1/items/${ID}`).set({ cartularyId: ID, collectionId: 'col_1' });
  const before = blocked.dump();
  const result = await runCli({ argv: [...BASE_ARGS, '--allow-remote', '--execute', '--confirm-test-purge'], firestore: withoutGroups(blocked), bucket: seedBucket() });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.report.blockers.map(({ code }) => code).sort(), ['anchoring_receipt_reference', 'collection_publication_reference']);
  assert.deepEqual(blocked.dump(), before);
});

test('racine absente : un propriétaire relu dans la demande de création différent de --expect-owner bloque (owner_mismatch), rien n’est écrit', async () => {
  const firestore = createMemoryFirestore();
  const cartularyId = 'cart_test_orphelin_expect_owner';
  await firestore.doc(`cartularyCreateRequests/${cartularyId}`).set({ ownerUid: 'autre-uid', status: 'processed', registryId: 'reg_x' });
  await firestore.doc(`privateDrafts/autre-uid/cartularies/${cartularyId}`).set({ status: 'active' });
  await firestore.doc(`privateDrafts/autre-uid/cartularies/${cartularyId}/state/cartularia-public-code`).set({ value: '"TST-1"', revision: 1, deleted: false });
  const before = firestore.dump();
  const plan = await planTestCartularyPurge({ firestore, bucket: null, cartularyId, expectedPublicCode: 'TST-1', expectedOwner: 'wave1-owner' });
  assert.equal(plan.ok, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === 'owner_mismatch'), 'owner_mismatch attendu quand le propriétaire relu diffère de --expect-owner');
  await assert.rejects(applyTestCartularyPurge({ firestore, bucket: null, plan }), (error) => error.code === 'plan_blocked');
  assert.deepEqual(firestore.dump(), before);
});
