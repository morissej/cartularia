import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  buildCarDemoImportBundle,
  CAR_DEMO_IMPORT_ACTOR_ID,
  CAR_DEMO_IMPORT_DATE,
  CAR_DEMO_IMPORT_REQUEST_ID,
} from '../src/migrations/carDemoImport.ts';
import { importCartularyBundle } from './lib/import-cartulary-command.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulator && !allowRemote) {
  throw new Error(
    'Import interrompu : utilisez l’émulateur Firestore ou passez explicitement --allow-remote avec des credentials Admin.',
  );
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);

const result = await importCartularyBundle({
  firestore,
  bundle: buildCarDemoImportBundle(),
  requestId: CAR_DEMO_IMPORT_REQUEST_ID,
  actorId: CAR_DEMO_IMPORT_ACTOR_ID,
  expectedRevision: 0,
  occurredAt: CAR_DEMO_IMPORT_DATE,
});

console.log(
  `Cartulaire car ${result.cartularyId} importé en révision ${result.revision} ` +
    `(${result.replayed ? 'rejeu idempotent' : 'création'}, événement ${result.auditEventId}).`,
);
