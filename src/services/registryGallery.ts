import { collection, getDocs } from 'firebase/firestore';
import { mockCartulary } from '../data/mockData.ts';
import { IWC_CARTULARY_ID } from '../domain/cartularyIds.ts';
import type { RegistryGalleryEntry, RegistryGallerySlide } from '../domain/gallery.ts';
import { db } from '../firebase.ts';
import { loadRegistryItems, observeRegistryItems } from './projections.ts';
import { loadPrivateStorageObjectUrl, releasePrivateMediaObjectUrl } from './privateMedia.ts';

interface ReadableAssetDocument {
  id?: string;
  mediaKind?: string;
  displayName?: string;
  capturedAt?: string | null;
  tags?: string[];
  componentCode?: string | null;
  storagePath?: string | null;
  projectionStatus?: string;
  presentationDerivative?: {
    url?: string;
    thumbnailUrl?: string;
  };
}

const prototypePreviewByAssetId = new Map(
  mockCartulary.assets
    .filter((asset) => asset.type === 'image')
    .map((asset) => [asset.id, {
      url: asset.url,
      thumbnailUrl: asset.thumbnailUrl || asset.url,
    }]),
);

const safeSameOriginPath = (value: unknown): value is string => typeof value === 'string'
  && value.startsWith('/')
  && !value.startsWith('//')
  && !value.includes('\\');

const resolveAssetPreview = async (
  cartularyId: string,
  assetId: string,
  asset: ReadableAssetDocument,
): Promise<Pick<RegistryGallerySlide, 'url' | 'thumbnailUrl' | 'source'> | null> => {
  const derivative = asset.presentationDerivative;
  if (safeSameOriginPath(derivative?.url)) {
    return {
      url: derivative.url,
      thumbnailUrl: safeSameOriginPath(derivative.thumbnailUrl) ? derivative.thumbnailUrl : derivative.url,
      source: 'authorized_derivative',
    };
  }

  // Les médias du Cartulaire IWC existent déjà dans le bundle Hosting. Les
  // utiliser évite tout téléchargement Storage au chargement de la Galerie.
  if (cartularyId === IWC_CARTULARY_ID) {
    const preview = prototypePreviewByAssetId.get(assetId);
    if (preview) return { ...preview, source: 'prototype_bundle' };
  }

  if (typeof asset.storagePath === 'string' && asset.storagePath.startsWith('private-drafts/')) {
    try {
      const url = await loadPrivateStorageObjectUrl(asset.storagePath);
      return { url, thumbnailUrl: url, source: 'firebase_storage' };
    } catch {
      return null;
    }
  }
  return null;
};

export const resolveRegistryGallerySlide = async (
  slide: RegistryGallerySlide,
): Promise<RegistryGallerySlide> => {
  if (slide.url || slide.source === 'error' || !slide.storagePath?.startsWith('private-drafts/')) return slide;
  try {
    const url = await loadPrivateStorageObjectUrl(slide.storagePath);
    return { ...slide, url, thumbnailUrl: url, source: 'firebase_storage' };
  } catch {
    return { ...slide, url: '', thumbnailUrl: '', source: 'error' };
  }
};

const loadEntry = async (
  item: Awaited<ReturnType<typeof loadRegistryItems>>[number],
): Promise<RegistryGalleryEntry> => {
  const assetsSnapshot = await getDocs(collection(db, 'cartularies', item.cartularyId, 'assets'));
  const candidates = assetsSnapshot.docs.map((document) => {
    const asset = document.data() as ReadableAssetDocument;
    const assetId = asset.id || document.id;
    if (asset.mediaKind !== 'image' || asset.projectionStatus === 'withdrawn') return null;
    if (assetId !== item.primaryAssetId && !asset.tags?.includes('slideshow')) return null;
    return { assetId, asset };
  }).filter((candidate): candidate is { assetId: string; asset: ReadableAssetDocument } => Boolean(candidate));
  const slides = (await Promise.all(candidates.map(async ({ assetId, asset }): Promise<RegistryGallerySlide | null> => {
    const hasAuthorizedDerivative = safeSameOriginPath(asset.presentationDerivative?.url);
    const shouldResolveNow = item.cartularyId === IWC_CARTULARY_ID
      || hasAuthorizedDerivative;
    const preview = shouldResolveNow
      ? await resolveAssetPreview(item.cartularyId, assetId, asset)
      : null;
    const storagePath = typeof asset.storagePath === 'string' && asset.storagePath.startsWith('private-drafts/')
      ? asset.storagePath
      : null;
    if (!preview && !storagePath) return null;
    return {
      assetId,
      cartularyId: item.cartularyId,
      displayName: asset.displayName || assetId,
      category: asset.componentCode || 'ensemble',
      capturedAt: asset.capturedAt || null,
      tags: Array.isArray(asset.tags) ? asset.tags : [],
      url: preview?.url ?? '',
      thumbnailUrl: preview?.thumbnailUrl ?? '',
      source: preview?.source ?? 'firebase_storage',
      storagePath,
    };
  }))).filter((slide): slide is RegistryGallerySlide => Boolean(slide));

  slides.sort((left, right) => {
    if (left.assetId === item.primaryAssetId) return -1;
    if (right.assetId === item.primaryAssetId) return 1;
    return left.displayName.localeCompare(right.displayName, 'fr', { sensitivity: 'base' });
  });

  return { item, primaryAssetId: item.primaryAssetId, slides };
};

export const loadRegistryGallery = async (registryId: string): Promise<RegistryGalleryEntry[]> => {
  const items = (await loadRegistryItems(registryId)).filter((item) => item.projectionStatus === 'active');
  return Promise.all(items.map(loadEntry));
};

export const observeRegistryGallery = (
  registryId: string,
  onEntries: (entries: RegistryGalleryEntry[]) => void,
  onError: (error: Error) => void,
) => {
  let generation = 0;
  return observeRegistryItems(registryId, (items) => {
    const currentGeneration = ++generation;
    void Promise.all(items.filter((item) => item.projectionStatus === 'active').map(loadEntry))
      .then((entries) => {
        if (currentGeneration === generation) onEntries(entries);
        else revokeRegistryGalleryObjectUrls(entries);
      })
      .catch(onError);
  }, onError);
};

export const revokeRegistryGalleryObjectUrls = (entries: RegistryGalleryEntry[]) => {
  const urls = new Set(entries.flatMap((entry) => entry.slides.map((slide) => slide.url || slide.thumbnailUrl)));
  urls.forEach((url) => {
    if (url.startsWith('blob:') && !releasePrivateMediaObjectUrl(url)) URL.revokeObjectURL(url);
  });
};
