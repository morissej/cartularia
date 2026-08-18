export const OWNERSHIP_HISTORY_FIELD_IDS = {
  fromYear: 'cover.ownershipHistory[].fromYear',
  toYear: 'cover.ownershipHistory[].toYear',
  description: 'cover.ownershipHistory[].description',
  firstOwner: 'cover.ownershipHistory[].firstOwner',
  summary: 'cover.ownershipHistory.summary',
  valuationAssessment: 'value.provenance.ownershipAssessment',
} as const;

export interface OwnershipHistoryEntry {
  id: string;
  fromYear: string;
  toYear: string;
  description: string;
  firstOwner: boolean;
}

export const normalizeOwnershipHistory = (value: unknown): OwnershipHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  let firstOwnerFound = false;
  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const entry = candidate as Partial<OwnershipHistoryEntry>;
    const firstOwner = entry.firstOwner === true && !firstOwnerFound;
    if (firstOwner) firstOwnerFound = true;
    return [{
      id: typeof entry.id === 'string' && entry.id ? entry.id : `ownership-history-${index + 1}`,
      fromYear: typeof entry.fromYear === 'string' ? entry.fromYear : '',
      toYear: typeof entry.toYear === 'string' ? entry.toYear : '',
      description: typeof entry.description === 'string' ? entry.description : '',
      firstOwner,
    }];
  });
};

const periodLabel = (entry: OwnershipHistoryEntry, language: 'FR' | 'EN') => {
  const from = entry.fromYear.trim() || (language === 'FR' ? 'année inconnue' : 'unknown year');
  const to = entry.toYear.trim() || (language === 'FR' ? 'aujourd’hui / année inconnue' : 'present / unknown year');
  return language === 'FR' ? `de ${from} à ${to}` : `from ${from} to ${to}`;
};

export const ownershipHistorySummary = (
  entries: readonly OwnershipHistoryEntry[],
  language: 'FR' | 'EN' = 'FR',
) => {
  if (entries.length === 0) {
    return language === 'FR'
      ? 'Historique des propriétaires non renseigné ; la provenance antérieure reste à documenter.'
      : 'Ownership history has not been entered; earlier provenance remains to be documented.';
  }
  const ordered = [...entries].sort((left, right) => (
    (Number(left.fromYear) || Number.MAX_SAFE_INTEGER) - (Number(right.fromYear) || Number.MAX_SAFE_INTEGER)
  ));
  const periods = ordered.map((entry) => {
    const role = entry.firstOwner
      ? (language === 'FR' ? 'premier propriétaire' : 'first owner')
      : (language === 'FR' ? 'propriétaire précédent' : 'previous owner');
    const description = entry.description.trim().replace(/[.;:!?]+$/u, '');
    return `${periodLabel(entry, language)} · ${role}${description ? ` · ${description}` : ''}`;
  });
  return language === 'FR'
    ? `Historique déclaré : ${periods.join(' ; ')}.`
    : `Declared history: ${periods.join('; ')}.`;
};

export const ownershipValuationAssessment = (
  entries: readonly OwnershipHistoryEntry[],
  language: 'FR' | 'EN' = 'FR',
) => {
  if (entries.length === 0) {
    return language === 'FR'
      ? 'Provenance antérieure non documentée : ce manque doit rester une réserve explicite dans l’évaluation et les résumés.'
      : 'Earlier provenance is undocumented: this gap must remain an explicit reservation in valuation and summaries.';
  }
  const firstOwner = entries.find((entry) => entry.firstOwner);
  if (firstOwner) {
    return language === 'FR'
      ? `Premier propriétaire identifié pour la période ${periodLabel(firstOwner, 'FR')}. La continuité de provenance constitue un facteur d’évaluation important, à confirmer par les pièces disponibles avant tout ajustement de valeur.`
      : `The first owner is identified for the period ${periodLabel(firstOwner, 'EN')}. Provenance continuity is an important valuation factor, subject to supporting evidence before any value adjustment.`;
  }
  return language === 'FR'
    ? `${entries.length} période${entries.length > 1 ? 's' : ''} de propriété renseignée${entries.length > 1 ? 's' : ''}, mais le premier propriétaire n’est pas identifié. La chaîne de provenance reste incomplète et doit être reflétée comme réserve d’évaluation.`
    : `${entries.length} ownership period${entries.length > 1 ? 's are' : ' is'} recorded, but the first owner is not identified. The provenance chain remains incomplete and must be reflected as a valuation reservation.`;
};
