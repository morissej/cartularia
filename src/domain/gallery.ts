import type { PrivatePresentation } from './presentationVariants.ts';
import type { RegistryItemProjection } from './projections.ts';
import { registryThumbnailSrc, registryThumbnailState, type RegistryItemThumbnail, type RegistryThumbnailState, normalizeRegistryThumbnail } from './registryThumbnail.ts';

/**
 * Galerie du Registre (contrat V3, K5) : les cartes se construisent depuis `item.thumbnail` seulement ;
 * les diapositives (assets) ne sont lues qu'à l'ouverture de la visionneuse, et leur affichage passe par les
 * variantes privées (propriétaire) ou par le bundle Hosting, jamais par un original.
 */

export interface RegistryGalleryEntry {
  item: RegistryItemProjection;
  primaryAssetId: string | null;
  thumbnail: RegistryItemThumbnail | null;
  thumbnailSrc: string | null;
  thumbnailState: RegistryThumbnailState;
}

/**
 * Accès d'une diapositive pour le compte courant :
 * - 'bundle' : dérivé same-origin du bundle Hosting (démonstrations, fixture pilote) ;
 * - 'owner' : variantes privées presentation-v3 lisibles par le propriétaire (rôle stage/thumbnail) ;
 * - 'restricted' : photo privée d'un autre propriétaire (aucune requête, message honnête) ;
 * - 'unavailable' : aucune copie de présentation connue.
 */
export type RegistryGallerySlideAccess = 'bundle' | 'owner' | 'restricted' | 'unavailable';

export interface RegistryGallerySlide {
  assetId: string;
  cartularyId: string;
  displayName: string;
  category: string;
  capturedAt: string | null;
  tags: string[];
  binaryId: string | null;
  privatePresentation: PrivatePresentation | null;
  /** Dérivé same-origin (scène) et sa vignette, uniquement pour un original du bundle. */
  url: string | null;
  thumbnailUrl: string | null;
  access: RegistryGallerySlideAccess;
}

export const ownerUidFromPrivateDraftStoragePath = (storagePath: string): string | null => {
  const match = /^private-drafts\/([^/]+)\/[^/]+\/[^/]+\/[a-f0-9]{64}\/original$/.exec(storagePath);
  return match?.[1] ?? null;
};

/** Propriétaire d'une variante privée depuis son chemin (private-derivatives/{uid}/…), sans requête. */
export const ownerUidFromPrivateDerivativePath = (storagePath: string): string | null => {
  const match = /^private-derivatives\/([^/]+)\/[^/]+\/[^/]+\/presentation-v3-(?:240|480|768|1200)\.webp$/.exec(storagePath);
  return match?.[1] ?? null;
};

export const buildRegistryGalleryEntry = (item: RegistryItemProjection): RegistryGalleryEntry => ({
  item,
  primaryAssetId: item.primaryAssetId,
  thumbnail: normalizeRegistryThumbnail(item.thumbnail),
  thumbnailSrc: registryThumbnailSrc(item.thumbnail),
  thumbnailState: registryThumbnailState(item),
});

export const resolveGallerySlideAccess = ({ url, binaryId, ownerUid, viewerUid }: {
  url: string | null;
  binaryId: string | null;
  ownerUid: string | null;
  viewerUid: string | null;
}): RegistryGallerySlideAccess => {
  if (url) return 'bundle';
  if (!binaryId || !ownerUid) return 'unavailable';
  return viewerUid && viewerUid === ownerUid ? 'owner' : 'restricted';
};
