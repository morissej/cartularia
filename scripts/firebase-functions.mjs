import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
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
import { deleteEmptyRegistryCollection, saveRegistryCollectionCommand } from './lib/collection-command.mjs';
import { createPersonalRecoveryCommands } from './lib/personal-recovery-command.mjs';
import { createRegistryRecoveryCommands } from './lib/registry-recovery-command.mjs';
import { getWebsitePublicationState, publishWebsite, revokeWebsite } from './lib/website-publication-command.mjs';
import {
  loadAdministrationOverview as loadAdministrationOverviewCommand,
  loadAdministrationUserDashboard,
  requireAdministrator,
  setAdministrationUserDisabled,
} from './lib/administration-command.mjs';

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
    'failed_precondition', 'deadline_exceeded', 'already_exists', 'resource_exhausted', 'aborted',
  ]);
  const normalized = String(error?.code || '').replaceAll('-', '_');
  const code = supported.has(normalized) ? normalized.replaceAll('_', '-') : 'internal';
  return new HttpsError(code, code === 'internal' ? "L’opération n’a pas pu être confirmée. Réessayez." : error.message);
};

export const deleteRegistryCollection = onCall(invitationCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  try {
    return await deleteEmptyRegistryCollection({ firestore, uid: request.auth.uid,
      registryId: request.data?.registryId, collectionId: request.data?.collectionId,
      expectedVersion: request.data?.expectedVersion,
      confirmed: request.data?.confirmed });
  } catch (error) { throw callableError(error); }
});

export const saveRegistryCollection = onCall(invitationCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise.');
  try {
    return await saveRegistryCollectionCommand({
      firestore, uid: request.auth.uid, registryId: request.data?.registryId,
      collectionId: request.data?.collectionId, mode: request.data?.mode,
      expectedVersion: request.data?.expectedVersion, input: request.data?.input,
      confirmedPublication: request.data?.confirmedPublication,
    });
  } catch (error) { throw callableError(error); }
});

const configuredProjectServices = (name, projectId, registryProjectId) => {
  const normalizedProjectId = String(projectId || '').trim();
  if (!normalizedProjectId || normalizedProjectId === registryProjectId) return null;
  const existingApp = getApps().find((candidate) => candidate.name === name);
  const projectApp = existingApp || initializeApp({
    credential: applicationDefault(),
    projectId: normalizedProjectId,
    serviceAccountId: `cartularia-recovery-signer@${normalizedProjectId}.iam.gserviceaccount.com`,
  }, name);
  return { auth: getAuth(projectApp), firestore: getFirestore(projectApp) };
};

const administrationSources = () => {
  const registryProjectId = String(app.options.projectId || process.env.GCLOUD_PROJECT || '').trim();
  const personal = configuredProjectServices(
    'cartularia-administration-personal',
    process.env.ADMIN_PERSONAL_FIREBASE_PROJECT_ID,
    registryProjectId,
  );
  const bridge = configuredProjectServices(
    'cartularia-administration-bridge',
    process.env.ADMIN_CODE_BRIDGE_FIREBASE_PROJECT_ID,
    registryProjectId,
  );
  return [
    { id: 'registry', label: 'Registre', auth, firestore },
    { id: 'personal', label: 'Coffre personnel', auth: personal?.auth || null, firestore: personal?.firestore || null },
    { id: 'bridge', label: 'Base de correspondance', auth: bridge?.auth || null, firestore: bridge?.firestore || null },
  ];
};

