import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
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
import {
  processPrivateDraftUpload,
  processPrivateDraftUploadBacklog,
} from './lib/private-upload-command.mjs';
import {
  acceptRegistryInvitation,
  issueRegistryInvitation,
  revokeRegistryInvitation,
} from './lib/invitation-command.mjs';
import { activateRegistryAccount as activateRegistryAccountCommand } from './lib/account-command.mjs';

const REGION = 'us-central1';
const app = getApps()[0] || initializeApp();
const firestore = getFirestore(app);
const storage = getStorage(app);
const auth = getAuth(app);

setGlobalOptions({ region: REGION, maxInstances: 5 });

const invitationCallableOptions = {
  region: REGION,
  memory: '256MiB',
  timeoutSeconds: 30,
  maxInstances: 5,
  enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== 'true',
};

export const activateRegistryAccount = onCall(invitationCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  try {
    const result = await activateRegistryAccountCommand({
      firestore,
      uid: request.auth.uid,
      email: request.auth.token.email || '',
      userName: request.data?.userName,
    });
    await auth.updateUser(request.auth.uid, { displayName: request.data?.userName?.trim().replace(/\s+/g, ' ').slice(0, 64) });
    return result;
  } catch (error) {
    logger.warn("Échec d’activation d’un compte Registre.", { code: error?.code || 'internal' });
    throw callableError(error);
  }
});

const callableError = (error) => {
  const supported = new Set([
    'invalid_argument', 'unauthenticated', 'permission_denied', 'not_found',
    'failed_precondition', 'deadline_exceeded', 'already_exists',
  ]);
  const code = supported.has(error?.code) ? error.code.replaceAll('_', '-') : 'internal';
  return new HttpsError(code, code === 'internal' ? "L’opération d’invitation a échoué." : error.message);
};

export const createRegistryInvitation = onCall(invitationCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  try {
    const result = await issueRegistryInvitation({
      firestore,
      auth,
      actorUid: request.auth.uid,
      registryId: request.data?.registryId,
      recipientEmail: request.data?.recipientEmail,
      scopeType: request.data?.scopeType,
      scopeId: request.data?.scopeId,
      displayTitle: request.data?.displayTitle,
      expiresAt: request.data?.expiresAt,
      continueUrl: request.data?.continueUrl,
    });
    return {
      invitationId: result.invitationId,
      expiresAt: result.expiresAt,
      ...(process.env.FUNCTIONS_EMULATOR === 'true' ? { emulatorSignInLink: result.signInLink } : {}),
    };
  } catch (error) {
    logger.warn("Échec d’émission d’une invitation.", { code: error?.code || 'internal' });
    throw callableError(error);
  }
});

export const acceptRegistryInvitationLink = onCall(invitationCallableOptions, async (request) => {
  if (!request.auth?.token?.email || request.auth.token.email_verified !== true) {
    throw new HttpsError('unauthenticated', 'Une adresse électronique vérifiée est requise.');
  }
  try {
    return await acceptRegistryInvitation({
      firestore,
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email,
      invitationId: request.data?.invitationId,
      token: request.data?.token,
    });
  } catch (error) {
    logger.warn("Échec d’acceptation d’une invitation.", { code: error?.code || 'internal' });
    throw callableError(error);
  }
});

export const revokeRegistryInvitationLink = onCall(invitationCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  try {
    return await revokeRegistryInvitation({
      firestore,
      actorUid: request.auth.uid,
      registryId: request.data?.registryId,
      invitationId: request.data?.invitationId,
    });
  } catch (error) {
    logger.warn("Échec de révocation d’une invitation.", { code: error?.code || 'internal' });
    throw callableError(error);
  }
});

export const verifyPrivateDraftUpload = onObjectFinalized({
  region: REGION,
  memory: '1GiB',
  timeoutSeconds: 540,
  maxInstances: 2,
  retry: false,
}, async (event) => {
  const result = await processPrivateDraftUpload({ firestore, storage, object: event.data });
  if (result.status === 'rejected') logger.warn('Original privé refusé après inspection.', result);
  else if (result.status === 'accepted') logger.info('Original privé vérifié.', result);
});

export const verifyPrivateDraftBacklogDaily = onSchedule({
  schedule: '5 4 * * *',
  timeZone: 'Europe/Paris',
  region: REGION,
  memory: '1GiB',
  timeoutSeconds: 540,
  maxInstances: 1,
  retryCount: 0,
}, async () => {
  const result = await processPrivateDraftUploadBacklog({ firestore, storage, limit: 10 });
  logger.info('Validation progressive des originaux privés terminée.', result);
});

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
