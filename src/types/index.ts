// Visibilité
export type VisibilityLevel = 'Secret' | 'Communauté' | 'Tous';

// Statut de possession (PieceStatus)
export type PieceStatus = 'InPossession' | 'OnDeposit' | 'Lost' | 'Stolen' | 'Destroyed' | 'Recovered' | 'Transferred';

// Statut de preuve
export type ProofStatus = 'Observé' | 'Documented' | 'Déclaré' | 'Estimé' | 'Non vérifié' | 'Contesté';

// Niveau de confiance
export type ConfidenceLevel = 'Faible' | 'Moyenne' | 'Forte';

// Statut du Sceau
export type SealStatus = 'Draft' | 'Issued' | 'Superseded' | 'Revoked' | 'Expired';

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface Organization {
  id: string;
  name: string;
}

export interface Registry {
  id: string;
  name: string;
}

export interface Collection {
  id: string;
  name: string;
  visibility: VisibilityLevel;
}

export interface Seal {
  id: string;
  status: SealStatus;
  hash: string;
  qrCodeUrl: string;
  issuedAt: string;
  supportCode: string;
}

export interface SectionPolicy {
  sectionId: string;
  visibility: VisibilityLevel;
  sensitiveFieldPolicies?: Record<string, VisibilityLevel>;
}

// Un même média peut remplir plusieurs rôles dans le Cartulaire.
// Les numéros suivent la taxonomie fonctionnelle validée pour les écrans.
export type MediaTag =
  | 'main-photo'
  | 'main-video'
  | 'spin-3d'
  | 'slideshow'
  | 'accessories'
  | 'documentation'
  | 'other';

// Alias conservé pour les éventuels consommateurs existants du prototype.
export type MediaRole = MediaTag;

export type MediaSubject = 'cadran' | 'boite' | 'mouvement' | 'bracelet' | 'defaut' | 'ensemble' | 'accessoire' | 'documentation';

export interface Asset {
  id: string;
  name: string;
  url: string;
  thumbnailUrl?: string;
  type: 'image' | 'video' | 'document';
  ratio?: '3:4' | '4:5' | '16:9';
  hash: string;
  status: 'Initiated' | 'Uploading' | 'Quarantine' | 'Processing' | 'Archived' | 'Failed' | 'Deleted';
  visibility: VisibilityLevel;
  tags: MediaTag[];
  category?: MediaSubject;
  posterUrl?: string;
  description?: string;
  capturedAt?: string;
  duration?: string;
  fileSize?: string;
  mimeType?: string;
  originalFileName?: string;
  metadataTimestamp?: string;
  timestampSource?: 'file.lastModified' | 'exif.DateTimeOriginal' | 'exif.CreateDate' | 'catalogue';
  binaryId?: string;
  localAvailability?: 'available' | 'missing';
  cloudStoragePath?: string;
  derivativeStatus?: 'not-required' | 'pending' | 'ready' | 'failed';
  sourceSection?: 'reference-report';
}

export interface SpinSet {
  id: string;
  images: Asset[];
  angles: number[];
  posterImageUrl: string;
  isComplete: boolean;
  visibility: VisibilityLevel;
}

export interface Observation {
  id: string;
  component: string;
  description: string;
  assetId?: string;
  proofStatus: ProofStatus;
  confidence: ConfidenceLevel;
  date: string;
}

export interface Valuation {
  id: string;
  date: string;
  lowValue: number;
  midValue: number;
  highValue: number;
  currency: string;
  confidence: ConfidenceLevel;
  source: string;
  visibility: VisibilityLevel;
}

export interface WatchReference {
  brand: string;
  model: string;
  reference: string;
  caliber: string;
  powerReserve: string;
  material: string;
  diameter: number; // in mm
  thickness: number; // in mm
  waterResistance: string; // e.g. "100m"
}

export interface WatchInstance {
  serialNumber: string;
  publicCode: string;
  status: PieceStatus;
  acquisitionDate: string;
  acquisitionPrice?: number;
  currency?: string;
  lastVerificationDate: string;
  reference: WatchReference;
  observations: Observation[];
  valuations: Valuation[];
  reminders: any[];
}

export interface MediaDossier {
  id: string;
  date: string;
  title: string;
  summary: string;
  assetIds: string[];
  author: string;
  status: 'Draft' | 'Reviewed' | 'Sealed';
}

export interface ComparableTransaction {
  id: string;
  date: string;
  channel: string;
  description: string;
  amount: number;
  currency: string;
  condition: string;
  sourceType: 'Transaction' | 'Annonce' | 'Estimation';
  source: string;
  saleChannel: 'Annonce' | 'Enchère' | 'Vente privée' | 'Marchand';
}

export interface MarketSnapshot {
  date: string;
  activeListings: number;
  observedTransactions90d: number;
  medianDaysOnMarket: number;
  lowValue: number;
  midValue: number;
  highValue: number;
  currency: string;
}

export interface ConditionReport {
  id: string;
  date: string;
  title: string;
  score: number;
  summary: string;
  dossierId: string;
}

export interface InsuranceCoverage {
  status: 'Active' | 'Expired' | 'Pending';
  insurer: string;
  insuredValue: number;
  deductible: number;
  currency: string;
  renewalDate: string;
}

export interface LocationRecord {
  city: string;
  country: string;
  storageType: string;
  verifiedAt: string;
  visibility: VisibilityLevel;
}

export interface Cartulary {
  id: string;
  publicCode: string;
  watchInstance: WatchInstance;
  sections: Record<string, SectionPolicy>;
  assets: Asset[];
  spinSet?: SpinSet;
  mediaDossiers: MediaDossier[];
  comparables: ComparableTransaction[];
  marketSnapshot: MarketSnapshot;
  conditionReports: ConditionReport[];
  insurance: InsuranceCoverage;
  location: LocationRecord;
  seal?: Seal;
  visibility: VisibilityLevel;
}

// Interface pour le journal d'audit chaîné (Integrity Journal)
export interface AuditEvent {
  id: string;
  cartularyId: string;
  timestamp: string;
  action: string;
  actorId: string;
  details: string;
  resource: {
    type: string;
    id: string;
    changedSections?: string[];
  };
  revision: number;
  beforeDigest: string | null;
  afterDigest: string;
  previousHash: string;
  hash: string;
  sequence: number;
  version: '2.0';
  canonicalizationVersion: 'jcs-1';
  requestId: string;
}
