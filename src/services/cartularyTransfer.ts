import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import type {
  CartularyTransferAuditEvent,
  CartularyTransferDocument,
  CartularyTransferState,
} from '../domain/transfer.ts';
import { auth, db } from '../firebase.ts';

const token = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');

const currentUser = () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Connexion requise pour décider une cession.');
  return user;
};

const submitRequest = async ({
  cartularyId,
  transferId,
  action,
  expectedRevision,
  counterpartyUid = null,
  expiresAtIso = null,
}: {
  cartularyId: string;
  transferId: string;
  action: 'propose' | 'accept' | 'reject';
  expectedRevision: number;
  counterpartyUid?: string | null;
  expiresAtIso?: string | null;
}) => {
  const user = currentUser();
  const requestId = `transfer_request_${token()}`;
  await setDoc(doc(db, 'cartularyTransferRequests', requestId), {
    requestDocumentId: requestId,
    requestId,
    transferId,
    cartularyId,
    ownerUid: user.uid,
    counterpartyUid,
    action,
    expectedRevision,
    decisionSource: 'human_confirmed',
    expiresAtIso,
    status: 'pending',
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return requestId;
};

export const proposeTransfer = ({ cartularyId, buyerUid, expectedRevision }: {
  cartularyId: string;
  buyerUid: string;
  expectedRevision: number;
}) => submitRequest({
  cartularyId,
  transferId: `transfer_${token()}`,
  action: 'propose',
  expectedRevision,
  counterpartyUid: buyerUid,
  expiresAtIso: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
});

export const acceptTransfer = (transfer: CartularyTransferDocument) => submitRequest({
  cartularyId: transfer.cartularyId,
  transferId: transfer.transferId,
  action: 'accept',
  expectedRevision: transfer.sourceRevision,
});

export const rejectTransfer = (transfer: CartularyTransferDocument) => submitRequest({
  cartularyId: transfer.cartularyId,
  transferId: transfer.transferId,
  action: 'reject',
  expectedRevision: transfer.sourceRevision,
});

export const waitForTransferRequest = (requestId: string, timeoutMs = 180_000) => new Promise<void>((resolve, reject) => {
  let unsubscribe: () => void = () => undefined;
  const timeout = window.setTimeout(() => {
    unsubscribe();
    reject(new Error('La demande reste en cours. Consultez à nouveau le Cartulaire dans quelques instants.'));
  }, timeoutMs);
  unsubscribe = onSnapshot(doc(db, 'cartularyTransferRequests', requestId), (snapshot) => {
    const data = snapshot.data();
    if (data?.status === 'processed') {
      window.clearTimeout(timeout);
      unsubscribe();
      resolve();
    } else if (data?.status === 'failed') {
      window.clearTimeout(timeout);
      unsubscribe();
      reject(new Error(String(data.errorMessage || 'La demande de cession a échoué.')));
    }
  }, (error) => {
    window.clearTimeout(timeout);
    unsubscribe();
    reject(error);
  });
});

export const observeCartularyTransferState = (
  cartularyId: string,
  onState: (state: CartularyTransferState) => void,
  onError: (error: Error) => void,
) => {
  const user = auth.currentUser;
  if (!user) return () => undefined;
  const state: Partial<CartularyTransferState> = { transfers: [], events: [] };
  const emit = () => {
    if (state.revision !== undefined && state.currentOwnerUid) onState(state as CartularyTransferState);
  };
  const unsubscribers = [
    onSnapshot(doc(db, 'cartularies', cartularyId), (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      state.revision = Number(data.revision || 0);
      state.currentOwnerUid = String(data.accountHolderId || '');
      state.transferCount = Number(data.ownershipTransferCount || 0);
      emit();
    }, (error) => onError(error)),
    onSnapshot(query(
      collection(db, 'cartularyTransfers'),
      where('participantUids', 'array-contains', user.uid),
      where('cartularyId', '==', cartularyId),
    ), (snapshot) => {
      state.transfers = snapshot.docs.map((document) => document.data() as CartularyTransferDocument)
        .sort((left, right) => right.sourceRevision - left.sourceRevision);
      emit();
    }, (error) => onError(error)),
    onSnapshot(query(collection(db, 'cartularies', cartularyId, 'auditEvents'), orderBy('sequence', 'asc')), (snapshot) => {
      state.events = snapshot.docs
        .map((document) => document.data() as CartularyTransferAuditEvent)
        .filter((event) => event.action.startsWith('cartulary.transfer.'));
      emit();
    }, (error) => onError(error)),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
};
