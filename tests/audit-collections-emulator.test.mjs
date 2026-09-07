import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { initializeApp, deleteApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertNewCollectionAssignments, deleteEmptyRegistryCollection, saveRegistryCollectionCommand } from '../scripts/lib/collection-command.mjs';
import { registryCollectionVersion } from '../scripts/lib/collection-policy.mjs';
import { acceptRegistryInvitation, issueRegistryInvitation, revokeRegistryInvitation } from '../scripts/lib/invitation-command.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:38480') throw new Error('Test exclusivement réservé à Firestore Emulator 38480.');
const projectId = 'cartularia-audit-collections-test';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const paths = new Set();
let app, db;
before(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  app = initializeApp({ projectId, credential: cert({ projectId, clientEmail: `emulator-only@${projectId}.iam.gserviceaccount.com`, privateKey }) }, `collections-${runId}`);
  db = getFirestore(app);
});
after(async () => { for (const path of paths) await db.doc(path).delete(); await db.terminate(); await deleteApp(app); });
const owned = (path) => { paths.add(path); return db.doc(path); };
async function fixture(label) {
  const uid = `${runId}-${label}`, registryId = `reg-${uid}`, organizationId = `org-${uid}`, collectionId = `col-${uid}`;
  const input = { firestore: db, uid, registryId, collectionId, confirmed: true, expectedVersion: registryCollectionVersion({ updatedAt: Timestamp.fromMillis(1234) }) };
  const collection = owned(`registries/${registryId}/collections/${collectionId}`);
  const publication = owned(`collectionPublications/${registryId}--${collectionId}`);
  const member = owned(`organizations/${organizationId}/memberships/${uid}`);
  const profile = owned(`users/${uid}`);
  await Promise.all([
    owned(`registries/${registryId}`).set({ organizationId }),
    profile.set({ status: 'active' }),
    member.set({ uid, status: 'active', permissions: ['cartulary.edit', 'publication.manage'], scopes: { registryIds: [registryId] } }),
    collection.set({ registryId, organizationId, status: 'draft', updatedAt: Timestamp.fromMillis(1234) }),
    publication.set({ publicationId: publication.id, registryId, organizationId, collectionId, status: 'published' }),
  ]);
  return { input, collection, publication, member, profile, organizationId };
}
test('C05 : suppression atomique des parents vide/public et répétition idempotente', async () => {
  const { input, collection, publication } = await fixture('empty');
  assert.deepEqual(await deleteEmptyRegistryCollection(input), { status: 'deleted', alreadyAbsent: false });
  assert.equal((await collection.get()).exists, false); assert.equal((await publication.get()).exists, false);
  assert.deepEqual(await deleteEmptyRegistryCollection(input), { status: 'deleted', alreadyAbsent: true });
});
test('C05 : la recréation du même identifiant ne ressuscite aucun ancien élément public', async () => {
  const { input, collection, publication, organizationId } = await fixture('recreation');
  const oldItem = owned(`${publication.path}/items/old-item`);
  await oldItem.set({ cartularyId: oldItem.id, collectionId: input.collectionId, displayTitle: 'Ancienne sélection' });
  await deleteEmptyRegistryCollection(input);
  assert.equal((await oldItem.get()).exists, false);
  await Promise.all([
    collection.set({ registryId: input.registryId, organizationId, status: 'published', publishedCartularyIds: ['new-item'] }),
    publication.set({ publicationId: publication.id, registryId: input.registryId, organizationId, collectionId: input.collectionId, status: 'published' }),
    owned(`${publication.path}/items/new-item`).set({ cartularyId: 'new-item', collectionId: input.collectionId }),
  ]);
  assert.deepEqual((await publication.collection('items').get()).docs.map((item) => item.id), ['new-item']);
});
for (const missingParent of ['collection', 'both']) test(`C05 : nettoie les orphelins lorsque ${missingParent} est absent`, async () => {
  const { input, collection, publication } = await fixture(`orphan-${missingParent}`);
  const orphan = owned(`${publication.path}/items/orphan`);
  await orphan.set({ cartularyId: orphan.id, collectionId: input.collectionId });
  await collection.delete();
  if (missingParent === 'both') await publication.delete();
  assert.deepEqual(await deleteEmptyRegistryCollection(input), { status: 'deleted', alreadyAbsent: true });
  assert.equal((await orphan.get()).exists, false);
  assert.equal((await publication.get()).exists, false);
});
test('C05 : refuse 201 enfants sans supprimer aucun document', async () => {
  const { input, collection, publication } = await fixture('over-limit');
  const batch = db.batch();
  for (let index = 0; index < 201; index++) batch.set(owned(`${publication.path}/items/item-${index}`), { collectionId: input.collectionId });
  await batch.commit();
  await assert.rejects(deleteEmptyRegistryCollection(input), { code: 'failed-precondition' });
  assert.equal((await collection.get()).exists, true);
  assert.equal((await publication.get()).exists, true);
  assert.equal((await publication.collection('items').get()).size, 201);
});
test('C05 : refuse une publication étrangère malgré un identifiant composite identique', async () => {
  const { input, collection, publication } = await fixture('foreign-publication');
  const foreign = owned(`${publication.path}/items/foreign`);
  await foreign.set({ collectionId: 'foreign-collection' });
  await publication.update({ registryId: 'foreign-registry', collectionId: 'foreign-collection' });
  for (const targetExists of [true, false]) {
    if (!targetExists) await collection.delete();
    await assert.rejects(deleteEmptyRegistryCollection(input), { code: 'permission-denied' });
    assert.equal((await publication.get()).exists, true);
    assert.equal((await foreign.get()).exists, true);
    assert.equal((await collection.get()).exists, targetExists);
  }
});
test('C05 : refuse un enfant orphelin étranger sans parent pour établir son identité', async () => {
  const { input, collection, publication } = await fixture('foreign-orphan');
  const foreign = owned(`${publication.path}/items/foreign`);
  await foreign.set({ collectionId: 'foreign-collection' });
  await Promise.all([collection.delete(), publication.delete()]);
  await assert.rejects(deleteEmptyRegistryCollection(input), { code: 'permission-denied' });
  assert.equal((await foreign.get()).exists, true);
});
for (const source of ['cartularies', 'items']) for (const field of ['collectionId', 'collectionIds']) {
  test(`C05 : refuse un objet référencé dans ${source}.${field}`, async () => {
    const { input, collection, publication } = await fixture(`${source}-${field}`);
    const path = source === 'items' ? `registries/${input.registryId}/items/item` : `cartularies/${input.registryId}-item`;
    await owned(path).set({ registryId: input.registryId, [field]: field === 'collectionId' ? input.collectionId : [input.collectionId] });
    await assert.rejects(deleteEmptyRegistryCollection(input), { code: 'failed-precondition' });
    assert.equal((await collection.get()).exists, true); assert.equal((await publication.get()).exists, true);
  });
}
test('C05 : droits retirés, invité restreint, démo, version périmée et absence de confirmation', async () => {
  const { input, member, profile } = await fixture('rights');
  await assert.rejects(deleteEmptyRegistryCollection({ ...input, confirmed: false }), { code: 'invalid-argument' });
  await assert.rejects(deleteEmptyRegistryCollection({ ...input, expectedVersion: 'stale-version' }), { code: 'aborted' });
  await profile.update({ accountPurpose: 'public_read_only_demo' });
  await assert.rejects(deleteEmptyRegistryCollection(input), { code: 'permission-denied' });
  await profile.update({ accountPurpose: 'private' });
  await member.update({ invitationManaged: true, invitationGrants: { [input.registryId]: { registry: false } } });
  await assert.rejects(deleteEmptyRegistryCollection(input), { code: 'permission-denied' });
  await member.update({ invitationManaged: false, status: 'revoked' });
  await assert.rejects(deleteEmptyRegistryCollection(input), { code: 'permission-denied' });
});
test('C05 : aucune affectation vers une Collection absente, étrangère ou archivée', async () => {
  const { input, collection, organizationId } = await fixture('assignment');
  const assign = () => db.runTransaction((transaction) => assertNewCollectionAssignments({ transaction, firestore: db, registryId: input.registryId, organizationId, previous: {}, next: { collectionIds: [input.collectionId] } }));
  await assign();
  await collection.update({ status: 'archived' });
  await assert.rejects(assign(), { code: 'failed-precondition' });
  await collection.update({ status: 'draft', organizationId: 'foreign' });
  await assert.rejects(assign(), { code: 'failed-precondition' });
  await collection.delete(); await assert.rejects(assign(), { code: 'failed-precondition' });
});
test('C05 : course réelle affectation/suppression sans référence pendante', async () => {
  const { input, collection, organizationId } = await fixture('concurrency');
  const item = owned(`cartularies/${input.registryId}-concurrent`);
  const results = await Promise.allSettled([
    deleteEmptyRegistryCollection(input),
    db.runTransaction(async (transaction) => {
      await assertNewCollectionAssignments({ transaction, firestore: db, registryId: input.registryId, organizationId, previous: {}, next: { collectionIds: [input.collectionId] } });
      transaction.set(item, { registryId: input.registryId, collectionIds: [input.collectionId] });
    }),
  ]);
  const [currentCollection, currentItem] = await Promise.all([collection.get(), item.get()]);
  assert.ok(!currentItem.exists || currentCollection.exists, 'Un objet ne doit jamais pointer vers une Collection supprimée.');
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
});

