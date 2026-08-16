import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { mockCartulary } from '../src/data/mockData.ts';
import { IWC_CARTULARY_ID } from '../src/domain/cartularyIds.ts';

const readLocalValue = (name) => {
  try {
    return readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim();
  } catch {
    return undefined;
  }
};

const projectId = process.env.GCLOUD_PROJECT
  || process.env.FIREBASE_PROJECT_ID
  || readLocalValue('VITE_FIREBASE_PROJECT_ID')
  || 'cartularia-wave1-local';
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET
  || readLocalValue('VITE_FIREBASE_STORAGE_BUCKET')
  || `${projectId}.firebasestorage.app`;
const usesEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST && (
  process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST
));
const allowRemote = process.argv.includes('--allow-remote');
if (!usesEmulators && !allowRemote) {
  throw new Error('Ingestion interrompue : utilisez les émulateurs Firestore et Storage ou passez explicitement --allow-remote.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  storageBucket,
  ...(usesEmulators ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);
const bucket = getStorage(app).bucket(storageBucket);
const ownerUid = 'wave1-owner';
const now = FieldValue.serverTimestamp();
const publicRoot = fileURLToPath(new URL('../public', import.meta.url));

const mimeTypeFor = (path) => ({
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}[extname(path).toLowerCase()] || 'application/octet-stream');

await firestore.doc(`privateDrafts/${ownerUid}/cartularies/${IWC_CARTULARY_ID}`).set({
  ownerUid,
  cartularyId: IWC_CARTULARY_ID,
  status: 'active',
  retentionPolicyVersion: 'inactive-plus-2y-v1',
  purgeAfter: null,
  lastActiveAt: now,
  updatedAt: now,
}, { merge: true });

const imported = [];
for (const asset of mockCartulary.assets) {
  if (asset.type !== 'image' || !asset.url.startsWith('/assets/IWC/')) continue;
  const sourcePath = `${publicRoot}${asset.url}`;
  if (!existsSync(sourcePath)) continue;
  const bytes = readFileSync(sourcePath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const sha256 = `sha256:${digest}`;
  const binaryId = `seed_iwc_${asset.id.replaceAll(/[^A-Za-z0-9_-]/g, '_')}`;
  const storagePath = `private-drafts/${ownerUid}/${IWC_CARTULARY_ID}/${binaryId}/${digest}/original`;
  const mimeType = mimeTypeFor(sourcePath);
  await bucket.upload(sourcePath, {
    destination: storagePath,
    resumable: false,
    metadata: {
      contentType: mimeType,
      metadata: { ownerUid, cartularyId: IWC_CARTULARY_ID, binaryId, sha256, kind: 'media' },
    },
  });
  await Promise.all([
    firestore.doc(`privateDrafts/${ownerUid}/cartularies/${IWC_CARTULARY_ID}/binaries/${binaryId}`).set({
      ownerUid,
      cartularyId: IWC_CARTULARY_ID,
      binaryId,
      deleted: false,
      revision: 1,
      fileName: asset.url.split('/').at(-1),
      mimeType,
      size: bytes.length,
      sha256,
      kind: 'media',
      storagePath,
      clientUpdatedAt: Date.now(),
      uploadStatus: 'ready',
      updatedAt: now,
    }, { merge: true }),
    firestore.doc(`cartularies/${IWC_CARTULARY_ID}/assets/${asset.id}`).set({
      binaryId,
      storagePath,
      sha256,
      mimeDeclared: mimeType,
      mimeDetected: mimeType,
      sizeBytes: bytes.length,
      processingState: 'ready',
      updatedAt: now,
    }, { merge: true }),
  ]);
  imported.push({ assetId: asset.id, binaryId, storagePath, size: bytes.length, sha256 });
}

console.log(JSON.stringify({
  event: 'IWC_MEDIA_STORAGE_SEEDED',
  projectId,
  storageBucket,
  cartularyId: IWC_CARTULARY_ID,
  importedCount: imported.length,
  imported,
}, null, 2));
