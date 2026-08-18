import { useCallback } from 'react';
import type { OwnershipHistoryEntry } from '../../../domain/ownershipHistory';
import type {
  AssetKind,
  OwnerDocument,
  OwnerField,
  OwnerType,
  StorageLocation,
  TransmissionRecipient,
  WatchPatrimonialStatus,
} from './cartularyStateTypes';
import { usePersistentCartularyState } from './usePersistentCartularyState';

interface OwnerStateOptions {
  loadFields: () => OwnerField[];
  loadType: () => OwnerType;
  loadDocuments: () => OwnerDocument[];
  loadHistory: () => OwnershipHistoryEntry[];
  loadAssetKind: () => AssetKind;
  loadWatchStatus: () => WatchPatrimonialStatus;
  loadRecipients: () => TransmissionRecipient[];
  loadLocations: () => StorageLocation[];
}

export const useCartularyOwnerState = (options: OwnerStateOptions) => {
  const fields = usePersistentCartularyState({ key: 'cartularia-owner-fields', load: options.loadFields });
  const type = usePersistentCartularyState({ key: 'cartularia-owner-type', load: options.loadType });
  const documents = usePersistentCartularyState({
    key: 'cartularia-owner-documents',
    load: options.loadDocuments,
    serialize: (items: OwnerDocument[]) => items.map((document) => ({
      ...document,
      url: document.url?.startsWith('blob:') ? undefined : document.url,
    })),
  });
  const history = usePersistentCartularyState({ key: 'cartularia-ownership-history', load: options.loadHistory });
  const assetKind = usePersistentCartularyState({ key: 'cartularia-asset-kind', load: options.loadAssetKind });
  const watchStatus = usePersistentCartularyState({ key: 'cartularia-watch-status', load: options.loadWatchStatus });
  const recipients = usePersistentCartularyState({ key: 'cartularia-transmission-recipients', load: options.loadRecipients });
  const locations = usePersistentCartularyState({
    key: 'cartularia-storage-locations',
    reloadKeys: ['cartularia-storage-locations', 'cartularia-storage-description'],
    load: options.loadLocations,
  });
  const reloadFields = fields.reloadIfPresent;
  const reloadType = type.reloadIfPresent;
  const reloadDocuments = documents.reloadIfPresent;
  const reloadHistory = history.reloadIfPresent;
  const reloadAssetKind = assetKind.reloadIfPresent;
  const reloadWatchStatus = watchStatus.reloadIfPresent;
  const reloadRecipients = recipients.reloadIfPresent;
  const reloadLocations = locations.reloadIfPresent;
  const reloadOwnerState = useCallback((keys: ReadonlySet<string>) => [
    reloadFields(keys),
    reloadType(keys),
    reloadDocuments(keys),
    reloadHistory(keys),
    reloadAssetKind(keys),
    reloadWatchStatus(keys),
    reloadRecipients(keys),
    reloadLocations(keys),
  ].some(Boolean), [
    reloadFields,
    reloadType,
    reloadDocuments,
    reloadHistory,
    reloadAssetKind,
    reloadWatchStatus,
    reloadRecipients,
    reloadLocations,
  ]);

  return {
    ownerFields: fields.value,
    ownerType: type.value,
    ownerDocuments: documents.value,
    ownershipHistory: history.value,
    assetKind: assetKind.value,
    watchStatus: watchStatus.value,
    transmissionRecipients: recipients.value,
    storageLocations: locations.value,
    reloadOwnerState,
    commands: {
      replaceFields: fields.replace,
      setOwnerType: type.replace,
      replaceDocuments: documents.replace,
      replaceHistory: history.replace,
      setAssetKind: assetKind.replace,
      setWatchStatus: watchStatus.replace,
      replaceRecipients: recipients.replace,
      replaceLocations: locations.replace,
      updateField: (id: string, patch: Partial<OwnerField>) => fields.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateDocument: (id: string, patch: Partial<OwnerDocument>) => documents.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateHistory: (id: string, patch: Partial<OwnershipHistoryEntry>) => history.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateRecipient: (id: string, patch: Partial<TransmissionRecipient>) => recipients.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateLocation: (id: string, patch: Partial<StorageLocation>) => locations.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
    },
  };
};
