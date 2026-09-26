import { render, renderHook, act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryCollections } from '../../src/features/registry/RegistryCollections.tsx';
import { RegistryComparison } from '../../src/features/registry/RegistryComparison.tsx';
import { useLatestValuationSnapshot } from '../../src/features/registry/useLatestValuationSnapshot.ts';

const state = vi.hoisted(() => ({ items: [] as any[], collections: [] as any[], snapshots: [] as any[], valuations: [] as any[], observe: vi.fn(), observeItems: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../../src/services/registryValuation.ts', () => ({ observeRegistryValuationSnapshots: (...args: any[]) => state.observe(...args), observeRegistryValuationItems: (...args: any[]) => state.observeItems(...args) }));
vi.mock('../../src/services/projections.ts', () => ({ observeRegistryItems: (_id: string, next: any) => { next(state.items); return () => {}; }, loadRegistryItems: async () => state.items }));
vi.mock('../../src/services/collections.ts', () => ({ observeRegistryCollections: (_id: string, next: any) => { next(state.collections); return () => {}; }, deleteRegistryCollection: vi.fn(), saveRegistryCollection: vi.fn(), normalizeCollectionSlug: (name: string) => name }));
const registry = { id: 'reg_test', organizationId: 'org_test', name: 'Registre test', referenceCurrency: 'EUR' } as any;
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/registry/reg_test/compare?items=a,b');
  state.items = ['a','b','c'].map(id => ({ cartularyId: id, registryId: 'reg_test', organizationId: 'org_test', displayTitle: `Objet ${id}`, collectionId: 'col_one', collectionIds: ['col_one'], assetType: 'watch', projectionStatus: 'active', possessionStatus: 'in_possession', lifecycleStatus: 'active', completenessLevel: 'documented', sourceRevision: 1 }));
  state.collections = [{ id: 'col_one', name: 'Collection test', status: 'draft', visibility: 'secret', publishedCartularyIds: [] }];
  state.snapshots = [{ asOfDate: '2026-09-26', lines: [{ cartularyId: 'a', marketValue: 100, observedAt: '2026-09-01', sourceLabel: 'Expertise' }, { cartularyId: 'b', marketValue: 200, observedAt: '2026-09-02', sourceLabel: 'Rapport' }, { cartularyId: 'elsewhere', marketValue: 99999 }] }];
  state.observe.mockImplementation((_id, next) => { next(state.snapshots); return state.unsubscribe; });
  state.valuations = state.snapshots[0].lines.map((line: any) => ({ ...line, registryId: 'reg_test', organizationId: 'org_test', sourceRevision: 1, projectionStatus: 'active', marketValue: { amount: line.marketValue, currency: 'EUR' } }));
  state.observeItems.mockImplementation((_id, next) => { next(state.valuations); return state.unsubscribe; });
});
describe('Jams 27 et 29 : valeurs privées dans les vues du Registre', () => {
  it('calcule le total couvert de la Collection sans inclure un objet extérieur et signale la partie manquante', async () => {
    render(<RegistryCollections registry={registry} canManage={false} canReadValuation />);
    const value = await screen.findByLabelText('Valeur de la collection Collection test');
    expect(value.textContent).toContain('300');
    expect(value.textContent).toContain('2/3 objet(s) couverts · total partiel');
    expect(value.textContent).toContain('Valeurs brutes retenues');
    expect(value.textContent).toContain('Objet c : Valeur brute non renseignée');
    expect(value.textContent).not.toContain('99999');
  });
  it('affiche la valeur et sa source dans la comparaison ; une valeur absente reste absente', async () => {
    state.snapshots[0].lines = [state.snapshots[0].lines[0]];
    render(<RegistryComparison registry={registry} canReadValuation />);
    const row = await screen.findByRole('row', { name: /Valeur de marché/ });
    expect(row.textContent).toContain('100');
    expect(row.textContent).toContain('2026-09-01 · Expertise');
    expect(within(row).getByText('Absente de cet arrêté')).toBeTruthy();
  });
  it('ne lit et ne rend aucune valeur sans le droit valuation.read', () => {
    render(<><RegistryCollections registry={registry} canManage={false} /><RegistryComparison registry={registry} /></>);
    expect(state.observe).not.toHaveBeenCalled();
    expect(state.observeItems).not.toHaveBeenCalled();
    expect(screen.queryByText(/Valeur de marché/)).toBeNull();
    expect(screen.queryByLabelText('Valeur de la collection Collection test')).toBeNull();
  });
  it('retire le résultat dès la révocation du droit et ignore un ancien abonnement', () => {
    let receive: any;
    state.observe.mockImplementation((_id, next) => { receive = next; return state.unsubscribe; });
    const view = renderHook(({ allowed }) => useLatestValuationSnapshot('reg_test', allowed), { initialProps: { allowed: true } });
    act(() => receive(state.snapshots));
    expect(view.result.current.snapshot?.asOfDate).toBe('2026-09-26');
    view.rerender({ allowed: false });
    act(() => receive(state.snapshots));
    expect(view.result.current.snapshot).toBeNull();
    expect(state.unsubscribe).toHaveBeenCalled();
  });
});
