import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { sha256Digest } from './canonical-json.mjs';
import { issueRfc3161Timestamp } from './rfc3161-timestamp.mjs';

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const REQUEST_ID_PATTERN = /^timestamp_[a-f0-9]{32}$/;
const FIRESTORE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const DEFAULT_RATE_LIMIT = 6;

export class TimestampRequestCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TimestampRequestCommandError';
    this.code = code;
  }
}

const validateRequestDocument = (requestDocumentId, data) => {
  if (
    !data
    || requestDocumentId !== data.requestDocumentId
    || requestDocumentId !== data.requestId
    || !REQUEST_ID_PATTERN.test(data.requestId || '')
    || !FIRESTORE_ID_PATTERN.test(data.ownerUid || '')
    || !FIRESTORE_ID_PATTERN.test(data.cartularyId || '')
    || !SHA256_PATTERN.test(data.digest || '')
  ) {
    throw new TimestampRequestCommandError('invalid_request', 'Demande d’horodatage incomplète ou invalide.');
  }
  return data;
};

const assertLegalOwner = (root, membership, ownerUid) => {
  const rootData = root.exists ? root.data() : null;
  const membershipData = membership.exists ? membership.data() : null;
  if (
    !rootData
    || rootData.accountHolderId !== ownerUid
    || !membershipData
    || membership.id !== ownerUid
    || membershipData.uid !== ownerUid
    || membershipData.organizationId !== rootData.organizationId
    || membershipData.status !== 'active'
    || !Array.isArray(membershipData.roles)
    || !membershipData.roles.includes('legal_owner')
    || !Array.isArray(membershipData.permissions)
    || !membershipData.permissions.includes('integrity.batch')
    || !Array.isArray(membershipData.scopes?.registryIds)
    || !membershipData.scopes.registryIds.includes(rootData.registryId)
  ) {
    throw new TimestampRequestCommandError('permission_denied', 'Le demandeur n’est pas le propriétaire légal autorisé de ce Cartulaire.');
  }
  return rootData;
};

const assertTrustedReceipt = (receipt, requestData) => {
  if (
    !receipt
    || receipt.protocol !== 'rfc3161-v1'
    || receipt.status !== 'ExternalReceipt'
    || receipt.digest !== requestData.digest
    || receipt.requestId !== requestData.requestId
    || receipt.verificationStatus !== 'trusted_rfc3161'
    || receipt.signatureVerified !== true
    || receipt.chainVerified !== true
    || receipt.nonceMatched !== true
    || receipt.hashAlgorithm !== 'sha256'
    || receipt.qualified !== false
    || receipt.qualificationStatus !== 'not_assessed'
    || !receipt.requestBase64
    || !receipt.tokenBase64
  ) {
    throw new TimestampRequestCommandError('unverified_timestamp_receipt', 'La TSA n’a pas produit un reçu RFC 3161 vérifié pour l’empreinte demandée.');
  }
};

const timestampInputDigest = (requestData) => sha256Digest({
  command: 'issueRfc3161Timestamp',
  requestId: requestData.requestId,
  ownerUid: requestData.ownerUid,
  cartularyId: requestData.cartularyId,
  digest: requestData.digest,
});

const hourWindowKey = (occurredAt) => {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.valueOf())) {
    throw new TimestampRequestCommandError('invalid_time', 'Horloge serveur invalide.');
  }
  return date.toISOString().slice(0, 13).replaceAll('-', '').replace('T', '');
};

const replayResult = (receipt, requestDocumentId) => ({
  requestDocumentId,
  receiptId: receipt.data().receiptId,
  status: 'processed',
  replayed: true,
});

