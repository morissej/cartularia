import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { IWC_IMPORT_ACTOR_ID } from '../src/migrations/iwcImport.ts';
import { moderateCommunityPublication } from './lib/community-command.mjs';

const WAVE5_COMMUNITY_PUBLICATION_ID = 'community_iwc_pilot_20260814';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');

if (!usesEmulator && !allowRemote) {
  throw new Error(
    'Modération interrompue : utilisez l’émulateur ou passez explicitement --allow-remote avec des credentials Admin.',
  );
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);

const result = await moderateCommunityPublication({
  firestore,
  publicationId: WAVE5_COMMUNITY_PUBLICATION_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  reasonCode: 'wave5_moderation_fixture',
  requestId: 'wave5-moderate-community-publication-v1',
  occurredAt: '2026-08-14T15:10:00.000Z',
});

console.log(JSON.stringify(result, null, 2));
