import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { DEMO_ACCOUNT, DEMO_CARTULARIES } from '../src/data/demoCartularies.ts';
import { buildDemoCartularyEnvelope, buildDemoRegistryItem, buildDemoAssetDocuments, demoValuationAmounts } from '../src/data/demoCartularyDocuments.ts';
import { CANONICALIZATION_VERSION, sha256Digest } from '../scripts/lib/canonical-json.mjs';
import { SCHEMA_CONTRACT_DIGEST_VERSION, schemaContractDigest } from '../scripts/lib/schema-catalog-files.mjs';
import {
  assertDemoRepairScope, buildDemoRepairPlan, decodeBackupValue, demoRepairOptions,
  encodeBackupValue, resolveExistingDemoUser, runDemoDataRepair, saveDemoRepairBackup,
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
const time = new Timestamp(1_780_000_000, 123_456_789);
const clone = (value) => decodeBackupValue(encodeBackupValue(value));

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
    put(rootPath, root);
    const item = buildDemoRegistryItem(cartulary, event.afterDigest);
    item.objectCode = null;
    item.netValuation = null;
    item.netAfterTaxValuation = null;
    item.costBasis = cartulary.purchasePrice;
    item.primaryAssetId = null;
    put(`${registryPath}/items/${cartulary.id}`, { ...item, generatedAt: time });
    state.queries[`${rootPath}/assets`] = [];
  }
  return state;
}

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
  assert.deepEqual(demoRepairOptions(['--data-only', '--allow-remote'], { GCLOUD_PROJECT: 'test-demo' }), { dataOnly: true, apply: false, projectId: 'test-demo', usesEmulator: false, backupDirectory: undefined });
  for (const [args, env] of [
    [['--apply'], {}],
    [['--data-only'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-only', '--allow-remote'], {}],
    [['--data-only', '--allow-remote'], { GCLOUD_PROJECT: 'one', FIREBASE_PROJECT_ID: 'two' }],
    [['--data-only'], { FIRESTORE_EMULATOR_HOST: 'localhost:1234' }],
    [['--data-only', '--apply', '--allow-remote'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-only', '--apply', '--allow-remote', '--backup-dir=relative'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-only', '--allow-remote', '--unknown'], { GCLOUD_PROJECT: 'test-demo' }],
    [['--data-olny', '--allow-remote'], { GCLOUD_PROJECT: 'test-demo' }],
  ]) assert.throws(() => demoRepairOptions(args, env), /refusée/);
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
