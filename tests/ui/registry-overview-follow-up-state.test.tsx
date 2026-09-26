import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryOverview } from '../../src/features/registry/RegistryOverview.tsx';

const mocks = vi.hoisted(() => ({
  followUpCallback: null as null | ((items: any[], coverage: any) => void),
  followUpState: 'loading',
  followUps: [] as any[],
}));

const registryItems = [
  {
    cartularyId: 'cart-a', organizationId: 'org-test', registryId: 'reg-test', collectionId: 'collection-a',
    assetType: 'watch', displayTitle: 'Montre A', makerName: 'Maison', modelName: 'A', referenceCode: null,
    manufactureYear: null, lifecycleStatus: 'active', possessionStatus: 'held', completenessLevel: 'documented',
    primaryAssetId: null, sourceRevision: 2, projectionStatus: 'active', contentHash: 'hash-a',
  },
  {
    cartularyId: 'cart-b', organizationId: 'org-test', registryId: 'reg-test', collectionId: 'collection-a',
    assetType: 'watch', displayTitle: 'Montre B', makerName: 'Maison', modelName: 'B', referenceCode: null,
    manufactureYear: null, lifecycleStatus: 'active', possessionStatus: 'held', completenessLevel: 'documented',
    primaryAssetId: null, sourceRevision: 1, projectionStatus: 'active', contentHash: 'hash-b',
  },
];

vi.mock('../../src/services/projections.ts', () => ({
  loadRegistryItems: vi.fn(async () => registryItems),
  observeRegistryItems: vi.fn((_registryId: string, onData: (items: any[]) => void) => {
    onData(registryItems);
    return () => undefined;
  }),
}));

vi.mock('../../src/services/followUp.ts', () => ({
  observeRegistryFollowUpsFromItems: vi.fn((_items: any[], onData: (items: any[], coverage: any) => void) => {
    mocks.followUpCallback = onData;
    onData(mocks.followUps, {
      state: mocks.followUpState,
      totalCartularies: 2,
      completeCartularies: 0,
      partialCartularies: 0,
      loadingCartularies: 2,
      failedCartularies: 0,
    });
    return () => undefined;
  }),
}));

vi.mock('../../src/features/registry/useRegistryCollections.ts', () => ({
  useRegistryCollections: () => ({ collectionName: (id: string) => id }),
}));

const registry = {
  id: 'reg-test', organizationId: 'org-test', name: 'Registre test', status: 'active', visibility: 'secret',
  itemCount: 2, modelVersion: '1.0.0', createdAt: { seconds: 1, nanoseconds: 0 }, updatedAt: { seconds: 1, nanoseconds: 0 },
} as const;
const organization = {
  id: 'org-test', name: 'Organisation test', status: 'active', modelVersion: '1.0.0',
  createdAt: { seconds: 1, nanoseconds: 0 }, updatedAt: { seconds: 1, nanoseconds: 0 },
} as const;
const membership = {
  uid: 'owner-test', organizationId: 'org-test', roles: ['account_holder'], status: 'active',
  scopes: { registryIds: ['reg-test'] }, permissions: ['registry.read', 'cartulary.read'],
  createdAt: { seconds: 1, nanoseconds: 0 }, revokedAt: null,
} as const;

const renderOverview = () => render(<RegistryOverview
  registry={registry}
  organization={organization}
  membership={membership}
/>);

beforeEach(() => {
  mocks.followUpCallback = null;
  mocks.followUpState = 'loading';
  mocks.followUps = [];
});

describe('exhaustivité des alertes du tableau de bord', () => {
  it('distingue chargement puis résultat partiel et conserve l’alerte connue si un dossier échoue', async () => {
    renderOverview();
    expect(await screen.findByText('Chargement des rappels autorisés…')).toBeTruthy();
    await waitFor(() => expect(mocks.followUpCallback).toBeTypeOf('function'));

    act(() => mocks.followUpCallback?.([{
      id: 'reminder-a', cartularyId: 'cart-a', organizationId: 'org-test', registryId: 'reg-test',
      collectionId: 'collection-a', assetType: 'watch', displayTitle: 'Montre A', title: 'Renouveler l’assurance',
      category: 'insurance', dueAt: '2026-09-20', reminderStatus: 'active', visibility: 'secret',
    }], {
      state: 'partial', totalCartularies: 2, completeCartularies: 1, partialCartularies: 0,
      loadingCartularies: 0, failedCartularies: 1,
    }));

    expect(screen.getByText('Échéances en retard')).toBeTruthy();
    expect(screen.getByText('Alertes partielles')).toBeTruthy();
    expect(screen.queryByText('Aucune alerte opérationnelle en cours.')).toBeNull();
  });

  it('ne transforme jamais une erreur totale en absence d’alerte', async () => {
    renderOverview();
    await waitFor(() => expect(mocks.followUpCallback).toBeTypeOf('function'));
    act(() => mocks.followUpCallback?.([], {
      state: 'error', totalCartularies: 2, completeCartularies: 0, partialCartularies: 0,
      loadingCartularies: 0, failedCartularies: 2,
    }));

    expect(screen.getByText('Alertes non confirmées')).toBeTruthy();
    expect(screen.getByText(/Une liste vide ne signifie pas/)).toBeTruthy();
    expect(screen.queryByText('Aucune alerte opérationnelle en cours.')).toBeNull();
  });

  it('annonce l’absence d’alerte seulement après une lecture complète', async () => {
    renderOverview();
    await waitFor(() => expect(mocks.followUpCallback).toBeTypeOf('function'));
    act(() => mocks.followUpCallback?.([], {
      state: 'ready', totalCartularies: 2, completeCartularies: 2, partialCartularies: 0,
      loadingCartularies: 0, failedCartularies: 0,
    }));

    expect(screen.getByText('Aucune alerte opérationnelle en cours.')).toBeTruthy();
  });
});

it('Jam 31 : affiche aussi les tâches non urgentes et n’inclut pas les tâches terminées', async () => {
  mocks.followUpState = 'ready';
  mocks.followUps = [{ id: 'future', cartularyId: 'cart-a', displayTitle: 'Montre A', title: 'Contrôle IWC planifié', dueAt: '2099-03-08', reminderStatus: 'planned', category: 'maintenance', assetType: 'watch' },
    { id: 'done', cartularyId: 'cart-a', displayTitle: 'Montre A', title: 'Tâche déjà terminée', dueAt: '2026-01-01', reminderStatus: 'completed', category: 'custom', assetType: 'watch' }];
  renderOverview();
  expect(await screen.findByText('Contrôle IWC planifié')).toBeTruthy();
  expect(screen.getByText('1 tâche(s) à faire, dont 0 à traiter en priorité.')).toBeTruthy();
  expect(screen.queryByText('Tâche déjà terminée')).toBeNull();
});
