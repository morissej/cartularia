import { useCallback } from 'react';
import type { ComparableTransaction, Valuation } from '../../../types';
import type {
  ComparableAnalysisEntry,
  ExitAssumptions,
  MarketDepthState,
  PurchaseExpense,
  PurchaseState,
  RetainedValuationState,
} from './cartularyStateTypes';
import { usePersistentCartularyState } from './usePersistentCartularyState';

interface ValuationStateOptions {
  loadMarketHistory: () => Valuation[];
  loadMarketDepth: () => MarketDepthState;
  loadComparables: () => ComparableTransaction[];
  loadComparableAnalysis: () => ComparableAnalysisEntry[];
  loadSensitivityPrices: () => number[];
  loadSensitivityCosts: () => number[];
  loadRetainedValuation: () => RetainedValuationState;
  loadPurchase: () => PurchaseState;
  loadPurchaseExpenses: () => PurchaseExpense[];
  loadExitAssumptions: () => ExitAssumptions;
}

export const useCartularyValuationState = (options: ValuationStateOptions) => {
  const marketHistory = usePersistentCartularyState({ key: 'cartularia-market-history', load: options.loadMarketHistory });
  const marketDepth = usePersistentCartularyState({ key: 'cartularia-market-depth', load: options.loadMarketDepth });
  const comparables = usePersistentCartularyState({ key: 'cartularia-comparables', load: options.loadComparables });
  const comparableAnalysis = usePersistentCartularyState({ key: 'cartularia-comparable-analysis', load: options.loadComparableAnalysis });
  const sensitivityPrices = usePersistentCartularyState({ key: 'cartularia-sensitivity-prices', load: options.loadSensitivityPrices });
  const sensitivityCosts = usePersistentCartularyState({ key: 'cartularia-sensitivity-costs', load: options.loadSensitivityCosts });
  const retainedValuation = usePersistentCartularyState({ key: 'cartularia-retained-valuation', load: options.loadRetainedValuation });
  const purchase = usePersistentCartularyState({ key: 'cartularia-purchase', load: options.loadPurchase });
  const purchaseExpenses = usePersistentCartularyState({ key: 'cartularia-purchase-expenses', load: options.loadPurchaseExpenses });
  const exitAssumptions = usePersistentCartularyState({ key: 'cartularia-exit-assumptions', load: options.loadExitAssumptions });
  const reloadMarketHistory = marketHistory.reloadIfPresent;
  const reloadMarketDepth = marketDepth.reloadIfPresent;
  const reloadComparables = comparables.reloadIfPresent;
  const reloadComparableAnalysis = comparableAnalysis.reloadIfPresent;
  const reloadSensitivityPrices = sensitivityPrices.reloadIfPresent;
  const reloadSensitivityCosts = sensitivityCosts.reloadIfPresent;
  const reloadRetainedValuation = retainedValuation.reloadIfPresent;
  const reloadPurchase = purchase.reloadIfPresent;
  const reloadPurchaseExpenses = purchaseExpenses.reloadIfPresent;
  const reloadExitAssumptions = exitAssumptions.reloadIfPresent;
  const reloadValuationState = useCallback((keys: ReadonlySet<string>) => [
    reloadMarketHistory(keys),
    reloadMarketDepth(keys),
    reloadComparables(keys),
    reloadComparableAnalysis(keys),
    reloadSensitivityPrices(keys),
    reloadSensitivityCosts(keys),
    reloadRetainedValuation(keys),
    reloadPurchase(keys),
    reloadPurchaseExpenses(keys),
    reloadExitAssumptions(keys),
  ].some(Boolean), [
    reloadMarketHistory,
    reloadMarketDepth,
    reloadComparables,
    reloadComparableAnalysis,
    reloadSensitivityPrices,
    reloadSensitivityCosts,
    reloadRetainedValuation,
    reloadPurchase,
    reloadPurchaseExpenses,
    reloadExitAssumptions,
  ]);

  return {
    marketHistory: marketHistory.value,
    marketDepth: marketDepth.value,
    comparables: comparables.value,
    comparableAnalysis: comparableAnalysis.value,
    sensitivityPrices: sensitivityPrices.value,
    sensitivityCosts: sensitivityCosts.value,
    retainedValuation: retainedValuation.value,
    purchase: purchase.value,
    purchaseExpenses: purchaseExpenses.value,
    exitAssumptions: exitAssumptions.value,
    reloadValuationState,
    commands: {
      replaceMarketHistory: marketHistory.replace,
      setMarketDepth: marketDepth.replace,
      replaceComparables: comparables.replace,
      replaceComparableAnalysis: comparableAnalysis.replace,
      setSensitivityPrices: sensitivityPrices.replace,
      setSensitivityCosts: sensitivityCosts.replace,
      setRetainedValuation: retainedValuation.replace,
      setPurchase: purchase.replace,
      replacePurchaseExpenses: purchaseExpenses.replace,
      setExitAssumptions: exitAssumptions.replace,
      updateMarketHistory: (id: string, patch: Partial<Valuation>) => marketHistory.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateComparable: (id: string, patch: Partial<ComparableTransaction>) => comparables.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateComparableAnalysis: (id: string, patch: Partial<ComparableAnalysisEntry>) => comparableAnalysis.replace((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)),
      updateExpense: <K extends keyof PurchaseExpense>(id: string, key: K, value: PurchaseExpense[K]) => {
        purchaseExpenses.replace((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
      },
    },
  };
};
