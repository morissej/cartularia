import { signInWithCustomToken, updatePassword, type User } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { callPersonalRecovery } from './recoveryTransport';
import { personalAuth, personalDb, personalPersistenceReady, personalVaultProjectId } from './firebase';
import { bridgePersistenceReady, codeBridgeAuth } from './codeBridgeFirebase';
import { decryptPersonalPayload, encryptPersonalPayload, sha256Hex, type EncryptedPersonalEnvelope } from './crypto';
import { getOpenedPersonalVaultCiphertext, loadPersonalVault, rememberPersonalVaultCiphertext } from './repository';
import {
  parsePersonalRecoveryKit, signRecoveryChallenge, unwrapRecoveryPassword, wrapRecoveryPassword,
  type PersonalRecoveryKit,
} from './recoveryCrypto';
import type { PersonalVaultPayload } from './types';

export interface RecoveryStatus { active: boolean; credentialId?: string; createdAt?: string }
const tokens = async (user: User, bridgeUser: User) => ({
  personalIdToken: await user.getIdToken(true), bridgeIdToken: await bridgeUser.getIdToken(true),
});
const call = callPersonalRecovery;

export const getPersonalRecoveryStatus = async (user: User, bridgeUser: User) => call<RecoveryStatus>('getPersonalVaultRecoveryStatus', await tokens(user, bridgeUser));

export const enrollPersonalRecovery = async (user: User, bridgeUser: User, kit: PersonalRecoveryKit, password: string) => {
  if (!personalDb || kit.personalUid !== user.uid || kit.personalProjectId !== personalVaultProjectId) throw new Error('Kit destiné à un autre Coffre.');
  const profile = await getDocFromServer(doc(personalDb, 'vaultUsers', user.uid, 'vault', 'profile'));
  if (!profile.exists()) throw new Error('Enregistrez votre Coffre avant d’activer le kit.');
  // Prove locally that the wrapped secret opens the current envelope, then pin
  // that envelope in the server transaction to reject a concurrent rotation.
  await decryptPersonalPayload({ envelope: profile.data() as EncryptedPersonalEnvelope, password, userAlias: kit.userAlias });
  return call<{ credentialId: string; createdAt: string }>('enrollPersonalVaultRecovery', {
    ...await tokens(user, bridgeUser), credentialId: kit.credentialId, userAlias: kit.userAlias, accountId: kit.accountId,
    signingPublicKeyJwk: kit.signingPublicKeyJwk, wrappingPublicKeyJwk: kit.wrappingPublicKeyJwk,
    wrappedPassword: await wrapRecoveryPassword(password, kit.wrappingPublicKeyJwk, kit.credentialId),
    expectedCiphertextHash: await sha256Hex(String(profile.data().ciphertext)),
  });
};

export const revokePersonalRecovery = async (user: User, bridgeUser: User) => call<{ revoked: true }>('revokePersonalVaultRecovery', await tokens(user, bridgeUser));

export const recoverPersonalVault = async (serializedKit: string) => {
  if (!personalAuth || !codeBridgeAuth || !personalVaultProjectId) throw new Error('Le Coffre est temporairement indisponible.');
  const kit = await parsePersonalRecoveryKit(serializedKit, personalVaultProjectId);
  const challenge = await call<{ challengeId: string; message: string; expiresAt: string }>('beginPersonalVaultRecovery', {
    personalUid: kit.personalUid, credentialId: kit.credentialId,
  });
  const [version, namespace, uid, credentialId, challengeId, expiresAt] = challenge.message.split('\n');
  if (version !== 'cartularia-recovery-v1' || namespace !== 'personal-vault' || uid !== kit.personalUid
    || credentialId !== kit.credentialId || challengeId !== challenge.challengeId
    || Number(expiresAt) <= Date.now() || Number(expiresAt) > Date.now() + 10 * 60_000) throw new Error('Demande de secours invalide ou expirée.');
  const session = await call<{ personalToken: string; bridgeToken: string; wrappedPassword: string; credentialId: string }>('completePersonalVaultRecovery', {
    personalUid: kit.personalUid, credentialId: kit.credentialId, challengeId: challenge.challengeId,
    signature: await signRecoveryChallenge(kit, challenge.message),
  });
  if (session.credentialId !== kit.credentialId) throw new Error('Le kit a été remplacé. Utilisez le plus récent.');
  const password = await unwrapRecoveryPassword(session.wrappedPassword, kit);
  await Promise.all([personalPersistenceReady, bridgePersistenceReady]);
  const personal = await signInWithCustomToken(personalAuth, session.personalToken);
  if (personal.user.uid !== kit.personalUid) throw new Error('Compte de secours incohérent.');
  const bridge = await signInWithCustomToken(codeBridgeAuth, session.bridgeToken);
  const payload = await loadPersonalVault({ user: personal.user, userAlias: kit.userAlias, password });
  if (!payload) throw new Error('Aucun Coffre enregistré n’a été retrouvé.');
  return { personalUser: personal.user, bridgeUser: bridge.user, payload, password, kit };
};

