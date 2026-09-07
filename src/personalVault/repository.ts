import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import { personalAuth, personalDb, personalPersistenceReady } from './firebase';
import {
  decryptPersonalPayload,
  encryptPersonalPayload,
  vaultAccountDocumentId,
  vaultAuthenticationEmail,
  type EncryptedPersonalEnvelope,
} from './crypto';
import type { PersonalVaultPayload } from './types';
import { migratePersonalVaultPayload } from './types';
import { authenticateCodeBridge, lockCodeBridge } from './codeBridgeRepository';
import { validCodeSyncRevision, type PersonalVaultSaveReceipt } from './codeSyncRevision';

interface EncryptedPersonalAccount extends EncryptedPersonalEnvelope {
  ownerUid: string;
  accountId: string;
  schemaVersion: 'encrypted-personal-account@2.0.0';
}

const configuredServices = () => {
  if (!personalAuth || !personalDb) throw new Error('Configuration Firebase du Coffre personnel manquante.');
  return { auth: personalAuth, db: personalDb };
};

const accountReference = (db: NonNullable<typeof personalDb>, uid: string) => doc(db, 'vaultUsers', uid, 'vault', 'profile');
const lastLoadedCiphertexts = new Map<string, string | null>();
export const rememberPersonalVaultCiphertext = (uid: string, ciphertext: string | null) => { lastLoadedCiphertexts.set(uid, ciphertext); };
export const getOpenedPersonalVaultCiphertext = (uid: string) => lastLoadedCiphertexts.get(uid);

export const authenticatePersonalVault = async ({
  userAlias,
  password,
  createAccount,
}: {
  userAlias: string;
  password: string;
  createAccount: boolean;
}) => {
  const { auth } = configuredServices();
  await personalPersistenceReady;
  const email = await vaultAuthenticationEmail(userAlias);
  let credential;
  if (createAccount) {
    try { credential = await createUserWithEmailAndPassword(auth, email, password); }
    catch (error) {
      // Resume an interrupted creation only after proving the same password.
      if ((error as { code?: string }).code !== 'auth/email-already-in-use') throw error;
      credential = await signInWithEmailAndPassword(auth, email, password);
    }
  } else credential = await signInWithEmailAndPassword(auth, email, password);
  const bridgeUser = await authenticateCodeBridge({ userName: userAlias, password, createAccount });
  return { personalUser: credential.user, bridgeUser };
};

export const loadPersonalVault = async ({
  user,
  userAlias,
  password,
}: {
  user: User;
  userAlias: string;
  password: string;
}) => {
  const { db } = configuredServices();
  const accountId = await vaultAccountDocumentId(userAlias);
  const snapshot = await getDocFromServer(accountReference(db, user.uid));
  if (!snapshot.exists()) { rememberPersonalVaultCiphertext(user.uid, null); return null; }
  const document = snapshot.data() as EncryptedPersonalAccount;
  if (document.ownerUid !== user.uid || document.accountId !== accountId) throw new Error('Référence de coffre incohérente.');
  const decrypted = await decryptPersonalPayload<PersonalVaultPayload>({ envelope: document, password, userAlias });
  rememberPersonalVaultCiphertext(user.uid, document.ciphertext);
  return migratePersonalVaultPayload(decrypted, userAlias);
};

export const savePersonalVault = async ({
  user,
  payload,
  password,
}: {
  user: User;
  payload: PersonalVaultPayload;
  password: string;
}): Promise<PersonalVaultSaveReceipt> => {
  const { db } = configuredServices();
  const accountId = await vaultAccountDocumentId(payload.userName);
  const expectedCiphertext = lastLoadedCiphertexts.get(user.uid);
  const envelope = await encryptPersonalPayload({ payload, password, userAlias: payload.userName });
  await runTransaction(db, async (transaction) => {
    const reference = accountReference(db, user.uid);
    const snapshot = await transaction.get(reference);
    const remoteCiphertext = snapshot.exists() ? snapshot.data().ciphertext : null;
    if (expectedCiphertext === undefined || remoteCiphertext !== expectedCiphertext) {
      throw Object.assign(new Error('Le Coffre a changé dans une autre session. Vos saisies restent affichées.'), { code: 'vault-conflict' });
    }
    transaction.set(reference, {
      schemaVersion: 'encrypted-personal-account@2.0.0',
      ownerUid: user.uid,
      accountId,
      ...envelope,
      updatedAt: serverTimestamp(),
    });
  });
  rememberPersonalVaultCiphertext(user.uid, envelope.ciphertext);
  // serverTimestamp is resolved only after the commit. Never publish codes
  // using a client clock or the timestamp of another session's later write.
  const confirmed = await getDocFromServer(accountReference(db, user.uid));
  if (!confirmed.exists() || confirmed.data().ciphertext !== envelope.ciphertext) {
    throw Object.assign(new Error('Le Coffre a changé avant confirmation de la sauvegarde.'), { code: 'vault-conflict' });
  }
  const revision = confirmed.data().updatedAt;
  if (!validCodeSyncRevision(revision)) throw new Error('La version de sauvegarde n’a pas été confirmée. Réessayez.');
  return { codeRevision: { seconds: revision.seconds, nanoseconds: revision.nanoseconds } };
};

export const lockPersonalVault = () => {
  const { auth } = configuredServices();
  return Promise.all([signOut(auth), lockCodeBridge()]).then(() => { lastLoadedCiphertexts.clear(); });
};
