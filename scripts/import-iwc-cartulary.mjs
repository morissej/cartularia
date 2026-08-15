import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  buildIwcImportBundle,
  IWC_IMPORT_ACTOR_ID,
  IWC_IMPORT_DATE,
  IWC_IMPORT_REQUEST_ID,
} from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from './lib/import-cartulary-command.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulator && !allowRemote) {
  throw new Error(
    'Import interrompu : utilisez l’émulateur Firestore ou passez explicitement --allow-remote avec des credentials Admin.',
  );
}

const app =
  getApps()[0] ||
  initializeApp({
    projectId,
    ...(usesEmulator ? {} : { credential: applicationDefault() }),
  });
const firestore = getFirestore(app);

const result = await importCartularyBundle({
  firestore,
  bundle: buildIwcImportBundle(),
  requestId: IWC_IMPORT_REQUEST_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  expectedRevision: 0,
  occurredAt: IWC_IMPORT_DATE,
});

console.log(
  `Cartulaire IWC ${result.cartularyId} importé en révision ${result.revision} ` +
    `(${result.replayed ? 'rejeu idempotent' : 'création'}, événement ${result.auditEventId}).`,
);
