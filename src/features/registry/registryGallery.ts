import type { RegistryGalleryEntry } from '../../domain/gallery.ts';
import { registryItemCollectionIds } from '../../domain/projections.ts';

/** Filtres de la Galerie : l'item seul (aucune diapositive n'est lue avant l'ouverture de la visionneuse, K5). */
export interface RegistryGalleryFilters {
  query: string;
  assetType: string;
  collectionId: string;
  makerName: string;
}

export const DEFAULT_REGISTRY_GALLERY_FILTERS: RegistryGalleryFilters = {
  query: '',
  assetType: 'all',
  collectionId: 'all',
  makerName: 'all',
};

const normalize = (value: string | number | null | undefined) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr');

export const filterRegistryGallery = (
  entries: RegistryGalleryEntry[],
  filters: RegistryGalleryFilters,
): RegistryGalleryEntry[] => {
  const queryTokens = normalize(filters.query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const { item } = entry;
    if (filters.assetType !== 'all' && item.assetType !== filters.assetType) return false;
    if (filters.collectionId !== 'all' && !registryItemCollectionIds(item).includes(filters.collectionId)) return false;
    if (filters.makerName !== 'all' && item.makerName !== filters.makerName) return false;
    const haystack = normalize([
      item.displayTitle,
      item.makerName,
      item.modelName,
      item.referenceCode,
      item.manufactureYear,
    ].join(' '));
    return queryTokens.every((token) => haystack.includes(token));
  });
};
