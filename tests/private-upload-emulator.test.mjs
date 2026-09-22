import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, updateDoc } from 'firebase/firestore';
import { getBytes, getMetadata, ref } from 'firebase/storage';
import sharp from 'sharp';
import {
  PRIVATE_UPLOAD_VERIFICATION_VERSION, processPrivateDraftUpload, processPrivateDraftUploadBacklog,
  regeneratePresentationDerivatives, applyPresentationMirrors,
  privateBinaryIsVerified, inspectPrivateBinaryOriginal, assertPrivateBinaryOriginal,
} from '../scripts/lib/private-upload-command.mjs';
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
const localEndpoint = /^(127\.0\.0\.1|localhost):[0-9]+$/;
if (!['cartularia-private-upload-test', 'demo-cartularia-p2', 'demo-cartularia-p3', 'demo-cartularia-p4'].includes(projectId)
  || !localEndpoint.test(firestoreHost || '') || !localEndpoint.test(storageHost || '')) {
  throw new Error('Test réservé aux projets fictifs privés autorisés sous émulateurs Firestore + Storage en boucle locale.');
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
  const result = await processPrivateDraftUpload({ firestore, storage: getStorage(app), object: metadata });
  assert.equal(result.status, 'accepted');
  const manifest = (await firestore.doc(`privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${binaryId}`).get()).data();
  assert.equal(manifest.verificationVersion, PRIVATE_UPLOAD_VERIFICATION_VERSION);
  assert.equal(manifest.verificationIdentity.generation, metadata.generation);
  assert.equal(manifest.verificationIdentity.bucket, bucketName);
  assert.equal(privateBinaryIsVerified(manifest), true);
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
  const mirror = await applyPresentationMirrors({ firestore, storage: getStorage(app), uid, cartularyId, binaryId });
  assert.equal(mirror.status, 'mirrored');
  assert.deepEqual(mirror.assets, [assetId]);
  const asset = (await firestore.doc(`cartularies/${cartularyId}/assets/${assetId}`).get()).data();
  assert.equal(asset.privatePresentation.version, 'presentation-v3');
  const item = (await firestore.doc(`registries/${registryId}/items/${cartularyId}`).get()).data();
  assert.equal(item.thumbnail.kind, 'inline');
  assert.equal(item.updatedAt, 'avant');
});

async function seedHistoricalBinary(label, { uploadOriginal = true } = {}) {
  const id = `binary_${runId}_${label}`;
  const storagePath = `private-drafts/${uid}/${cartularyId}/${id}/${digest(original).replace('sha256:', '')}/original`;
  const manifest = {
    ownerUid: uid, cartularyId, binaryId: id, kind: 'media', fileName: 'photo.jpg',
    mimeType: 'image/jpeg', size: original.length, sha256: digest(original), storagePath,
    deleted: false, revision: 1, clientUpdatedAt: 0, uploadStatus: 'ready',
  };
  const manifestRef = firestore.doc(`privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${id}`);
  await manifestRef.set(manifest);
  const file = bucket.file(storagePath);
  if (uploadOriginal) {
    await file.save(original, {
      resumable: false,
      metadata: {
        contentType: 'image/jpeg',
        metadata: { ownerUid: uid, cartularyId, binaryId: id, sha256: digest(original), kind: 'media' },
      },
    });
  }
  return { file, manifest, manifestRef };
}

async function verifyHistoricalBinary(fixture) {
  const [object] = await fixture.file.getMetadata();
  const result = await processPrivateDraftUpload({ firestore, storage: getStorage(app), object });
  assert.equal(result.status, 'accepted');
  const manifest = (await fixture.manifestRef.get()).data();
  assert.equal(privateBinaryIsVerified(manifest), true);
  return manifest;
}

test('P3 : un manifeste ready antidaté sans original ne constitue jamais une preuve', async () => {
  const { manifest, manifestRef } = await seedHistoricalBinary('missing', { uploadOriginal: false });
  assert.equal(privateBinaryIsVerified(manifest), false);
  await assert.rejects(() => inspectPrivateBinaryOriginal({ bucket, manifest, uid, cartularyId, binaryId: manifest.binaryId }));
  await assert.rejects(() => assertPrivateBinaryOriginal({ bucket, manifest, uid, cartularyId, binaryId: manifest.binaryId }));
  const stored = (await manifestRef.get()).data();
  assert.equal(stored.verificationStatus, undefined);
  assert.equal(stored.verificationIdentity, undefined);
});

