import { randomUUID } from 'node:crypto';
import { createRecoveryProofCommands, RecoveryCommandError, validateRecoveryInput, validateRecoverySigningKey } from './personal-recovery-command.mjs';

export const createRegistryRecoveryCommands = ({ db, auth, projectId = db.projectId, now = () => Date.now() }) => {
  const assertEnabled = async (uid) => {
    const [user, profile] = await Promise.all([auth.getUser(uid), db.doc(`users/${uid}`).get()]);
    if (user.disabled || !profile.exists || profile.data().status !== 'active' || profile.data().accountPurpose === 'public_read_only_demo') throw new RecoveryCommandError('permission-denied');
    return user;
  };
  const requireSession = async (requestAuth, recent = true) => {
    if (!requestAuth?.uid) throw new RecoveryCommandError('unauthenticated');
    const authenticatedAt = Number(requestAuth.token?.auth_time);
    if (!Number.isFinite(authenticatedAt) || authenticatedAt <= 0) throw new RecoveryCommandError('unauthenticated');
    const age = now() / 1000 - authenticatedAt;
    if (recent && (age < -60 || age > 900)) throw new RecoveryCommandError('unauthenticated', 'Reconnectez-vous avant de modifier le kit de secours.');
    const user = await assertEnabled(requestAuth.uid);
    // Callable authentication verifies the signature, not refresh-token
    // revocation. A recently stolen/revoked session must not install a new kit.
    if (user.tokensValidAfterTime) {
      const validAfter = Date.parse(user.tokensValidAfterTime) / 1000;
      if (!Number.isFinite(validAfter) || authenticatedAt < validAfter) throw new RecoveryCommandError('unauthenticated', 'Cette session a été révoquée. Reconnectez-vous.');
    }
    return requestAuth.uid;
  };
  const proof = createRecoveryProofCommands({
    db, recordCollection: 'registryRecovery', namespace: 'registry', now, assertEnabled,
    issueSession: async (uid) => ({ registryToken: await auth.createCustomToken(uid) }),
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
      await db.doc(`registryRecovery/${uid}`).set({
        schemaVersion: 'registry-recovery@1.0.0', credentialId: input.credentialId,
        signingPublicKeyJwk, createdAt, revokedAt: null, challengeCount: 0, challengeWindowEndsAt: 0,
      });
      return { credentialId: input.credentialId, createdAt };
    },
    status: async (requestAuth) => {
      const uid = await requireSession(requestAuth, false);
      const snapshot = await db.doc(`registryRecovery/${uid}`).get();
      if (!snapshot.exists || snapshot.data().revokedAt) return { active: false };
      const { credentialId, createdAt } = snapshot.data();
      return { active: true, credentialId, createdAt };
    },
    revoke: async (requestAuth) => {
      const uid = await requireSession(requestAuth);
      await db.doc(`registryRecovery/${uid}`).set({ revokedAt: new Date(now()).toISOString(), revocationId: randomUUID() }, { merge: true });
      return { revoked: true };
    },
  };
};
