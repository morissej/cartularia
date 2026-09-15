import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validRegistryThumbnail } from '../scripts/lib/presentation-variants.mjs';
import { normalizeRegistryThumbnail } from '../src/domain/registryThumbnail.ts';
import { Timestamp } from 'firebase-admin/firestore';
import { DEMO_ACCOUNT, DEMO_CARTULARIES } from '../src/data/demoCartularies.ts';
import {
  DEMO_REVIEWED_AT, buildDemoCartularyEnvelope, buildDemoRegistryItem, buildDemoAssetDocuments, buildDemoReminderDocuments, demoValuationAmounts,
} from '../src/data/demoCartularyDocuments.ts';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';
import { CANONICALIZATION_VERSION, sha256Digest } from '../scripts/lib/canonical-json.mjs';
import { SCHEMA_CONTRACT_DIGEST_VERSION, schemaContractDigest } from '../scripts/lib/schema-catalog-files.mjs';
import {
  DEMO_ENRICHMENT_VERSION, DEMO_REPAIR_VERSION, DEMO_THUMBNAIL_VERSION, assertDemoRepairScope, buildDemoAccessProjections, buildDemoRepairPlan, decodeBackupValue, demoRepairOptions,
  encodeBackupValue, enrichmentEventId, resolveExistingDemoUser, runDemoDataRepair, saveDemoRepairBackup,
} from '../scripts/lib/demo-data-repair.mjs';

const schema = JSON.parse(readFileSync(new URL('../firebase/schema-catalog/watch/1.6.0.json', import.meta.url), 'utf8'));
const schemaDigest = schemaContractDigest(schema);
const user = { uid: 'demo-existing-uid', email: 'fixture@registry.cartularia.invalid' };
const authUser = { ...user, disabled: false, emailVerified: true };
const registryPath = `registries/${DEMO_ACCOUNT.registryId}`;
const orgPath = `organizations/${DEMO_ACCOUNT.organizationId}`;
const schemaPath = 'schemaCatalog/watch/versions/1.6.0';
const collectionPath = `${registryPath}/collections/${DEMO_ACCOUNT.collectionId}`;
const occurredAt = '2026-09-06T12:30:00.000Z';
const enrichedAt = '2026-09-13T10:00:00.000Z';
const time = new Timestamp(1_780_000_000, 123_456_789);
const clone = (value) => decodeBackupValue(encodeBackupValue(value));
const accessesPath = `${registryPath}/accesses`;
const shortId = (id) => createHash('sha256').update(id).digest('hex').slice(0, 20);
const submariner = DEMO_CARTULARIES[0];

// Fixture « avant toute migration » : seed initial historique (revision 1, dossiers « à vérifier »,
// aucun média, aucun rappel, aucun accès), tel que la production l'était avant le 6 septembre.
function fixture() {
  const state = { documents: {}, queries: {} };
  const put = (path, data) => { state.documents[path] = { data: clone(data), updateTime: time }; };
  put(schemaPath, { schemaId: schema.schemaId, assetType: schema.assetType, version: schema.version, defaultVisibility: schema.defaultVisibility, fieldCount: schema.fieldCount, sectionIds: schema.sections, status: 'active', catalogDigest: schemaDigest, contractDigestVersion: SCHEMA_CONTRACT_DIGEST_VERSION });
  for (const section of schema.sections) {
    const path = `${schemaPath}/sections/${section}/fields`;
    const fields = schema.fields.filter((field) => field.sectionId === section);
    fields.forEach((field) => put(`${path}/${field.fieldId}`, field));
    state.queries[path] = fields.map((field) => `${path}/${field.fieldId}`).sort();
  }
  put(`users/${user.uid}`, { ...user, status: 'active', accountPurpose: 'public_read_only_demo' });
  put(orgPath, { id: DEMO_ACCOUNT.organizationId, name: 'Collection de démonstration Cartularia', status: 'active' });
  put(`${orgPath}/memberships/${user.uid}`, { uid: user.uid, organizationId: DEMO_ACCOUNT.organizationId, roles: ['guest'], status: 'active', scopes: { registryIds: [DEMO_ACCOUNT.registryId] }, permissions: ['organization.read', 'membership.read', 'registry.read', 'access.read', 'cartulary.read', 'cartulary.export'], revokedAt: null, accountPurpose: 'public_read_only_demo' });
  state.queries[`${orgPath}/memberships`] = [`${orgPath}/memberships/${user.uid}`];
  put(registryPath, { id: DEMO_ACCOUNT.registryId, organizationId: DEMO_ACCOUNT.organizationId, status: 'active', visibility: 'secret', itemCount: 5, accountPurpose: 'public_read_only_demo' });
  put(collectionPath, { id: DEMO_ACCOUNT.collectionId, registryId: DEMO_ACCOUNT.registryId, organizationId: DEMO_ACCOUNT.organizationId, name: 'Demo Montres', websiteTitle: 'Demo Montres', description: DEMO_ACCOUNT.collectionDescription, status: 'draft', visibility: 'secret', publicationConsent: false, publishedCartularyIds: [], publishedAt: null });
  state.queries.organizationRegistries = [registryPath];
  state.queries.organizationCartularies = DEMO_CARTULARIES.map(({ id }) => `cartularies/${id}`).sort();
  state.queries[`${registryPath}/items`] = DEMO_CARTULARIES.map(({ id }) => `${registryPath}/items/${id}`).sort();
  state.queries[`${registryPath}/collections`] = [collectionPath];
  for (const cartulary of DEMO_CARTULARIES) {
    const rootPath = `cartularies/${cartulary.id}`;
    const eventId = `evt_demo_${createHash('sha256').update(cartulary.id).digest('hex').slice(0, 20)}`;
    const event = { eventId, cartularyId: cartulary.id, sequence: 1, occurredAt: '2026-08-22T08:00:00.000Z', actor: { uid: user.uid, role: 'demo_seed' }, action: 'cartulary.demo.created', resource: { type: 'cartulary', id: cartulary.id }, beforeDigest: null, afterDigest: sha256Digest('historical demo content'), previousEventHash: `sha256:${'0'.repeat(64)}`, canonicalizationVersion: CANONICALIZATION_VERSION, requestId: `seed_demo_${cartulary.id}` };
    const hash = sha256Digest({ previousEventHash: event.previousEventHash, event });
    put(`${rootPath}/auditEvents/${eventId}`, { ...event, occurredAt: Timestamp.fromDate(new Date(event.occurredAt)), occurredAtIso: event.occurredAt, hash });
    state.queries[`${rootPath}/auditEvents`] = [`${rootPath}/auditEvents/${eventId}`];
    const root = { ...buildDemoCartularyEnvelope(cartulary, user.uid, hash), schemaDigest, integritySequence: 1, demo: true, demoDisclaimer: 'Exemplaire, documents, historique et valeurs fictifs.', createdAt: time, updatedAt: time };
    delete root.objectCode;
    delete root.netValuation;
    delete root.netAfterTaxValuation;
    root.costBasis = cartulary.purchasePrice;
    root.primaryAssetId = null;
    root.completenessLevel = 'imported_unreviewed';
    root.lastVerifiedAt = null;
    put(rootPath, root);
    const item = buildDemoRegistryItem(cartulary, event.afterDigest);
    item.objectCode = null;
    item.netValuation = null;
    item.netAfterTaxValuation = null;
    item.costBasis = cartulary.purchasePrice;
    item.primaryAssetId = null;
    item.completenessLevel = 'imported_unreviewed';
    delete item.thumbnail;
    put(`${registryPath}/items/${cartulary.id}`, { ...item, generatedAt: time });
    state.queries[`${rootPath}/assets`] = [];
    state.queries[`${rootPath}/reminders`] = [];
  }
  state.queries[accessesPath] = [];
  return state;
}

