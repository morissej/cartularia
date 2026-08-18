import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  markCartularySyncRequestFailed,
  processCartularySyncRequest,
} from './lib/live-sync-command.mjs';
import {
  markCartularyCreateRequestFailed,
  processCartularyCreateRequest,
} from './lib/create-cartulary-command.mjs';
import {
  markTimestampRequestFailed,
  processTimestampRequest,
} from './lib/timestamp-request-command.mjs';
import { runScheduledPublicAnchoring } from './lib/public-anchor-command.mjs';
import { runExpiredTransferSweep } from './lib/transfer-command.mjs';
import { markTransferRequestFailed, processTransferRequest } from './lib/transfer-request-command.mjs';

const REGION = 'us-central1';
const app = getApps()[0] || initializeApp();
const firestore = getFirestore(app);

setGlobalOptions({ region: REGION, maxInstances: 5 });

export const anchorIntegrityBatchesDaily = onSchedule({
  schedule: '20 3 * * *',
  timeZone: 'Europe/Paris',
  region: REGION,
  memory: '512MiB',
  timeoutSeconds: 540,
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const result = await runScheduledPublicAnchoring({ firestore });
  logger.info('Cycle quotidien OpenTimestamps terminé.', {
    inspected: result.inspected,
    eligible: result.eligible,
    anchored: result.anchored,
    pending: result.pending,
    failed: result.failed,
  });
  if (result.failed > 0) {
    logger.warn('Certains lots devront être retentés au prochain cycle.', { failed: result.failed });
  }
});

export const expireCartularyTransfersDaily = onSchedule({
  schedule: '35 3 * * *',
  timeZone: 'Europe/Paris',
  region: REGION,
  memory: '256MiB',
  timeoutSeconds: 120,
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const result = await runExpiredTransferSweep({ firestore });
  logger.info('Cycle quotidien d’expiration des cessions terminé.', {
    inspected: result.inspected,
    expired: result.expired,
  });
});

export const processCartularyTransfer = onDocumentWritten({
  document: 'cartularyTransferRequests/{requestDocumentId}',
  region: REGION,
  memory: '512MiB',
  timeoutSeconds: 540,
  maxInstances: 2,
  retry: false,
}, async (event) => {
  const after = event.data?.after;
  if (!after?.exists || after.data()?.status !== 'pending') return;
  const requestDocumentId = event.params.requestDocumentId;
  try {
    const result = await processTransferRequest({ firestore, requestDocumentId });
    logger.info('Demande de cession traitée.', {
      requestDocumentId,
      transferId: result.transferId,
      status: result.status,
    });
  } catch (error) {
    await markTransferRequestFailed({ firestore, requestDocumentId, error });
    logger.error('Échec de la demande de cession.', {
      requestDocumentId,
      code: error?.code || 'transfer_failed',
    });
    throw error;
  }
});

export const issueRfc3161TimestampReceipt = onDocumentWritten({
  document: 'timestampRequests/{requestDocumentId}',
  region: REGION,
  memory: '512MiB',
  timeoutSeconds: 60,
  maxInstances: 5,
  retry: false,
}, async (event) => {
  const after = event.data?.after;
  if (!after?.exists || after.data()?.status !== 'pending') return;
  const requestDocumentId = event.params.requestDocumentId;
  const requestId = after.data().requestId;
  try {
    const result = await processTimestampRequest({ firestore, requestDocumentId });
    logger.info('Demande RFC 3161 traitée.', {
      requestDocumentId,
      status: result.status,
      replayed: result.replayed === true,
    });
  } catch (error) {
    await markTimestampRequestFailed({ firestore, requestDocumentId, requestId, error });
    logger.error('Échec de la demande RFC 3161.', {
      requestDocumentId,
      code: error?.code || 'timestamp_failed',
    });
    throw error;
  }
});

export const createCartularyFromPrivateDraft = onDocumentWritten({
  document: 'cartularyCreateRequests/{requestDocumentId}',
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
    const result = await processCartularyCreateRequest({ firestore, requestDocumentId });
    logger.info('Cartulaire créé depuis un brouillon privé.', {
      requestDocumentId,
      status: result.status,
      revision: result.revision,
    });
  } catch (error) {
    await markCartularyCreateRequestFailed({ firestore, requestDocumentId, requestId, error });
    logger.error('Échec de création du Cartulaire depuis le brouillon privé.', {
      requestDocumentId,
      code: error?.code || 'create_failed',
      message: error?.message || String(error),
    });
    throw error;
  }
});

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
