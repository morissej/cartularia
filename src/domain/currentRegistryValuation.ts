import type { RegistryItemProjection, RegistryValuationItemProjection } from './projections.ts';

export type CurrentValuationIssue = 'missing_value' | 'missing_currency' | 'currency_mismatch' | 'inactive_valuation' | 'stale_valuation';
export const CURRENT_VALUATION_ISSUE_LABELS: Record<CurrentValuationIssue, string> = {
  missing_value: 'Valeur brute non renseignée',
  missing_currency: 'Devise non renseignée',
  currency_mismatch: 'Devise différente de celle du Registre',
  inactive_valuation: 'Valorisation retirée',
  stale_valuation: 'Valorisation en cours d’actualisation',
};

export interface CurrentRegistryValuationLine {
  cartularyId: string;
  displayTitle: string;
  assetType: string;
  collectionIds: string[];
  amount: number | null;
  currency: string | null;
  issue: CurrentValuationIssue | null;
  documentationIncomplete: boolean;
}

export const summarizeCurrentValuation = (lines: CurrentRegistryValuationLine[]) => {
  const included = lines.filter((line) => !line.issue && line.amount !== null);
  return {
    lines,
    total: included.length || lines.length === 0 ? included.reduce((sum, line) => sum + Math.round(line.amount! * 100), 0) / 100 : null,
    itemCount: lines.length,
    includedCount: included.length,
    missingCount: lines.length - included.length,
    documentationIncompleteCount: included.filter((line) => line.documentationIncomplete).length,
  };
};

export type CurrentRegistryValuation = ReturnType<typeof summarizeCurrentValuation>;

const amountOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const currencyOrNull = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : null;

/** L'inventaire est la base du calcul : une valorisation absente ne fait jamais disparaître un objet. */
export const buildCurrentRegistryValuation = (
  items: RegistryItemProjection[],
  valuations: RegistryValuationItemProjection[],
  registryId: string,
  referenceCurrency: string,
): CurrentRegistryValuation => {
  const activeItems = new Map(items.filter((item) => item.registryId === registryId && item.projectionStatus === 'active').map((item) => [item.cartularyId, item]));
  const byId = new Map(valuations.filter((value) => value.registryId === registryId).map((value) => [value.cartularyId, value]));
  const lines = [...activeItems.values()].map((item): CurrentRegistryValuationLine => {
    const candidate = byId.get(item.cartularyId);
    const valuation = candidate?.organizationId === item.organizationId ? candidate : undefined;
    // Compatibilité en lecture seule avec les anciens items : ne jamais y réécrire de données financières.
    const legacy = item as RegistryItemProjection & { grossValuation?: number; valuationCurrency?: string };
    const value = valuation
      ? valuation.currentValue ?? valuation.marketValue
      : { amount: legacy.grossValuation, currency: legacy.valuationCurrency };
    const amount = amountOrNull(value?.amount);
    const currency = currencyOrNull(value?.currency);
    const issue = valuation?.projectionStatus === 'withdrawn' ? 'inactive_valuation'
      : valuation && valuation.sourceRevision < item.sourceRevision ? 'stale_valuation'
        : amount === null ? 'missing_value'
          : !currency ? 'missing_currency'
            : currency !== referenceCurrency ? 'currency_mismatch' : null;
    const metadata = valuation?.marketValue;
    return {
      cartularyId: item.cartularyId,
      displayTitle: item.displayTitle,
      assetType: item.assetType,
      collectionIds: [...new Set([...(item.collectionIds || []), item.collectionId].filter(Boolean))],
      amount,
      currency,
      issue,
      documentationIncomplete: !metadata?.level || !metadata.observedAt || !metadata.sourceLabel || !metadata.confidence || !metadata.currency,
    };
  });
  return summarizeCurrentValuation(lines);
};
