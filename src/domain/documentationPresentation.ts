import type { DocumentationTier } from './projections.ts';

export const DOCUMENTATION_LEVEL_LABELS: Record<DocumentationTier, string> = {
  P0: 'Dossier minimal',
  P1: 'Identité établie',
  P2: 'Dossier tenu',
  P3: 'Dossier daté',
  P4: 'Dossier certifié',
};

export const documentationLevelLabel = (level: DocumentationTier | null) =>
  level ? DOCUMENTATION_LEVEL_LABELS[level] : 'Documents de base à réunir';

// The stored assessment can contain older development labels. Translate those
// at the presentation boundary without changing its evidence or hash.
export const DOCUMENTATION_CRITERION_COPY: Record<string, { label: string; action: string; expectedProof: string }> = {
  dated_condition_report_dev03: { label: 'Constat d’état daté', action: 'Faire établir un constat d’état daté.', expectedProof: 'Constat d’état daté, accompagné de ses sources.' },
  dated_sourced_valuation_dev04: { label: 'Évaluation datée et sourcée', action: 'Faire établir une évaluation datée et sourcée.', expectedProof: 'Évaluation datée avec ses sources et son auteur.' },
};

export const VALUATION_EXCLUSION_LABELS: Record<string, string> = {
  missing_amount: 'Montant absent',
  missing_currency: 'Devise absente',
  missing_level: 'Origine de l’évaluation non précisée',
  missing_date: 'Date de l’évaluation absente',
  missing_source: 'Source de l’évaluation absente',
  missing_confidence: 'Fiabilité de l’évaluation non précisée',
  currency_mismatch: 'Devise différente de celle de l’arrêté',
  value_after_statement: 'Valeur postérieure à la date de l’arrêté',
  inactive_projection: 'Valeur retirée du Registre',
  documentation_profile_not_configured: 'Évaluation des documents indisponible pour ce type d’objet',
  documentation_not_evaluated: 'Documents pas encore évalués',
};

export const valuationExclusionLabel = (reason: string) =>
  VALUATION_EXCLUSION_LABELS[reason] || 'Informations insuffisantes pour cette synthèse';