const privateInput = () => ({ name: 'Collection locale', description: 'Description', websiteTitle: 'Titre public', websiteSlug: '', status: 'draft', visibility: 'secret', publicationConsent: false, publishedCartularyIds: [] });
const saveInput = (input, changes = {}) => ({ ...input, mode: 'update', input: privateInput(), ...changes });
async function addSelectedObject(env, suffix = 'selected') {
  const { input, organizationId } = env;
  const id = `${input.registryId}-${suffix}`;
  const root = owned(`cartularies/${id}`);
  const item = owned(`registries/${input.registryId}/items/${id}`);
  await root.set({ organizationId, registryId: input.registryId, collectionId: 'primary', collectionIds: ['primary', input.collectionId], objectCode: 'OBJ-FICTIF', serialNumber: 'SECRET' });
  await item.set({ organizationId, registryId: input.registryId, cartularyId: id, collectionId: 'primary', collectionIds: ['primary', input.collectionId], assetType: 'car', projectionStatus: 'active', displayTitle: 'Voiture fictive', makerName: 'Atelier', modelName: 'Prototype', referenceCode: 'REF', manufactureYear: 1967, purchasePrice: 10000, grossValuation: 20000, privatePath: 'private/secret' });
  owned(`${env.publication.path}/items/${id}`);
  return { id, root, item };
}