test('P3 : le serveur inspecte un ancien original intact puis atteste sa génération réelle', async () => {
  const fixture = await seedHistoricalBinary('legacy');
  const [beforeMetadata] = await fixture.file.getMetadata();
  const [beforeBytes] = await fixture.file.download();
  const inspected = await inspectPrivateBinaryOriginal({ bucket, manifest: fixture.manifest, uid, cartularyId, binaryId: fixture.manifest.binaryId });
  assert.deepEqual(inspected.verificationIdentity, {
    schemaVersion: 'private-binary-identity@1.0.0',
    ownerUid: uid, cartularyId, binaryId: fixture.manifest.binaryId,
    storagePath: fixture.manifest.storagePath, sha256: digest(original), size: original.length,
    bucket: bucketName, generation: beforeMetadata.generation,
  });
  assert.equal((await fixture.manifestRef.get()).data().verificationIdentity, undefined, 'inspection en lecture seule');
  const attested = await verifyHistoricalBinary(fixture);
  assert.deepEqual(attested.verificationIdentity, inspected.verificationIdentity);
  const trusted = await assertPrivateBinaryOriginal({ bucket, manifest: attested, uid, cartularyId, binaryId: attested.binaryId });
  assert.equal(trusted.verificationIdentity.generation, beforeMetadata.generation);
  const [afterMetadata] = await fixture.file.getMetadata();
  const [afterBytes] = await fixture.file.download();
  assert.equal(afterMetadata.generation, beforeMetadata.generation);
  assert.deepEqual(afterBytes, beforeBytes, 'vérifier et attester ne réécrit pas les octets originaux');
});

test('P3 : le client ne substitue pas un original attesté et sa disparition bloque l’usage serveur', async () => {
  const fixture = await seedHistoricalBinary('deleted');
  const attested = await verifyHistoricalBinary(fixture);
  const client = doc(rules.authenticatedContext(uid).firestore(), fixture.manifestRef.path);
  await assertFails(updateDoc(client, {
    sha256: `sha256:${'b'.repeat(64)}`,
    storagePath: attested.storagePath.replace(attested.sha256.slice('sha256:'.length), 'b'.repeat(64)),
  }));
  await assertFails(updateDoc(client, { 'verificationIdentity.generation': '999999' }));
  await assertFails(updateDoc(client, { mimeType: 'application/pdf' }));
  await assertPrivateBinaryOriginal({ bucket, manifest: attested, uid, cartularyId, binaryId: attested.binaryId });
  await fixture.file.delete();
  assert.equal(privateBinaryIsVerified(attested), true, 'le contrôle du manifeste seul ne prouve pas la présence Storage');
  await assert.rejects(() => assertPrivateBinaryOriginal({ bucket, manifest: attested, uid, cartularyId, binaryId: attested.binaryId }));
});

test('P3 : un chemin étranger ou altéré ne réutilise aucune attestation', async () => {
  const fixture = await seedHistoricalBinary('wrongpath');
  const attested = await verifyHistoricalBinary(fixture);
  for (const storagePath of [
    attested.storagePath.replace(uid, otherUid),
    `${attested.storagePath}/extra`,
    attested.storagePath.replace(attested.sha256.slice('sha256:'.length), 'b'.repeat(64)),
  ]) {
    const altered = { ...attested, storagePath };
    assert.equal(privateBinaryIsVerified(altered), false);
    await assert.rejects(() => assertPrivateBinaryOriginal({ bucket, manifest: altered, uid, cartularyId, binaryId: altered.binaryId }));
    await assert.rejects(() => inspectPrivateBinaryOriginal({ bucket, manifest: altered, uid, cartularyId, binaryId: altered.binaryId }));
  }
});

