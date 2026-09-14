import { useEffect, useState } from 'react';
import { sanitizeComparisonIds } from './registryComparison.ts';

/**
 * Sélection de comparaison partagée entre les vues et la coquille du Registre.
 *
 * La sélection vit volontairement dans l'URL de la vue courante (`?compare=` sur le
 * Catalogue, `?items=` sur la Comparaison) et n'est jamais persistée. La coquille ne se
 * rerend pas quand une vue met l'URL à jour par `replaceState` : chaque vue annonce donc
 * sa sélection par un événement DOM, et la barre latérale l'écoute. Un seul émetteur par vue.
 */
export const COMPARISON_SELECTION_EVENT = 'cartularia:registry-comparison-selection';

export interface ComparisonSelectionDetail {
  ids: string[];
}

export interface ComparisonSelectionState {
  ids: string[];
  count: number;
}

const EMPTY_SELECTION: ComparisonSelectionState = { ids: [], count: 0 };

export const readComparisonSelectionIds = (search: string): string[] => {
  const params = new URLSearchParams(search);
  return sanitizeComparisonIds(params.get('compare') ?? params.get('items'));
};

export const readComparisonSelectionCount = (search: string) => readComparisonSelectionIds(search).length;

const toState = (ids: readonly string[]): ComparisonSelectionState => {
  const sanitized = sanitizeComparisonIds([...ids]);
  return sanitized.length === 0 ? EMPTY_SELECTION : { ids: sanitized, count: sanitized.length };
};

export const announceComparisonSelection = (ids: readonly string[]) => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const detail: ComparisonSelectionDetail = { ids: sanitizeComparisonIds([...ids]) };
  window.dispatchEvent(new CustomEvent<ComparisonSelectionDetail>(COMPARISON_SELECTION_EVENT, { detail }));
};

/**
 * Suit la sélection de comparaison annoncée par la vue courante ; initialisée depuis l'URL,
 * mise à jour par l'événement d'annonce et par la navigation historique.
 */
export const useComparisonSelectionCount = (): ComparisonSelectionState => {
  const [state, setState] = useState<ComparisonSelectionState>(() => (
    typeof window === 'undefined' ? EMPTY_SELECTION : toState(readComparisonSelectionIds(window.location.search))
  ));

  useEffect(() => {
    const handleAnnouncement = (event: Event) => {
      const detail = (event as CustomEvent<Partial<ComparisonSelectionDetail>>).detail;
      setState(toState(Array.isArray(detail?.ids) ? detail.ids : []));
    };
    const handleHistory = () => setState(toState(readComparisonSelectionIds(window.location.search)));
    window.addEventListener(COMPARISON_SELECTION_EVENT, handleAnnouncement);
    window.addEventListener('popstate', handleHistory);
    return () => {
      window.removeEventListener(COMPARISON_SELECTION_EVENT, handleAnnouncement);
      window.removeEventListener('popstate', handleHistory);
    };
  }, []);

  return state;
};
