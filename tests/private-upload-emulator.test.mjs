import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { getBytes, getMetadata, ref } from 'firebase/storage';
import sharp from 'sharp';
import { PRIVATE_UPLOAD_VERIFICATION_VERSION, processPrivateDraftUpload, regeneratePresentationDerivatives, applyPresentationMirrors } from '../scripts/lib/private-upload-command.mjs';
import { presentationVariantPath, validPresentationVariantPath } from '../scripts/lib/presentation-variants.mjs';

/**
 * Bout en bout sous émulateurs Firestore + Storage (jamais lancés par les agents ; rejoués par l'orchestrateur) :
 *   1. téléversement Admin d'un original + manifeste → processPrivateDraftUpload → variantes v3 + presentation-v2 + manifeste ;
 *   2. lecture des variantes par le propriétaire sous storage.rules du dépôt (getBytes/getMetadata) : succès ;
 *      autre uid et anonyme : refus ; presentation-v2.webp (derivativeId sans extension) : refus même pour le propriétaire (C1) ;
 *   3. régénération idempotente + miroirs assets.privatePresentation / items.thumbnail.
 * Exécution : npm run test:private-upload:emulator (voir deliverables : script emulators:exec --only firestore,storage).
 */
const projectId = process.env.GCLOUD_PROJECT;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
if (projectId !== 'cartularia-private-upload-test' || !firestoreHost || !storageHost) {
  throw new Error('Test réservé au projet fictif cartularia-private-upload-test sous émulateurs Firestore + Storage locaux.');
}
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const bucketName = `${projectId}.appspot.com`;
const uid = `owner_${runId}`;
const otherUid = `stranger_${runId}`;
const cartularyId = `cart_${runId}_upload`;
const registryId = `reg_${runId}`;
const binaryId = `binary_${runId}`;
const assetId = `asset_${runId}`;
let app; let firestore; let bucket; let rules; let original; let originalPath;