test('P3 : remplacer les octets au même chemin ne conserve pas la confiance de l’ancienne génération', async () => {
  const fixture = await seedHistoricalBinary('replaced');
  const attested = await verifyHistoricalBinary(fixture);
  const replacement = await sharp({ create: { width: 1000, height: 700, channels: 3, background: '#112233' } }).jpeg().toBuffer();
  await fixture.file.save(replacement, {
    resumable: false,
    metadata: {
      contentType: 'image/jpeg',
      metadata: { ownerUid: uid, cartularyId, binaryId: attested.binaryId, sha256: attested.sha256, kind: 'media' },
    },
  });
  const [changed] = await fixture.file.getMetadata();
  assert.notEqual(changed.generation, attested.verificationIdentity.generation);
  await assert.rejects(() => assertPrivateBinaryOriginal({ bucket, manifest: attested, uid, cartularyId, binaryId: attested.binaryId }));
});


const manifestState = async (fixture) => (await fixture.manifestRef.get()).data();
const startInterruptedUploadWorker = async (context, fixture, stage, now) => {
  const [object] = await fixture.file.getMetadata();
  const child = fork(fileURLToPath(new URL('./helpers/private-upload-interrupted-worker.mjs', import.meta.url)), [], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data.toString(); });
  child.stderr.on('data', (data) => { output += data.toString(); });
  let resolvePaused; let rejectPaused; let resolveDone; let rejectDone;
  const paused = new Promise((resolve, reject) => { resolvePaused = resolve; rejectPaused = reject; });
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Killed workers deliberately never report a result; keep unexpected failures observable.
  done.catch(() => {});
  let wasPaused = false;
  child.on('message', (message) => {
    if (message.type === 'paused') { wasPaused = true; resolvePaused(message); }
    if (message.type === 'done') resolveDone(message.result);
    if (message.type === 'failed') {
      const error = Object.assign(new Error(message.error.message), { code: message.error.code });
      rejectPaused(error); rejectDone(error);
    }
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => {
    if (!wasPaused || (code !== 0 && signal !== 'SIGKILL')) {
      const error = new Error(`Worker exit ${code}/${signal}: ${output}`);
      rejectPaused(error); rejectDone(error);
    }
    resolve({ code, signal });
  }));
  const kill = async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; };
  context.after(kill);
  child.send({ type: 'start', stage, now, object });
  await paused;
  return { object, done, kill, resume: () => child.send({ type: 'resume' }) };
};

for (const stage of ['before_download', 'after_derivatives']) {
  test(`P4 : arrêt brutal ${stage}, bail actif respecté puis original accepté après expiration`, { timeout: 60_000 }, async (context) => {
    const fixture = await seedHistoricalBinary(`crash_${stage}`);
    const [initialMetadata] = await fixture.file.getMetadata();
    const now = Date.now();
    const worker = await startInterruptedUploadWorker(context, fixture, stage, now);
    const processing = await manifestState(fixture);
    assert.equal(processing.verificationStatus, 'processing');
    assert.equal(processing.uploadStatus, 'verifying');
    assert.ok(processing.verificationAttemptId);
    assert.ok(Number.isSafeInteger(processing.verificationLeaseExpiresAt));
    assert.ok(processing.verificationLeaseExpiresAt > now);
    await worker.kill();
    const prefix = `private-derivatives/${uid}/${cartularyId}/${fixture.manifest.binaryId}/`;
    const [prepared] = await bucket.getFiles({ prefix });
    if (stage === 'before_download') assert.equal(prepared.length, 0);
    else {
      assert.ok(prepared.some((file) => file.name.endsWith('/presentation-v2.webp')));
      assert.ok(prepared.some((file) => file.name.endsWith('/presentation-v3-240.webp')));
      assert.equal(processing.verificationIdentity, undefined, 'des dérivés seuls ne constituent pas une acceptation');
    }
    const deferred = await processPrivateDraftUpload({ firestore, storage: getStorage(app), object: worker.object, now: () => now + 1 });
    assert.equal(deferred.status, 'deferred');
    assert.equal(deferred.reason, 'lease_active');
    assert.deepEqual(await manifestState(fixture), processing, 'un bail vivant ne doit pas être volé');
    const recovered = await processPrivateDraftUpload({ firestore, storage: getStorage(app), object: worker.object, now: () => processing.verificationLeaseExpiresAt + 1 });
    assert.equal(recovered.status, 'accepted');
    const accepted = await manifestState(fixture);
    assert.equal(privateBinaryIsVerified(accepted), true);
    assert.notEqual(accepted.verificationAttemptId, processing.verificationAttemptId);
    assert.equal(accepted.verificationIdentity.generation, initialMetadata.generation);
    assert.equal((await fixture.file.getMetadata())[0].generation, initialMetadata.generation);
    assert.deepEqual((await fixture.file.download())[0], original);
    for (const variant of accepted.presentationDerivative.variants) {
      assert.equal(digest((await bucket.file(variant.storagePath).download())[0]), variant.sha256);
    }
    const replay = await processPrivateDraftUpload({ firestore, storage: getStorage(app), object: worker.object, now: () => processing.verificationLeaseExpiresAt + 2 });
    assert.equal(replay.status, 'accepted');
    assert.equal(replay.replayed, true);
    assert.deepEqual(await manifestState(fixture), accepted, 'rejouer ne dégrade ni ne réécrit une acceptation');
  });
}

