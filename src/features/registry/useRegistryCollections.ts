import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RegistryCollectionDocument } from '../../domain/collections.ts';
import { observeRegistryCollections } from '../../services/collections.ts';
const EMPTY_COLLECTIONS: RegistryCollectionDocument[] = [];

/** Collection names remain authoritative even when a view only carries IDs. */
export function useRegistryCollections(registryId: string) {
  const [snapshot, setSnapshot] = useState<{ registryId: string; collections: RegistryCollectionDocument[]; state: 'loading' | 'ready' | 'error' }>({ registryId, collections: [], state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSnapshot((current) => ({ registryId, collections: current.registryId === registryId ? current.collections : [], state: 'loading' }));
    return observeRegistryCollections(registryId,
      (collections) => setSnapshot({ registryId, collections, state: 'ready' }),
      () => setSnapshot((current) => ({ registryId, collections: current.registryId === registryId ? current.collections : [], state: 'error' })),
    );
  }, [registryId, attempt]);
  const collections = snapshot.registryId === registryId ? snapshot.collections : EMPTY_COLLECTIONS;
  const state = snapshot.registryId === registryId ? snapshot.state : 'loading';
  const names = useMemo(() => new Map(collections.map((entry) => [entry.id, entry.name])), [collections]);
  const collectionName = useCallback((id: string) => names.get(id) || (state === 'loading' ? 'Collection en cours de chargement…' : 'Collection non renseignée'), [names, state]);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return { collections, state, collectionName, retry };
}