before(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  app = initializeApp({ projectId, credential: cert({ projectId, clientEmail: `test-only@${projectId}.iam.gserviceaccount.com`, privateKey }), storageBucket: bucketName }, `private-upload-${runId}`);
  firestore = getFirestore(app);
  bucket = getStorage(app).bucket();
  const [host, port] = storageHost.split(':');
  const [fsHost, fsPort] = firestoreHost.split(':');
  rules = await initializeTestEnvironment({
    projectId,
    firestore: { host: fsHost, port: Number(fsPort), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
    storage: { host, port: Number(port), rules: readFileSync(new URL('../storage.rules', import.meta.url), 'utf8') },
  });
  original = await sharp({ create: { width: 1000, height: 700, channels: 3, background: '#6b4f2a' } }).jpeg().toBuffer();
  originalPath = `private-drafts/${uid}/${cartularyId}/${binaryId}/${digest(original).replace('sha256:', '')}/original`;
  await Promise.all([
    firestore.doc(`users/${uid}`).set({ uid, status: 'active' }),
    firestore.doc(`users/${otherUid}`).set({ uid: otherUid, status: 'active' }),
    firestore.doc(`cartularies/${cartularyId}`).set({ id: cartularyId, accountHolderId: uid, registryId, organizationId: `org_${runId}`, revision: 1 }),
    firestore.doc(`cartularies/${cartularyId}/assets/${assetId}`).set({ id: assetId, binaryId, mediaKind: 'image', displayName: 'Photo' }),
    firestore.doc(`registries/${registryId}/items/${cartularyId}`).set({ cartularyId, registryId, primaryAssetId: assetId, revision: 1, updatedAt: 'avant' }),
    firestore.doc(`privateDrafts/${uid}/cartularies/${cartularyId}`).set({ ownerUid: uid, cartularyId, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1' }),
    firestore.doc(`privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${binaryId}`).set({
      ownerUid: uid, cartularyId, binaryId, kind: 'media', fileName: 'photo.jpg', mimeType: 'image/jpeg', size: original.length, sha256: digest(original),
      storagePath: originalPath, deleted: false, revision: 1, clientUpdatedAt: Date.now(), uploadStatus: 'pending_upload',
    }),
    bucket.file(originalPath).save(original, { resumable: false, metadata: { contentType: 'image/jpeg', metadata: { ownerUid: uid, cartularyId, binaryId, sha256: digest(original), kind: 'media' } } }),
  ]);
});

after(async () => {
  const failures = [];
  const clean = async (operation) => { try { await operation(); } catch (error) { failures.push(error.code || 'cleanup-failed'); } };
  for (const prefix of [`private-drafts/${uid}/`, `private-derivatives/${uid}/`]) {
    await clean(async () => { const [files] = await bucket.getFiles({ prefix }); for (const file of files) await file.delete({ ignoreNotFound: true }); });
  }
  for (const path of [`cartularies/${cartularyId}`, `registries/${registryId}`, `privateDrafts/${uid}`, `users/${uid}`, `users/${otherUid}`]) await clean(() => firestore.recursiveDelete(firestore.doc(path)));
  await clean(() => rules.cleanup());
  await clean(() => deleteApp(app));
  assert.equal(failures.length, 0, `Nettoyage incomplet pour le run ${runId}: ${failures.join(', ')}`);
});

test('vérification → variantes v3 lisibles par le propriétaire seulement ; presentation-v2 jamais lisible (C1)', async () => {
  const [metadata] = await bucket.file(originalPath).getMetadata();
  const result = await processPrivateDraftUpload({ firestore, storage: getStorage(app), object: { name: originalPath, bucket: bucketName, size: original.length, contentType: 'image/jpeg', metadata: metadata.metadata } });
  assert.equal(result.status, 'accepted');
  const manifest = (await firestore.doc(`privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${binaryId}`).get()).data();
  assert.equal(manifest.verificationVersion, PRIVATE_UPLOAD_VERIFICATION_VERSION);
  assert.deepEqual(manifest.presentationDerivative.variants.map((variant) => variant.storagePath), [240, 480, 768].map((width) => presentationVariantPath(uid, cartularyId, binaryId, width)));
  assert.ok(manifest.presentationDerivative.variants.every((variant) => validPresentationVariantPath(variant.storagePath, uid, cartularyId, binaryId)));
  const owner = rules.authenticatedContext(uid).storage(`gs://${bucketName}`);
  const stranger = rules.authenticatedContext(otherUid).storage(`gs://${bucketName}`);
  const anonymous = rules.unauthenticatedContext().storage(`gs://${bucketName}`);
  for (const variant of manifest.presentationDerivative.variants) {
    // getBytes : disponible sous Node (getBlob ne l'est que dans un navigateur) ; mêmes règles Storage.
    const bytes = await assertSucceeds(getBytes(ref(owner, variant.storagePath), 8 * 1024 * 1024));
    assert.equal(digest(Buffer.from(bytes)), variant.sha256);
    assert.equal((await getMetadata(ref(owner, variant.storagePath))).customMetadata.derivativeId, variant.storagePath.split('/').at(-1));
    await assertFails(getMetadata(ref(stranger, variant.storagePath)));
    await assertFails(getMetadata(ref(anonymous, variant.storagePath)));
  }
  await assertFails(getMetadata(ref(owner, manifest.presentationDerivative.storagePath)));
});

test('régénération idempotente et miroirs sur l’objet', async () => {
  const identity = { firestore, storage: getStorage(app), uid, cartularyId, binaryId };
  assert.equal((await regeneratePresentationDerivatives(identity)).status, 'already_current');
  const mirror = await applyPresentationMirrors({ firestore, uid, cartularyId, binaryId });
  assert.equal(mirror.status, 'mirrored');
  assert.deepEqual(mirror.assets, [assetId]);
  const asset = (await firestore.doc(`cartularies/${cartularyId}/assets/${assetId}`).get()).data();
  assert.equal(asset.privatePresentation.version, 'presentation-v3');
  const item = (await firestore.doc(`registries/${registryId}/items/${cartularyId}`).get()).data();
  assert.equal(item.thumbnail.kind, 'inline');
  assert.equal(item.updatedAt, 'avant');
});
