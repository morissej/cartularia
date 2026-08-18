import type { RegistryGalleryEntry, RegistryGallerySlide } from '../../domain/gallery.ts';

export interface RegistryGalleryFilters {
  query: string;
  assetType: string;
  collectionId: string;
  makerName: string;
  category: string;
}

export const DEFAULT_REGISTRY_GALLERY_FILTERS: RegistryGalleryFilters = {
  query: '',
  assetType: 'all',
  collectionId: 'all',
  makerName: 'all',
  category: 'all',
};

const normalize = (value: string | null | undefined) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr');

export const gallerySlidesForCategory = (
  entry: RegistryGalleryEntry,
  category: string,
): RegistryGallerySlide[] => category === 'all'
  ? entry.slides
  : entry.slides.filter((slide) => slide.category === category);

export const filterRegistryGallery = (
  entries: RegistryGalleryEntry[],
  filters: RegistryGalleryFilters,
): RegistryGalleryEntry[] => {
  const queryTokens = normalize(filters.query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    const { item } = entry;
    if (filters.assetType !== 'all' && item.assetType !== filters.assetType) return false;
    if (filters.collectionId !== 'all' && item.collectionId !== filters.collectionId) return false;
    if (filters.makerName !== 'all' && item.makerName !== filters.makerName) return false;
    if (filters.category !== 'all' && gallerySlidesForCategory(entry, filters.category).length === 0) return false;
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
