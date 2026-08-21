export type PublicProjectionStatus = 'published' | 'revoked';

export interface RegistryItemProjection {
  cartularyId: string;
  organizationId: string;
  registryId: string;
  collectionId: string;
  collectionIds?: string[];
  assetType: string;
  displayTitle: string;
  makerName: string;
  modelName: string;
  referenceCode: string | null;
  manufactureYear: number | null;
  lifecycleStatus: string;
  patrimonialStatus?: 'Patrimonial' | 'À vendre' | 'Ouvert à proposition' | null;
  userAlias?: string | null;
  objectCode?: string | null;
  possessionStatus: string;
  purchasePrice?: number | null;
  costBasis?: number | null;
  grossValuation?: number | null;
  netValuation?: number | null;
  netAfterTaxValuation?: number | null;
  valuationCurrency?: string | null;
  completenessLevel: string;
  primaryAssetId: string | null;
  sourceRevision: number;
  projectionStatus: 'active' | 'withdrawn';
  contentHash: string;
  generatedAt?: { seconds: number; nanoseconds: number };
  updatedAt?: { seconds: number; nanoseconds: number };
}

export const registryItemCollectionIds = (item: Pick<RegistryItemProjection, 'collectionId' | 'collectionIds'>): string[] => (
  [...new Set([...(item.collectionIds || []), item.collectionId].filter(Boolean))]
);

export interface PublicDerivativeProjection {
  assetId: string;
  derivativeId: string;
  mediaKind: string;
  mimeType: string;
  storagePath: string;
  contentHash: string;
  downloadUrl: string | null;
}

export interface PublicBlockProjection {
  blockId: string;
  title: string;
  payload: Record<string, unknown>;
  assets: PublicDerivativeProjection[];
  sourceRevision: number;
  publicationStatus: 'published';
  contentHash: string;
}

export interface PublicPublicationProjection {
  publicCode: string;
  cartularyId: string;
  audience: 'public';
  assetType: string;
  schemaVersion: string;
  displayTitle: string;
  makerName: string;
  modelName: string;
  referenceCode: string | null;
  status: PublicProjectionStatus;
  publicationStatus: PublicProjectionStatus;
  publicationRevision: number;
  sourceRevision: number;
  blockIds: string[];
  assetCount: number;
  contentHash: string;
  publishedAtIso: string;
}

export interface PublicSealProjection {
  publicCode: string;
  cartularyId: string;
  publicationPath: string;
  status: 'issued';
  contentHash: string;
  supportCode: string;
  issuedAtIso: string;
  schemaVersion: string;
  publicationRevision: number;
}

export interface LoadedPublicProjection {
  publication: PublicPublicationProjection;
  blocks: PublicBlockProjection[];
  seal: PublicSealProjection | null;
}

export interface ReportProjection {
  reportId: string;
  cartularyId: string;
  organizationId: string;
  registryId: string;
  audience: 'owner_report';
  schemaVersion: string;
  publicationStatus: 'generated';
  blockIds: string[];
  sourceRevision: number;
  contentHash: string;
  generatedAtIso: string;
}
