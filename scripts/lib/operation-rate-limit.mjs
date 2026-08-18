import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export class OperationRateLimitError extends Error {
  constructor(operation, limit, windowMs) {
    super(`Quota ${operation} atteint (${limit} opérations sur ${Math.round(windowMs / 3_600_000)} h).`);
    this.name = 'OperationRateLimitError';
    this.code = 'rate_limited';
  }
}

const positiveInteger = (value, label) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} doit être un entier positif.`);
  return parsed;
};

const rateLimitDocumentRef = ({ firestore, operation, ownerUid, windowStart }) => {
  const accountKey = createHash('sha256').update(ownerUid).digest('hex').slice(0, 32);
  return firestore.doc(`operationRateLimits/${operation}_${accountKey}/windows/${windowStart}`);
};

export const claimQueuedOperation = async ({
  firestore,
  requestRef,
  requestId,
  ownerUid,
  operation,
  limit,
  windowMs,
  occurredAt = new Date().toISOString(),
}) => {
  const safeLimit = positiveInteger(limit, 'Le quota');
  const safeWindowMs = positiveInteger(windowMs, 'La fenêtre de quota');
  const occurredAtMs = Date.parse(occurredAt);
  if (!Number.isFinite(occurredAtMs)) throw new Error('La date du verrou opérationnel est invalide.');
  const windowStart = Math.floor(occurredAtMs / safeWindowMs) * safeWindowMs;
  const rateLimitRef = rateLimitDocumentRef({ firestore, operation, ownerUid, windowStart });

  return firestore.runTransaction(async (transaction) => {
    const [requestSnapshot, rateLimitSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(rateLimitRef),
    ]);
    if (!requestSnapshot.exists) return { claimed: false, reason: 'missing' };
    const request = requestSnapshot.data();
    if (request.requestId !== requestId) return { claimed: false, reason: 'superseded' };
    if (request.status === 'processing') return { claimed: false, reason: 'in_progress' };
    if (request.status !== 'pending') return { claimed: false, reason: 'not_pending' };

    const currentCount = Number(rateLimitSnapshot.data()?.count || 0);
    if (!Number.isInteger(currentCount) || currentCount < 0) {
      throw new Error('Le compteur de quota opérationnel est invalide.');
    }
    if (currentCount >= safeLimit) throw new OperationRateLimitError(operation, safeLimit, safeWindowMs);

    transaction.set(rateLimitRef, {
      ownerUid,
      operation,
      windowStart: Timestamp.fromMillis(windowStart),
      windowMs: safeWindowMs,
      count: currentCount + 1,
      limit: safeLimit,
      expiresAt: Timestamp.fromMillis(windowStart + (safeWindowMs * 2)),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(requestRef, {
      status: 'processing',
      processingStartedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true, count: currentCount + 1, limit: safeLimit };
  });
};
