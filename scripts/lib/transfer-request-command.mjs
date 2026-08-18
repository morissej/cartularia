import { FieldValue } from 'firebase-admin/firestore';
import {
  acceptCartularyTransfer,
  completeCartularyTransfer,
  proposeCartularyTransfer,
  rejectCartularyTransfer,
  sealAcceptedTransferHead,
} from './transfer-command.mjs';

const ID = /^[a-z0-9][a-z0-9_-]{5,127}$/;

export class TransferRequestCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TransferRequestCommandError';
    this.code = code;
  }
}

const validateRequest = (requestDocumentId, data) => {
  if (
    !data
    || data.requestDocumentId !== requestDocumentId
    || data.requestId !== requestDocumentId
    || !ID.test(data.requestId || '')
    || !ID.test(data.transferId || '')
    || !ID.test(data.cartularyId || '')
    || !ID.test(data.ownerUid || '')
    || !['propose', 'accept', 'reject'].includes(data.action)
    || !Number.isInteger(data.expectedRevision)
    || data.expectedRevision < 1
    || data.decisionSource !== 'human_confirmed'
    || (data.action === 'propose' && !ID.test(data.counterpartyUid || ''))
  ) {
    throw new TransferRequestCommandError('invalid_request', 'Demande de cession incomplète ou invalide.');
  }
  return data;
};

export const processTransferRequest = async ({
  firestore,
  requestDocumentId,
  issueTimestamp,
  publicAnchorAdapter,
  occurredAt = new Date().toISOString(),
}) => {
  const requestRef = firestore.doc(`cartularyTransferRequests/${requestDocumentId}`);
  const initial = await requestRef.get();
  if (!initial.exists) return { requestDocumentId, status: 'ignored', reason: 'missing' };
  const request = validateRequest(requestDocumentId, initial.data());
  if (request.status === 'processed') return { ...request.result, requestDocumentId, replayed: true };
  if (!['pending', 'failed'].includes(request.status)) return { requestDocumentId, status: 'ignored', reason: request.status };
  await requestRef.update({ status: 'processing', processingStartedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });

  let result;
  if (request.action === 'propose') {
    result = await proposeCartularyTransfer({
      firestore,
      transferId: request.transferId,
      cartularyId: request.cartularyId,
      sellerUid: request.ownerUid,
      buyerUid: request.counterpartyUid,
      requestId: request.requestId,
      expectedRevision: request.expectedRevision,
      occurredAt,
      expiresAt: request.expiresAtIso,
    });
  } else if (request.action === 'reject') {
    result = await rejectCartularyTransfer({
      firestore,
      transferId: request.transferId,
      buyerUid: request.ownerUid,
      requestId: request.requestId,
      expectedRevision: request.expectedRevision,
      occurredAt,
    });
  } else {
    const accepted = await acceptCartularyTransfer({
      firestore,
      transferId: request.transferId,
      buyerUid: request.ownerUid,
      requestId: request.requestId,
      expectedRevision: request.expectedRevision,
      occurredAt,
    });
    const sealing = await sealAcceptedTransferHead({ firestore, transferId: request.transferId, issueTimestamp, publicAnchorAdapter, occurredAt });
    result = await completeCartularyTransfer({
      firestore,
      transferId: request.transferId,
      requestId: `complete_${request.requestId}`,
      expectedRevision: accepted.revision,
      occurredAt,
    });
    result = { ...result, sealing };
  }

  await requestRef.update({
    status: 'processed',
    result,
    processedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ...result, requestDocumentId, replayed: false };
};

const publicMessage = (error) => {
  if (error?.code === 'revision_conflict' || error?.code === 'stale_transfer') return 'Le Cartulaire a évolué : la proposition doit être renouvelée.';
  if (error?.code === 'permission_denied') return 'Ce compte ne peut pas décider cette cession.';
  if (error?.code === 'transfer_expired') return 'La proposition de cession a expiré.';
  return 'La cession n’a pas pu être traitée. Aucun changement de propriétaire n’a été appliqué.';
};

export const markTransferRequestFailed = async ({ firestore, requestDocumentId, error }) => {
  const requestRef = firestore.doc(`cartularyTransferRequests/${requestDocumentId}`);
  await firestore.runTransaction(async (transaction) => {
    const request = await transaction.get(requestRef);
    if (!request.exists || request.data().status === 'processed') return;
    transaction.update(requestRef, {
      status: 'failed',
      errorCode: error?.code || 'transfer_failed',
      errorMessage: publicMessage(error),
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};
