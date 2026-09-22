import type { RegistryItemMediaKind, RegistryItemThumbnail, RegistryItemThumbnailStatus } from './registryThumbnail.ts';

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
  completenessLevel: string;
  primaryAssetId: string | null;
  /**
   * Aides de présentation écrites par le serveur Admin, hors `contentHash` (contrat V3, K3) : vignette de la
   * couverture (inline ou bundle) et nature de la couverture ; absentes sur les items antérieurs à V3.
   */
  thumbnail?: RegistryItemThumbnail | null;
  primaryMediaKind?: RegistryItemMediaKind | null;
  /** État de la vignette écrit par le serveur (K3 étendu) : 'ready' | 'pending' | 'failed' | 'none' ; absent avant le tour 4. */
  thumbnailStatus?: RegistryItemThumbnailStatus | null;
  sourceRevision: number;
  projectionStatus: 'active' | 'withdrawn';
  contentHash: string;
  generatedAt?: { seconds: number; nanoseconds: number };
  updatedAt?: { seconds: number; nanoseconds: number };
}

export type RegistryValuationLevel = 'owner_declared' | 'ai_proposed' | 'professional' | 'transaction';
export type RegistryValuationConfidence = 'low' | 'medium' | 'high';

export interface RegistryInsuranceContractProjection {
  contractId: string;
  carrierLabel: string;
  contractReference: string;
  insuredAmount: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  basisLabel: string;
  status: 'active' | 'expired' | 'pending';
}

export interface RegistryValuationItemProjection {
  schemaVersion: 'registry-valuation@1.0.0';
  cartularyId: string;
  organizationId: string;
  registryId: string;
  collectionId: string;
  collectionIds: string[];
  assetType: string;
  displayTitle: string;
  marketValue: {
    amount: number | null;
    currency: string | null;
    level: RegistryValuationLevel | null;
    observedAt: string | null;
    sourceLabel: string | null;
    confidence: RegistryValuationConfidence | null;
  };
  insuranceContracts: RegistryInsuranceContractProjection[];
  insuranceWarnings: string[];
  eligibility: 'eligible' | 'excluded';
  exclusionReasons: string[];
  visibility: 'secret';
  sourceRevision: number;
  projectionStatus: 'active' | 'withdrawn';
  contentHash: string;
  generatedAt?: { seconds: number; nanoseconds: number };
  updatedAt?: { seconds: number; nanoseconds: number };
}

export interface RegistryValuationSnapshotLine {
  cartularyId: string;
  assetType: string;
  displayTitle: string;
  collectionId: string;
  marketValue: number;
  insuredCapital: number;
  coverageGap: number;
  currency: 'EUR';
  level: RegistryValuationLevel;
  observedAt: string;
  sourceLabel: string;
  confidence: RegistryValuationConfidence;
  insuranceContractCount: number;
  insuranceWarnings: string[];
  sourceRevision: number;
}

export interface RegistryValuationSnapshot {
  schemaVersion: 'registry-valuation-snapshot@1.0.0';
  snapshotId: string;
  organizationId: string;
  registryId: string;
  scopeType: 'registry';
  scopeId: string;
  asOfDate: string;
  referenceCurrency: 'EUR';
  totalMarketValue: number;
  totalInsuredCapital: number;
  coverageGap: number;
  uninsuredLineCount: number;
  lowConfidenceValue: number;
  lowConfidenceShare: number;
  totalsByLevel: Record<RegistryValuationLevel, number>;
  lines: RegistryValuationSnapshotLine[];
  excludedLines: Array<{ cartularyId: string; displayTitle: string; reasons: string[] }>;
  sourceProjectionCount: number;
  sourceProjectionHashes: string[];
  immutable: true;
  visibility: 'secret';
  contentHash: string;
  createdBy: string;
  createdAtIso: string;
  createdAt?: { seconds: number; nanoseconds: number };
}

export type DocumentationTier = 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
export type DocumentationAssessmentStatus = 'not_evaluated' | 'not_configured' | 'evaluated';
export type DocumentationCriterionStatus = 'proven' | 'missing' | 'unknown' | 'unverified' | 'unavailable';
export type DocumentationActionCost = 'free' | 'time' | 'service';