test('P4 : un ancien worker reprend après son successeur et ne peut pas remplacer son acceptation', { timeout: 60_000 }, async (context) => {
  const fixture = await seedHistoricalBinary('overlap');
  const now = Date.now();
  const worker = await startInterruptedUploadWorker(context, fixture, 'after_derivatives', now);
  const processing = await manifestState(fixture);
  const result = await processPrivateDraftUpload({ firestore, storage: getStorage(app), object: worker.object, now: () => processing.verificationLeaseExpiresAt + 1 });
  assert.equal(result.status, 'accepted');
  const accepted = await manifestState(fixture);
  assert.notEqual(accepted.verificationAttemptId, processing.verificationAttemptId);
  const paths = [...accepted.presentationDerivative.variants.map((variant) => variant.storagePath), accepted.presentationDerivative.storagePath];
  const generationBefore = await Promise.all(paths.map(async (path) => (await bucket.file(path).getMetadata())[0].generation));
  worker.resume();
  const obsolete = await worker.done;
  assert.equal(obsolete.status, 'ignored');
  assert.equal(obsolete.reason, 'stale_inspection');
  assert.deepEqual(await manifestState(fixture), accepted);
  assert.deepEqual(await Promise.all(paths.map(async (path) => (await bucket.file(path).getMetadata())[0].generation)), generationBefore);
});


test('P4 : le rattrapage ignore un bail vivant puis reprend le traitement expiré', { timeout: 30_000 }, async () => {
  const fixture = await seedHistoricalBinary('backlog_lease');
  const now = Date.now();
  await fixture.manifestRef.update({ uploadStatus: 'verifying', verificationStatus: 'processing',
    verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION, verificationAttemptId: 'interrupted-backlog-worker',
    verificationLeaseExpiresAt: now + 1_000,
  });
  // Limit this emulator test to its own original; never scan or mutate another test's inventory.
  const scopedStorage = { bucket: () => new Proxy(bucket, { get(target, key) {
    if (key === 'getFiles') return async () => [[fixture.file]];
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } }) };
  const pending = await manifestState(fixture);
  const active = await processPrivateDraftUploadBacklog({ firestore, storage: scopedStorage, now: () => now, variantLimit: 0 });
  assert.equal(active.inspected, 0);
  assert.deepEqual(await manifestState(fixture), pending);
  const expired = await processPrivateDraftUploadBacklog({ firestore, storage: scopedStorage, now: () => now + 1_001, variantLimit: 0 });
  assert.equal(expired.inspected, 1);
  assert.equal(expired.accepted, 1);
  assert.equal(expired.rejected, 0);
  const accepted = await manifestState(fixture);
  assert.equal(privateBinaryIsVerified(accepted), true);
  assert.notEqual(accepted.verificationAttemptId, pending.verificationAttemptId);
});


test('P4 : le propriétaire ne peut fabriquer ni prolonger les baux et délais de reprise serveur', async () => {
  const fixture = await seedHistoricalBinary('lease_rules');
  const client = doc(rules.authenticatedContext(uid).firestore(), fixture.manifestRef.path);
  for (const patch of [
    { verificationLeaseExpiresAt: Date.now() + 86_400_000 },
    { verificationRetryAfter: Date.now() + 86_400_000 },
    { verificationRetryCount: 999 },
    { verificationAttemptId: 'forged-client-attempt' },
  ]) await assertFails(updateDoc(client, patch));
  assert.deepEqual(await manifestState(fixture), fixture.manifest);
});
