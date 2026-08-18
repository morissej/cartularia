import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/persistence/localVault.ts', () => ({
  persistCartulariaJson: vi.fn().mockResolvedValue(undefined),
}));

import { persistCartulariaJson } from '../../src/persistence/localVault.ts';
import { useCartularyConditionState } from '../../src/features/cartulary/state/useCartularyConditionState.ts';
import { useCartularyMediaState } from '../../src/features/cartulary/state/useCartularyMediaState.ts';
import { useCartularyOwnerState } from '../../src/features/cartulary/state/useCartularyOwnerState.ts';
import { useCartularyPublicationState } from '../../src/features/cartulary/state/useCartularyPublicationState.ts';
import { useCartularyValuationState } from '../../src/features/cartulary/state/useCartularyValuationState.ts';
import type { Asset } from '../../src/types/index.ts';

const mediaAsset: Asset = {
  id: 'media-1',
  name: 'Face',
  url: 'blob:face',
  thumbnailUrl: 'blob:thumbnail',
  posterUrl: 'blob:poster',
  type: 'image',
  hash: 'hash',
  status: 'Archived',
  visibility: 'Secret',
  tags: [],
  binaryId: 'binary-1',
};

describe('hooks de domaine du Cartulaire', () => {
  beforeEach(() => vi.mocked(persistCartulariaJson).mockClear());

  it('conserve la clé média et exclut les URL blob de la persistance', async () => {
    const { result } = renderHook(() => useCartularyMediaState({ loadAssets: () => [mediaAsset] }));

    act(() => result.current.commands.toggleAssetTag('media-1', 'main-photo'));
    expect(result.current.mediaAssets[0].tags).toEqual(['main-photo']);

    await waitFor(() => expect(persistCartulariaJson).toHaveBeenLastCalledWith(
      'cartularia-media-assets-v3',
      [expect.objectContaining({ url: '', thumbnailUrl: undefined, posterUrl: undefined, tags: ['main-photo'] })],
    ));
  });

  it('réunit les contrôles, rapports et documents sans mélanger leurs clés', async () => {
    const { result } = renderHook(() => useCartularyConditionState({
      loadChecks: () => [{ id: 'check-1', title: 'Référence', note: '', checked: false }],
      loadEntries: () => [{ id: 'entry-1', date: '2026-08-17', title: 'État', note: '', attachments: [{ name: 'preuve.pdf', url: 'blob:preuve' }] }],
      loadDocumentation: () => [{ id: 'doc-1', category: 'Facture', description: '', state: 'À vérifier' }],
    }));

    act(() => result.current.commands.updateCheck('check-1', { checked: true }));
    act(() => result.current.commands.updateDocumentation('doc-1', 'state', 'Présent'));
    expect(result.current.identificationChecks[0].checked).toBe(true);
    expect(result.current.documentationItems[0].state).toBe('Présent');

    await waitFor(() => expect(persistCartulariaJson).toHaveBeenCalledWith(
      'cartularia-condition-entries',
      [expect.objectContaining({ attachments: [expect.objectContaining({ url: undefined })] })],
    ));
  });

  it('recharge le domaine propriétaire avec l’ancienne clé de lieu', () => {
    let locationName = 'Coffre A';
    const { result } = renderHook(() => useCartularyOwnerState({
      loadFields: () => [],
      loadType: () => 'Personne physique',
      loadDocuments: () => [],
      loadHistory: () => [],
      loadAssetKind: () => 'Montre',
      loadWatchStatus: () => 'Patrimonial',
      loadRecipients: () => [],
      loadLocations: () => [{ id: 'location-1', name: locationName, contents: '', description: '' }],
    }));

    locationName = 'Coffre B';
    act(() => result.current.reloadOwnerState(new Set(['cartularia-storage-description'])));
    expect(result.current.storageLocations[0].name).toBe('Coffre B');
  });

  it('expose les commandes de valorisation sur les contrats existants', () => {
    const { result } = renderHook(() => useCartularyValuationState({
      loadMarketHistory: () => [],
      loadMarketDepth: () => ({ analysisDate: '2026-08-17', activeListings: 0, transactions12m: 0, medianDaysOnMarket: 0, lowValue: 1, midValue: 2, highValue: 3 }),
      loadComparables: () => [],
      loadComparableAnalysis: () => [{ id: 'analysis-1', angle: 'Marché', finding: '', reading: '' }],
      loadSensitivityPrices: () => [1, 2, 3],
      loadSensitivityCosts: () => [5, 10],
      loadRetainedValuation: () => ({ amount: 2, explanation: '' }),
      loadPurchase: () => ({ date: '2020-01-01', purchasePrice: 1 }),
      loadPurchaseExpenses: () => [{ id: 'expense-1', kind: 'Autre', date: '', label: '', amount: 0 }],
      loadExitAssumptions: () => ({ saleDate: '2026-08-17', salePrice: 3, disposalCostPct: 10 }),
    }));

    act(() => result.current.commands.updateComparableAnalysis('analysis-1', { finding: 'Stable' }));
    act(() => result.current.commands.updateExpense('expense-1', 'amount', 250));
    expect(result.current.comparableAnalysis[0].finding).toBe('Stable');
    expect(result.current.purchaseExpenses[0].amount).toBe(250);
  });

  it('ne persiste la liaison de publication qu’après calcul de son empreinte', async () => {
    const { result } = renderHook(() => useCartularyPublicationState({
      loadWebsiteBlocks: () => [],
      loadReportBlocks: () => [],
      loadCommunityBlocks: () => [],
      loadDecisions: () => [],
      loadSourceBinding: () => ({ revision: 0, digest: '', updatedAt: '' }),
    }));

    await waitFor(() => expect(persistCartulariaJson).toHaveBeenCalledWith('cartularia-published-blocks', []));
    expect(vi.mocked(persistCartulariaJson).mock.calls.some(([key]) => key === 'cartularia-publication-source-v1')).toBe(false);

    act(() => result.current.commands.setSourceBinding({ revision: 1, digest: 'digest-1', updatedAt: '2026-08-17T12:00:00Z' }));
    await waitFor(() => expect(persistCartulariaJson).toHaveBeenCalledWith(
      'cartularia-publication-source-v1',
      { revision: 1, digest: 'digest-1', updatedAt: '2026-08-17T12:00:00Z' },
    ));
  });
});
