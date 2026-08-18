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
  source: 'prototype_bundle' | 'authorized_derivative' | 'firebase_storage' | 'error';
  storagePath?: string | null;
}

export const ownerUidFromPrivateDraftStoragePath = (storagePath: string): string | null => {
  const match = /^private-drafts\/([^/]+)\/[^/]+\/[^/]+\/[a-f0-9]{64}\/original$/.exec(storagePath);
  return match?.[1] ?? null;
};

export interface RegistryGalleryEntry {
  item: RegistryItemProjection;
  primaryAssetId: string | null;
  slides: RegistryGallerySlide[];
}
