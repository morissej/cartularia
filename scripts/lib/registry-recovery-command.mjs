import { randomUUID } from 'node:crypto';
import { createRecoveryProofCommands, RecoveryCommandError, validateRecoveryInput, validateRecoverySigningKey, assertRecoveryChallengeCurrent } from './personal-recovery-command.mjs';
import { assertActiveAccount, assertActiveAccountSession } from './account-access-command.mjs';

export const createRegistryRecoveryCommands = ({ db, auth, projectId = db.projectId, now = () => Date.now() }) => {
  const assertEnabled = async (uid, _record, context = {}) => {
    const account = await assertActiveAccount({ auth, firestore: db, uid, transaction: context.transaction });
    if (account.profile?.accountPurpose === 'public_read_only_demo') throw new RecoveryCommandError('permission-denied');
    if (Object.hasOwn(context, 'issuedAt')) assertRecoveryChallengeCurrent(account, context.issuedAt);
    return account.user;
  };
  const requireSession = async (requestAuth, recent = true, transaction) => {
    const account = await assertActiveAccountSession({ auth, firestore: db, requestAuth, nowSeconds: now() / 1000, transaction });
    if (account.profile?.accountPurpose === 'public_read_only_demo') throw new RecoveryCommandError('permission-denied');
    const age = now() / 1000 - Number(requestAuth.token.auth_time);
    if (recent && age > 900) throw new RecoveryCommandError('unauthenticated', 'Reconnectez-vous avant de modifier le kit de secours.');
    return account.uid;
  };
  const proof = createRecoveryProofCommands({
    db, recordCollection: 'registryRecovery', namespace: 'registry', now, assertEnabled,
    issueSession: async (uid) => ({ registryToken: await auth.createCustomToken(uid, { cartulariaRecoveryIssuedAt: Math.floor(now() / 1000) }) }),
  });
  return {
    begin: proof.begin,
    complete: proof.complete,
    enroll: async (requestAuth, input) => {
      validateRecoveryInput(input);
      const uid = await requireSession(requestAuth);
      if (!projectId || input.ownerUid !== uid || input.projectId !== projectId) throw new RecoveryCommandError('permission-denied', 'Kit destiné à un autre compte ou projet.');
      if (typeof input?.credentialId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.credentialId)) throw new RecoveryCommandError('invalid-argument');
      const signingPublicKeyJwk = validateRecoverySigningKey(input.signingPublicKeyJwk);
      const createdAt = new Date(now()).toISOString();
      await db.runTransaction(async (transaction) => {
        await requireSession(requestAuth, true, transaction);
        transaction.set(db.doc(`registryRecovery/${uid}`), {
          schemaVersion: 'registry-recovery@1.0.0', credentialId: input.credentialId,
          signingPublicKeyJwk, createdAt, revokedAt: null, challengeCount: 0, challengeWindowEndsAt: 0,
        });
      });
      return { credentialId: input.credentialId, createdAt };
    },
    status: async (requestAuth) => {
      const uid = await requireSession(requestAuth, false);
      const snapshot = await db.runTransaction(async (transaction) => {
        await requireSession(requestAuth, false, transaction);
        return transaction.get(db.doc(`registryRecovery/${uid}`));
      });
      if (!snapshot.exists || snapshot.data().revokedAt) return { active: false };
      const { credentialId, createdAt } = snapshot.data();
      return { active: true, credentialId, createdAt };
    },
    revoke: async (requestAuth) => {
      const uid = await requireSession(requestAuth);
      await db.runTransaction(async (transaction) => {
        await requireSession(requestAuth, true, transaction);
        transaction.set(db.doc(`registryRecovery/${uid}`), { revokedAt: new Date(now()).toISOString(), revocationId: randomUUID() }, { merge: true });
      });
      return { revoked: true };
    },
  };
};
