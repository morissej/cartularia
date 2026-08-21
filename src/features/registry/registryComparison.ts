import type { RegistryItemProjection } from '../../domain/projections.ts';
import {
  assetTypeLabel,
  COMPLETENESS_LABELS,
  labelFromIdentifier,
  LIFECYCLE_LABELS,
  POSSESSION_LABELS,
} from './registryPresentation.ts';

export const REGISTRY_COMPARISON_MIN = 2;
export const REGISTRY_COMPARISON_MAX = 4;

export type RegistryComparisonFieldId =
  | 'assetType'
  | 'collectionId'
  | 'makerName'
  | 'modelName'
  | 'referenceCode'
  | 'manufactureYear'
  | 'possessionStatus'
  | 'patrimonialStatus'
  | 'lifecycleStatus'
  | 'purchasePrice'
  | 'costBasis'
  | 'grossValuation'
  | 'netValuation'
  | 'netAfterTaxValuation'
  | 'completenessLevel'
  | 'sourceRevision'
  | 'updatedAt';

export interface RegistryComparisonRow {
  id: RegistryComparisonFieldId;
  label: string;
  values: string[];
  allEqual: boolean;
}

export const REGISTRY_COMPARISON_FIELD_IDS: readonly RegistryComparisonFieldId[] = [
  'assetType',
  'collectionId',
  'makerName',
  'modelName',
  'referenceCode',
  'manufactureYear',
  'possessionStatus',
  'patrimonialStatus',
  'lifecycleStatus',
  'purchasePrice',
  'costBasis',
  'grossValuation',
  'netValuation',
  'netAfterTaxValuation',
  'completenessLevel',
  'sourceRevision',
  'updatedAt',
];

export const sanitizeComparisonIds = (
  value: string | string[] | null | undefined,
): string[] => {
  const candidates = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))]
    .slice(0, REGISTRY_COMPARISON_MAX);
};

export const selectRegistryComparisonItems = (
  items: RegistryItemProjection[],
  selectedIds: string[],
): RegistryItemProjection[] => {
  const activeById = new Map(items
    .filter((item) => item.projectionStatus === 'active')
    .map((item) => [item.cartularyId, item]));
  return sanitizeComparisonIds(selectedIds)
    .map((cartularyId) => activeById.get(cartularyId))
    .filter((item): item is RegistryItemProjection => Boolean(item));
};

export const toggleRegistryComparisonId = (
  selectedIds: string[],
  cartularyId: string,
): string[] => {
  const sanitized = sanitizeComparisonIds(selectedIds);
  if (sanitized.includes(cartularyId)) return sanitized.filter((candidate) => candidate !== cartularyId);
  if (sanitized.length >= REGISTRY_COMPARISON_MAX) return sanitized;
  return [...sanitized, cartularyId];
};

const formattedTimestamp = (item: RegistryItemProjection) => {
  if (!item.updatedAt) return 'Non datée';
  const date = new Date(item.updatedAt.seconds * 1_000 + item.updatedAt.nanoseconds / 1_000_000);
  if (Number.isNaN(date.getTime())) return 'Non datée';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
};

const formattedMoney = (item: RegistryItemProjection, value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Non renseignée';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: item.valuationCurrency || 'EUR', maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString('fr-FR')} ${item.valuationCurrency || 'EUR'}`;
  }
};

const FIELD_DEFINITIONS: Array<{
  id: RegistryComparisonFieldId;
  label: string;
  value: (item: RegistryItemProjection) => string;
}> = [
  { id: 'assetType', label: "Type d’actif", value: (item) => assetTypeLabel(item.assetType) },
  { id: 'collectionId', label: 'Collection', value: (item) => labelFromIdentifier(item.collectionId) },
  { id: 'makerName', label: 'Maison ou fabricant', value: (item) => item.makerName || 'Non renseigné' },
  { id: 'modelName', label: 'Modèle', value: (item) => item.modelName || 'Non renseigné' },
  { id: 'referenceCode', label: 'Référence', value: (item) => item.referenceCode || 'Non renseignée' },
  { id: 'manufactureYear', label: 'Année', value: (item) => item.manufactureYear ? String(item.manufactureYear) : 'Non renseignée' },
  { id: 'possessionStatus', label: 'Situation', value: (item) => POSSESSION_LABELS[item.possessionStatus] || labelFromIdentifier(item.possessionStatus) },
  { id: 'patrimonialStatus', label: 'Statut patrimonial', value: (item) => item.patrimonialStatus || 'Non renseigné' },
  { id: 'lifecycleStatus', label: 'État du dossier', value: (item) => LIFECYCLE_LABELS[item.lifecycleStatus] || labelFromIdentifier(item.lifecycleStatus) },
  { id: 'purchasePrice', label: "Prix d’achat", value: (item) => formattedMoney(item, item.purchasePrice) },
  { id: 'costBasis', label: 'Prix de revient', value: (item) => formattedMoney(item, item.costBasis) },
  { id: 'grossValuation', label: 'Valorisation brute', value: (item) => formattedMoney(item, item.grossValuation) },
  { id: 'netValuation', label: 'Valorisation nette après frais de vente', value: (item) => formattedMoney(item, item.netValuation) },
  { id: 'netAfterTaxValuation', label: 'Valorisation nette après impôts', value: (item) => formattedMoney(item, item.netAfterTaxValuation) },
  { id: 'completenessLevel', label: 'Palier de complétude', value: (item) => COMPLETENESS_LABELS[item.completenessLevel] || labelFromIdentifier(item.completenessLevel) },
  { id: 'sourceRevision', label: 'Révision projetée', value: (item) => String(item.sourceRevision) },
  { id: 'updatedAt', label: 'Projection actualisée', value: formattedTimestamp },
];

export const buildRegistryComparisonRows = (
  items: RegistryItemProjection[],
): RegistryComparisonRow[] => FIELD_DEFINITIONS.map((field) => {
  const values = items.map(field.value);
  return {
    id: field.id,
    label: field.label,
    values,
    allEqual: new Set(values).size <= 1,
  };
});

export const buildRegistryComparisonHref = (
  registryId: string,
  selectedIds: string[],
  returnTo?: string,
) => {
  const params = new URLSearchParams();
  const ids = sanitizeComparisonIds(selectedIds);
  if (ids.length > 0) params.set('items', ids.join(','));
  if (returnTo?.startsWith('/registry/') && !returnTo.startsWith('//') && !returnTo.includes('\\')) {
    params.set('returnTo', returnTo);
  }
  const query = params.toString();
  return `/registry/${encodeURIComponent(registryId)}/compare${query ? `?${query}` : ''}`;
};
