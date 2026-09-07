import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { getWebsitePublicationState, publishWebsite, revokeWebsite } from '../scripts/lib/website-publication-command.mjs';

// Run against the existing local emulator process only. Token URLs deliberately
// bypass Rules: this suite proves physical deletion, not cross-project Rules,
// callable authentication, App Check or production IAM.
const projectId = process.env.GCLOUD_PROJECT;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const storageHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
if (projectId !== 'cartularia-audit-publication-test' || firestoreHost !== '127.0.0.1:38480'
  || storageHost !== '127.0.0.1:39419'
  || (process.env.STORAGE_EMULATOR_HOST && process.env.STORAGE_EMULATOR_HOST !== `http://${storageHost}`)) {
  throw new Error('Test réservé au projet fictif audit-publication et aux émulateurs locaux 38480/39419.');
}
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const apps = [];
const databases = [];
const cleanupDocuments = [];
const privatePaths = [];
const publicPrefixes = [];
let credential, firestore, bucket, original, presentation;
const createServices = (label) => {
  const app = initializeApp({ projectId, credential, storageBucket: `${projectId}.appspot.com` }, `audit-publication-${runId}-${label}`);
  apps.push(app);
  const db = getFirestore(app); databases.push(db);
  return { firestore: db, bucket: getStorage(app).bucket() };
};
before(async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  // Ephemeral test-only key, no ADC discovery or real cloud authority.
  credential = cert({ projectId, clientEmail: `test-only@${projectId}.iam.gserviceaccount.com`, privateKey });
  ({ firestore, bucket } = createServices('initial'));
  original = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#a09177' } }).png().toBuffer();
  presentation = await sharp(original).webp().toBuffer();
  assert.equal((await sharp(presentation).metadata()).format, 'webp');
});
after(async () => {
  // Never flush a namespace/bucket: only this run's generated exact roots and
  // unique object prefixes may be deleted, including after a failed assertion.
  const failures = [];
  const clean = async (operation) => { try { await operation(); } catch (error) { failures.push(error.code || 'cleanup-failed'); } };
  for (const prefix of publicPrefixes) {
    await clean(async () => {
      const [files] = await bucket.getFiles({ prefix });
      for (const file of files) await file.delete({ ignoreNotFound: true });
    });
  }
  for (const path of privatePaths) await clean(() => bucket.file(path).delete({ ignoreNotFound: true }));
  for (const ref of cleanupDocuments.reverse()) await clean(() => firestore.recursiveDelete(ref));
  await Promise.all(databases.map((db) => clean(() => db.terminate())));
  await Promise.all(apps.map((app) => clean(() => deleteApp(app))));
  assert.equal(failures.length, 0, `Nettoyage local incomplet pour le run ${runId}: ${failures.join(', ')}`);
});

const fixture = async (label) => {
  const cartularyId = `cart_${runId}_${label}`;
  const uid = `owner_${runId}_${label}`;
  const organizationId = `org_${runId}_${label}`;
  const registryId = `reg_${runId}_${label}`;
  const publicCode = `OBJ-AUDIT-${runId}-${label}`;
  const assetId = `asset_${runId}_${label}`;
  const binaryId = `binary_${runId}_${label}`;
  const originalPath = `private/${uid}/${cartularyId}/${binaryId}/original.png`;
  const derivativePath = `private-derivatives/${uid}/${cartularyId}/${binaryId}/presentation.webp`;
  privatePaths.push(originalPath, derivativePath);
  publicPrefixes.push(`public/${publicCode}/`);
  for (const path of [`cartularies/${cartularyId}`, `users/${uid}`, `organizations/${organizationId}`, `privateDrafts/${uid}`, `publications/${publicCode}`, `seals/${publicCode}`]) cleanupDocuments.push(firestore.doc(path));
  const setup = await Promise.allSettled([
    bucket.file(originalPath).save(original, { resumable: false, metadata: { contentType: 'image/png' } }),
    bucket.file(derivativePath).save(presentation, { resumable: false, metadata: { contentType: 'image/webp' } }),
    firestore.doc(`cartularies/${cartularyId}`).set({ id: cartularyId, accountHolderId: uid, organizationId, registryId, publicCode, revision: 1, assetType: 'car', schemaId: 'car', schemaVersion: '1.0.0', displayTitle: 'Objet fictif de recette', makerName: 'Atelier fictif', modelName: 'Prototype fictif', referenceCode: 'AUDIT' }),
    firestore.doc(`users/${uid}`).set({ status: 'active' }),
    firestore.doc(`organizations/${organizationId}/memberships/${uid}`).set({ uid, status: 'active', roles: ['legal_owner'], permissions: ['publication.manage'], scopes: { registryIds: [registryId] } }),
    firestore.doc(`privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${binaryId}`).set({ kind: 'media', sha256: digest(original), verificationStatus: 'accepted', publicationEligible: true, presentationDerivative: { storagePath: derivativePath, metadataStripped: true, mimeType: 'image/webp', sourceSha256: digest(original), sha256: digest(presentation), size: presentation.length } }),
  ]);
  const setupFailure = setup.find((result) => result.status === 'rejected');
  if (setupFailure) throw setupFailure.reason;
  const requestAuth = { uid };
  const request = (overrides = {}) => ({ cartularyId, requestId: `website_${randomUUID().replaceAll('-', '')}`, expectedRevision: 1, confirmed: true, confirmedNonPersonalMedia: true, blocks: [{ id: 'media-hero', title: 'Présentation', payload: { heading: 'Objet fictif' }, assets: [{ assetId, binaryId }] }], ...overrides });
  const state = (db = firestore) => getWebsitePublicationState({ firestore: db, requestAuth, cartularyId });
  const assertOriginalPreserved = async () => assert.equal(digest((await bucket.file(originalPath).download())[0]), digest(original));
  return { firestore, bucket, requestAuth, cartularyId, publicCode, request, state, assertOriginalPreserved };
};

