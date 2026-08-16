import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import type { RegistryAccessProjection } from '../domain/access.ts';
import { db } from '../firebase.ts';

export const loadRegistryAccesses = async (registryId: string): Promise<RegistryAccessProjection[]> => {
  const snapshot = await getDocs(query(
    collection(db, 'registries', registryId, 'accesses'),
    orderBy('updatedAt', 'desc'),
  ));
  return snapshot.docs.flatMap((accessSnapshot) => {
    const access = accessSnapshot.data() as RegistryAccessProjection;
    if (access.registryId !== registryId || access.projectionStatus !== 'active') return [];
    return [{ ...access, id: access.id || accessSnapshot.id }];
  });
};
