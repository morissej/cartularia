import { act, render, renderHook, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryValuationSummary } from '../../src/features/registry/RegistryValuationSummary.tsx';
import { RegistryCollections } from '../../src/features/registry/RegistryCollections.tsx';
import { useCurrentRegistryValuation } from '../../src/features/registry/useCurrentRegistryValuation.ts';

const fixture = vi.hoisted(() => ({ items: [] as any[], valuations: [] as any[], callbacks: [] as any[], errors: [] as any[], observe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../../src/services/registryValuation.ts', () => ({
  observeRegistryValuationItems: (...args: any[]) => fixture.observe(...args),
  observeRegistryValuationSnapshots: (_id: string, next: any) => {
    next([{ snapshotId: 'historical', asOfDate: '2026-09-26', totalMarketValue: 20750, totalInsuredCapital: 0, coverageGap: 20750, uninsuredLineCount: 1, lowConfidenceShare: 1, lowConfidenceValue: 20750, totalsByLevel: {}, lines: [], excludedLines: [] }]);
    return () => {};
  },
  requestRegistryValuationSnapshot: vi.fn(),
}));
vi.mock('../../src/services/projections.ts', () => ({ observeRegistryItems: (_id: string, next: any) => { next(fixture.items); return () => {}; } }));
vi.mock('../../src/features/registry/useRegistryCollections.ts', () => ({ useRegistryCollections: () => ({ collections: [{ id: 'col_pilots', name: 'Pilots', status: 'draft' }], state: 'ready', retry: vi.fn() }) }));
vi.mock('../../src/services/collections.ts', () => ({ deleteRegistryCollection: vi.fn(), saveRegistryCollection: vi.fn(), normalizeCollectionSlug: (name: string) => name }));

const registry = { id: 'reg_test', organizationId: 'org_test', referenceCurrency: 'EUR', name: 'Registre test' } as any;
const membership = { permissions: ['valuation.read'], roles: [] } as any;
const money = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
beforeEach(() => {
  vi.clearAllMocks();
  fixture.callbacks = []; fixture.errors = [];
  fixture.items = ['rolex', 'iwc'].map(id => ({ cartularyId: id, displayTitle: id === 'rolex' ? 'Rolex GMT-Master' : 'IWC Flieger UTC', registryId: 'reg_test', organizationId: 'org_test', collectionId: 'col_pilots', collectionIds: ['col_pilots'], assetType: 'watch', projectionStatus: 'active', sourceRevision: 5, ...(id === 'iwc' ? { grossValuation: 2500, valuationCurrency: 'EUR' } : {}) }));
  fixture.valuations = [{ ...fixture.items[0], marketValue: { amount: 20750, currency: 'EUR', level: 'ai_proposed', observedAt: '2026-07-18', sourceLabel: 'Note', confidence: 'low' } }];
  fixture.observe.mockImplementation((_id, next, error) => { fixture.callbacks.push(next); fixture.errors.push(error); next(fixture.valuations); return fixture.unsubscribe; });
});

describe('valeur patrimoniale courante du Registre et des Collections', () => {
  it('affiche 23 250 € et deux objets couverts aux deux niveaux, en conservant l’ancien arrêté séparément', async () => {
    render(<><RegistryValuationSummary registry={registry} membership={membership} items={fixture.items} inventoryState="ready" /><RegistryCollections registry={registry} canManage={false} canReadValuation /></>);
    const current = await screen.findByRole('region', { name: 'Valeur patrimoniale' });
    expect(current.textContent).toContain(money(23250));
    expect(current.textContent).toContain('2 objet(s) sur 2 inclus');
    expect(within(current).getByRole('row', { name: /IWC Flieger UTC/ }).textContent).toContain(money(2500));
    const collection = screen.getByLabelText('Valeur de la collection Pilots');
    expect(collection.textContent).toContain(money(23250));
    expect(collection.textContent).toContain('2/2 objet(s) couverts');
    expect(collection.textContent).not.toContain('total partiel');
    const history = screen.getByText('Arrêtés de valeur historiques').closest('details')!;
    expect(history.open).toBe(false);
    expect(history.textContent).toContain(money(20750));
    act(() => fixture.callbacks.forEach(next => next([{ ...fixture.valuations[0], marketValue: { ...fixture.valuations[0].marketValue, amount: 22000 } }])));
    expect(current.textContent).toContain(money(24500));
    expect(collection.textContent).toContain(money(24500));
    expect(history.textContent).toContain(money(20750));
  });

  it('signale nommément la montre sans montant et ne transforme pas une erreur de lecture en total fiable', async () => {
    delete fixture.items[1].grossValuation;
    render(<RegistryValuationSummary registry={registry} membership={membership} items={fixture.items} inventoryState="ready" />);
    const current = await screen.findByRole('region', { name: 'Valeur patrimoniale' });
    expect(current.textContent).toContain('total partiel');
    expect(current.textContent).toContain('1 objet(s) sur 2 inclus');
    expect(within(current).getByRole('row', { name: /IWC Flieger UTC/ }).textContent).toContain('Valeur brute non renseignée');
    act(() => fixture.errors[0](new Error('permission-denied')));
    expect(current.textContent).not.toContain(money(20750));
    expect(within(current).getByRole('alert').textContent).toContain('Le total ne peut pas être confirmé');
  });

  it('ne lit et n’affiche pas les montants sans valuation.read', () => {
    render(<RegistryValuationSummary registry={registry} membership={{ ...membership, permissions: [] }} items={fixture.items} inventoryState="ready" />);
    expect(fixture.observe).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Valeur patrimoniale' })).toBeNull();
  });

  it('masque immédiatement les valeurs lors d’une révocation, d’un changement de Registre ou d’une erreur d’inventaire', () => {
    const view = renderHook(({ id, allowed, inventoryState }) => useCurrentRegistryValuation(id, 'EUR', fixture.items, inventoryState, allowed), { initialProps: { id: 'reg_test', allowed: true, inventoryState: 'ready' as 'loading' | 'ready' | 'error' } });
    expect(view.result.current.summary?.total).toBe(23250);
    const late = fixture.callbacks[0];
    view.rerender({ id: 'reg_test', allowed: false, inventoryState: 'ready' });
    act(() => late(fixture.valuations));
    expect(view.result.current.summary).toBeNull();
    expect(fixture.unsubscribe).toHaveBeenCalled();
    fixture.observe.mockImplementation((_id, next) => { fixture.callbacks.push(next); return fixture.unsubscribe; });
    view.rerender({ id: 'reg_other', allowed: true, inventoryState: 'ready' });
    expect(view.result.current.summary).toBeNull();
    act(() => late(fixture.valuations));
    expect(view.result.current.summary).toBeNull();
    view.rerender({ id: 'reg_other', allowed: true, inventoryState: 'error' });
    expect(view.result.current.state).toBe('error');
    expect(view.result.current.summary).toBeNull();
  });
});
