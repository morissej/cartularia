import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  CAR_DEMO_CARTULARY_ID,
  CAR_DEMO_IMPORT_ACTOR_ID,
} from '../src/migrations/carDemoImport.ts';
import { projectRegistryItem } from './lib/projection-command.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulator && !allowRemote) {
  throw new Error(
    'Projection interrompue : utilisez l’émulateur ou passez explicitement --allow-remote avec des credentials Admin.',
  );
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);

const result = await projectRegistryItem({
  firestore,
  cartularyId: CAR_DEMO_CARTULARY_ID,
  actorId: CAR_DEMO_IMPORT_ACTOR_ID,
  requestId: 'wave4-project-registry-car-v1',
  expectedRevision: 1,
  occurredAt: '2026-08-14T14:05:00.000Z',
});

console.log(JSON.stringify({
  ...result,
  vertical: 'car@1.0.0',
  publicProjection: 'not_requested',
  reportProjection: 'not_requested',
}, null, 2));
