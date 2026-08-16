import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
const ownerUid = process.env.CARTULARIA_OWNER_UID || 'wave1-owner';
const cartularyId = process.env.CARTULARIA_CARTULARY_ID || 'cart_iwc_flieger_utc_2002';
const registryId = process.env.CARTULARIA_REGISTRY_ID || 'reg_collection_privee';
if (!projectId || !storageBucket) {
  throw new Error('FIREBASE_PROJECT_ID et FIREBASE_STORAGE_BUCKET sont requis.');
}
if (!process.argv.includes('--allow-remote')) {
  throw new Error('Vérification interrompue : passez explicitement --allow-remote.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  storageBucket,
  credential: applicationDefault(),
});
const firestore = getFirestore(app);
const [user, root, item, request, assets] = await Promise.all([
  getAuth(app).getUser(ownerUid),
  firestore.doc(`cartularies/${cartularyId}`).get(),
  firestore.doc(`registries/${registryId}/items/${cartularyId}`).get(),
  firestore.doc(`cartularySyncRequests/${cartularyId}`).get(),
  firestore.collection(`cartularies/${cartularyId}/assets`).get(),
]);
if (!root.exists || !item.exists || !request.exists) {
  throw new Error('Cartulaire, projection Registre ou demande de synchronisation manquante.');
}
const rootData = root.data();
const itemData = item.data();
const requestData = request.data();
const readyAssets = assets.docs.filter((document) => (
  document.data().processingState === 'ready' && typeof document.data().storagePath === 'string'
));
const primaryAsset = assets.docs.find((document) => document.id === rootData.primaryAssetId);
if (!primaryAsset?.data().storagePath) throw new Error('Média principal Storage manquant.');
const [primaryMetadata] = await getStorage(app).bucket(storageBucket)
  .file(primaryAsset.data().storagePath)
  .getMetadata();

const report = {
  projectId,
  admin: { uid: user.uid, email: user.email, disabled: user.disabled },
  cartulary: { id: root.id, revision: rootData.revision, primaryAssetId: rootData.primaryAssetId },
  registryItem: { id: item.id, sourceRevision: itemData.sourceRevision, projectionStatus: itemData.projectionStatus },
  syncRequest: { status: requestData.status, outcome: requestData.outcome || null, errorCode: requestData.errorCode || null },
  media: { totalAssets: assets.size, readyStorageAssets: readyAssets.length, primarySize: Number(primaryMetadata.size) },
};
console.log(JSON.stringify(report, null, 2));
if (requestData.status !== 'processed') process.exitCode = 2;
