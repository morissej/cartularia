import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { collection, doc, getDocFromServer, getDocs, getDocsFromServer, onSnapshot, runTransaction, serverTimestamp, Timestamp } from 'firebase/firestore';
import { sha256Hex } from './crypto';
import { bridgePersistenceReady, codeBridgeAuth, codeBridgeDb, codeBridgeIsConfigured } from './codeBridgeFirebase';
import type { PersonalVaultPayload } from './types';
import { assertNewCodeSyncRevision, compareCodeSyncRevision, validCodeSyncRevision, type PersonalVaultSaveReceipt } from './codeSyncRevision';
import { allocateGenericCodeLabels } from './codeLabels';

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
  await bridgePersistenceReady;
  const email = await bridgeEmail(userName);
  if (createAccount) {
    try { return (await createUserWithEmailAndPassword(auth, email, password)).user; }
    catch (error) {
      if ((error as { code?: string }).code !== 'auth/email-already-in-use') throw error;
      return (await signInWithEmailAndPassword(auth, email, password)).user;
    }
  }
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

export const loadOwnerObjectCodes = async (user: User | null) => {
  if (!user || !codeBridgeIsConfigured) return new Map<string, string[]>();
  const snapshots = await getDocs(subcollection(user.uid, 'clients'));
  return new Map(snapshots.docs.map((snapshot) => {
    const data = snapshot.data();
    return [snapshot.id, Array.isArray(data.objectCodes) ? data.objectCodes.filter((code): code is string => typeof code === 'string') : []];
  }));
};

export const saveCodeCorrespondences = async (user: User | null, payload: PersonalVaultPayload, receipt: PersonalVaultSaveReceipt) => {
  if (!user || !codeBridgeIsConfigured) throw new Error('Session de correspondance absente.');
  const { db } = configuredBridge();
  if (!validCodeSyncRevision(receipt?.codeRevision)) throw new Error('Enregistrez le Coffre avant de synchroniser ses codes.');
  const revision = new Timestamp(receipt.codeRevision.seconds, receipt.codeRevision.nanoseconds);
  const primaryClientNumber = payload.owners.find((owner) => owner.linkedToUserName)?.clientNumber;
  if (!primaryClientNumber) throw new Error('Un numéro client principal est requis.');
  const people = [
    ...payload.owners.map((owner) => owner.clientNumber),
    ...payload.transmissionPlans.flatMap((plan) => plan.recipients.map((recipient) => recipient.recipientCode)),
    ...payload.managers.map((manager) => manager.managerCode),
  ].filter((code, index, values) => values.indexOf(code) === index);
  const account = doc(db, 'codeAccounts', user.uid, 'account', 'profile');
  const initial = await getDocFromServer(account);
  const initialRevision = initial.data()?.codeRevision;
  assertNewCodeSyncRevision(revision, initialRevision);
  const records: Array<{ name: Exclude<BridgeSubcollection, 'clients'>; values: Array<{ code: string; genericLabel?: string }> }> = [
    { name: 'transmissions', values: payload.transmissionPlans.map((plan) => ({ code: plan.transmissionCode })) },
    { name: 'locations', values: payload.storage.map((location, index) => ({ code: location.locationCode, genericLabel: `Lieu ${index + 1}` })) },
    { name: 'managers', values: payload.managers.map((manager) => ({ code: manager.managerCode })) },
    { name: 'people', values: people.map((code, index) => ({ code, genericLabel: `Personne ${index + 1}` })) },
  ];
  const snapshots = await Promise.all(records.map(({ name }) => getDocsFromServer(subcollection(user.uid, name))));
  const writes = records.map((record, index) => {
    const wanted = new Set(record.values.map(({ code }) => code));
    const existing = new Map(snapshots[index].docs.map((snapshot) => [snapshot.id, snapshot.data()]));
    const labels = record.name === 'locations' || record.name === 'people'
      ? allocateGenericCodeLabels(record.values.map(({ code }) => code), existing, record.name === 'locations' ? 'Lieu' : 'Personne')
      : new Map<string, string>();
    return { ...record, labels, removed: snapshots[index].docs.filter((snapshot) => !wanted.has(snapshot.id)) };
  });
  // One atomic publication; never split a generation into partially visible chunks.
  const count = 1 + payload.owners.length + writes.reduce((sum, record) => sum + record.values.length + record.removed.length, 0);
  if (count > 450) throw Object.assign(new Error('Trop de codes pour une synchronisation atomique (450 opérations maximum). Le Coffre reste enregistré ; contactez le support avant d’ajouter d’autres codes.'), { code: 'code-sync-capacity' });
  await runTransaction(db, async (transaction) => {
    const current = await transaction.get(account);
    const currentRevision = current.data()?.codeRevision;
    assertNewCodeSyncRevision(revision, currentRevision);
    if (initial.exists() !== current.exists() || (initialRevision === undefined ? currentRevision !== undefined
      : !validCodeSyncRevision(currentRevision) || compareCodeSyncRevision(initialRevision, currentRevision) !== 0)) {
      throw Object.assign(new Error('Les codes ont changé pendant leur lecture. Réessayez depuis le Coffre à jour.'), { code: 'code-sync-conflict' });
    }
    // Read object bindings in the transaction; they are server-owned and must
    // neither be dropped nor replaced by a stale client snapshot.
    const clients = await Promise.all(payload.owners.map((owner) => transaction.get(doc(subcollection(user.uid, 'clients'), owner.clientNumber))));
    transaction.set(account, {
      schemaVersion: 'code-account-link@1.0.0',
      ownerUid: user.uid,
      primaryClientNumber,
      codeRevision: revision,
      updatedAt: serverTimestamp(),
    });
    const base = (code: string) => ({ schemaVersion: 'code-correspondence@1.0.0', ownerUid: user.uid, code, sourceRevision: revision, updatedAt: serverTimestamp() });
    payload.owners.forEach((owner, index) => transaction.set(clients[index].ref, { ...base(owner.clientNumber), objectCodes: clients[index].data()?.objectCodes ?? [] }));
    for (const record of writes) {
      record.removed.forEach((snapshot) => transaction.delete(snapshot.ref));
      record.values.forEach(({ code }) => transaction.set(doc(subcollection(user.uid, record.name), code), {
        ...base(code), ...(record.labels.has(code) ? { genericLabel: record.labels.get(code) } : {}),
      }));
    }
  });
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
