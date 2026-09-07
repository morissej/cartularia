import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import {
  collectionLabelFromIdentifier,
  normalizeCollectionSlug,
  registryCollectionId,
  registryCollectionVersion,
  type CollectionWebsiteItemProjection,
  type CollectionWebsitePublication,
  type RegistryCollectionDocument,
  type RegistryCollectionInput,
} from '../domain/collections.ts';
import { registryItemCollectionIds } from '../domain/projections.ts';
import { db, functions } from '../firebase.ts';
import { httpsCallable } from 'firebase/functions';
import { loadRegistryItems } from './projections.ts';

export { normalizeCollectionSlug, registryCollectionId } from '../domain/collections.ts';

const SAFE_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;

const normalizeSnapshot = (registryId: string, id: string, data: Partial<RegistryCollectionDocument>) => ({
  ...data,
  id,
  registryId,
} as RegistryCollectionDocument);

export const loadRegistryCollections = async (registryId: string): Promise<RegistryCollectionDocument[]> => {
  const snapshot = await getDocs(collection(db, 'registries', registryId, 'collections'));
  return snapshot.docs
    .map((entry) => normalizeSnapshot(registryId, entry.id, entry.data()))
    .sort((left, right) => left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' }));
};

export const observeRegistryCollections = (
  registryId: string,
  onCollections: (collections: RegistryCollectionDocument[]) => void,
  onError: (error: Error) => void,
) => onSnapshot(collection(db, 'registries', registryId, 'collections'), (snapshot) => {
  onCollections(snapshot.docs
    .map((entry) => normalizeSnapshot(registryId, entry.id, entry.data()))
    .sort((left, right) => left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' })));
}, onError);

export const saveRegistryCollection = async ({
  id,
  createId,
  organizationId,
  registryId,
  input,
  expectedVersion,
  confirmedPublication = false,
}: {
  id?: string;
  createId?: string;
  organizationId: string;
  registryId: string;
  input: RegistryCollectionInput;
  expectedVersion?: string;
  confirmedPublication?: boolean;
}) => {
  const collectionId = id || createId || registryCollectionId(input.name);
  if (id && !expectedVersion) throw new Error('Rechargez la Collection avant de modifier sa dernière version.');
  const result = await httpsCallable<Record<string, unknown>, { collectionId: string }>(functions, 'saveRegistryCollection')({
    registryId, organizationId, collectionId, mode: id ? 'update' : 'create', ...(id ? { expectedVersion } : {}), input, confirmedPublication,
  });
  return result.data.collectionId;
};

export const deleteRegistryCollection = async (registryId: string, collectionId: string, expectedVersion?: string) => {
  let version = expectedVersion;
  if (!version) {
    const existing = await getDoc(doc(db, 'registries', registryId, 'collections', collectionId));
    if (!existing.exists()) return;
    version = registryCollectionVersion(existing.data());
  }
  await httpsCallable(functions, 'deleteRegistryCollection')({ registryId, collectionId, expectedVersion: version, confirmed: true });
};

export const loadCollectionWebsitePublication = async (publicationId: string): Promise<{
  publication: CollectionWebsitePublication;
  items: CollectionWebsiteItemProjection[];
} | null> => {
  if (!SAFE_DOCUMENT_ID.test(publicationId)) return null;
  const reference = doc(db, 'collectionPublications', publicationId);
  const publicationSnapshot = await getDoc(reference);
  if (!publicationSnapshot.exists()) return null;
  const publication = publicationSnapshot.data() as CollectionWebsitePublication;
  if (publication.status !== 'published') return null;
  const itemSnapshots = await getDocs(collection(reference, 'items'));
  return {
    publication,
    items: itemSnapshots.docs
      .map((entry) => entry.data() as CollectionWebsiteItemProjection)
      .sort((left, right) => left.displayTitle.localeCompare(right.displayTitle, 'fr', { sensitivity: 'base' })),
  };
};

export const loadCartularyCollectionContext = async (
  cartularyId: string,
  registryIdHint?: string | null,
) => {
  let data: { registryId?: string; organizationId?: string; collectionId?: string } = {};
  try {
    const snapshot = await getDoc(doc(db, 'cartularies', cartularyId));
    if (snapshot.exists()) data = snapshot.data() as typeof data;
  } catch (error) {
    if (!registryIdHint) throw error;
  }

  const registryId = data.registryId || registryIdHint;
  if (!registryId) return null;
  const collectionDocuments = await loadRegistryCollections(registryId);
  const registryItems = await loadRegistryItems(registryId).catch(() => []);
  const currentItem = registryItems.find((item) => item.cartularyId === cartularyId);
  const collectionsById = new Map(collectionDocuments.map((entry) => [entry.id, entry]));
  registryItems.forEach((item) => {
    registryItemCollectionIds(item).forEach((collectionId) => {
      if (collectionsById.has(collectionId)) return;
      const name = collectionLabelFromIdentifier(collectionId);
      collectionsById.set(collectionId, {
        id: collectionId,
        organizationId: item.organizationId,
        registryId,
        name,
        description: '',
        websiteTitle: name,
        websiteSlug: normalizeCollectionSlug(name),
        status: 'draft',
        visibility: 'secret',
        publicationConsent: false,
        publishedCartularyIds: [],
      });
    });
  });
  return {
    registryId,
    organizationId: data.organizationId
      || currentItem?.organizationId
      || collectionDocuments[0]?.organizationId
      || registryItems[0]?.organizationId
      || '',
    collectionId: data.collectionId || currentItem?.collectionId || '',
    collections: [...collectionsById.values()].sort((left, right) => left.name.localeCompare(right.name, 'fr', { sensitivity: 'base' })),
  };
};