// Fixture « production du 13 septembre » : la réparation v1 est appliquée (53 écritures du 6
// septembre : médias, codes, montants, révision 2), mais aucun enrichissement v2.
function productionFixture() {
  const state = fixture();
  const put = (path, data) => { state.documents[path] = { data: clone(data), updateTime: time }; };
  state.documents[collectionPath].data.name = 'Les cinq icônes';
  state.documents[collectionPath].data.websiteTitle = 'Les cinq icônes';
  for (const cartulary of DEMO_CARTULARIES) {
    const rootPath = `cartularies/${cartulary.id}`;
    const seedEvent = state.documents[state.queries[`${rootPath}/auditEvents`][0]].data;
    const assets = buildDemoAssetDocuments(cartulary);
    const digest = sha256Digest({ repairVersion: DEMO_REPAIR_VERSION, cartularyId: cartulary.id, fixture: 'v1' });
    const eventId = `evt_${DEMO_REPAIR_VERSION.replaceAll('-', '_')}_${shortId(cartulary.id)}`;
    const event = { eventId, cartularyId: cartulary.id, sequence: 2, occurredAt, actor: { uid: user.uid, role: 'demo_data_repair' }, action: 'cartulary.demo.data_repaired', resource: { type: 'cartulary', id: cartulary.id }, beforeDigest: seedEvent.hash, afterDigest: digest, previousEventHash: seedEvent.hash, canonicalizationVersion: CANONICALIZATION_VERSION, requestId: `${DEMO_REPAIR_VERSION}_${cartulary.id}` };
    const hash = sha256Digest({ previousEventHash: seedEvent.hash, event });
    put(`${rootPath}/auditEvents/${eventId}`, { ...event, occurredAt: Timestamp.fromDate(new Date(occurredAt)), occurredAtIso: occurredAt, hash });
    state.queries[`${rootPath}/auditEvents`].push(`${rootPath}/auditEvents/${eventId}`);
    put(rootPath, { ...buildDemoCartularyEnvelope(cartulary, user.uid, hash), schemaDigest, revision: 2, integritySequence: 2, completenessLevel: 'imported_unreviewed', lastVerifiedAt: null, demo: true, demoDisclaimer: 'Exemplaire, documents, historique et valeurs fictifs.', createdAt: time, updatedAt: time });
    const { thumbnail: _thumbnail, ...itemV1 } = buildDemoRegistryItem(cartulary, digest);
    put(`${registryPath}/items/${cartulary.id}`, { ...itemV1, completenessLevel: 'imported_unreviewed', sourceRevision: 2, generatedAt: time, updatedAt: time });
    for (const asset of assets) put(`${rootPath}/assets/${asset.id}`, { ...asset, createdAt: time, updatedAt: time });
    state.queries[`${rootPath}/assets`] = assets.map((asset) => `${rootPath}/assets/${asset.id}`).sort();
  }
  return state;
}

// Événement de publication démo tel que l'écrit scripts/lib/demo-publication-command.mjs
// (createDemoAuditEvent : acteur demo_seed, eventId dérivé de action:requestId, beforeDigest = tête).
function appendPublicationEvent(state, cartulary, action) {
  const rootPath = `cartularies/${cartulary.id}`;
  const root = state.documents[rootPath].data;
  const sequence = root.integritySequence + 1;
  const requestId = `demo_${action === 'publication.published' ? 'publish' : 'revoke'}_${cartulary.id}_${sequence}`;
  const previousEventHash = root.integrityHead;
  const event = { eventId: `evt_${sha256Digest(`${action}:${requestId}`).slice(7, 31)}`, cartularyId: cartulary.id, sequence, occurredAt: enrichedAt, actor: { uid: user.uid, role: 'demo_seed' }, action, resource: { type: 'publication', id: cartulary.publicCode }, beforeDigest: previousEventHash, afterDigest: sha256Digest({ publication: cartulary.publicCode, sequence }), previousEventHash, canonicalizationVersion: CANONICALIZATION_VERSION, requestId };
  const hash = sha256Digest({ previousEventHash, event });
  const path = `${rootPath}/auditEvents/${event.eventId}`;
  state.documents[path] = { data: clone({ ...event, occurredAt: Timestamp.fromDate(new Date(enrichedAt)), occurredAtIso: enrichedAt, hash }), updateTime: time };
  state.queries[`${rootPath}/auditEvents`].push(path);
  Object.assign(root, { publicationStatus: action === 'publication.published' ? 'published' : 'revoked', revision: sequence, integritySequence: sequence, integrityHead: hash });
  return event;
}

const auditEventsOf = (state, cartularyId) => state.queries[`cartularies/${cartularyId}/auditEvents`].map((path) => state.documents[path].data);

function applyPlan(state, changes) {
  for (const change of changes) {
    const existing = state.documents[change.path];
    state.documents[change.path] = { data: { ...(existing?.data || {}), ...change.data }, updateTime: time };
    const collection = change.path.slice(0, change.path.lastIndexOf('/'));
    if (state.queries[collection] && !state.queries[collection].includes(change.path)) state.queries[collection].push(change.path);
  }
}

function fakeFirestore(state, { beforeTransaction } = {}) {
  const activity = { transactions: 0, committed: [] };
  const document = (path) => ({ kind: 'doc', path, get: async () => snapshot(path) });
  const snapshot = (path) => ({ ref: { path }, exists: Boolean(state.documents[path]), data: () => clone(state.documents[path].data), updateTime: state.documents[path]?.updateTime });
  const query = (path, name = path, maximum = Infinity) => ({ kind: 'query', path, name, where: () => query(path, path === 'cartularies' ? 'organizationCartularies' : 'organizationRegistries'), limit: (limit) => query(path, name, limit), get: async () => ({ docs: (state.queries[name] || []).slice(0, maximum).map(snapshot) }) });
  return {
    activity,
    doc: document,
    collection: query,
    runTransaction: async (handler) => {
      activity.transactions += 1;
      beforeTransaction?.();
      const pending = [];
      await handler({ get: (reference) => reference.get(), create: (ref, data) => pending.push({ path: ref.path, data }), update: (ref, data) => pending.push({ path: ref.path, data }) });
      activity.committed.push(...pending);
    },
  };
}