export interface DocumentationEvidenceReference {
  kind: string;
  reference: string;
  revision?: number;
  observedAt?: string;
  sourceLabel?: string;
}

export interface DocumentationCriterionResult {
  criterionId: string;
  tier: DocumentationTier;
  label: string;
  status: DocumentationCriterionStatus;
  satisfied: boolean;
  evidenceRefs: DocumentationEvidenceReference[];
  expectedProof: string;
  dependencies: string[];
  criterionOrder: number;
  note?: string;
}

export interface DocumentationPriorityAction {
  cartularyId: string;
  displayTitle: string;
  collectionId: string;
  collectionIds: string[];
  targetTier: DocumentationTier;
  targetTierName: string;
  criterionId: string;
  missingCriterion: string;
  action: string;
  expectedProof: string;
  costCategory: DocumentationActionCost;
  dependencies: string[];
  priorityReason: string;
  gainMeasurementStatus: 'unmeasured';
  gainMeasurementLabel: 'gain non mesuré';
  priorityOrder: number[];
}

export interface DocumentationEffectMeasurement {
  status: 'unmeasured';
  label: 'ordre de grandeur non mesuré';
  monetaryGain: null;
  measuredCoefficient: null;
  h3Model: {
    activationStatus: 'inactive';
    modelVersion: string | null;
    source: string | null;
    sourceRightToUse: string | null;
    studiedSegment: string | null;
    sampleSize: number | null;
    coefficient: number | null;
    confidenceInterval: { low: number; high: number } | null;
    measuredAt: string | null;
  };
}

export interface DocumentationAssessmentProjection {
  schemaVersion: 'documentation-assessment@1.0.0';
  cartularyId: string;
  organizationId: string;
  registryId: string;
  collectionId: string;
  collectionIds: string[];
  assetType: string;
  displayTitle: string;
  assessmentStatus: DocumentationAssessmentStatus;
  methodVersion: string | null;
  verticalProfile: string | null;
  evaluatedAt: string;
  dataRevision: number;
  visibility: 'secret';
  documentationTier: DocumentationTier | null;
  documentationTierName: string | null;
  nextTier: DocumentationTier | null;
  nextTierName: string | null;
  criteria: DocumentationCriterionResult[];
  satisfiedCriteria: DocumentationCriterionResult[];
  missingCriteria: DocumentationCriterionResult[];
  evidenceUsed: Array<DocumentationEvidenceReference & { criterionId: string }>;
  actions: DocumentationPriorityAction[];
  warnings: string[];
  measurement: DocumentationEffectMeasurement;
  contentHash: string;
  projectionStatus?: 'active' | 'withdrawn';
}

export interface RegistryDocumentationSummary {
  schemaVersion: 'registry-documentation-summary@1.0.0';
  registryId: string;
  organizationId: string;
  referenceCurrency: 'EUR';
  asOfDate: string;
  generatedAt: string;
  visibility: 'secret';
  authorizationScope: { registry: boolean; cartularyIds: string[]; collectionIds: string[] };
  securedValue: number;
  exposedValue: number;
  distributionByTier: Record<DocumentationTier, number>;
  belowP0Count: number;
  eligibleLineCount: number;
  lines: Array<{
    cartularyId: string;
    displayTitle: string;
    assetType: string;
    collectionId: string;
    collectionIds: string[];
    marketValue: number;
    currency: 'EUR';
    documentationTier: DocumentationTier | null;
    documentationTierName: string | null;
    sourceRevision: number;
    assessmentHash: string;
    valuationHash: string;
    actions: DocumentationPriorityAction[];
  }>;
  priorityActions: DocumentationPriorityAction[];
  excludedLines: Array<{ cartularyId: string; displayTitle: string; reasons: string[] }>;
  measurement: DocumentationEffectMeasurement;
  tierHistory: { status: 'unavailable'; reason: string; points: [] };
  sourceProjectionHashes: string[];
  contentHash: string;
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