test('N-R01 : jeton exact, ancien timestamp nanosecondes et course entre deux sauvegardes', async () => {
  const env = await fixture('save-cas');
  const firstTimestamp = new Timestamp(123, 455000), secondTimestamp = new Timestamp(123, 456000);
  assert.equal(Math.floor(firstTimestamp.toMillis()), Math.floor(secondTimestamp.toMillis()));
  await env.collection.update({ updatedAt: secondTimestamp });
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input, { expectedVersion: registryCollectionVersion({ updatedAt: firstTimestamp }) })), { code: 'aborted' });
  const exact = registryCollectionVersion({ updatedAt: secondTimestamp });
  const results = await Promise.allSettled([
    saveRegistryCollectionCommand(saveInput(env.input, { expectedVersion: exact, input: { ...privateInput(), name: 'Session A' } })),
    saveRegistryCollectionCommand(saveInput(env.input, { expectedVersion: exact, input: { ...privateInput(), name: 'Session B' } })),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'aborted');
  assert.match((await env.collection.get()).data().versionToken, /^collection_[0-9a-f-]+$/);
});

test('N-R01/02 : supprimer puis enregistrer une ancienne saisie ne recrée rien ; créer deux fois refuse', async () => {
  const env = await fixture('save-deleted');
  await deleteEmptyRegistryCollection(env.input);
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input)), { code: 'not-found' });
  assert.equal((await env.collection.get()).exists, false);
  const created = await saveRegistryCollectionCommand(saveInput(env.input, { mode: 'create' }));
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input, { mode: 'create' })), { code: 'already-exists' });
  assert.equal((await env.collection.get()).data().versionToken, created.versionToken);
  await assert.rejects(deleteEmptyRegistryCollection(env.input), { code: 'aborted' });
  await assert.rejects(deleteEmptyRegistryCollection({ ...env.input, expectedVersion: undefined, expectedUpdatedAtMillis: 1234 }), { code: 'invalid-argument' });
});

