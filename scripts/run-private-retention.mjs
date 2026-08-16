import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  markAccountInactive,
  purgeDuePrivateDrafts,
} from './lib/retention-command.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-retention-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');
const execute = process.argv.includes('--execute');
const inactiveArgument = process.argv.find((argument) => argument.startsWith('--mark-inactive='));

if (!usesEmulator && !allowRemote) {
  throw new Error('Conservation interrompue : utilisez l’émulateur ou passez explicitement --allow-remote.');
}
if (allowRemote && execute && !process.argv.includes('--confirm-private-purge')) {
  throw new Error('Purge distante interrompue : ajoutez --confirm-private-purge après revue du dry-run.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);
const bucket = usesEmulator ? null : getStorage(app).bucket();

const result = inactiveArgument
  ? await markAccountInactive({ firestore, uid: inactiveArgument.split('=')[1] })
  : await purgeDuePrivateDrafts({ firestore, bucket, dryRun: !execute });

console.log(JSON.stringify({ mode: inactiveArgument ? 'mark-inactive' : execute ? 'purge' : 'dry-run', result }, null, 2));
