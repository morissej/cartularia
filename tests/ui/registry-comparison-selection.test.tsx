import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryItems } from '../../src/features/registry/RegistryItems';
// Extension explicite : sur un système de fichiers insensible à la casse, « RegistryComparison »
// sans extension résoudrait registryComparison.ts (fonctions pures) au lieu du composant.
import { RegistryComparison } from '../../src/features/registry/RegistryComparison.tsx';
import {
  announceComparisonSelection,
  COMPARISON_SELECTION_EVENT,
  useComparisonSelectionCount,
} from '../../src/features/registry/comparisonSelection';
import type { RegistryDocument } from '../../src/domain/foundations';

const state = vi.hoisted(() => ({ items: [] as any[], collections: [] as any[], published: vi.fn() }));
vi.mock('../../src/services/collections', () => ({
  observeRegistryCollections: vi.fn((_id, next) => { next(state.collections); return () => {}; }),
  deleteRegistryCollection: vi.fn(), saveRegistryCollection: vi.fn(), normalizeCollectionSlug: (name: string) => name,
}));
vi.mock('../../src/services/projections', () => ({
  observeRegistryItems: vi.fn((_id, next) => { next(state.items); return () => {}; }),
  loadRegistryItems: vi.fn(async () => state.items), loadScopedRegistryItems: vi.fn(async () => state.items),
  loadPublicPublicationStatuses: (...args: unknown[]) => state.published(...args),
}));

const registry = { id: 'reg_demo', organizationId: 'org_demo', name: 'Registre test' } as RegistryDocument;
const item = (cartularyId: string, displayTitle: string) => ({
  cartularyId, registryId: 'reg_demo', organizationId: 'org_demo', collectionId: 'col_demo', assetType: 'watch', displayTitle, makerName: 'Maison', modelName: 'Modèle', objectCode: `OBJ-${cartularyId}`, referenceCode: 'REF', manufactureYear: 2000, lifecycleStatus: 'active', patrimonialStatus: 'Patrimonial', possessionStatus: 'in_possession', completenessLevel: 'documented', projectionStatus: 'active', sourceRevision: 1, contentHash: 'sha256:x', updatedAt: '2026-01-01T00:00:00.000Z',
});

const listenCounts = () => {
  const counts: number[] = [];
  const listener = (event: Event) => counts.push((event as CustomEvent<{ ids: string[] }>).detail.ids.length);
  window.addEventListener(COMPARISON_SELECTION_EVENT, listener);
  return { counts, stop: () => window.removeEventListener(COMPARISON_SELECTION_EVENT, listener) };
};

beforeEach(() => {
  window.history.replaceState(null, '', '/registry/reg_demo/items');
  state.items = [item('cart_a', 'Montre A'), item('cart_b', 'Montre B')];
  state.collections = [];
  state.published.mockResolvedValue({});
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

describe('sélection de comparaison partagée avec la coquille du Registre', () => {
  it('le compteur se lit dans l’URL puis suit les annonces des vues, sans persistance', () => {
    window.history.replaceState(null, '', '/registry/reg_demo/items?compare=a,b');
    const { result } = renderHook(() => useComparisonSelectionCount());
    expect(result.current.count).toBe(2);
    expect(result.current.ids).toEqual(['a', 'b']);
    act(() => announceComparisonSelection(['a']));
    expect(result.current.count).toBe(1);
    act(() => announceComparisonSelection([]));
    expect(result.current.count).toBe(0);
    act(() => { window.history.pushState(null, '', '/registry/reg_demo/compare?items=x,y,z'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(result.current.count).toBe(3);
    expect(window.localStorage.length).toBe(0);
  });

  it('le Catalogue annonce chaque changement de sélection et vide la sélection quand il disparaît', async () => {
    const listening = listenCounts();
    const user = userEvent.setup();
    const { unmount } = render(<RegistryItems registry={registry} />);
    const buttons = await screen.findAllByRole('button', { name: 'Ajouter à la comparaison' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[0]);
    await waitFor(() => expect(listening.counts.at(-1)).toBe(1));
    expect(window.location.search).toContain('compare=cart_a');
    await user.click(screen.getAllByRole('button', { name: 'Ajouter à la comparaison' })[0]);
    await waitFor(() => expect(listening.counts.at(-1)).toBe(2));
    unmount();
    expect(listening.counts.at(-1)).toBe(0);
    listening.stop();
  });

  it('la Comparaison annonce la sélection lue dans son URL', async () => {
    window.history.replaceState(null, '', '/registry/reg_demo/compare?items=cart_a,cart_b');
    const listening = listenCounts();
    render(<RegistryComparison registry={registry} />);
    await screen.findByRole('heading', { name: 'Comparer les Cartulaires' });
    await waitFor(() => expect(listening.counts.at(-1)).toBe(2));
    expect(screen.getByText('Comparaison', { selector: '.registry-kicker' })).toBeTruthy();
    listening.stop();
  });
});