// Recovery is callable without a Registry session (including from the isolated
// Vault origin). Enrollment checks recent, revoked-aware target-project tokens;
// recovery checks one-use signed challenges and per-credential server limits.
// Existing administration/publication callables retain App Check enforcement.
const recoveryCallableOptions = {
  ...invitationCallableOptions, enforceAppCheck: false,
  serviceAccount: process.env.FUNCTIONS_EMULATOR === 'true' ? undefined : process.env.RECOVERY_RUNTIME_SERVICE_ACCOUNT,
};
const runRecovery = (operation) => onCall(recoveryCallableOptions, async (request) => {
  try {
    // Never silently fall back to the default privileged runtime account.
    if (process.env.FUNCTIONS_EMULATOR !== 'true' && !process.env.RECOVERY_RUNTIME_SERVICE_ACCOUNT) {
      throw new HttpsError('failed-precondition', 'Le service de secours n’est pas encore disponible.');
    }
    return await operation(request);
  }
  catch (error) { logger.warn('Récupération refusée ou indisponible.', { code: error?.code || 'internal' }); throw callableError(error); }
});
const registryRecovery = () => createRegistryRecoveryCommands({ db: firestore, auth });
const personalRecovery = () => {
  const sources = administrationSources();
  const personal = sources.find((source) => source.id === 'personal');
  const bridge = sources.find((source) => source.id === 'bridge');
  if (!personal?.firestore || !personal.auth || !bridge?.auth
    || personal.firestore.projectId === bridge.firestore?.projectId) throw new HttpsError('failed-precondition', 'Les espaces de secours ne sont pas raccordés séparément.');
  return createPersonalRecoveryCommands({ personalDb: personal.firestore, personalAuth: personal.auth, bridgeAuth: bridge.auth });
};
export const enrollRegistryRecovery = runRecovery((request) => registryRecovery().enroll(request.auth, request.data));
export const getRegistryRecoveryStatus = runRecovery((request) => registryRecovery().status(request.auth));
export const revokeRegistryRecovery = runRecovery((request) => registryRecovery().revoke(request.auth));
export const beginRegistryRecovery = runRecovery((request) => registryRecovery().begin(request.data || {}));
export const completeRegistryRecovery = runRecovery((request) => registryRecovery().complete(request.data || {}));
export const enrollPersonalVaultRecovery = runRecovery((request) => personalRecovery().enroll(request.data || {}));
export const getPersonalVaultRecoveryStatus = runRecovery((request) => personalRecovery().status(request.data || {}));
export const revokePersonalVaultRecovery = runRecovery((request) => personalRecovery().revoke(request.data || {}));
export const beginPersonalVaultRecovery = runRecovery((request) => personalRecovery().begin(request.data || {}));
export const completePersonalVaultRecovery = runRecovery((request) => personalRecovery().complete(request.data || {}));
export const commitPersonalVaultPasswordRotation = runRecovery((request) => personalRecovery().commitPasswordRotation(request.data || {}));

const websiteCallableOptions = {
  ...invitationCallableOptions,
  memory: '512MiB',
  timeoutSeconds: 180,
  // Each publication copies verified derivatives sequentially; do not multiply
  // their peak buffer allocation by the platform's default request concurrency.
  concurrency: 1,
};
const runWebsiteCommand = (operation) => onCall(websiteCallableOptions, async (request) => {
  try { return await operation(request); }
  catch (error) { logger.warn('Publication non confirmée.', { code: error?.code || 'internal' }); throw callableError(error); }
});
export const getCartularyWebsiteState = runWebsiteCommand((request) => getWebsitePublicationState({ firestore, requestAuth: request.auth, cartularyId: request.data?.cartularyId }));
export const publishCartularyWebsite = runWebsiteCommand((request) => publishWebsite({ firestore, bucket: storage.bucket(), requestAuth: request.auth, input: request.data || {} }));
export const revokeCartularyWebsite = runWebsiteCommand((request) => revokeWebsite({ firestore, bucket: storage.bucket(), requestAuth: request.auth, input: request.data || {} }));

export const getAdministrationOverview = onCall(invitationCallableOptions, async (request) => {
  try {
    requireAdministrator(request.auth);
    return await loadAdministrationOverviewCommand({
      sources: administrationSources(),
      pageSize: request.data?.pageSize,
    });
  } catch (error) {
    logger.warn('Échec de lecture de la console d’administration.', { code: error?.code || 'internal' });
    throw callableError(error);
  }
});

export const getAdministrationUserDashboard = onCall(invitationCallableOptions, async (request) => {
  try {
    requireAdministrator(request.auth);
    return await loadAdministrationUserDashboard({
      sources: administrationSources(),
      databaseId: request.data?.database,
      targetUid: request.data?.uid,
    });
  } catch (error) {
    logger.warn('Échec de lecture du dashboard utilisateur.', { code: error?.code || 'internal' });
    throw callableError(error);
  }
});

export const setAdministrationUserState = onCall(invitationCallableOptions, async (request) => {
  try {
    const actorUid = requireAdministrator(request.auth);
    const sources = administrationSources();
    const source = sources.find((candidate) => candidate.id === request.data?.database);
    if (!source) throw Object.assign(new Error('Base d’administration invalide.'), { code: 'invalid_argument' });
    const result = await setAdministrationUserDisabled({
      actorUid,
      source,
      targetUid: request.data?.uid,
      disabled: request.data?.disabled === true,
      reason: request.data?.reason,
      auditFirestore: firestore,
      timestamp: FieldValue.serverTimestamp(),
    });
    logger.info('État utilisateur modifié depuis la console.', {
      actorUid,
      targetUid: result.uid,
      database: result.database,
      disabled: result.disabled,
    });
    return result;
  } catch (error) {
    logger.warn('Échec de modification depuis la console d’administration.', { code: error?.code || 'internal' });
    throw callableError(error);
  }
});

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
