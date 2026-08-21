import type { FirestoreTimestampValue } from './foundations.ts';
import type { RegistryItemProjection } from './projections.ts';

export type RegistryCollectionStatus = 'draft' | 'published' | 'archived';

export interface RegistryCollectionDocument {
  id: string;
  organizationId: string;
  registryId: string;
  name: string;
  description: string;
  websiteTitle: string;
  websiteSlug: string;
  status: RegistryCollectionStatus;
  visibility: 'secret' | 'public';
  publicationConsent?: boolean;
  publishedCartularyIds?: string[];
  publishedAt?: FirestoreTimestampValue | null;
  createdAt?: FirestoreTimestampValue;
  updatedAt?: FirestoreTimestampValue;
}

export interface RegistryCollectionInput {
  name: string;
  description: string;
  websiteTitle: string;
  websiteSlug: string;
  status: RegistryCollectionStatus;
  visibility: 'secret' | 'public';
  publicationConsent: boolean;
  publishedCartularyIds: string[];
}

export interface CollectionWebsitePublication {
  publicationId: string;
  organizationId: string;
  registryId: string;
  collectionId: string;
  websiteTitle: string;
  websiteSlug: string;
  description: string;
  status: 'published' | 'revoked';
  itemCount: number;
  publishedAt?: FirestoreTimestampValue;
  updatedAt?: FirestoreTimestampValue;
}

export interface CollectionWebsiteItemProjection {
  cartularyId: string;
  collectionId: string;
  assetType: string;
  displayTitle: string;
  makerName: string;
  modelName: string;
  referenceCode: string | null;
  manufactureYear: number | null;
  publicCode: string | null;
}

const collectionSlug = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 64);

export const normalizeCollectionSlug = (value: string) => collectionSlug(value) || 'collection';

export const collectionWebsitePublicationId = (registryId: string, collectionId: string) => (
  `${registryId}--${collectionId}`
);

export const collectionWebsitePath = (registryId: string, collectionId: string) => {
  const parameters = new URLSearchParams({
    publicationId: collectionWebsitePublicationId(registryId, collectionId),
  });
  return `/collection-website?${parameters.toString()}`;
};

export const collectionWebsiteIsPublished = (collection: Pick<RegistryCollectionDocument, 'status' | 'visibility' | 'publicationConsent'>) => (
  collection.status === 'published'
  && collection.visibility === 'public'
  && collection.publicationConsent === true
);

export const collectionWebsiteItemProjection = (
  item: RegistryItemProjection,
  collectionId: string,
): CollectionWebsiteItemProjection => ({
  cartularyId: item.cartularyId,
  collectionId,
  assetType: item.assetType,
  displayTitle: item.displayTitle,
  makerName: item.makerName,
  modelName: item.modelName,
  referenceCode: item.referenceCode,
  manufactureYear: item.manufactureYear,
  publicCode: item.objectCode || null,
});

export const collectionLabelFromIdentifier = (value: string) => value
  .replace(/^col_/, '')
  .split(/[_-]+/)
  .filter(Boolean)
  .map((part) => `${part.charAt(0).toLocaleUpperCase('fr')}${part.slice(1)}`)
  .join(' ');

export const registryCollectionId = (name: string) => {
  const suffix = crypto.getRandomValues(new Uint8Array(4));
  const token = [...suffix].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `col_${normalizeCollectionSlug(name).replace(/-/g, '_')}_${token}`;
};
