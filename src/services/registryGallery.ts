import { collection, getDocs } from 'firebase/firestore';
import { mockCartulary } from '../data/mockData.ts';
import {
  buildRegistryGalleryEntry,
  ownerUidFromPrivateDerivativePath,
  ownerUidFromPrivateDraftStoragePath,
  resolveGallerySlideAccess,
  type RegistryGalleryEntry,
  type RegistryGallerySlide,
} from '../domain/gallery.ts';
import { presentationFromAssetDocument } from '../domain/presentationVariants.ts';
import { auth, db } from '../firebase.ts';
import { presentationDerivativeUrl } from '../media/presentationDerivatives.ts';
import { loadRegistryItems, observeRegistryItems } from './projections.ts';

/**
 * Galerie du Registre (contrat V3, K5) :
 * - les cartes se construisent depuis `registries/{r}/items/{id}.thumbnail` seulement : 0 lecture d'assets, 0 Storage ;
 * - les diapositives sont lues (1 getDocs assets) à l'ouverture de la visionneuse seulement ; leur affichage passe
 *   par les variantes privées (propriétaire, rôle stage/thumbnail) ou par un dérivé same-origin du bundle Hosting ;
 *   jamais par un original, jamais par presentation-v2 ; un membre non propriétaire reçoit un état honnête.
 * Aucune écriture Firestore ici.
 */

interface ReadableAssetDocument {
  id?: string;
  mediaKind?: string;
  displayName?: string;
  capturedAt?: string | null;
  tags?: string[];
  componentCode?: string | null;
  storagePath?: string | null;
  binaryId?: string | null;
  projectionStatus?: string;
  presentationDerivative?: {
    url?: string;
    thumbnailUrl?: string;
  };
}

const STAGE_WIDTH = 1200;
const THUMBNAIL_WIDTH = 480;

const safeSameOriginPath = (value: unknown): value is string => typeof value === 'string'
  && value.startsWith('/')
  && !value.startsWith('//')
  && !value.includes('\\');

// Originaux déjà présents dans le bundle Hosting (fixture du Cartulaire pilote) : dérivés du catalogue statique,
// aucun téléchargement Storage. La clé porte le Cartulaire : aucune marque n'est testée.
const bundlePreviewKey = (cartularyId: string, assetId: string) => `${cartularyId}::${assetId}`;
const bundlePreviewByAssetId = new Map(
  mockCartulary.assets
    .filter((asset) => asset.type === 'image' && safeSameOriginPath(asset.url))
    .map((asset) => [bundlePreviewKey(mockCartulary.id, asset.id), {
      url: presentationDerivativeUrl(asset.url, STAGE_WIDTH),
      thumbnailUrl: presentationDerivativeUrl(asset.thumbnailUrl || asset.url, THUMBNAIL_WIDTH),
    }]),
);

/** Dérivé same-origin (bundle Hosting) d'un asset : `presentationDerivative.url` catalogué, sinon fixture pilote. */
const bundlePreviewFor = (cartularyId: string, assetId: string, asset: ReadableAssetDocument) => {
  const derivative = asset.presentationDerivative;
  if (safeSameOriginPath(derivative?.url)) {
    const thumbnailSource = safeSameOriginPath(derivative.thumbnailUrl) ? derivative.thumbnailUrl : derivative.url;
    return { url: presentationDerivativeUrl(derivative.url, STAGE_WIDTH), thumbnailUrl: presentationDerivativeUrl(thumbnailSource, THUMBNAIL_WIDTH) };
  }
  return bundlePreviewByAssetId.get(bundlePreviewKey(cartularyId, assetId)) ?? null;
};

const slideOwnerUid = (asset: ReadableAssetDocument, presentation: ReturnType<typeof presentationFromAssetDocument>) => {
  const variantPath = presentation?.variants[0]?.storagePath;
  if (variantPath) return ownerUidFromPrivateDerivativePath(variantPath);
  return typeof asset.storagePath === 'string' ? ownerUidFromPrivateDraftStoragePath(asset.storagePath) : null;
};

/**
 * Diapositives d'un Cartulaire, lues à l'ouverture de la visionneuse seulement (photo de couverture puis vues
 * « slideshow »). Aucun octet d'image n'est transféré ici : la visionneuse acquiert ensuite les variantes à la demande.
 */
export const loadRegistryGallerySlides = async ({ cartularyId, primaryAssetId }: {
  cartularyId: string;
  primaryAssetId: string | null;
}): Promise<RegistryGallerySlide[]> => {
  await auth.authStateReady();
  const viewerUid = auth.currentUser?.uid ?? null;
  const assetsSnapshot = await getDocs(collection(db, 'cartularies', cartularyId, 'assets'));
  const slides = assetsSnapshot.docs.flatMap((document): RegistryGallerySlide[] => {
    const asset = document.data() as ReadableAssetDocument;
    const assetId = asset.id || document.id;
    if (asset.mediaKind !== 'image' || asset.projectionStatus === 'withdrawn') return [];
    if (assetId !== primaryAssetId && !asset.tags?.includes('slideshow')) return [];
    const privatePresentation = presentationFromAssetDocument(asset);
    const bundle = bundlePreviewFor(cartularyId, assetId, asset);
    const binaryId = typeof asset.binaryId === 'string' && asset.binaryId ? asset.binaryId : null;
    return [{
      assetId,
      cartularyId,
      displayName: asset.displayName || assetId,
      category: asset.componentCode || 'ensemble',
      capturedAt: asset.capturedAt || null,
      tags: Array.isArray(asset.tags) ? asset.tags : [],
      binaryId,
      privatePresentation,
      url: bundle?.url ?? null,
      thumbnailUrl: bundle?.thumbnailUrl ?? null,
      access: resolveGallerySlideAccess({ url: bundle?.url ?? null, binaryId, ownerUid: slideOwnerUid(asset, privatePresentation), viewerUid }),
    }];
  });
  slides.sort((left, right) => {
    if (left.assetId === primaryAssetId) return -1;
    if (right.assetId === primaryAssetId) return 1;
    return left.displayName.localeCompare(right.displayName, 'fr', { sensitivity: 'base' });
  });
  return slides;
};

const entriesFor = (items: Awaited<ReturnType<typeof loadRegistryItems>>): RegistryGalleryEntry[] => items
  .filter((item) => item.projectionStatus === 'active')
  .map(buildRegistryGalleryEntry);

export const loadRegistryGallery = async (registryId: string): Promise<RegistryGalleryEntry[]> => entriesFor(await loadRegistryItems(registryId));

export const observeRegistryGallery = (
  registryId: string,
  onEntries: (entries: RegistryGalleryEntry[]) => void,
  onError: (error: Error) => void,
) => observeRegistryItems(registryId, (items) => onEntries(entriesFor(items)), onError);
