import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { personalAuth, personalDb } from './firebase';
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
  const email = await vaultAuthenticationEmail(userAlias);
  const credential = createAccount
    ? await createUserWithEmailAndPassword(auth, email, password)
    : await signInWithEmailAndPassword(auth, email, password);
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
  const snapshot = await getDoc(accountReference(db, user.uid));
  if (!snapshot.exists()) return null;
  const document = snapshot.data() as EncryptedPersonalAccount;
  if (document.ownerUid !== user.uid || document.accountId !== accountId) throw new Error('Référence de coffre incohérente.');
  const decrypted = await decryptPersonalPayload<PersonalVaultPayload>({ envelope: document, password, userAlias });
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
}) => {
  const { db } = configuredServices();
  const accountId = await vaultAccountDocumentId(payload.userName);
  const envelope = await encryptPersonalPayload({ payload, password, userAlias: payload.userName });
  await setDoc(accountReference(db, user.uid), {
    schemaVersion: 'encrypted-personal-account@2.0.0',
    ownerUid: user.uid,
    accountId,
    ...envelope,
    updatedAt: serverTimestamp(),
  });
};

export const lockPersonalVault = () => {
  const { auth } = configuredServices();
  return Promise.all([signOut(auth), lockCodeBridge()]).then(() => undefined);
};
