import { useCallback } from 'react';
import type { OwnershipHistoryEntry } from '../../../domain/ownershipHistory';
import type { AssetKind, WatchPatrimonialStatus } from './cartularyStateTypes';
import type { StorageCodeReference, TransmissionCodeReference } from '../../../domain/personalDataBoundary';
import { usePersistentCartularyState } from './usePersistentCartularyState';

interface OwnerStateOptions {
  loadHistory: () => OwnershipHistoryEntry[];
  loadAssetKind: () => AssetKind;
  loadWatchStatus: () => WatchPatrimonialStatus;
  loadCollectionId: () => string;
  loadUserAlias: () => string;
  loadObjectCode: () => string;
  loadStorageCodes: () => StorageCodeReference[];
  loadTransmissionCodes: () => TransmissionCodeReference[];
}

export const useCartularyOwnerState = (options: OwnerStateOptions) => {
  const history = usePersistentCartularyState({ key: 'cartularia-ownership-history', load: options.loadHistory });
  const assetKind = usePersistentCartularyState({ key: 'cartularia-asset-kind', load: options.loadAssetKind });
  const watchStatus = usePersistentCartularyState({ key: 'cartularia-watch-status', load: options.loadWatchStatus });
  const collectionId = usePersistentCartularyState({ key: 'cartularia-collection-id', load: options.loadCollectionId });
  const userAlias = usePersistentCartularyState({ key: 'cartularia-user-alias', load: options.loadUserAlias });
  const objectCode = usePersistentCartularyState({ key: 'cartularia-object-code', load: options.loadObjectCode });
  const storageCodes = usePersistentCartularyState({ key: 'cartularia-storage-code-names', load: options.loadStorageCodes });
  const transmissionCodes = usePersistentCartularyState({ key: 'cartularia-transmission-code-references', load: options.loadTransmissionCodes });
  const reloadOwnerState = useCallback((keys: ReadonlySet<string>) => [
    history.reloadIfPresent(keys),
    assetKind.reloadIfPresent(keys),
    watchStatus.reloadIfPresent(keys),
    collectionId.reloadIfPresent(keys),
    userAlias.reloadIfPresent(keys),
    objectCode.reloadIfPresent(keys),
    storageCodes.reloadIfPresent(keys),
    transmissionCodes.reloadIfPresent(keys),
  ].some(Boolean), [history, assetKind, watchStatus, collectionId, userAlias, objectCode, storageCodes, transmissionCodes]);

  return {
    ownershipHistory: history.value,
    assetKind: assetKind.value,
    watchStatus: watchStatus.value,
    collectionId: collectionId.value,
    userAlias: userAlias.value,
    objectCode: objectCode.value,
    storageCodes: storageCodes.value,
    transmissionCodes: transmissionCodes.value,
    reloadOwnerState,
    commands: {
      replaceHistory: history.replace,
      setAssetKind: assetKind.replace,
      setWatchStatus: watchStatus.replace,
      setCollectionId: collectionId.replace,
      setUserAlias: userAlias.replace,
      setObjectCode: objectCode.replace,
      replaceStorageCodes: storageCodes.replace,
      replaceTransmissionCodes: transmissionCodes.replace,
      updateHistory: (id: string, patch: Partial<OwnershipHistoryEntry>) => history.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateStorageCode: (id: string, patch: Partial<StorageCodeReference>) => storageCodes.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateTransmissionCode: (id: string, patch: Partial<TransmissionCodeReference>) => transmissionCodes.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
    },
  };
};
