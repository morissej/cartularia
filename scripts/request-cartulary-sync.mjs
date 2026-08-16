import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const cartularyId = process.env.CARTULARIA_CARTULARY_ID || 'cart_iwc_flieger_utc_2002';
const ownerUid = process.env.CARTULARIA_OWNER_UID || 'wave1-owner';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!projectId) throw new Error('FIREBASE_PROJECT_ID est requis.');
if (!usesEmulator && !process.argv.includes('--allow-remote')) {
  throw new Error('Demande interrompue : passez explicitement --allow-remote.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);
const requestId = `sync_deploy_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
await firestore.doc(`cartularySyncRequests/${cartularyId}`).set({
  requestDocumentId: cartularyId,
  requestId,
  ownerUid,
  cartularyId,
  reason: 'production_deployment_verification',
  status: 'pending',
  requestedAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});
console.log(JSON.stringify({ event: 'CARTULARY_SYNC_REQUESTED', projectId, cartularyId, requestId }));
