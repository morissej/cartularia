import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import {
  markCartularySyncRequestFailed,
  processCartularySyncRequest,
} from './lib/live-sync-command.mjs';

const REGION = 'us-central1';
const app = getApps()[0] || initializeApp();
const firestore = getFirestore(app);

setGlobalOptions({ region: REGION, maxInstances: 5 });

export const syncCartularyToRegistry = onDocumentWritten({
  document: 'cartularySyncRequests/{requestDocumentId}',
  region: REGION,
  memory: '512MiB',
  timeoutSeconds: 120,
  maxInstances: 5,
  retry: false,
}, async (event) => {
  const after = event.data?.after;
  if (!after?.exists || after.data()?.status !== 'pending') return;
  const requestDocumentId = event.params.requestDocumentId;
  const requestId = after.data().requestId;
  try {
    const result = await processCartularySyncRequest({ firestore, requestDocumentId });
    logger.info('Cartulaire raccordé au Registre.', {
      requestDocumentId,
      outcome: result.outcome,
      revision: result.revision,
    });
  } catch (error) {
    await markCartularySyncRequestFailed({
      firestore,
      requestDocumentId,
      requestId,
      error,
    });
    logger.error('Échec du raccordement Cartulaire vers Registre.', {
      requestDocumentId,
      code: error?.code || 'sync_failed',
      message: error?.message || String(error),
    });
    throw error;
  }
});