test('data-only est une simulation par défaut, exige un projet explicite et refuse les configurations ambiguës', () => {
  assert.deepEqual(demoRepairOptions(['--data-only', '--allow-remote'], { GCLOUD_PROJECT: 'test-demo' }), { dataOnly: true, apply: false, expectNoWrites: false, projectId: 'test-demo', usesEmulator: false, backupDirectory: undefined });
  assert.equal(demoRepairOptions(['--data-only', '--expect-no-writes'], { GCLOUD_PROJECT: 'test-demo', FIRESTORE_EMULATOR_HOST: 'localhost:1', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:2' }).expectNoWrites, true);
  for (const [args, env] of [
    [['--apply'], {}],
    [['--expect-no-writes'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-only', '--apply', '--expect-no-writes', '--allow-remote', '--backup-dir=/private/tmp'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-only'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-only', '--allow-remote'], {}],
    [['--data-only', '--allow-remote'], { GCLOUD_PROJECT: 'one', FIREBASE_PROJECT_ID: 'two' }],
    [['--data-only'], { FIRESTORE_EMULATOR_HOST: 'localhost:1234' }],
    [['--data-only', '--apply', '--allow-remote'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-only', '--apply', '--allow-remote', '--backup-dir=relative'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-only', '--allow-remote', '--unknown'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-olny', '--allow-remote'], { GCLOUD_PROJECT: 'test-demo' }],
    // Seed complet hors émulateurs : refusé même avec --allow-remote (oubli de --data-only contre la production).
    [['--allow-remote'], { GCLOUD_PROJECT: 'test-demo' }],
    [[], { GCLOUD_PROJECT: 'test-demo' }],
    [['--allow-remote'], { GCLOUD_PROJECT: 'test-demo', FIRESTORE_EMULATOR_HOST: 'localhost:1' }],
  ]) assert.throws(() => demoRepairOptions(args, env), /refusée/);
  assert.throws(() => demoRepairOptions(['--allow-remote'], { GCLOUD_PROJECT: 'test-demo' }), /seed complet est réservé aux émulateurs/);
  // Le seed complet reste possible sur les émulateurs (test:demo-account:full).
  assert.deepEqual(demoRepairOptions([], { FIRESTORE_EMULATOR_HOST: 'localhost:1', FIREBASE_AUTH_EMULATOR_HOST: 'localhost:2' }), { dataOnly: false, apply: false, expectNoWrites: false, projectId: 'cartularia-demo-local', usesEmulator: true, backupDirectory: undefined });
});

test('Auth est exclusivement lu ; compte manquant/désactivé/non vérifié ou privilégié refusé', async () => {
  assert.deepEqual(await resolveExistingDemoUser({ getUserByEmail: async () => authUser }, user.email), user);
  for (const candidate of [null, { ...authUser, disabled: true }, { ...authUser, emailVerified: false }, { ...authUser, email: 'other' }, { ...authUser, customClaims: { admin: true } }]) {
    await assert.rejects(resolveExistingDemoUser({ getUserByEmail: async () => candidate }, user.email), /refusée/);
  }
  await assert.rejects(resolveExistingDemoUser({ getUserByEmail: async () => { throw { code: 'auth/user-not-found' }; } }, user.email), /aucune création/);
});

test('le plan répare Galerie/codes/coût de revient/net sans remplacer Auth, droits, sections ou audit initial', () => {
  const state = fixture();
  for (const { id } of DEMO_CARTULARIES) {
    assert.equal(Object.hasOwn(state.documents[`cartularies/${id}`].data, 'objectCode'), false);
    assert.equal(state.documents[`${registryPath}/items/${id}`].data.objectCode, null);
    assert.equal(state.documents[`${registryPath}/items/${id}`].data.netValuation, null);
    assert.equal(state.documents[`${registryPath}/items/${id}`].data.netAfterTaxValuation, null);
  }
  const before = clone(state);
  const plan = buildDemoRepairPlan(state, user, schema, occurredAt);
  assert.deepEqual(state, before);
  assert.ok(plan.changes.length > 40 && plan.changes.length < 100);
  assert.ok(plan.changes.every(({ path }) => !/users\/|memberships\/|sections\/|ownerRelations\/|valuations\//.test(path)));
  assert.ok(plan.changes.every(({ path }) => !/\/auditEvents\/evt_demo_[a-f0-9]{20}$/.test(path)));
  applyPlan(state, plan.changes);
  for (const cartulary of DEMO_CARTULARIES) {
    const item = state.documents[`${registryPath}/items/${cartulary.id}`].data;
    assert.equal(item.objectCode, cartulary.publicCode);
    assert.equal(item.costBasis, demoValuationAmounts(cartulary).costBasis);
    assert.equal(item.netValuation, demoValuationAmounts(cartulary).netValuation);
    assert.ok(state.documents[`cartularies/${cartulary.id}/assets/${item.primaryAssetId}`].data.presentationDerivative.url.startsWith('/assets/demo-watches/'));
    assert.deepEqual(item.thumbnail, buildDemoRegistryItem(cartulary, item.contentHash).thumbnail, 'v3 posée dans la même mise à jour d’item');
  }
  assert.equal(state.documents[collectionPath].data.name, 'Les cinq icônes');
  assert.equal(assertDemoRepairScope(state, user, schema), schemaDigest);
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, occurredAt).changes, [], 'relancer la même réparation est idempotent');
});

test('les changements privés, marqueurs falsifiés et projections hors périmètre sont refusés avant remplacement', () => {
  const cartulary = DEMO_CARTULARIES[0];
  const rootPath = `cartularies/${cartulary.id}`;
  const cases = [
    (s) => { delete s.documents[`users/${user.uid}`].data.accountPurpose; },
    (s) => { s.documents[registryPath].data.accountPurpose = 'personal'; },
    (s) => { s.documents[`${orgPath}/memberships/${user.uid}`].data.permissions.push('cartulary.edit'); },
    (s) => { s.queries[`${orgPath}/memberships`].push(`${orgPath}/memberships/other`); },
    (s) => { s.queries.organizationCartularies.push('cartularies/real-object'); },
    (s) => { s.queries[`${registryPath}/items`].push(`${registryPath}/items/real-object`); },
    (s) => { s.documents[rootPath].data.demo = false; },
    (s) => { s.documents[rootPath].data.accountHolderId = 'other'; },
    (s) => { s.documents[rootPath].data.schemaVersion = '1.5.0'; },
    (s) => { s.documents[rootPath].data.objectCode = 'REAL-CODE'; },
    (s) => { s.documents[rootPath].data.costBasis = 123456; },
    (s) => { s.documents[rootPath].data.binaryId = 'real-private-original'; },
    (s) => { s.documents[rootPath].data.integrityHead = sha256Digest('tampered'); },
    (s) => { s.documents[`${registryPath}/items/${cartulary.id}`].data.organizationId = 'other'; },
    (s) => { s.documents[collectionPath].data.publicationConsent = true; },
    (s) => { s.documents[collectionPath].data.name = 'Ma vraie collection'; },
    (s) => { s.documents[schemaPath].data.catalogDigest = sha256Digest('different schema'); },
    (s) => { const p = s.queries[`${schemaPath}/sections/${schema.sections[0]}/fields`][0]; s.documents[p].data.label = 'tampered contract'; },
  ];
  for (const mutate of cases) {
    const state = fixture();
    mutate(state);
    assert.throws(() => buildDemoRepairPlan(state, user, schema, occurredAt), /refusée/);
  }
});

test('un original privé, une URL tierce, un média inconnu ou même un champ inattendu empêche toute écriture', () => {
  const cartulary = DEMO_CARTULARIES[0];
  const asset = buildDemoAssetDocuments(cartulary)[0];
  const path = `cartularies/${cartulary.id}/assets/${asset.id}`;
  for (const patch of [{ storagePath: 'private-drafts/real/originals/blob' }, { binaryId: 'private-original' }, { presentationDerivative: { url: 'https://third-party.test/original.jpg' } }, { sourceRefs: ['source_real'] }, { ownerName: 'real owner' }]) {
    const state = fixture();
    state.documents[path] = { data: { ...asset, ...patch }, updateTime: time };
    state.queries[`cartularies/${cartulary.id}/assets`] = [path];
    assert.throws(() => buildDemoRepairPlan(state, user, schema, occurredAt), /refusée/);
  }
  const state = fixture();
  state.documents[`${path}-unknown`] = { data: asset, updateTime: time };
  state.queries[`cartularies/${cartulary.id}/assets`] = [`${path}-unknown`];
  assert.throws(() => buildDemoRepairPlan(state, user, schema, occurredAt), /média inconnu/);
});

test('les nets historiques null des projections sont acceptés sans autoriser une valeur arbitraire ni les null des racines', () => {
  assert.doesNotThrow(() => buildDemoRepairPlan(fixture(), user, schema, occurredAt));
  for (const { id } of DEMO_CARTULARIES) {
    for (const field of ['netValuation', 'netAfterTaxValuation']) {
      for (const value of [0, -1, 123456, '9270']) {
        const state = fixture();
        state.documents[`${registryPath}/items/${id}`].data[field] = value;
        assert.throws(() => buildDemoRepairPlan(state, user, schema, occurredAt), /refusée/);
      }
      const rootState = fixture();
      rootState.documents[`cartularies/${id}`].data[field] = null;
      assert.throws(() => buildDemoRepairPlan(rootState, user, schema, occurredAt), /refusée/);
    }
  }
});

test('un média fictif partiel est complété sans remplacer ses dates ni autres documents', () => {
  const state = fixture();
  const cartulary = DEMO_CARTULARIES[0];
  const asset = buildDemoAssetDocuments(cartulary)[0];
  const path = `cartularies/${cartulary.id}/assets/${asset.id}`;
  const partial = { ...asset, createdAt: time };
  delete partial.presentationDerivative;
  state.documents[path] = { data: partial, updateTime: time };
  state.queries[`cartularies/${cartulary.id}/assets`] = [path];
  const change = buildDemoRepairPlan(state, user, schema, occurredAt).changes.find((entry) => entry.path === path);
  assert.equal(change.operation, 'update');
  assert.deepEqual(change.data, { presentationDerivative: asset.presentationDerivative });
});

test('le mode simulation ne démarre aucune transaction et ne sauvegarde rien', async () => {
  const firestore = fakeFirestore(fixture());
  let backupCalls = 0;
  const result = await runDemoDataRepair({ firestore, readAuth: { getUserByEmail: async () => authUser }, registryEmail: user.email, schema, options: { apply: false, projectId: 'test-demo' }, backup: () => { backupCalls += 1; } });
  assert.equal(result.applied, false);
  assert.equal(result.mode, 'dry-run');
  assert.ok(result.writes.length > 0);
  assert.equal(backupCalls, 0);
  assert.equal(firestore.activity.transactions, 0);
});

test('la sauvegarde précède la transaction unique et une dérive même non ciblée annule le lot entier', async () => {
  const state = fixture();
  let saved = false;
  const firestore = fakeFirestore(state, { beforeTransaction: () => { assert.equal(saved, true); } });
  const inputs = { firestore, readAuth: { getUserByEmail: async () => authUser }, registryEmail: user.email, schema, options: { apply: true, projectId: 'test-demo', backupDirectory: '/private/tmp' }, backup: () => { saved = true; return { path: 'fixture', digest: 'fixture' }; } };
  const result = await runDemoDataRepair(inputs);
  assert.equal(result.applied, true);
  assert.equal(firestore.activity.transactions, 1);
  assert.equal(firestore.activity.committed.length, result.writes.length);

  const changedState = fixture();
  const changedFirestore = fakeFirestore(changedState);
  await assert.rejects(runDemoDataRepair({ ...inputs, firestore: changedFirestore, backup: () => { changedState.documents[registryPath].updateTime = new Timestamp(time.seconds, time.nanoseconds + 1); return { path: 'fixture' }; } }), /changé depuis la sauvegarde/);
  assert.equal(changedFirestore.activity.committed.length, 0);

  const phantomState = fixture();
  const phantomFirestore = fakeFirestore(phantomState);
  await assert.rejects(runDemoDataRepair({ ...inputs, firestore: phantomFirestore, backup: () => { const path = `${orgPath}/memberships/other`; phantomState.queries[`${orgPath}/memberships`].push(path); phantomState.documents[path] = { data: { uid: 'other' }, updateTime: time }; return { path: 'fixture' }; } }), /changé depuis la sauvegarde/);
  assert.equal(phantomFirestore.activity.committed.length, 0);
});

test('erreur de sauvegarde ou compte désactivé pendant la préparation : zéro transaction', async () => {
  for (const variant of ['backup', 'auth']) {
    const firestore = fakeFirestore(fixture());
    let authReads = 0;
    await assert.rejects(runDemoDataRepair({ firestore, readAuth: { getUserByEmail: async () => (++authReads === 2 ? { ...authUser, disabled: true } : authUser) }, registryEmail: user.email, schema, options: { apply: true, projectId: 'test-demo', backupDirectory: '/private/tmp' }, backup: () => { if (variant === 'backup') throw new Error('disk full'); return { path: 'fixture' }; } }), variant === 'backup' ? /disk full/ : /aucune réactivation/);
    assert.equal(firestore.activity.transactions, 0);
  }
});

test('sauvegarde ciblée relisible, empreinte vérifiée, créations absentes enregistrées et timestamps nanoseconde intacts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cartularia-demo-repair-test-'));
  try {
    const state = fixture();
    const plan = buildDemoRepairPlan(state, user, schema, occurredAt);
    const saved = saveDemoRepairBackup(directory, 'test-demo', state, plan);
    const { digest, ...payload } = JSON.parse(readFileSync(saved.path, 'utf8'));
    assert.equal(digest, saved.digest);
    assert.equal(digest, sha256Digest(payload));
    assert.deepEqual(decodeBackupValue(payload.guards), state);
    assert.deepEqual(decodeBackupValue(payload.plan), plan);
    assert.equal(payload.before.length, plan.changes.length);
    assert.ok(payload.before.some(({ existed, document }) => existed === false && document === null));
    assert.equal(statSync(saved.path).mode & 0o777, 0o600);
    assert.equal(statSync(join(saved.path, '..')).mode & 0o777, 0o700);
    assert.throws(() => encodeBackupValue({ unsupported: new Date() }), /type Firestore inattendu/);
  } finally { rmSync(directory, { recursive: true }); }
});

// ------------------------------------------------------------------------------------------------
// Enrichissement démo v2 : dossiers « Complet », rappels de Suivi, projections d'Accès,
// rejouable après la publication réelle d'un objet démo (décision V2 (a)).
// ------------------------------------------------------------------------------------------------

test('v2 sur la production réparée : exactement 24 opérations, événement 3 par Cartulaire, aucun média ni Collection', () => {
  const state = productionFixture();
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, occurredAt).changes.filter(({ path }) => /\/assets\/|collections\//.test(path)), [], 'la v1 n’a plus rien à faire');
  const before = clone(state);
  const plan = buildDemoRepairPlan(state, user, schema, enrichedAt);
  assert.deepEqual(state, before);
  assert.equal(plan.enrichmentVersion, DEMO_ENRICHMENT_VERSION);
  assert.equal(plan.changes.length, 24);
  const count = (predicate) => plan.changes.filter(predicate).length;
  assert.equal(count(({ path, operation }) => /^cartularies\/[^/]+$/.test(path) && operation === 'update'), 5);
  assert.equal(count(({ path, operation }) => path.startsWith(`${registryPath}/items/`) && operation === 'update'), 5);
  assert.equal(count(({ path, operation }) => /\/auditEvents\/evt_demo_data_enrichment_v2_[a-f0-9]{20}$/.test(path) && operation === 'create'), 5);
  assert.equal(count(({ path, operation }) => /\/reminders\/rem_demo_/.test(path) && operation === 'create'), 6);
  assert.equal(count(({ path, operation }) => path.startsWith(`${accessesPath}/acc_demo_`) && operation === 'create'), 3);
  for (const cartulary of DEMO_CARTULARIES) {
    const rootPath = `cartularies/${cartulary.id}`;
    const rootUpdate = plan.changes.find(({ path }) => path === rootPath).data;
    const itemUpdate = plan.changes.find(({ path }) => path === `${registryPath}/items/${cartulary.id}`).data;
    const event = plan.changes.find(({ path }) => path === `${rootPath}/auditEvents/${enrichmentEventId(cartulary.id)}`).data;
    assert.deepEqual(Object.keys(rootUpdate).sort(), ['completenessLevel', 'integrityHead', 'integritySequence', 'lastVerifiedAt', 'revision']);
    assert.equal(rootUpdate.completenessLevel, 'complete');
    assert.equal(rootUpdate.lastVerifiedAt, DEMO_REVIEWED_AT);
    assert.equal(rootUpdate.revision, 3);
    assert.equal(rootUpdate.integritySequence, 3);
    assert.deepEqual(itemUpdate, { thumbnail: buildDemoRegistryItem(cartulary, 'x').thumbnail, completenessLevel: 'complete', sourceRevision: 3, contentHash: event.afterDigest });
    assert.equal(event.sequence, 3);
    assert.equal(event.action, 'cartulary.demo.enriched');
    assert.deepEqual(event.actor, { uid: user.uid, role: 'demo_data_enrichment' });
    assert.equal(event.requestId, `${DEMO_ENRICHMENT_VERSION}_${cartulary.id}`);
    assert.equal(event.beforeDigest, state.documents[rootPath].data.integrityHead);
    assert.equal(event.occurredAtIso, enrichedAt);
    assert.equal(rootUpdate.integrityHead, event.hash);
    // Les rappels créés portent l'UID réel du compte démo et jamais de date client.
    for (const reminder of buildDemoReminderDocuments(cartulary, user.uid)) {
      const change = plan.changes.find(({ path }) => path === `${rootPath}/reminders/${reminder.id}`);
      assert.deepEqual(change.data, reminder);
      assert.equal(change.data.createdBy, user.uid);
      assert.equal(Object.hasOwn(change.data, 'createdAt'), false);
    }
  }
  for (const access of buildDemoAccessProjections()) {
    const change = plan.changes.find(({ path }) => path === `${accessesPath}/${access.id}`);
    assert.deepEqual(change.stamps, ['generatedAt', 'updatedAt']);
    assert.ok(change.data.issuedAt instanceof Timestamp);
    assert.match(change.data.contentHash, /^sha256:[a-f0-9]{64}$/);
  }
});

test('v2 appliquée : chaîne recalculée valide par le vérificateur client, gardes acceptées, relance à zéro écriture', () => {
  const state = productionFixture();
  applyPlan(state, buildDemoRepairPlan(state, user, schema, enrichedAt).changes);
  for (const cartulary of DEMO_CARTULARIES) {
    const root = state.documents[`cartularies/${cartulary.id}`].data;
    const events = auditEventsOf(state, cartulary.id);
    assert.equal(events.length, 3);
    const audit = verifyAuditChain({ events, integrityHead: root.integrityHead, integritySequence: root.integritySequence });
    assert.deepEqual(audit.errors, []);
    assert.equal(audit.valid, true);
    assert.equal(root.revision, 3);
    assert.equal(root.completenessLevel, 'complete');
    assert.equal(state.documents[`${registryPath}/items/${cartulary.id}`].data.completenessLevel, 'complete');
    assert.equal(state.queries[`cartularies/${cartulary.id}/reminders`].length, buildDemoReminderDocuments(cartulary).length);
  }
  assert.equal(state.queries[accessesPath].length, 3);
  assert.equal(assertDemoRepairScope(state, user, schema), schemaDigest);
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, enrichedAt).changes, [], 'seconde simulation : zéro écriture');
});

test('émulateur : jeu déjà réparé par les builders v1 mais non revu → v2 s’enchaîne en séquence 2', () => {
  const state = fixture();
  const v1Plan = buildDemoRepairPlan(state, user, schema, occurredAt);
  // Simule un seed complet fait avec les builders du 6 septembre : médias, codes et montants à jour,
  // dossiers encore « à vérifier », sans aucun événement de réparation (séquence 1).
  for (const change of v1Plan.changes.filter(({ path }) => /\/assets\/|collections\//.test(path))) applyPlan(state, [change]);
  for (const cartulary of DEMO_CARTULARIES) {
    const expectedRoot = buildDemoCartularyEnvelope(cartulary, user.uid, state.documents[`cartularies/${cartulary.id}`].data.integrityHead);
    const root = state.documents[`cartularies/${cartulary.id}`].data;
    for (const key of ['objectCode', 'costBasis', 'netValuation', 'netAfterTaxValuation', 'primaryAssetId']) root[key] = expectedRoot[key];
    const item = state.documents[`${registryPath}/items/${cartulary.id}`].data;
    const expectedItem = buildDemoRegistryItem(cartulary, item.contentHash);
    for (const key of ['objectCode', 'costBasis', 'netValuation', 'netAfterTaxValuation', 'primaryAssetId']) item[key] = expectedItem[key];
  }
  const plan = buildDemoRepairPlan(state, user, schema, enrichedAt);
  assert.equal(plan.changes.length, 24);
  assert.ok(plan.changes.every(({ path }) => !path.includes('evt_demo_data_repair_v1')));
  for (const cartulary of DEMO_CARTULARIES) {
    assert.equal(plan.changes.find(({ path }) => path === `cartularies/${cartulary.id}`).data.integritySequence, 2);
    assert.equal(plan.changes.find(({ path }) => path === `cartularies/${cartulary.id}/auditEvents/${enrichmentEventId(cartulary.id)}`).data.sequence, 2);
  }
  applyPlan(state, plan.changes);
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, enrichedAt).changes, []);
});

test('rappel inconnu, rappel altéré, accès inconnu, destinataire non masqué ou divergence après v2 : refus avant toute écriture', () => {
  const rootPath = `cartularies/${submariner.id}`;
  const reminder = buildDemoReminderDocuments(submariner, user.uid)[0];
  const access = buildDemoAccessProjections()[0];
  const enriched = () => { const s = productionFixture(); applyPlan(s, buildDemoRepairPlan(s, user, schema, enrichedAt).changes); return s; };
  const cases = [
    [/hors périmètre démo/, () => { const s = productionFixture(); const p = `${rootPath}/reminders/rem_real_private`; s.documents[p] = { data: { ...reminder, id: 'rem_real_private' }, updateTime: time }; s.queries[`${rootPath}/reminders`] = [p]; return s; }],
    [/non fictive|hors périmètre/, () => { const s = enriched(); s.documents[`${rootPath}/reminders/${reminder.id}`].data.title = 'Appeler mon vrai assureur'; return s; }],
    [/hors périmètre/, () => { const s = enriched(); s.documents[`${rootPath}/reminders/${reminder.id}`].data.createdBy = 'someone-else'; return s; }],
    [/champ inattendu/, () => { const s = enriched(); s.documents[`${rootPath}/reminders/${reminder.id}`].data.note = 'privé'; return s; }],
    [/hors périmètre démo/, () => { const s = productionFixture(); const p = `${accessesPath}/acc_real_invitation`; s.documents[p] = { data: { ...access, id: 'acc_real_invitation' }, updateTime: time }; s.queries[accessesPath] = [p]; return s; }],
    [/non masqué/, () => { const s = enriched(); s.documents[`${accessesPath}/${access.id}`].data.recipientLabel = 'expert@example.com'; return s; }],
    [/non fictive|hors périmètre/, () => { const s = enriched(); s.documents[`${accessesPath}/${access.id}`].data.displayTitle = 'Mandat réel'; return s; }],
    [/non fictive/, () => { const s = enriched(); s.documents[`${accessesPath}/${access.id}`].data.consultationCount = 42; return s; }],
    [/nouvelle migration explicite/, () => { const s = enriched(); s.documents[rootPath].data.completenessLevel = 'imported_unreviewed'; return s; }],
    [/nouvelle migration explicite/, () => { const s = enriched(); s.documents[`${registryPath}/items/${submariner.id}`].data.completenessLevel = 'imported_unreviewed'; return s; }],
    [/non fictive/, () => { const s = enriched(); s.documents[rootPath].data.completenessLevel = 'partial'; return s; }],
    [/non fictive/, () => { const s = enriched(); s.documents[rootPath].data.lastVerifiedAt = '2026-09-13T00:00:00.000Z'; return s; }],
    [/en double/, () => { const s = enriched(); const events = s.queries[`${rootPath}/auditEvents`]; const twin = `${rootPath}/auditEvents/evt_twin`; s.documents[twin] = { data: { ...s.documents[events[2]].data, sequence: 4 }, updateTime: time }; events.push(twin); return s; }],
    [/action d’audit inconnue|action d'audit inconnue/, () => { const s = enriched(); s.documents[s.queries[`${rootPath}/auditEvents`][2]].data.action = 'cartulary.updated'; return s; }],
    [/hors périmètre|hors séquence/, () => { const s = enriched(); const e = s.queries[`${rootPath}/auditEvents`]; [s.documents[e[1]].data.sequence, s.documents[e[2]].data.sequence] = [3, 2]; return s; }],
  ];
  for (const [expected, build] of cases) {
    const state = build();
    assert.throws(() => buildDemoRepairPlan(state, user, schema, enrichedAt), expected);
  }
});

test('décision (a) : après la publication réelle signée par le seed démo, la relance v2 reste acceptée et vide', () => {
  const state = productionFixture();
  applyPlan(state, buildDemoRepairPlan(state, user, schema, enrichedAt).changes);
  const published = appendPublicationEvent(state, submariner, 'publication.published');
  assert.equal(published.sequence, 4);
  const root = state.documents[`cartularies/${submariner.id}`].data;
  assert.equal(root.publicationStatus, 'published');
  assert.equal(root.revision, 4);
  assert.equal(verifyAuditChain({ events: auditEventsOf(state, submariner.id), integrityHead: root.integrityHead, integritySequence: root.integritySequence }).valid, true);
  assert.equal(assertDemoRepairScope(state, user, schema), schemaDigest);
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, enrichedAt).changes, [], 'objet publié : aucune écriture');
  // Le Registre n'est pas reprojeté par la publication : la projection reste en révision 3.
  assert.equal(state.documents[`${registryPath}/items/${submariner.id}`].data.sourceRevision, 3);
  // Les quatre autres objets restent non publiés et n'ont rien à recevoir non plus.
  for (const cartulary of DEMO_CARTULARIES.slice(1)) assert.equal(state.documents[`cartularies/${cartulary.id}`].data.publicationStatus, 'none');

  const revoked = appendPublicationEvent(state, submariner, 'publication.revoked');
  assert.equal(revoked.sequence, 5);
  assert.equal(state.documents[`cartularies/${submariner.id}`].data.publicationStatus, 'revoked');
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, enrichedAt).changes, [], 'objet retiré : aucune écriture');
  appendPublicationEvent(state, submariner, 'publication.published');
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, enrichedAt).changes, [], 'republication : aucune écriture');
});