export const processTimestampRequest = async ({
  firestore,
  requestDocumentId,
  issueTimestamp = issueRfc3161Timestamp,
  occurredAt = new Date().toISOString(),
  rateLimitPerHour = Number(process.env.CARTULARIA_TIMESTAMP_RATE_LIMIT_PER_HOUR || DEFAULT_RATE_LIMIT),
}) => {
  const requestRef = firestore.doc(`timestampRequests/${requestDocumentId}`);
  const receiptRef = firestore.doc(`timestampReceipts/${requestDocumentId}`);
  const initialRequest = await requestRef.get();
  if (!initialRequest.exists) return { requestDocumentId, status: 'ignored', reason: 'missing' };
  const requestData = validateRequestDocument(requestDocumentId, initialRequest.data());
  const inputDigest = timestampInputDigest(requestData);

  if (requestData.status === 'processed') {
    const receipt = await receiptRef.get();
    if (!receipt.exists || receipt.data().inputDigest !== inputDigest) {
      throw new TimestampRequestCommandError('receipt_missing', 'La demande est traitée mais son reçu est absent ou incohérent.');
    }
    return replayResult(receipt, requestDocumentId);
  }
  if (requestData.status !== 'pending') {
    return { requestDocumentId, status: 'ignored', reason: requestData.status || 'not_pending' };
  }
  if (!Number.isInteger(rateLimitPerHour) || rateLimitPerHour < 1 || rateLimitPerHour > 100) {
    throw new TimestampRequestCommandError('invalid_rate_limit', 'Limite de débit serveur invalide.');
  }

  const rootRef = firestore.doc(`cartularies/${requestData.cartularyId}`);
  const initialRoot = await rootRef.get();
  if (!initialRoot.exists) throw new TimestampRequestCommandError('cartulary_not_found', 'Cartulaire introuvable.');
  const initialRootData = initialRoot.data();
  const membershipRef = firestore.doc(`organizations/${initialRootData.organizationId}/memberships/${requestData.ownerUid}`);
  const windowKey = hourWindowKey(occurredAt);
  const rateRef = firestore.doc(`timestampRateLimits/${requestData.ownerUid}/windows/${windowKey}`);

  const claim = await firestore.runTransaction(async (transaction) => {
    const [currentRequest, existingReceipt, root, membership, rate] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(receiptRef),
      transaction.get(rootRef),
      transaction.get(membershipRef),
      transaction.get(rateRef),
    ]);
    if (!currentRequest.exists) return { claimed: false, reason: 'missing' };
    const currentData = validateRequestDocument(requestDocumentId, currentRequest.data());
    if (timestampInputDigest(currentData) !== inputDigest) {
      throw new TimestampRequestCommandError('idempotency_conflict', 'La demande a changé sous le même identifiant.');
    }
    if (existingReceipt.exists) {
      if (existingReceipt.data().inputDigest !== inputDigest) {
        throw new TimestampRequestCommandError('idempotency_conflict', 'Un reçu différent existe sous le même identifiant.');
      }
      transaction.update(requestRef, {
        status: 'processed',
        receiptId: existingReceipt.data().receiptId,
        processedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { claimed: false, replay: replayResult(existingReceipt, requestDocumentId) };
    }
    if (currentData.status !== 'pending') return { claimed: false, reason: currentData.status || 'not_pending' };
    const rootData = assertLegalOwner(root, membership, requestData.ownerUid);
    if (
      rootData.organizationId !== initialRootData.organizationId
      || rootData.registryId !== initialRootData.registryId
    ) {
      throw new TimestampRequestCommandError('scope_changed', 'Le périmètre du Cartulaire a changé pendant la demande.');
    }
    const used = rate.exists ? Number(rate.data().count || 0) : 0;
    if (used >= rateLimitPerHour) {
      throw new TimestampRequestCommandError('rate_limited', 'Limite horaire d’horodatage atteinte pour ce compte.');
    }
    transaction.set(rateRef, {
      ownerUid: requestData.ownerUid,
      windowKey,
      count: used + 1,
      limit: rateLimitPerHour,
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date(new Date(occurredAt).valueOf() + 2 * 60 * 60 * 1000)),
    }, { merge: true });
    transaction.update(requestRef, {
      status: 'processing',
      inputDigest,
      processingStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true, organizationId: rootData.organizationId, registryId: rootData.registryId };
  });

  if (claim.replay) return claim.replay;
  if (!claim.claimed) return { requestDocumentId, status: 'ignored', reason: claim.reason || 'not_claimed' };

  const receipt = await issueTimestamp({ digest: requestData.digest, requestId: requestData.requestId });
  assertTrustedReceipt(receipt, requestData);

  return firestore.runTransaction(async (transaction) => {
    const [currentRequest, existingReceipt] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(receiptRef),
    ]);
    if (!currentRequest.exists || timestampInputDigest(currentRequest.data()) !== inputDigest) {
      throw new TimestampRequestCommandError('idempotency_conflict', 'La demande a été remplacée pendant l’horodatage.');
    }
    if (existingReceipt.exists) {
      if (existingReceipt.data().inputDigest !== inputDigest || existingReceipt.data().tokenSha256 !== receipt.tokenSha256) {
        throw new TimestampRequestCommandError('idempotency_conflict', 'Le reçu existant ne correspond pas au rejeu.');
      }
      return replayResult(existingReceipt, requestDocumentId);
    }
    if (currentRequest.data().status !== 'processing') {
      throw new TimestampRequestCommandError('request_not_processing', 'La demande n’est plus en cours de traitement.');
    }
    transaction.create(receiptRef, {
      ...receipt,
      requestDocumentId,
      ownerUid: requestData.ownerUid,
      cartularyId: requestData.cartularyId,
      organizationId: claim.organizationId,
      registryId: claim.registryId,
      inputDigest,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(requestRef, {
      status: 'processed',
      receiptId: receipt.receiptId,
      processedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      requestDocumentId,
      receiptId: receipt.receiptId,
      status: 'processed',
      replayed: false,
    };
  });
};

const publicFailureMessage = (error) => {
  if (error?.code === 'rate_limited') return 'Limite horaire d’horodatage atteinte. Réessayez plus tard.';
  if (error?.code === 'permission_denied') return 'Ce compte ne peut pas horodater ce Cartulaire.';
  if (error?.code === 'invalid_request') return 'La demande d’horodatage est invalide.';
  return 'L’horodatage externe a échoué. Aucun reçu de test n’a été créé.';
};

export const markTimestampRequestFailed = async ({ firestore, requestDocumentId, requestId, error }) => {
  const requestRef = firestore.doc(`timestampRequests/${requestDocumentId}`);
  await firestore.runTransaction(async (transaction) => {
    const request = await transaction.get(requestRef);
    if (!request.exists || request.data().requestId !== requestId || request.data().status === 'processed') return;
    transaction.update(requestRef, {
      status: 'failed',
      errorCode: error?.code || 'timestamp_failed',
      errorMessage: publicFailureMessage(error),
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};
