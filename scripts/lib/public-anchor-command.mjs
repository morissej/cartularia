import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { canonicalize, sha256Bytes } from './canonical-json.mjs';
import {
  OpenTimestampsPublicAnchorAdapter,
  publicAnchorPayloadDigest,
  toPublicAnchorPayload,
} from './trust-adapters.mjs';

const PROVIDER_DOCUMENT_ID = 'opentimestamps';
const LOCK_DURATION_MS = 10 * 60 * 1000;

export class PublicAnchorCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PublicAnchorCommandError';
    this.code = code;
  }
}

const validateAnchorResult = ({ result, payloadDigest }) => {
  if (!['pending_confirmation', 'anchored'].includes(result?.status)) {
    throw new PublicAnchorCommandError('invalid_anchor_status', 'Statut OpenTimestamps invalide.');
  }
  if (result.provider !== 'opentimestamps' || result.network !== 'bitcoin-mainnet') {
    throw new PublicAnchorCommandError('invalid_anchor_provider', 'Fournisseur d’ancrage inattendu.');
  }
  if (result.payloadDigest !== payloadDigest || !result.proofBase64 || !result.proofSha256) {
    throw new PublicAnchorCommandError('invalid_anchor_proof', 'Preuve OpenTimestamps incomplète.');
  }
  let proof;
  try {
    proof = Buffer.from(result.proofBase64, 'base64');
  } catch {
    throw new PublicAnchorCommandError('invalid_anchor_proof', 'Preuve OpenTimestamps illisible.');
  }
  if (proof.length === 0 || sha256Bytes(proof) !== result.proofSha256) {
    throw new PublicAnchorCommandError('invalid_anchor_proof', 'Empreinte de preuve OpenTimestamps invalide.');
  }
  if (result.status === 'anchored' && (
    !Number.isInteger(result.blockHeight)
    || !/^\d{4}-\d{2}-\d{2}T/.test(result.confirmedAtIso || '')
  )) {
    throw new PublicAnchorCommandError('unproven_public_anchor', 'La confirmation Bitcoin n’est pas démontrée.');
  }
};