test('décision (a), limites : acteur étranger, statut de racine incohérent, retrait sans publication ou hash altéré sont refusés', () => {
  const rootPath = `cartularies/${submariner.id}`;
  const publishedState = () => { const s = productionFixture(); applyPlan(s, buildDemoRepairPlan(s, user, schema, enrichedAt).changes); appendPublicationEvent(s, submariner, 'publication.published'); return s; };
  const lastEvent = (s) => s.documents[s.queries[`${rootPath}/auditEvents`].at(-1)].data;
  const cases = [
    [/hors périmètre/, () => { const s = publishedState(); lastEvent(s).actor = { uid: user.uid, role: 'owner' }; return s; }],
    [/hors périmètre/, () => { const s = publishedState(); lastEvent(s).actor = { uid: 'real-owner-uid', role: 'demo_seed' }; return s; }],
    [/hors périmètre/, () => { const s = publishedState(); lastEvent(s).resource = { type: 'publication', id: 'REAL-CODE' }; return s; }],
    [/statut de publication incohérent/, () => { const s = publishedState(); s.documents[rootPath].data.publicationStatus = 'none'; return s; }],
    [/statut de publication incohérent/, () => { const s = productionFixture(); applyPlan(s, buildDemoRepairPlan(s, user, schema, enrichedAt).changes); s.documents[rootPath].data.publicationStatus = 'published'; return s; }],
    [/statut de publication incohérent/, () => { const s = publishedState(); s.documents[rootPath].data.publicationStatus = 'suspended'; return s; }],
    [/retrait sans publication/, () => { const s = productionFixture(); applyPlan(s, buildDemoRepairPlan(s, user, schema, enrichedAt).changes); appendPublicationEvent(s, submariner, 'publication.revoked'); return s; }],
    [/chaîne d’audit incohérente|chaîne d'audit incohérente/, () => { const s = publishedState(); lastEvent(s).afterDigest = sha256Digest('tampered publication'); return s; }],
    [/révision ou tête/, () => { const s = publishedState(); s.documents[rootPath].data.revision = 3; return s; }],
    [/mal formé/, () => { const s = publishedState(); lastEvent(s).requestId = ''; return s; }],
  ];
  for (const [expected, build] of cases) {
    const state = build();
    assert.throws(() => buildDemoRepairPlan(state, user, schema, enrichedAt), expected);
  }
  // Un enrichissement v2 demandé après une publication est encore possible : événement 4 après le 3 de publication.
  const late = productionFixture();
  appendPublicationEvent(late, submariner, 'publication.published');
  const plan = buildDemoRepairPlan(late, user, schema, enrichedAt);
  assert.equal(plan.changes.find(({ path }) => path === rootPath).data.integritySequence, 4);
  assert.equal(plan.changes.find(({ path }) => path === rootPath).data.completenessLevel, 'complete');
  assert.equal(Object.hasOwn(plan.changes.find(({ path }) => path === rootPath).data, 'publicationStatus'), false, 'la v2 ne touche jamais au statut de publication');
  applyPlan(late, plan.changes);
  assert.equal(late.documents[rootPath].data.publicationStatus, 'published');
  assert.deepEqual(buildDemoRepairPlan(late, user, schema, enrichedAt).changes, []);
});

test('--expect-no-writes : refus fermé tant que des écritures restent, succès sur l’état enrichi ; horodatages serveur ciblés', async () => {
  const pending = fakeFirestore(productionFixture());
  const readAuth = { getUserByEmail: async () => authUser };
  await assert.rejects(runDemoDataRepair({ firestore: pending, readAuth, registryEmail: user.email, schema, options: { apply: false, expectNoWrites: true, projectId: 'test-demo' } }), /--expect-no-writes/);
  assert.equal(pending.activity.transactions, 0);

  const state = productionFixture();
  const firestore = fakeFirestore(state);
  const applied = await runDemoDataRepair({ firestore, readAuth, registryEmail: user.email, schema, options: { apply: true, projectId: 'test-demo', backupDirectory: '/private/tmp' }, backup: () => ({ path: 'fixture', digest: 'fixture' }) });
  assert.equal(applied.applied, true);
  assert.equal(applied.writes.length, 24);
  const isServerStamp = (value) => value && value.constructor?.name === 'ServerTimestampTransform';
  for (const { path, data } of firestore.activity.committed) {
    if (path.includes('/auditEvents/')) assert.ok(!('createdAt' in data) && !('updatedAt' in data), 'événement daté par occurredAt uniquement');
    else if (path.includes('/reminders/')) assert.ok(isServerStamp(data.createdAt) && isServerStamp(data.updatedAt));
    else if (path.startsWith(accessesPath)) assert.ok(isServerStamp(data.generatedAt) && isServerStamp(data.updatedAt) && !('createdAt' in data));
    else assert.ok(isServerStamp(data.updatedAt) && !('createdAt' in data));
  }
  applyPlan(state, applied.writes.map(({ path }) => firestore.activity.committed.find((entry) => entry.path === path)).map(({ path, data }) => ({ path, data: Object.fromEntries(Object.entries(data).filter(([, value]) => !isServerStamp(value))) })));
  const quiet = await runDemoDataRepair({ firestore: fakeFirestore(state), readAuth, registryEmail: user.email, schema, options: { apply: false, expectNoWrites: true, projectId: 'test-demo' } });
  assert.deepEqual(quiet.writes, []);
  assert.equal(quiet.applied, false);
});

// ------------------------------------------------------------------------------------------------
// V3 — vignette de bundle sur les projections (contrat unique K3/K8) : cinq mises à jour d'item,
// aucun événement d'audit, aucune racine ni actif touchés, rejouable avant ou après publication.
// ------------------------------------------------------------------------------------------------

const enrichedProduction = () => { const s = productionFixture(); applyPlan(s, buildDemoRepairPlan(s, user, schema, enrichedAt).changes); return s; };
const withoutThumbnails = (state) => { for (const { id } of DEMO_CARTULARIES) delete state.documents[`${registryPath}/items/${id}`].data.thumbnail; return state; };

test('v3 sur la production enrichie et publiée : exactement cinq écritures item { thumbnail }, sans audit, racine ni actif', () => {
  assert.equal(DEMO_THUMBNAIL_VERSION, 'demo-data-enrichment-v3');
  const state = withoutThumbnails(enrichedProduction());
  appendPublicationEvent(state, submariner, 'publication.published');
  const before = clone(state);
  const plan = buildDemoRepairPlan(state, user, schema, enrichedAt);
  assert.deepEqual(state, before);
  assert.equal(plan.thumbnailVersion, DEMO_THUMBNAIL_VERSION);
  assert.equal(plan.changes.length, 5);
  for (const cartulary of DEMO_CARTULARIES) {
    const change = plan.changes.find(({ path }) => path === `${registryPath}/items/${cartulary.id}`);
    assert.equal(change.operation, 'update');
    assert.deepEqual(change.data, { thumbnail: buildDemoRegistryItem(cartulary, 'x').thumbnail });
    assert.equal(change.data.thumbnail.kind, 'bundle');
    assert.ok(validRegistryThumbnail(change.data.thumbnail), 'vignette v3 valide pour le serveur (empreinte préfixée)');
    assert.ok(normalizeRegistryThumbnail(change.data.thumbnail), 'vignette v3 acceptée par le client');
    assert.match(change.data.thumbnail.path, /^\/assets\/demo-watches\/derivatives\/.+\.240\.webp$/);
    assert.equal(change.data.thumbnail.assetId, state.documents[`${registryPath}/items/${cartulary.id}`].data.primaryAssetId);
  }
  assert.ok(plan.changes.every(({ path }) => !/auditEvents|\/assets\/|^cartularies\/[^/]+$/.test(path)), 'ni audit, ni actif, ni racine');
  applyPlan(state, plan.changes);
  for (const cartulary of DEMO_CARTULARIES) {
    const item = state.documents[`${registryPath}/items/${cartulary.id}`].data;
    assert.equal(item.sourceRevision, 3, 'révision de projection inchangée');
    assert.equal(item.contentHash, before.documents[`${registryPath}/items/${cartulary.id}`].data.contentHash, 'vignette hors contentHash');
  }
  const root = state.documents[`cartularies/${submariner.id}`].data;
  assert.equal(root.revision, 4);
  assert.equal(root.publicationStatus, 'published');
  assert.equal(verifyAuditChain({ events: auditEventsOf(state, submariner.id), integrityHead: root.integrityHead, integritySequence: root.integritySequence }).valid, true);
  assert.equal(assertDemoRepairScope(state, user, schema), schemaDigest);
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, enrichedAt).changes, [], 'seconde simulation : zéro écriture');
});

