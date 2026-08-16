import { collection, getDocs } from 'firebase/firestore';
import { getBlob, ref } from 'firebase/storage';
import { mockCartulary } from '../data/mockData.ts';
import { IWC_CARTULARY_ID } from '../domain/cartularyIds.ts';
import type { RegistryGalleryEntry, RegistryGallerySlide } from '../domain/gallery.ts';
import { db, storage } from '../firebase.ts';
import { loadRegistryItems, observeRegistryItems } from './projections.ts';

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

  if (typeof asset.storagePath === 'string' && asset.storagePath.startsWith('private-drafts/')) {
    try {
      const blob = await getBlob(ref(storage, asset.storagePath));
      const url = URL.createObjectURL(blob);
      return { url, thumbnailUrl: url, source: 'firebase_storage' };
    } catch {
      // Le repli local ci-dessous reste disponible dans le seul environnement pilote.
    }
  }

  // Le prototype IWC conserve encore ses binaires dans public/assets. Cette
  // résolution est volontairement limitée à l'émulateur et ne crée aucune
  // copie dans le Registre.
  if (import.meta.env.VITE_USE_FIREBASE_EMULATORS !== 'true' || cartularyId !== IWC_CARTULARY_ID) return null;
  const preview = prototypePreviewByAssetId.get(assetId);
  return preview ? { ...preview, source: 'local_prototype' } : null;
};

const loadEntry = async (
  item: Awaited<ReturnType<typeof loadRegistryItems>>[number],
): Promise<RegistryGalleryEntry> => {
  const assetsSnapshot = await getDocs(collection(db, 'cartularies', item.cartularyId, 'assets'));
  const slides = (await Promise.all(assetsSnapshot.docs.map(async (document): Promise<RegistryGallerySlide | null> => {
    const asset = document.data() as ReadableAssetDocument;
    const assetId = asset.id || document.id;
    if (asset.mediaKind !== 'image' || asset.projectionStatus === 'withdrawn') return null;
    if (assetId !== item.primaryAssetId && !asset.tags?.includes('slideshow')) return null;
    const preview = await resolveAssetPreview(item.cartularyId, assetId, asset);
    if (!preview) return null;
    return {
      assetId,
      cartularyId: item.cartularyId,
      displayName: asset.displayName || assetId,
      category: asset.componentCode || 'ensemble',
      capturedAt: asset.capturedAt || null,
      tags: Array.isArray(asset.tags) ? asset.tags : [],
      ...preview,
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
  const urls = new Set(entries.flatMap((entry) => entry.slides.flatMap((slide) => [slide.url, slide.thumbnailUrl])));
  urls.forEach((url) => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  });
};
