import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db, functions } from '../firebase.ts';
import type { RegistryValuationSnapshot } from '../domain/projections.ts';

export const observeRegistryValuationSnapshots = (
  registryId: string,
  onSnapshots: (snapshots: RegistryValuationSnapshot[]) => void,
  onError: (error: Error) => void,
) => onSnapshot(
  query(collection(db, 'registries', registryId, 'valuationSnapshots'), orderBy('asOfDate', 'desc')),
  (snapshot) => onSnapshots(snapshot.docs.map((document) => document.data() as RegistryValuationSnapshot)),
  (error) => onError(error),
);

export const requestRegistryValuationSnapshot = async (registryId: string, asOfDate: string) => {
  const requestId = `statement_${asOfDate.replaceAll('-', '_')}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const createSnapshot = httpsCallable<
    { registryId: string; snapshotId: string; asOfDate: string },
    RegistryValuationSnapshot & { replayed: boolean }
  >(functions, 'createRegistryValuationStatement');
  const result = await createSnapshot({ registryId, snapshotId: requestId, asOfDate });
  return result.data;
};