test('v3 : une vignette altérée, incomplète ou d’un autre genre est refusée avant toute écriture ; une vignette absente n’est pas une dérive', () => {
  const itemPath = `${registryPath}/items/${submariner.id}`;
  const expected = buildDemoRegistryItem(submariner, 'x').thumbnail;
  const cases = [
    [/non fictive|non reconnue/, (s) => { s.documents[itemPath].data.thumbnail = { ...expected, path: '/assets/private/real-object.240.webp' }; }],
    [/non fictive|non reconnue/, (s) => { s.documents[itemPath].data.thumbnail = { ...expected, sha256: 'f'.repeat(64) }; }],
    [/non fictive|non reconnue/, (s) => { s.documents[itemPath].data.thumbnail = { kind: 'inline', dataUrl: 'data:image/webp;base64,AA==', width: 240, height: 240, assetId: expected.assetId, sha256: expected.sha256 }; }],
    [/non fictive|non reconnue/, (s) => { const { sha256: _sha, ...partial } = expected; s.documents[itemPath].data.thumbnail = partial; }],
  ];
  for (const [pattern, mutate] of cases) {
    const state = enrichedProduction();
    mutate(state);
    assert.throws(() => buildDemoRepairPlan(state, user, schema, enrichedAt), pattern);
  }
  const state = enrichedProduction();
  delete state.documents[itemPath].data.thumbnail;
  assert.doesNotThrow(() => assertDemoRepairScope(state, user, schema));
  assert.deepEqual(buildDemoRepairPlan(state, user, schema, enrichedAt).changes.map(({ path, data }) => [path, Object.keys(data)]), [[itemPath, ['thumbnail']]]);
});

