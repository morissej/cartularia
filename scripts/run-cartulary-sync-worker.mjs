import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { markCartularySyncRequestFailed, processCartularySyncRequest } from './lib/live-sync-command.mjs';

const localProjectId = (() => {
  try {
    return readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .match(/^VITE_FIREBASE_PROJECT_ID=(.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
})();
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || localProjectId || 'cartularia-wave1-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');
if (!usesEmulator && !allowRemote) {
  throw new Error('Worker interrompu : utilisez l’émulateur Firestore ou passez explicitement --allow-remote.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);
const active = new Set();

const processDocument = async (document) => {
  const data = document.data();
  if (active.has(document.id)) return;
  active.add(document.id);
  try {
    const result = await processCartularySyncRequest({ firestore, requestDocumentId: document.id });
    console.log(JSON.stringify({ event: 'CARTULARY_SYNC', ...result }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'CARTULARY_SYNC_FAILED', requestDocumentId: document.id, code: error?.code, message: error?.message }));
    await markCartularySyncRequestFailed({
      firestore,
      requestDocumentId: document.id,
      requestId: data.requestId,
      error,
    });
  } finally {
    active.delete(document.id);
  }
};

const unsubscribe = firestore.collection('cartularySyncRequests')
  .where('status', '==', 'pending')
  .onSnapshot(
    (snapshot) => snapshot.docChanges()
      .filter((change) => change.type === 'added' || change.type === 'modified')
      .forEach((change) => void processDocument(change.doc)),
    (error) => console.error(JSON.stringify({ event: 'SYNC_WORKER_LISTENER_FAILED', message: error.message })),
  );

console.log(JSON.stringify({ event: 'SYNC_WORKER_READY', projectId, usesEmulator }));

const stop = () => {
  unsubscribe();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
