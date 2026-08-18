export const CARTULARY_CREATION_PROFILE_VERSION = '1.0.0';

export interface WatchCartularyCreationProfile {
  profileVersion: typeof CARTULARY_CREATION_PROFILE_VERSION;
  assetType: 'watch';
  schemaId: 'watch';
  schemaVersion: '1.5.0';
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
  derivativeStatus: 'not-required';
  capturedAt: string;
  timestampSource: 'file.lastModified';
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