test('v3 appliquée en une transaction : horodatage serveur updatedAt seul, sauvegarde versionnée, --expect-no-writes ensuite', async () => {
  const state = withoutThumbnails(enrichedProduction());
  const firestore = fakeFirestore(state);
  const readAuth = { getUserByEmail: async () => authUser };
  await assert.rejects(runDemoDataRepair({ firestore: fakeFirestore(clone(state)), readAuth, registryEmail: user.email, schema, options: { apply: false, expectNoWrites: true, projectId: 'test-demo' } }), /--expect-no-writes/);
  const directory = mkdtempSync(join(tmpdir(), 'cartularia-demo-v3-'));
  try {
    const applied = await runDemoDataRepair({ firestore, readAuth, registryEmail: user.email, schema, options: { apply: true, projectId: 'test-demo', backupDirectory: directory } });
    assert.equal(applied.applied, true);
    assert.equal(applied.writes.length, 5);
    assert.ok(applied.writes.every(({ path, operation }) => path.startsWith(`${registryPath}/items/`) && operation === 'update'));
    const backup = JSON.parse(readFileSync(applied.backup.path, 'utf8'));
    assert.equal(backup.thumbnailVersion, DEMO_THUMBNAIL_VERSION);
    assert.ok(applied.backup.path.includes(DEMO_THUMBNAIL_VERSION));
    assert.equal(backup.before.length, 5);
    assert.ok(backup.before.every(({ existed, document }) => existed === true && document !== null), 'les cinq items existaient : restauration possible');
    const isServerStamp = (value) => value && value.constructor?.name === 'ServerTimestampTransform';
    for (const { data } of firestore.activity.committed) {
      assert.deepEqual(Object.keys(data).sort(), ['thumbnail', 'updatedAt']);
      assert.ok(isServerStamp(data.updatedAt));
    }
    applyPlan(state, firestore.activity.committed.map(({ path, data }) => ({ path, data: { thumbnail: data.thumbnail } })));
    const quiet = await runDemoDataRepair({ firestore: fakeFirestore(state), readAuth, registryEmail: user.email, schema, options: { apply: false, expectNoWrites: true, projectId: 'test-demo' } });
    assert.deepEqual(quiet.writes, []);
  } finally { rmSync(directory, { recursive: true }); }
});
