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
  imported_unreviewed: 'Données à vérifier',
  partial: 'Partiel',
  complete: 'Complet',
};

/**
 * Explication du signal « à revoir » (P-C5) : une seule source pour le tableau de bord et le catalogue.
 * Chaque affirmation est vérifiée au source (création, projection, synchronisation) ; la deuxième phrase
 * décrit l'action « Marquer comme revu » de la page Accueil du Cartulaire (lot B, `CartularyReviewStatus`),
 * traitée par `syncCartularyToRegistry` : elle n'est vraie qu'avec la fonction redéployée.
 */
export const REVIEW_SIGNAL_EXPLANATION = '« À vérifier » et « Données à vérifier » sont posés à la création de chaque Cartulaire : ses informations sont déclarées par le propriétaire ou importées de son dossier, et n’ont pas encore été revues. Le propriétaire éditeur le lève depuis la page Accueil de son Cartulaire (« Marquer comme revu ») ; il ne bloque ni la consultation, ni l’édition, ni la publication, ni la cession.';

export const labelFromIdentifier = (value: string) => value
  .replace(/^col_/, '')
  .split(/[_-]+/)
  .filter(Boolean)
  .map((part) => `${part.charAt(0).toLocaleUpperCase('fr')}${part.slice(1)}`)
  .join(' ');

export const assetTypeLabel = (value: string) => ASSET_TYPE_LABELS[value] || labelFromIdentifier(value);
export const lifecycleLabel = (value: string) => LIFECYCLE_LABELS[value] || labelFromIdentifier(value);
export const completenessLabel = (value: string) => COMPLETENESS_LABELS[value] || labelFromIdentifier(value);