/**
 * Firebase receives the new password directly. Cartularia receives only ciphertext.
 * Until the atomic commit, an unchanged active kit opens the previous envelope.
 * Auth and Firestore are not one transaction: a concurrent revocation can still
 * invalidate that fallback, so an interrupted update must not promise recovery.
 */
export const rotatePersonalPasswordWithKit = async ({ user, bridgeUser, kit, password, payload, operationId }: {
  user: User; bridgeUser: User; kit: PersonalRecoveryKit; password: string; payload: PersonalVaultPayload; operationId: string;
}) => {
  if (!personalDb || password.length < 12) throw new Error('Utilisez au moins 12 caractères.');
  if (kit.personalUid !== user.uid || kit.personalProjectId !== personalVaultProjectId) throw new Error('Kit destiné à un autre Coffre.');
  const reference = doc(personalDb, 'vaultUsers', user.uid, 'vault', 'profile');
  // Pin the version actually opened by this session, never a newer ciphertext
  // fetched just before encrypting an older displayed payload.
  const openedCiphertext = getOpenedPersonalVaultCiphertext(user.uid);
  const assertOpenedVersion = async () => {
    const current = await getDocFromServer(reference);
    if (!openedCiphertext || !current.exists() || current.data().ciphertext !== openedCiphertext
      || getOpenedPersonalVaultCiphertext(user.uid) !== openedCiphertext) {
      throw Object.assign(new Error('Le Coffre a changé dans une autre session. Conservez vos saisies puis rouvrez-le avant de changer le mot de passe.'), { code: 'vault-conflict' });
    }
    if (personalAuth?.currentUser?.uid !== user.uid || codeBridgeAuth?.currentUser?.uid !== bridgeUser.uid) {
      throw Object.assign(new Error('La session du Coffre a changé. Rouvrez-le avant de continuer.'), { code: 'vault-session-changed' });
    }
  };
  await assertOpenedVersion();
  const envelope = await encryptPersonalPayload({ payload, password, userAlias: kit.userAlias });
  const wrappedPassword = await wrapRecoveryPassword(password, kit.wrappingPublicKeyJwk, kit.credentialId);
  const expectedCiphertextHash = await sha256Hex(openedCiphertext!);
  const recovery = await getPersonalRecoveryStatus(user, bridgeUser);
  if (!recovery.active || recovery.credentialId !== kit.credentialId) {
    throw Object.assign(new Error('Ce kit a été remplacé ou révoqué. Aucun mot de passe n’a été modifié ; vérifiez le kit actuellement actif avant de recommencer.'), { code: 'vault-kit-stale' });
  }
  // Crypto can be slow: recheck before either irreversible Auth mutation.
  await assertOpenedVersion();
  try {
    await updatePassword(user, password);
    await updatePassword(bridgeUser, password);
    await call<{ committed: true }>('commitPersonalVaultPasswordRotation', {
      ...await tokens(user, bridgeUser), credentialId: kit.credentialId, operationId, envelope, wrappedPassword,
      expectedCiphertextHash,
    });
  } catch (cause) {
    throw Object.assign(new Error('Une partie du changement d’accès peut avoir abouti. Conservez l’ancien et le nouveau mot de passe et vos saisies. Utilisez uniquement le kit actuellement actif : un kit remplacé ou révoqué ne permet plus de reprendre. Ne poursuivez pas les modifications tant que l’accès et le déchiffrement ne sont pas confirmés.', { cause }), { code: 'vault-rotation-uncertain' });
  }
  rememberPersonalVaultCiphertext(user.uid, envelope.ciphertext);
};
