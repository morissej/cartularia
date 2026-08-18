import { readFileSync } from 'node:fs';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { processPrivateDraftUploadBacklog } from './lib/private-upload-command.mjs';

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
  || readLocalValue('VITE_FIREBASE_PROJECT_ID');
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET
  || readLocalValue('VITE_FIREBASE_STORAGE_BUCKET');
const usesEmulators = Boolean(process.env.FIRESTORE_EMULATOR_HOST && (
  process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST
));
const allowRemote = process.argv.includes('--allow-remote');
const limitArgument = process.argv.find((argument) => argument.startsWith('--limit='));
const limit = Math.min(25, Math.max(1, Number(limitArgument?.slice('--limit='.length) || 10)));

if (!projectId || !storageBucket) throw new Error('Projet Firebase ou bucket Storage non configuré.');
if (!usesEmulators && !allowRemote) {
  throw new Error('Validation interrompue : utilisez les émulateurs ou passez explicitement --allow-remote.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  storageBucket,
  ...(usesEmulators ? {} : { credential: applicationDefault() }),
});
const result = await processPrivateDraftUploadBacklog({
  firestore: getFirestore(app),
  storage: getStorage(app),
  limit,
});

console.log(JSON.stringify({
  event: 'PRIVATE_UPLOAD_BACKLOG_PROCESSED',
  projectId,
  limit,
  ...result,
}));