test('N-R01 : révocation préservée face à une publication ancienne et consentement explicite obligatoire', async () => {
  const env = await fixture('save-revocation');
  const object = await addSelectedObject(env);
  const publishedInput = { ...privateInput(), publicationConsent: true, publishedCartularyIds: [object.id], status: 'published', visibility: 'public' };
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input, { input: publishedInput })), { code: 'failed-precondition' });
  const published = await saveRegistryCollectionCommand(saveInput(env.input, { input: publishedInput, confirmedPublication: true }));
  const revoked = await saveRegistryCollectionCommand(saveInput(env.input, { expectedVersion: published.versionToken }));
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input, { expectedVersion: published.versionToken, input: publishedInput, confirmedPublication: true })), { code: 'aborted' });
  assert.equal((await env.publication.get()).data().status, 'revoked');
  assert.equal((await env.publication.collection('items').get()).size, 0);
  assert.equal((await env.collection.get()).data().versionToken, revoked.versionToken);
});

test('N-R01 : projection publique minimale issue de sources autorisées et rattachement secondaire vérifié', async () => {
  const env = await fixture('save-source'); const object = await addSelectedObject(env);
  const input = { ...privateInput(), publicationConsent: true, publishedCartularyIds: [object.id] };
  const result = await saveRegistryCollectionCommand(saveInput(env.input, { input, confirmedPublication: true }));
  const item = (await env.publication.collection('items').doc(object.id).get()).data();
  assert.deepEqual(Object.keys(item).sort(), ['cartularyId', 'collectionId', 'assetType', 'displayTitle', 'makerName', 'modelName', 'referenceCode', 'manufactureYear', 'publicCode'].sort());
  assert.equal(item.publicCode, 'OBJ-FICTIF');
  await object.root.update({ collectionIds: [] });
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input, { input, confirmedPublication: true, expectedVersion: result.versionToken })), { code: 'failed-precondition' });
  await object.root.update({ collectionIds: [env.input.collectionId], organizationId: 'foreign-org' });
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input, { input, confirmedPublication: true, expectedVersion: result.versionToken })), { code: 'failed-precondition' });
});

test('N-R01 : permission de publication distincte, lecteur, démo et compte révoqué refusés', async () => {
  const env = await fixture('save-rights'); const object = await addSelectedObject(env);
  const input = { ...privateInput(), publicationConsent: true, publishedCartularyIds: [object.id] };
  await env.member.update({ permissions: ['cartulary.edit'] });
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input, { input, confirmedPublication: true })), { code: 'permission-denied' });
  await assert.rejects(deleteEmptyRegistryCollection(env.input), { code: 'permission-denied' });
  await env.member.update({ permissions: ['cartulary.read'] });
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input)), { code: 'permission-denied' });
  await env.member.update({ permissions: ['cartulary.edit', 'publication.manage'] });
  await env.profile.update({ accountPurpose: 'public_read_only_demo' });
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input)), { code: 'permission-denied' });
  await env.profile.update({ accountPurpose: 'private' }); await env.member.update({ status: 'revoked' });
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input)), { code: 'permission-denied' });
});

