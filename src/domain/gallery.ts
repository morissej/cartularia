import type { RegistryItemProjection } from './projections.ts';

export interface RegistryGallerySlide {
  assetId: string;
  cartularyId: string;
  displayName: string;
  url: string;
  thumbnailUrl: string;
  category: string;
  capturedAt: string | null;
  tags: string[];
  source: 'local_prototype' | 'authorized_derivative' | 'firebase_storage';
}

export interface RegistryGalleryEntry {
  item: RegistryItemProjection;
  primaryAssetId: string | null;
  slides: RegistryGallerySlide[];
}
