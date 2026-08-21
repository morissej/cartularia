export interface PublicationSourceBinding {
  revision: number;
  digest: string;
  updatedAt: string;
}

export interface IdentificationCheck {
  id: string;
  title: string;
  note: string;
  checked: boolean;
}

export interface ConditionAttachment {
  id?: string;
  name: string;
  size?: number;
  type?: string;
  url?: string;
  binaryId?: string;
  sha256?: string;
}

export interface ConditionEntry {
  id: string;
  date: string;
  title: string;
  note: string;
  attachments: ConditionAttachment[];
}

export type DocumentationCategory = 'Facture' | 'Garantie' | 'Assurances' | 'Boîte' | 'Écrin' | 'Manuel' | 'Certificat' | 'Accessoire' | 'Autre';
export type DocumentationState = 'Présent' | 'Complet' | 'Incomplet' | 'Manquant' | 'À vérifier';

export interface DocumentationItem {
  id: string;
  category: DocumentationCategory;
  description: string;
  state: DocumentationState;
}

export interface OwnerField {
  id: string;
  label: string;
  value: string;
}

export type OwnerType = 'Personne physique' | 'Entreprise';
export type WatchPatrimonialStatus = 'Patrimonial' | 'À vendre' | 'Ouvert à proposition';
export type AssetKind = 'Montre' | 'Voiture' | 'Vin' | 'Sculpture' | 'Peinture' | 'Photographie' | 'Meuble' | 'Autre art' | 'Bien immobilier' | 'Autre';

export interface TransmissionRecipient {
  id: string;
  firstName: string;
  lastName: string;
  address: string;
  email: string;
  phone: string;
  percentage: number | '';
}

export interface OwnerDocument {
  id: string;
  category: string;
  fileName: string;
  size: number;
  type: string;
  url?: string;
  binaryId?: string;
  sha256?: string;
}

export interface MarketDepthState {
  analysisDate: string;
  activeListings: number;
  transactions12m: number;
  medianDaysOnMarket: number;
  lowValue: number;
  midValue: number;
  highValue: number;
}

export interface RetainedValuationState {
  amount: number;
  saleCostAmount: number;
  taxAmount: number;
  explanation: string;
}

export interface StorageLocation {
  id: string;
  name: string;
  contents: string;
  description: string;
}

export interface PurchaseState {
  date: string;
  purchasePrice: number;
}

export interface PurchaseExpense {
  id: string;
  kind: 'Révision' | 'Assurance' | 'Coûts de conservation' | 'Autre';
  date: string;
  label: string;
  amount: number;
}

export interface ExitAssumptions {
  saleDate: string;
  salePrice: number;
  disposalCostPct: number;
}

export interface ComparableAnalysisEntry {
  id: string;
  angle: string;
  finding: string;
  reading: string;
}
