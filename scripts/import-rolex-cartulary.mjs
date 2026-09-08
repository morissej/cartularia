import { randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  buildRolexDossierState,
  buildRolexImportBundle,
  ROLEX_CARTULARY_ID,
  ROLEX_IMPORT_ACTOR_ID,
  ROLEX_IMPORT_DATE,
  ROLEX_IMPORT_REQUEST_ID,
} from '../src/migrations/rolexImport.ts';
import { importCartularyBundle } from './lib/import-cartulary-command.mjs';
import { projectRegistryItem } from './lib/projection-command.mjs';
import { processCartularySyncRequest } from './lib/live-sync-command.mjs';

/**
 * Charge le dossier Rolex du pilote comme données (ADR-029) : Cartulaire autoritaire, projection
 * Registre, puis brouillon privé du propriétaire pour le Cartulaire complet. Idempotent.
 */
const OWNER_UID = process.env.CARTULARIA_OWNER_UID || ROLEX_IMPORT_ACTOR_ID;
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulator && !allowRemote) {
  throw new Error('Import interrompu : utilisez l’émulateur Firestore ou passez explicitement --allow-remote avec des credentials Admin.');
}

const app = getApps()[0] || initializeApp({ projectId, ...(usesEmulator ? {} : { credential: applicationDefault() }) });
const firestore = getFirestore(app);

const imported = await importCartularyBundle({
  firestore,
  bundle: buildRolexImportBundle(),
  requestId: ROLEX_IMPORT_REQUEST_ID,
  actorId: ROLEX_IMPORT_ACTOR_ID,
  expectedRevision: 0,
  occurredAt: ROLEX_IMPORT_DATE,
});

const projected = imported.replayed
  ? { revision: imported.revision, replayed: true }
  : await projectRegistryItem({
    firestore,
    cartularyId: ROLEX_CARTULARY_ID,
    actorId: ROLEX_IMPORT_ACTOR_ID,
    requestId: `project_${ROLEX_IMPORT_REQUEST_ID}`,
    expectedRevision: imported.revision,
    occurredAt: ROLEX_IMPORT_DATE,
  });

const draftRef = firestore.doc(`privateDrafts/${OWNER_UID}/cartularies/${ROLEX_CARTULARY_ID}`);
await draftRef.set({
  ownerUid: OWNER_UID,
  cartularyId: ROLEX_CARTULARY_ID,
  status: 'active',
  retentionPolicyVersion: 'inactive-plus-2y-v1',
  purgeAfter: null,
  lastActiveAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });

let stateUpdates = 0;
for (const [key, value] of buildRolexDossierState()) {
  const reference = draftRef.collection('state').doc(key);
  const existing = await reference.get();
  const serialized = JSON.stringify(value);
  if (existing.exists && existing.data()?.deleted !== true && existing.data()?.value === serialized) continue;
  await reference.set({
    ownerUid: OWNER_UID,
    cartularyId: ROLEX_CARTULARY_ID,
    key,
    value: serialized,
    deleted: false,
    revision: Number(existing.data()?.revision || 0) + 1,
    clientUpdatedAt: Date.now(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  stateUpdates += 1;
}

let sync = { status: 'skipped', reason: 'no_state_change' };
if (stateUpdates > 0) {
  const requestId = `rolex_dossier_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await firestore.doc(`cartularySyncRequests/${ROLEX_CARTULARY_ID}`).set({
    requestDocumentId: ROLEX_CARTULARY_ID,
    requestId,
    ownerUid: OWNER_UID,
    cartularyId: ROLEX_CARTULARY_ID,
    reason: 'rolex_dossier_seed_adr029',
    status: 'pending',
    requestedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  sync = await processCartularySyncRequest({ firestore, requestDocumentId: ROLEX_CARTULARY_ID });
}

console.log(JSON.stringify({
  event: 'ROLEX_CARTULARY_IMPORTED',
  projectId,
  cartularyId: ROLEX_CARTULARY_ID,
  ownerUid: OWNER_UID,
  imported: { revision: imported.revision, replayed: imported.replayed, auditEventId: imported.auditEventId },
  projected,
  stateUpdates,
  sync,
}, null, 2));
