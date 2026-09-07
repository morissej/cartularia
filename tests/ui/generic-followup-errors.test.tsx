import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { GenericCartularyPage } from '../../src/components/GenericCartularyPage';
const state = vi.hoisted(() => ({ loadItems: vi.fn(), next: null as any, fail: null as any, auth: { currentUser: { uid: 'owner_test' }, authStateReady: async () => {} } }));
vi.mock('../../src/firebase', () => ({ auth: state.auth }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: any, next: any) => { next(state.auth.currentUser); return () => {}; } }));
vi.mock('../../src/services/cartularies', () => ({ loadPrivateCartulary: async () => ({ envelope: { id: 'cart_car_test', registryId: 'reg_test', collectionId: 'col_test', publicCode: 'OBJ-0001', displayTitle: 'Voiture', makerName: 'Constructeur', modelName: 'Voiture', assetType: 'car', schemaId: 'car', schemaVersion: '1.2.0', revision: 4, lifecycleStatus: 'active' }, sections: [] }) }));
vi.mock('../../src/services/schemaCatalog', () => ({ loadVerticalSchema: async () => ({ schemaId: 'car', version: '1.2.0', fields: [], sections: [] }) }));
vi.mock('../../src/services/genericCartulary', () => ({ canEditGenericCartulary: async () => true, canPublishGenericCartulary: async () => false, loadGenericCartularyAssets: async () => [], saveGenericCartularyFields: vi.fn(), saveGenericCartularyMedia: vi.fn(), uploadGenericCartularyMedia: vi.fn() }));
vi.mock('../../src/services/collections', () => ({ loadRegistryCollections: async () => [] }));
vi.mock('../../src/services/projections', () => ({ loadScopedRegistryItems: (...args: unknown[]) => state.loadItems(...args) }));
vi.mock('../../src/services/followUp', () => ({ observeRegistryFollowUpsFromItems: (_items: any, next: any, fail: any) => { state.next = next; state.fail = fail; return () => {}; } }));
vi.mock('../../src/features/registry/RegistryTodoBoard', () => ({ RegistryTodoBoard: ({ todos, canManage }: any) => <div><p>{todos.length ? todos[0].title : 'Aucune tâche à traiter'}</p><button disabled={!canManage}>Modifier une tâche</button></div> }));
vi.mock('../../src/components/PublicWebsitePublicationPanel', () => ({ PublicWebsitePublicationPanel: () => null }));
beforeEach(() => { window.history.replaceState(null, '', '/cartulary-view?cartularyId=cart_car_test#cover'); state.loadItems.mockReset(); state.next = null; state.fail = null; });
it('une projection inaccessible ne masque pas une panne sous un suivi vide et la reprise aboutit', async () => {
  state.loadItems.mockRejectedValueOnce(new Error('Réseau')).mockResolvedValue([{ cartularyId: 'cart_car_test' }]);
  render(<GenericCartularyPage />); await screen.findByText(/Le suivi n’a pas pu être actualisé/); expect(screen.queryByText('Aucune tâche à traiter')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer le suivi' })); await waitFor(() => expect(state.next).toBeTypeOf('function'));
  expect(screen.getByText('Chargement du suivi…')).toBeTruthy(); act(() => state.next([]));
  expect(screen.getByText('Aucune tâche à traiter')).toBeTruthy();
});
it('une erreur d’abonnement conserve la dernière tâche connue mais suspend sa modification', async () => {
  state.loadItems.mockResolvedValue([{ cartularyId: 'cart_car_test' }]); render(<GenericCartularyPage />);
  await waitFor(() => expect(state.next).toBeTypeOf('function')); act(() => state.next([{ title: 'Entretien à prévoir' }]));
  expect((screen.getByRole('button', { name: 'Modifier une tâche' }) as HTMLButtonElement).disabled).toBe(false);
  act(() => state.fail(new Error('Coupure réseau'))); expect(screen.getByText('Entretien à prévoir')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Modifier une tâche' }) as HTMLButtonElement).disabled).toBe(true);
});