const publishedPath = async (env) => {
  const snapshot = await firestore.doc(`publications/${env.publicCode}/blocks/media-hero`).get();
  return snapshot.data().assets[0].storagePath;
};
const bearerProbe = async (path) => {
  // Simulate an already distributed legacy Firebase download URL. No token is
  // printed or persisted outside the isolated emulator's test object metadata.
  const token = randomUUID();
  await bucket.file(path).setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  const url = `http://${storageHost}/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
  return async (expectedState) => {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (expectedState === 200) {
      assert.equal(response.status, 200);
      assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(presentation));
    } else {
      // The emulator may authorize before revealing a missing object's status.
      // A denied URL alone is insufficient: Admin must confirm physical absence.
      assert.ok([403, 404].includes(response.status), `URL encore accessible : HTTP ${response.status}`);
      await response.arrayBuffer();
      assert.equal((await bucket.file(path).exists())[0], false);
    }
  };
};

test('publication réelle : désélection supprime le binaire et invalide son ancienne URL bearer', async () => {
  const env = await fixture('deselection');
  const published = await publishWebsite({ ...env, input: env.request() });
  const path = await publishedPath(env);
  const [metadata] = await bucket.file(path).getMetadata();
  assert.equal(metadata.cacheControl, 'private, no-store, max-age=0');
  const probe = await bearerProbe(path); await probe(200);
  await publishWebsite({ ...env, input: env.request({ expectedRevision: published.revision, blocks: [{ id: 'condition-summary', title: 'État', payload: { paragraphs: ['État fictif'] }, assets: [] }] }) });
  await probe('deleted');
  assert.equal((await bucket.file(path).exists())[0], false);
  assert.equal((await env.state()).cleanupPending, false);
  await env.assertOriginalPreserved();
});

test('retrait réel : le fichier est supprimé et un ancien rejeu ne republie pas la projection', async () => {
  const env = await fixture('retrait');
  const publishRequest = env.request();
  const published = await publishWebsite({ ...env, input: publishRequest });
  const path = await publishedPath(env);
  const probe = await bearerProbe(path); await probe(200);
  const withdrawal = env.request({ expectedRevision: published.revision });
  await revokeWebsite({ ...env, input: withdrawal });
  await probe('deleted');
  await revokeWebsite({ ...env, input: withdrawal });
  await publishWebsite({ ...env, input: publishRequest });
  assert.equal((await env.state()).status, 'revoked');
  await probe('deleted');
  await env.assertOriginalPreserved();
});

test('panne delete : journal durable, publication bloquée et reprise réelle depuis une nouvelle instance', async () => {
  const env = await fixture('reprise');
  const published = await publishWebsite({ ...env, input: env.request() });
  const path = await publishedPath(env);
  const probe = await bearerProbe(path); await probe(200);
  // Every read/write and transaction remains real. Only the delete transport
  // fails deliberately, representing a storage outage after the Firestore commit.
  const failingBucket = { file: (name) => {
    const file = bucket.file(name);
    file.delete = async () => { throw Object.assign(new Error('Injected local deletion outage'), { code: 503 }); };
    return file;
  } };
  const withdrawal = env.request({ expectedRevision: published.revision });
  await assert.rejects(revokeWebsite({ ...env, bucket: failingBucket, input: withdrawal }), { code: 'media_cleanup_pending' });
  const interrupted = await env.state();
  assert.equal(interrupted.status, 'revoked'); assert.equal(interrupted.cleanupPending, true);
  assert.equal(interrupted.pendingCleanupCount, 1);
  await probe(200);
  await assert.rejects(publishWebsite({ ...env, bucket: failingBucket, input: env.request({ expectedRevision: interrupted.revision }) }), { code: 'media_cleanup_pending' });
  assert.equal((await env.state()).revision, interrupted.revision);
  // No prior request body, in-memory refs or original service object is reused.
  const fresh = createServices('resume');
  const refreshed = await env.state(fresh.firestore);
  assert.equal(refreshed.cleanupPending, true);
  const result = await revokeWebsite({ ...fresh, requestAuth: env.requestAuth, input: env.request({ expectedRevision: refreshed.revision, cleanupOnly: true }) });
  assert.equal(result.status, 'revoked'); assert.equal(result.cleanupPending, false);
  assert.equal(result.revision, interrupted.revision);
  await probe('deleted');
  assert.equal((await fresh.bucket.file(path).exists())[0], false);
  assert.equal((await fresh.firestore.doc(`cartularies/${env.cartularyId}/websiteCleanup/${withdrawal.requestId}`).get()).data().complete, true);
  await env.assertOriginalPreserved();
});
