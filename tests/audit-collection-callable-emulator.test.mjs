import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:38480') throw new Error('Réservé à Firestore Emulator local 38480.');
const projectId = 'cartularia-audit-callable-test';
const runId = randomUUID().replaceAll('-', '');
const uid = `owner_${runId}`, registryId = `reg_${runId}`, organizationId = `org_${runId}`, collectionId = `col_${runId}`;
let app, db, saveRegistryCollection, deleteRegistryCollection;
const input = { name: 'Collection fictive', description: 'Recette locale', websiteTitle: 'Collection fictive', websiteSlug: 'recette-locale',
  status: 'draft', visibility: 'secret', publicationConsent: false, publishedCartularyIds: [] };
const data = { registryId, collectionId, mode: 'create', input, confirmedPublication: false };
before(async () => {
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIREBASE_CONFIG = JSON.stringify({ projectId, storageBucket: `${projectId}.appspot.com` });
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  app = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com`, credential: cert({ projectId, clientEmail: `test-only@${projectId}.iam.gserviceaccount.com`, privateKey }) });
  db = getFirestore(app);
  // Run invokes the real handler and error adapter, not the HTTP auth/App Check
  // middleware. All persistence is restricted to this emulator namespace.
  ({ saveRegistryCollection, deleteRegistryCollection } = await import('../scripts/firebase-functions.mjs'));
  await Promise.all([
    db.doc(`users/${uid}`).set({ status: 'active' }),
    db.doc(`registries/${registryId}`).set({ organizationId, status: 'active' }),
    db.doc(`organizations/${organizationId}/memberships/${uid}`).set({ uid, status: 'active', permissions: ['cartulary.edit', 'publication.manage'], scopes: { registryIds: [registryId] } }),
  ]);
});
after(async () => {
  for (const path of [`users/${uid}`, `registries/${registryId}`, `organizations/${organizationId}`, `collectionPublications/${registryId}--${collectionId}`]) await db.recursiveDelete(db.doc(path));
  await db.terminate(); await deleteApp(app);
});

test('le handler refuse une absence de session, même avec un UID dans la charge utile', async () => {
  for (const callable of [saveRegistryCollection, deleteRegistryCollection]) {
    await assert.rejects(callable.run({ data: { ...data, uid } }), { code: 'unauthenticated' });
  }
});
test('le handler utilise l’acteur authentifié, jamais un UID forgé dans les données', async () => {
  await assert.rejects(saveRegistryCollection.run({ auth: { uid: 'intruder_fixture' }, data: { ...data, uid } }), { code: 'permission-denied' });
  assert.equal((await db.doc(`registries/${registryId}/collections/${collectionId}`).get()).exists, false);
});
test('création, conflit de version, suppression versionnée et anti-résurrection traversent les vrais handlers', async () => {
  const auth = { uid };
  const initial = await saveRegistryCollection.run({ auth, data });
  assert.equal(initial.collectionId, collectionId);
  assert.match(initial.versionToken, /^collection_/);
  const update = { ...data, mode: 'update', expectedVersion: initial.versionToken, input: { ...input, name: 'Version confirmée' } };
  const next = await saveRegistryCollection.run({ auth, data: update });
  assert.notEqual(next.versionToken, initial.versionToken);
  await assert.rejects(saveRegistryCollection.run({ auth, data: update }), { code: 'aborted' });
  await assert.rejects(deleteRegistryCollection.run({ auth, data: { registryId, collectionId, expectedVersion: initial.versionToken, confirmed: true } }), { code: 'aborted' });
  assert.equal((await db.doc(`registries/${registryId}/collections/${collectionId}`).get()).data().name, 'Version confirmée');
  await deleteRegistryCollection.run({ auth, data: { registryId, collectionId, expectedVersion: next.versionToken, confirmed: true } });
  assert.equal((await db.doc(`registries/${registryId}/collections/${collectionId}`).get()).exists, false);
  await assert.rejects(saveRegistryCollection.run({ auth, data: { ...update, expectedVersion: next.versionToken } }), { code: 'not-found' });
});
