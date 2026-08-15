export const CARTULARY_MODEL_VERSION = '1.0.0';

export type CartularyAssetType = 'watch' | 'car' | 'wine' | 'art' | 'real_estate' | 'other';
export type CartularyVisibility = 'secret' | 'community' | 'public';
export type CartularyLifecycleStatus = 'draft' | 'review' | 'active' | 'suspended' | 'transferred' | 'archived';
export type CartularyPossessionStatus =
  | 'in_possession'
  | 'on_deposit'
  | 'lost'
  | 'stolen'
  | 'destroyed'
  | 'recovered'
  | 'transferred';
export type CartularyPublicationStatus = 'none' | 'draft' | 'published' | 'suspended' | 'revoked';
export type CartularyProofStatus =
  | 'observed'
  | 'documented'
  | 'declared'
  | 'estimated'
  | 'unverified'
  | 'contested';
export type CartularyConfidence = 'low' | 'medium' | 'high';

export interface ProvenancedValue<T> {
  value: T;
  proofStatus: CartularyProofStatus;
  confidence: CartularyConfidence;
  sourceRefs: string[];
  observedAt: string;
  assertedBy: string;
  visibility: CartularyVisibility;
}

export interface CartularyEnvelope {
  id: string;
  organizationId: string;
  registryId: string;
  collectionId: string;
  assetType: CartularyAssetType;
  schemaId: string;
  schemaVersion: string;
  publicCode: string;
  displayTitle: string;
  makerName: string;
  modelName: string;
  referenceCode: string | null;
  manufactureYear: number | null;
  accountHolderId: string;
  legalOwnerRelationId: string;
  lifecycleStatus: CartularyLifecycleStatus;
  possessionStatus: CartularyPossessionStatus;
  defaultVisibility: 'secret';
  publicationStatus: CartularyPublicationStatus;
  primaryAssetId: string | null;
  completenessLevel: 'imported_unreviewed';
  lastVerifiedAt: string | null;
  revision: 1;
  integrityHead: string;
  integritySequence: 0;
  modelVersion: typeof CARTULARY_MODEL_VERSION;
  deletedAt: null;
}

export interface CartularySectionDocument {
  id: string;
  schemaSectionId: string;
  schemaVersion: string;
  title: string;
  visibility: 'secret';
  status: 'imported_unreviewed' | 'imported_unmapped';
  fields: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  revision: 1;
}

export interface CartularySourceDocument {
  id: string;
  kind: 'prototype_migration' | 'project_document';
  label: string;
  locator: string;
  proofStatus: 'unverified';
  visibility: 'secret';
}

export interface CartularyAssetDocument {
  id: string;
  cartularyId: string;
  organizationId: string;
  originalVersionId: null;
  mediaKind: 'image' | 'video' | 'document';
  displayName: string;
  mimeDeclared: string | null;
  mimeDetected: null;
  sizeBytes: null;
  sha256: null;
  capturedAt: string | null;
  timestampSource: string | null;
  tags: string[];
  componentCode: string | null;
  evidencePurpose: 'prototype_migration';
  processingState: 'pending_binary_reingest';
  visibility: 'secret';
  requestedVisibility: CartularyVisibility;
  sourceRefs: string[];
  accessPolicyVersion: 'wave2-deny-all';
}

export interface CartularySpinSetDocument {
  id: string;
  cartularyId: string;
  organizationId: string;
  assetIds: string[];
  angles: number[];
  posterAssetId: string | null;
  manifestHash: null;
  isComplete: false;
  visibility: 'secret';
  publicationState: 'blocked_pending_binaries';
}

export interface CartularyObservationDocument {
  id: string;
  cartularyId: string;
  component: string;
  description: string;
  assetId: string | null;
  proofStatus: 'unverified';
  importedProofStatus: string;
  confidence: 'low';
  sourceRefs: string[];
  observedAt: string;
  visibility: 'secret';
  reviewStatus: 'pending_human_review';
}

export interface CartularyValuationDocument {
  id: string;
  cartularyId: string;
  observedAt: string;
  lowValue: number;
  midValue: number;
  highValue: number;
  currency: string;
  sourceLabel: string;
  sourceRefs: string[];
  proofStatus: 'unverified';
  confidence: 'low';
  visibility: 'secret';
  reviewStatus: 'pending_human_review';
}

export interface CartularyImportBundle {
  envelope: CartularyEnvelope;
  sections: CartularySectionDocument[];
  sources: CartularySourceDocument[];
  assets: CartularyAssetDocument[];
  spinSets: CartularySpinSetDocument[];
  observations: CartularyObservationDocument[];
  valuations: CartularyValuationDocument[];
  comparables: Array<Record<string, unknown> & { id: string }>;
  reports: Array<Record<string, unknown> & { id: string }>;
  reminders: Array<Record<string, unknown> & { id: string }>;
  ownerRelations: Array<Record<string, unknown> & { id: string }>;
  events: Array<Record<string, unknown> & { id: string }>;
}
