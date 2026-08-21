import { registryItemCollectionIds, type RegistryItemProjection } from '../../domain/projections.ts';
import { IWC_CARTULARY_ID, ROLEX_CARTULARY_ID } from '../../domain/cartularyIds.ts';

export type RegistryCatalogSort = 'updated-desc' | 'title-asc' | 'year-desc';

export interface RegistryCatalogFilters {
  query: string;
  assetType: string;
  collectionId: string;
  patrimonialStatus: string;
  lifecycleStatus?: string;
  sort: RegistryCatalogSort;
}

export const DEFAULT_REGISTRY_CATALOG_FILTERS: RegistryCatalogFilters = {
  query: '',
  assetType: 'all',
  collectionId: 'all',
  patrimonialStatus: 'all',
  sort: 'updated-desc',
};

const normalize = (value: string | number | null | undefined) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr');

const updatedAtValue = (item: RegistryItemProjection) => {
  if (item.updatedAt) return item.updatedAt.seconds * 1_000 + item.updatedAt.nanoseconds / 1_000_000;
  return item.sourceRevision;
};

export const filterAndSortRegistryItems = (
  items: RegistryItemProjection[],
  filters: RegistryCatalogFilters,
): RegistryItemProjection[] => {
  const searchTokens = normalize(filters.query).split(/\s+/).filter(Boolean);
  const filtered = items.filter((item) => {
    if (item.projectionStatus !== 'active') return false;
    if (filters.assetType !== 'all' && item.assetType !== filters.assetType) return false;
    if (filters.collectionId !== 'all' && !registryItemCollectionIds(item).includes(filters.collectionId)) return false;
    if (filters.patrimonialStatus !== 'all' && item.patrimonialStatus !== filters.patrimonialStatus) return false;
    if (filters.lifecycleStatus && filters.lifecycleStatus !== 'all' && item.lifecycleStatus !== filters.lifecycleStatus) return false;

    const haystack = normalize([
      item.displayTitle,
      item.makerName,
      item.modelName,
      item.referenceCode,
      item.userAlias,
      item.objectCode,
      item.manufactureYear,
      item.assetType,
      ...registryItemCollectionIds(item),
    ].join(' '));
    return searchTokens.every((token) => haystack.includes(token));
  });

  return [...filtered].sort((left, right) => {
    if (filters.sort === 'title-asc') {
      return left.displayTitle.localeCompare(right.displayTitle, 'fr', { sensitivity: 'base' });
    }
    if (filters.sort === 'year-desc') {
      const yearDifference = (right.manufactureYear ?? -1) - (left.manufactureYear ?? -1);
      return yearDifference || left.displayTitle.localeCompare(right.displayTitle, 'fr', { sensitivity: 'base' });
    }
    return updatedAtValue(right) - updatedAtValue(left)
      || left.displayTitle.localeCompare(right.displayTitle, 'fr', { sensitivity: 'base' });
  });
};

export const buildCartularyHref = (cartularyId: string, returnTo: string, assetType?: string) => {
  const params = new URLSearchParams({ cartularyId, returnTo });
  const usesFullCartulary = assetType === 'watch'
    || cartularyId === IWC_CARTULARY_ID
    || cartularyId === ROLEX_CARTULARY_ID;
  return `${usesFullCartulary ? '/cartulary' : '/cartulary-view'}?${params.toString()}`;
};

export const isRegistryReturnPath = (value: string | null): value is string => Boolean(
  value
  && value.startsWith('/registry/')
  && !value.startsWith('//')
  && !value.includes('\\'),
);
