import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { sha256Hex } from './crypto';
import { codeBridgeAuth, codeBridgeDb, codeBridgeIsConfigured } from './codeBridgeFirebase';
import type { PersonalVaultPayload } from './types';

const configuredBridge = () => {
  if (!codeBridgeAuth || !codeBridgeDb) throw new Error('Configuration de la base de correspondance manquante.');
  return { auth: codeBridgeAuth, db: codeBridgeDb };
};

const bridgeEmail = async (userName: string) => (
  `${await sha256Hex(`bridge\u0000${userName.trim().toLocaleLowerCase('fr')}`)}@codes.cartularia.invalid`
);

export const authenticateCodeBridge = async ({ userName, password, createAccount }: {
  userName: string;
  password: string;
  createAccount: boolean;
}): Promise<User | null> => {
  if (!codeBridgeIsConfigured) return null;
  const { auth } = configuredBridge();
  const email = await bridgeEmail(userName);
  if (createAccount) return (await createUserWithEmailAndPassword(auth, email, password)).user;
  try {
    return (await signInWithEmailAndPassword(auth, email, password)).user;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== 'auth/user-not-found' && code !== 'auth/invalid-credential') throw error;
    return (await createUserWithEmailAndPassword(auth, email, password)).user;
  }
};

export const lockCodeBridge = () => codeBridgeAuth ? signOut(codeBridgeAuth) : Promise.resolve();

type BridgeSubcollection = 'clients' | 'transmissions' | 'locations' | 'managers' | 'people';

export interface CodeBridgeSelectorOption {
  code: string;
  genericLabel: string;
}

const subcollection = (uid: string, name: BridgeSubcollection) => {
  const { db } = configuredBridge();
  return collection(db, 'codeAccounts', uid, name);
};

const synchronizeCollection = async ({
  user,
  name,
  records,
}: {
  user: User;
  name: BridgeSubcollection;
  records: Array<{ code: string; data: Record<string, unknown> }>;
}) => {
  const reference = subcollection(user.uid, name);
  const expected = new Set(records.map(({ code }) => code));
  const existing = await getDocs(reference);
  const existingData = new Map(existing.docs.map((snapshot) => [snapshot.id, snapshot.data()]));
  await Promise.all([
    ...existing.docs.filter((snapshot) => !expected.has(snapshot.id)).map((snapshot) => deleteDoc(snapshot.ref)),
    ...records.map(({ code, data }) => setDoc(doc(reference, code), {
      schemaVersion: 'code-correspondence@1.0.0',
      ownerUid: user.uid,
      code,
      ...data,
      ...(typeof existingData.get(code)?.genericLabel === 'string'
        ? { genericLabel: existingData.get(code)?.genericLabel }
        : {}),
      updatedAt: serverTimestamp(),
    })),
  ]);
};

const synchronizeClients = async (user: User, payload: PersonalVaultPayload) => {
  const reference = subcollection(user.uid, 'clients');
  const existing = await getDocs(reference);
  const existingObjectCodes = new Map(existing.docs.map((snapshot) => [
    snapshot.id,
    Array.isArray(snapshot.data().objectCodes) ? snapshot.data().objectCodes : [],
  ]));
  await Promise.all(payload.owners.map((owner) => setDoc(doc(reference, owner.clientNumber), {
    schemaVersion: 'code-correspondence@1.0.0',
    ownerUid: user.uid,
    code: owner.clientNumber,
    objectCodes: existingObjectCodes.get(owner.clientNumber) ?? [],
    updatedAt: serverTimestamp(),
  })));
};

export const loadOwnerObjectCodes = async (user: User | null) => {
  if (!user || !codeBridgeIsConfigured) return new Map<string, string[]>();
  const snapshots = await getDocs(subcollection(user.uid, 'clients'));
  return new Map(snapshots.docs.map((snapshot) => {
    const data = snapshot.data();
    return [snapshot.id, Array.isArray(data.objectCodes) ? data.objectCodes.filter((code): code is string => typeof code === 'string') : []];
  }));
};

export const saveCodeCorrespondences = async (user: User | null, payload: PersonalVaultPayload) => {
  if (!user || !codeBridgeIsConfigured) return;
  const { db } = configuredBridge();
  const primaryClientNumber = payload.owners.find((owner) => owner.linkedToUserName)?.clientNumber;
  if (!primaryClientNumber) throw new Error('Un numéro client principal est requis.');
  const people = [
    ...payload.owners.map((owner) => owner.clientNumber),
    ...payload.transmissionPlans.flatMap((plan) => plan.recipients.map((recipient) => recipient.recipientCode)),
    ...payload.managers.map((manager) => manager.managerCode),
  ].filter((code, index, values) => values.indexOf(code) === index);
  await Promise.all([
    setDoc(doc(db, 'codeAccounts', user.uid, 'account', 'profile'), {
      schemaVersion: 'code-account-link@1.0.0',
      ownerUid: user.uid,
      primaryClientNumber,
      updatedAt: serverTimestamp(),
    }),
    synchronizeClients(user, payload),
    synchronizeCollection({ user, name: 'transmissions', records: payload.transmissionPlans.map((plan) => ({ code: plan.transmissionCode, data: {} })) }),
    synchronizeCollection({ user, name: 'locations', records: payload.storage.map((location, index) => ({ code: location.locationCode, data: { genericLabel: `Lieu ${index + 1}` } })) }),
    synchronizeCollection({ user, name: 'managers', records: payload.managers.map((manager) => ({ code: manager.managerCode, data: {} })) }),
    synchronizeCollection({ user, name: 'people', records: people.map((code, index) => ({ code, data: { genericLabel: `Personne ${index + 1}` } })) }),
  ]);
};

export const observeCodeBridgeOptions = (
  name: 'locations' | 'people',
  onOptions: (options: CodeBridgeSelectorOption[]) => void,
  onError: (error: Error) => void,
) => {
  if (!codeBridgeAuth || !codeBridgeDb || !codeBridgeIsConfigured) {
    onOptions([]);
    return () => undefined;
  }
  let unsubscribeSnapshot: () => void = () => undefined;
  const unsubscribeAuth = onAuthStateChanged(codeBridgeAuth, (user) => {
    unsubscribeSnapshot();
    unsubscribeSnapshot = () => undefined;
    if (!user) {
      onOptions([]);
      return;
    }
    unsubscribeSnapshot = onSnapshot(subcollection(user.uid, name), (snapshot) => {
      const prefix = name === 'locations' ? 'Lieu' : 'Personne';
      onOptions(snapshot.docs
        .map((entry, index) => ({
          code: entry.id,
          genericLabel: typeof entry.data().genericLabel === 'string' ? entry.data().genericLabel : `${prefix} ${index + 1}`,
        }))
        .sort((left, right) => left.genericLabel.localeCompare(right.genericLabel, 'fr', { numeric: true })));
    }, onError);
  }, onError);
  return () => {
    unsubscribeSnapshot();
    unsubscribeAuth();
  };
};
