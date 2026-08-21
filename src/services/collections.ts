import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import {
  collectionWebsiteItemProjection,
  collectionWebsiteIsPublished,
  collectionWebsitePublicationId,
  collectionLabelFromIdentifier,
  normalizeCollectionSlug,
  registryCollectionId,
  type CollectionWebsiteItemProjection,
  type CollectionWebsitePublication,
  type RegistryCollectionDocument,
  type RegistryCollectionInput,
} from '../domain/collections.ts';
import { registryItemCollectionIds } from '../domain/projections.ts';
import { db } from '../firebase.ts';
import { loadRegistryItems } from './projections.ts';

export { normalizeCollectionSlug, registryCollectionId } from '../domain/collections.ts';

const SAFE_DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/;

const normalizePublishedCartularyIds = (values: string[]) => (
  [...new Set(values.filter((value) => SAFE_DOCUMENT_ID.test(value)))].slice(0, 200)
);

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
  organizationId,
  registryId,
  input,
}: {
  id?: string;
  organizationId: string;
  registryId: string;
  input: RegistryCollectionInput;
}) => {
  const collectionId = id || registryCollectionId(input.name);
  const reference = doc(db, 'registries', registryId, 'collections', collectionId);
  const existing = await getDoc(reference);
  const explicitlyPublished = input.publicationConsent && input.status !== 'archived';
  const publishedCartularyIds = explicitlyPublished
    ? normalizePublishedCartularyIds(input.publishedCartularyIds)
    : [];
  const normalizedStatus = input.status === 'archived'
    ? 'archived'
    : explicitlyPublished ? 'published' : 'draft';
  const normalizedVisibility = explicitlyPublished ? 'public' : 'secret';
  const publicationId = collectionWebsitePublicationId(registryId, collectionId);
  const publicationReference = doc(db, 'collectionPublications', publicationId);
  const hasExistingPublication = existing.exists()
    && collectionWebsiteIsPublished(existing.data() as RegistryCollectionDocument);
  const [registryItems, currentPublicationItems, existingPublication] = await Promise.all([
    explicitlyPublished ? loadRegistryItems(registryId) : Promise.resolve([]),
    hasExistingPublication ? getDocs(collection(publicationReference, 'items')) : Promise.resolve(null),
    hasExistingPublication ? getDoc(publicationReference) : Promise.resolve(null),
  ]);
  const selectedItems = registryItems.filter((item) => (
    item.projectionStatus === 'active'
    && publishedCartularyIds.includes(item.cartularyId)
    && registryItemCollectionIds(item).includes(collectionId)
  ));
  const selectedIds = new Set(selectedItems.map((item) => item.cartularyId));
  const batch = writeBatch(db);
  batch.set(reference, {
    id: collectionId,
    organizationId,
    registryId,
    ...input,
    websiteSlug: normalizeCollectionSlug(input.websiteSlug || input.name),
    status: normalizedStatus,
    visibility: normalizedVisibility,
    publicationConsent: explicitlyPublished,
    publishedCartularyIds: [...selectedIds],
    publishedAt: explicitlyPublished
      ? existing.data()?.publishedAt || serverTimestamp()
      : null,
    ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(publicationReference, {
    publicationId,
    organizationId,
    registryId,
    collectionId,
    websiteTitle: input.websiteTitle.trim() || input.name.trim(),
    websiteSlug: normalizeCollectionSlug(input.websiteSlug || input.name),
    description: input.description.trim(),
    status: explicitlyPublished ? 'published' : 'revoked',
    itemCount: selectedItems.length,
    publishedAt: explicitlyPublished
      ? existingPublication?.data()?.publishedAt || serverTimestamp()
      : existingPublication?.data()?.publishedAt || null,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  selectedItems.forEach((item) => {
    batch.set(doc(publicationReference, 'items', item.cartularyId), collectionWebsiteItemProjection(item, collectionId));
  });
  (currentPublicationItems?.docs || [])
    .filter((item) => !selectedIds.has(item.id))
    .forEach((item) => batch.delete(item.ref));

  await batch.commit();
  return collectionId;
};

export const deleteRegistryCollection = (registryId: string, collectionId: string) => (
  deleteDoc(doc(db, 'registries', registryId, 'collections', collectionId))
);

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