test('N-R01 : limite 200 et remplacement atomique de 200 anciens objets par 200 nouveaux', async () => {
  const env = await fixture('save-limit');
  await assert.rejects(saveRegistryCollectionCommand(saveInput(env.input, { input: { ...privateInput(), publishedCartularyIds: Array.from({ length: 201 }, (_, i) => `item_${i}`) } })), { code: 'invalid-argument' });
  const selected = [];
  const sourceBatch = db.batch(), oldBatch = db.batch();
  for (let index = 0; index < 200; index++) {
    const id = `${env.input.registryId}-new-${index}`; selected.push(id);
    const common = { organizationId: env.organizationId, registryId: env.input.registryId, collectionId: env.input.collectionId };
    sourceBatch.set(owned(`cartularies/${id}`), common);
    sourceBatch.set(owned(`registries/${env.input.registryId}/items/${id}`), { ...common, cartularyId: id, projectionStatus: 'active', assetType: 'car', displayTitle: `Objet ${index}`, makerName: 'Atelier', modelName: 'Prototype' });
    owned(`${env.publication.path}/items/${id}`);
    oldBatch.set(owned(`${env.publication.path}/items/old-${index}`), { collectionId: env.input.collectionId });
  }
  await sourceBatch.commit(); await oldBatch.commit();
  await saveRegistryCollectionCommand(saveInput(env.input, { input: { ...privateInput(), publicationConsent: true, publishedCartularyIds: selected }, confirmedPublication: true }));
  const result = await env.publication.collection('items').get();
  assert.equal(result.size, 200); assert.ok(result.docs.every((entry) => selected.includes(entry.id)));
});

test('N-R05 : invitation d’une Collection vide/secondaire, acceptation bornée et révocation réelles en émulateur', async () => {
  const env = await fixture('invitation-secondary');
  const guestUid = `${env.input.uid}-guest`;
  await env.member.update({ organizationId: env.organizationId, roles: ['legal_owner'], permissions: ['registry.read', 'cartulary.edit', 'access.read'] });
  const parameters = { firestore: db, auth: { generateSignInWithEmailLink: async (_email, settings) => `https://auth.example.test/action?continueUrl=${encodeURIComponent(settings.url)}` }, actorUid: env.input.uid, registryId: env.input.registryId, recipientEmail: 'fixture@example.test', scopeType: 'collection', scopeId: env.input.collectionId, displayTitle: 'Collection fictive', continueUrl: 'http://127.0.0.1:5174/invitation/accept' };
  const previousEmulator = process.env.FUNCTIONS_EMULATOR; process.env.FUNCTIONS_EMULATOR = 'true';
  try {
    const issued = await issueRegistryInvitation(parameters);
    for (const path of [`registryInvitations/${issued.invitationId}`, `mail/${issued.invitationId}`, `registries/${env.input.registryId}/accesses/${issued.invitationId}`, `users/${guestUid}`, `organizations/${env.organizationId}/memberships/${guestUid}`]) owned(path);
    const token = new URL(new URL(issued.signInLink).searchParams.get('continueUrl')).searchParams.get('token');
    await acceptRegistryInvitation({ firestore: db, actorUid: guestUid, actorEmail: 'fixture@example.test', invitationId: issued.invitationId, token });
    const membership = db.doc(`organizations/${env.organizationId}/memberships/${guestUid}`);
    const rights = (await membership.get()).data();
    assert.deepEqual(rights.invitationGrants[env.input.registryId], { registry: false, collectionIds: [env.input.collectionId], cartularyIds: [] });
    assert.equal(rights.permissions.includes('cartulary.edit'), false);
    await revokeRegistryInvitation({ firestore: db, actorUid: env.input.uid, registryId: env.input.registryId, invitationId: issued.invitationId });
    assert.equal((await membership.get()).data().status, 'revoked');
    await env.collection.update({ status: 'archived' });
    await assert.rejects(issueRegistryInvitation(parameters), { code: 'scope_not_found' });
  } finally { if (previousEmulator === undefined) delete process.env.FUNCTIONS_EMULATOR; else process.env.FUNCTIONS_EMULATOR = previousEmulator; }
});
