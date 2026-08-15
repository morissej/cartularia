import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { IWC_CARTULARY_ID, IWC_IMPORT_ACTOR_ID } from '../src/migrations/iwcImport.ts';
import { projectRegistryItem } from './lib/projection-command.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulator && !allowRemote) {
  throw new Error(
    'Projection interrompue : utilisez l’émulateur ou passez explicitement --allow-remote avec des credentials Admin.',
  );
}

const expectedRevisionArgument = process.argv.find((argument) => argument.startsWith('--expected-revision='));
const expectedRevision = Number(expectedRevisionArgument?.split('=')[1] ?? 1);
if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
  throw new Error('--expected-revision doit être un entier positif.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);

const result = await projectRegistryItem({
  firestore,
  cartularyId: IWC_CARTULARY_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  requestId: 'wave3-project-registry-iwc-v1',
  expectedRevision,
  occurredAt: '2026-08-14T10:00:00.000Z',
});

console.log(JSON.stringify({
  ...result,
  publicProjection: 'blocked_pending_human_W_approval',
  reportProjection: 'blocked_pending_human_R_approval',
}, null, 2));
