import { CREATION_PROFILE_DEFINITIONS, type CreationProfileDefinition } from '../../scripts/lib/creation-profile-map.mjs';

export const CARTULARY_CREATION_PROFILE_VERSION = '1.0.0';

/**
 * Types d'objets proposés à la création : libellés et règles de saisie viennent de la table de
 * création partagée avec le serveur (ADR-030). La version de schéma n'est pas codée ici : elle
 * est résolue dans le catalogue au moment de la création (`loadCreationSchemaVersion`).
 */
export const SUPPORTED_CREATION_PROFILES: { readonly watch: CreationProfileDefinition; readonly car: CreationProfileDefinition } = CREATION_PROFILE_DEFINITIONS;
export type SupportedCreationAssetType = keyof typeof SUPPORTED_CREATION_PROFILES;

export interface CartularyCreationProfile {
  profileVersion: typeof CARTULARY_CREATION_PROFILE_VERSION;
  assetType: SupportedCreationAssetType;
  schemaId: SupportedCreationAssetType;
  /** Version publiée du catalogue retenue à la création (`x.y.z`). */
  schemaVersion: string;
  collectionId: string;
  brand: string;
  model: string;
  reference: string;
  manufactureYear: number | null;
  serialNumber: string;
  caliber: string;
  description: string;
  conditionSummary: string;
  purchaseDate: string;
  purchasePrice: number | null;
  currency: string;
  seller: string;
  valuationDate: string;
  valuationLow: number | null;
  valuationMid: number | null;
  valuationHigh: number | null;
  sourceLabel: string;
  assertedAt: string;
}

export type WatchCartularyCreationProfile = CartularyCreationProfile & { assetType: 'watch'; schemaId: 'watch' };

export interface CartularyCreationMediaAsset {
  id: string;
  name: string;
  originalFileName: string;
  type: 'image' | 'video' | 'document';
  mimeType: string;
  url: '';
  hash: string;
  status: 'Archived';
  binaryId: string;
  tags: Array<'main-photo' | 'main-video' | 'slideshow' | 'documentation' | 'other'>;
  category: 'ensemble' | 'documentation';
  visibility: 'Secret';
  fileSize: string;
  derivativeStatus: 'not-required' | 'pending' | 'ready';
  capturedAt: string;
  timestampSource: 'file.lastModified' | 'exif.DateTimeOriginal' | 'exif.CreateDate';
}

export interface CartularyCreationResult {
  cartularyId: string;
  requestId: string;
  publicCode: string;
  uploadedFileCount: number;
  uploadedBytes: number;
}

export const CARTULARY_CREATION_TIMEOUT_MESSAGE = 'La création peut encore aboutir. Vérifiez le catalogue avant de recommencer ; ce bouton reprendra la même demande sans téléverser à nouveau les fichiers.';

export const resumeOrCreateCartulary = async (
  pending: CartularyCreationResult | null,
  create: () => Promise<CartularyCreationResult>,
) => pending ?? create();
