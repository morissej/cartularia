export const ASSET_TYPE_LABELS: Record<string, string> = {
  watch: 'Montre',
  car: 'Véhicule',
  wine: 'Vin',
  art: 'Art',
  real_estate: 'Immobilier',
  other: 'Autre actif',
};

export const LIFECYCLE_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  review: 'À vérifier',
  active: 'Actif',
  suspended: 'Suspendu',
  transferred: 'Transféré',
  archived: 'Archivé',
};

export const POSSESSION_LABELS: Record<string, string> = {
  in_possession: 'En possession',
  on_deposit: 'En dépôt',
  lost: 'Perdu',
  stolen: 'Volé',
  destroyed: 'Détruit',
  recovered: 'Retrouvé',
  transferred: 'Transféré',
};

export const COMPLETENESS_LABELS: Record<string, string> = {
  imported_unreviewed: 'Import à vérifier',
  partial: 'Partiel',
  complete: 'Complet',
};

export const labelFromIdentifier = (value: string) => value
  .replace(/^col_/, '')
  .split(/[_-]+/)
  .filter(Boolean)
  .map((part) => `${part.charAt(0).toLocaleUpperCase('fr')}${part.slice(1)}`)
  .join(' ');

export const assetTypeLabel = (value: string) => ASSET_TYPE_LABELS[value] || labelFromIdentifier(value);
export const lifecycleLabel = (value: string) => LIFECYCLE_LABELS[value] || labelFromIdentifier(value);
export const completenessLabel = (value: string) => COMPLETENESS_LABELS[value] || labelFromIdentifier(value);