const updateIntegrityProjections = async ({ firestore, batchId, status, result }) => {
  const receipts = await firestore.collection(`integrityBatches/${batchId}/receipts`).get();
  await Promise.all(receipts.docs.map((receiptDocument) => {
    const receipt = receiptDocument.data();
    return firestore.doc(`integrityProjections/${receipt.cartularyId}`).set({
      cartularyId: receipt.cartularyId,
      sourceRevision: receipt.sourceRevision,
      integrityHead: receipt.integrityHead,
      batchId,
      publicAnchoringStatus: status,
      publicAnchorProvider: result.provider,
      publicAnchorNetwork: result.network,
      publicAnchorPayloadDigest: result.payloadDigest,
      publicAnchorBlockHeight: result.blockHeight ?? null,
      publicAnchorConfirmedAtIso: result.confirmedAtIso ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }));
};

export const processIntegrityBatchPublicAnchor = async ({
  firestore,
  batchId,
  adapter = new OpenTimestampsPublicAnchorAdapter(),
  now = new Date(),
}) => {
  const batchRef = firestore.doc(`integrityBatches/${batchId}`);
  const anchorRef = batchRef.collection('publicAnchors').doc(PROVIDER_DOCUMENT_ID);
  const lockToken = randomUUID();
  const claimed = await firestore.runTransaction(async (transaction) => {
    const [batch, currentAnchor] = await Promise.all([
      transaction.get(batchRef),
      transaction.get(anchorRef),
    ]);
    if (!batch.exists) throw new PublicAnchorCommandError('batch_not_found', 'Lot Merkle introuvable.');
    const batchData = batch.data();
    if (batchData.status !== 'timestamped') {
      throw new PublicAnchorCommandError('batch_not_timestamped', 'Le lot doit être horodaté avant ancrage public.');
    }
    const current = currentAnchor.exists ? currentAnchor.data() : null;
    if (current?.status === 'anchored') {
      return { replayed: true, result: current };
    }
    if (
      current?.status === 'processing'
      && typeof current.lockExpiresAt?.toMillis === 'function'
      && current.lockExpiresAt.toMillis() > now.getTime()
    ) {
      return { replayed: true, inProgress: true, result: current };
    }
    const payload = toPublicAnchorPayload(batchData);
    const payloadDigest = publicAnchorPayloadDigest(payload);
    const proofBase64 = current?.proofBase64 || null;
    transaction.set(anchorRef, {
      provider: 'opentimestamps',
      network: 'bitcoin-mainnet',
      protocol: 'opentimestamps-v1',
      status: 'processing',
      payload,
      canonicalPayload: canonicalize(payload),
      payloadDigest,
      proofBase64,
      proofSha256: current?.proofSha256 || null,
      lockToken,
      lockExpiresAt: Timestamp.fromMillis(now.getTime() + LOCK_DURATION_MS),
      createdAt: current?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.update(batchRef, {
      publicAnchoringStatus: current?.status === 'pending_confirmation' ? 'pending_confirmation' : 'processing',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { payload, payloadDigest, proofBase64, replayed: false };
  });

  if (claimed.replayed) {
    return {
      batchId,
      status: claimed.result.status,
      inProgress: claimed.inProgress === true,
      replayed: true,
      blockHeight: claimed.result.blockHeight ?? null,
    };
  }

  let result;
  try {
    result = await adapter.anchor({
      payload: claimed.payload,
      payloadDigest: claimed.payloadDigest,
      proofBase64: claimed.proofBase64,
    });
    validateAnchorResult({ result, payloadDigest: claimed.payloadDigest });
  } catch (error) {
    await firestore.runTransaction(async (transaction) => {
      const anchor = await transaction.get(anchorRef);
      if (anchor.data()?.lockToken !== lockToken) return;
      transaction.update(anchorRef, {
        status: 'failed',
        errorCode: error?.code || 'public_anchor_failed',
        lockToken: FieldValue.delete(),
        lockExpiresAt: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(batchRef, {
        publicAnchoringStatus: 'failed',
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    throw error;
  }

  await firestore.runTransaction(async (transaction) => {
    const anchor = await transaction.get(anchorRef);
    if (anchor.data()?.lockToken !== lockToken) {
      throw new PublicAnchorCommandError('anchor_lock_lost', 'Le verrou d’ancrage a expiré.');
    }
    transaction.update(anchorRef, {
      ...result,
      status: result.status,
      lockToken: FieldValue.delete(),
      lockExpiresAt: FieldValue.delete(),
      errorCode: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      ...(result.status === 'anchored' ? { anchoredAt: FieldValue.serverTimestamp() } : {}),
    });
    transaction.update(batchRef, {
      publicAnchoringStatus: result.status,
      publicAnchorProvider: result.provider,
      publicAnchorNetwork: result.network,
      publicAnchorPayloadDigest: result.payloadDigest,
      publicAnchorBlockHeight: result.blockHeight ?? null,
      publicAnchorConfirmedAtIso: result.confirmedAtIso ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await updateIntegrityProjections({ firestore, batchId, status: result.status, result });
  return {
    batchId,
    status: result.status,
    blockHeight: result.blockHeight ?? null,
    replayed: false,
  };
};

export const runScheduledPublicAnchoring = async ({
  firestore,
  adapter = new OpenTimestampsPublicAnchorAdapter(),
  now = new Date(),
  limit = 100,
}) => {
  const batches = await firestore.collection('integrityBatches').where('status', '==', 'timestamped').limit(limit).get();
  const eligible = batches.docs.filter((document) => (
    ['deferred', 'not_requested', 'processing', 'pending_confirmation', 'failed'].includes(document.data().publicAnchoringStatus)
  ));
  const results = [];
  for (const batch of eligible) {
    try {
      results.push(await processIntegrityBatchPublicAnchor({ firestore, batchId: batch.id, adapter, now }));
    } catch (error) {
      results.push({ batchId: batch.id, status: 'failed', code: error?.code || 'public_anchor_failed' });
    }
  }
  return {
    inspected: batches.size,
    eligible: eligible.length,
    anchored: results.filter((result) => result.status === 'anchored').length,
    pending: results.filter((result) => result.status === 'pending_confirmation').length,
    failed: results.filter((result) => result.status === 'failed').length,
    results,
  };
};
