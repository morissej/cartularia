import type { Rfc3161GatewayReceipt } from '../utils/integrityJournal';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebase';

interface TimestampRequestDocument {
  status?: 'pending' | 'processing' | 'processed' | 'failed';
  errorMessage?: string;
}

const isGatewayReceipt = (value: unknown): value is Rfc3161GatewayReceipt => {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<Rfc3161GatewayReceipt>;
  return receipt.protocol === 'rfc3161-v1'
    && receipt.status === 'ExternalReceipt'
    && (receipt.verificationStatus === 'trusted_rfc3161' || receipt.verificationStatus === 'qualified_eidas')
    && receipt.signatureVerified === true
    && receipt.chainVerified === true
    && receipt.nonceMatched === true
    && typeof receipt.tokenBase64 === 'string'
    && typeof receipt.requestBase64 === 'string'
    && typeof receipt.issuedAt === 'string';
};

const randomRequestId = () => `timestamp_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;

const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

export const requestExternalTimestamp = async (
  digest: string,
  cartularyId: string,
): Promise<Rfc3161GatewayReceipt> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Connectez-vous avec le compte propriétaire pour demander un horodatage externe.');
  if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('La racine Merkle à horodater est invalide.');
  if (!cartularyId) throw new Error('Le Cartulaire à horodater est introuvable.');

  const requestId = randomRequestId();
  const requestRef = doc(db, 'timestampRequests', requestId);
  const receiptRef = doc(db, 'timestampReceipts', requestId);
  await setDoc(requestRef, {
    requestDocumentId: requestId,
    requestId,
    ownerUid: user.uid,
    cartularyId,
    digest,
    status: 'pending',
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const requestSnapshot = await getDoc(requestRef);
    const request = requestSnapshot.data() as TimestampRequestDocument | undefined;
    if (request?.status === 'failed') {
      throw new Error(request.errorMessage || 'L’horodatage externe a échoué. Aucun reçu de test n’a été créé.');
    }
    if (request?.status === 'processed') {
      const receiptSnapshot = await getDoc(receiptRef);
      const receipt: unknown = receiptSnapshot.data();
      if (!isGatewayReceipt(receipt)) throw new Error('La passerelle a conservé un reçu RFC 3161 incomplet.');
      if (receipt.digest !== digest || receipt.requestId !== requestId) {
        throw new Error('Le reçu RFC 3161 ne correspond pas à la demande d’horodatage.');
      }
      return receipt;
    }
    await wait(500);
  }
  throw new Error('La passerelle d’horodatage n’a pas répondu dans le délai prévu.');
};
