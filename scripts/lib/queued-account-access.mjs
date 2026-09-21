import { assertActiveAccount } from './account-access-command.mjs';

/** Recheck the requester before a delayed client command reaches Admin SDK writes. */
export async function assertActiveQueuedAccount({ auth, firestore, requestDocument }) {
  const account = await assertActiveAccount({ auth, firestore, uid: requestDocument?.ownerUid });
  const cutoff = account.accountAccess?.validAfter;
  if (cutoff !== undefined) {
    // Rules bind requestedAt to request.time. A request preceding suspension
    // must not become executable again merely because the account was reopened.
    const requestedAt = requestDocument.requestedAt;
    const milliseconds = typeof requestedAt?.toMillis === 'function'
      ? requestedAt.toMillis() : requestedAt instanceof Date ? requestedAt.getTime() : NaN;
    if (!Number.isFinite(milliseconds) || Math.floor(milliseconds / 1000) <= cutoff) {
      throw Object.assign(new Error('La demande précède la révocation de la session. Soumettez une nouvelle demande.'), { code: 'permission_denied' });
    }
  }
  return account;
}
