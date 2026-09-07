import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryCollections } from '../../src/features/registry/RegistryCollections';
import { RegistryItems } from '../../src/features/registry/RegistryItems';
import { RegistryAccessCenter } from '../../src/features/registry/RegistryAccessCenter';
import { NewCartularyPage } from '../../src/features/registry/NewCartularyPage';
import type { RegistryDocument } from '../../src/domain/foundations';

const state = vi.hoisted(() => ({ items: [] as any[], accesses: [] as any[], collections: [] as any[], itemsError: null as null | (() => void), collectionError: null as null | (() => void), pending: false,
  revoke: vi.fn(), remove: vi.fn(), published: vi.fn() }));
vi.mock('../../src/services/collections', () => ({
  observeRegistryCollections: vi.fn((_id, next, error) => { state.collectionError = error; if (!state.pending) next(state.collections); return () => {}; }),
  deleteRegistryCollection: (...args: unknown[]) => state.remove(...args), saveRegistryCollection: vi.fn(), normalizeCollectionSlug: (name: string) => name,
}));
vi.mock('../../src/services/projections', () => ({
  observeRegistryItems: vi.fn((_id, next, error) => { state.itemsError = error; if (!state.pending) next(state.items); return () => {}; }),
  loadRegistryItems: vi.fn(async () => state.items), loadScopedRegistryItems: vi.fn(async () => state.items),
  loadPublicPublicationStatuses: (...args: unknown[]) => state.published(...args),
}));
vi.mock('../../src/services/access', () => ({ loadRegistryAccesses: vi.fn(async () => state.accesses), revokeRegistryAccess: (...args: unknown[]) => state.revoke(...args), createRegistryAccess: vi.fn() }));
const registry = { id: 'reg_demo', organizationId: 'org_demo', name: 'Registre test' } as RegistryDocument;
const item = { cartularyId: 'cart_object', registryId: 'reg_demo', organizationId: 'org_demo', collectionId: 'col_actual_suffix', assetType: 'watch', displayTitle: 'Rolex essai', makerName: 'Rolex', modelName: 'Essai', objectCode: 'OBJ-00001', referenceCode: 'REF', manufactureYear: 2000, lifecycleStatus: 'active', possessionStatus: 'in_possession', completenessLevel: 'imported_unreviewed', projectionStatus: 'active', sourceRevision: 1 };

beforeEach(() => {
  window.history.replaceState(null, '', '/registry/reg_demo/items');
  state.items = [item]; state.pending = false;
  state.collections = [{ id: 'col_actual_suffix', name: 'Les cinq icônes', description: '', websiteTitle: 'Vitrine', status: 'draft', visibility: 'secret', publicationConsent: false }];
  state.accesses = [{ id: 'access_one', cartularyId: item.cartularyId, registryId: registry.id, organizationId: registry.organizationId, scopeType: 'cartulary', scopeId: item.cartularyId, displayTitle: item.displayTitle, recipientLabel: 'invite@example.test', recipientKind: 'person', accessKind: 'invitation', sourceStatus: 'active', issuedAt: '2026-01-01', expiresAt: null, revokedAt: null, lastConsultedAt: null, consultationCount: 0, projectionStatus: 'active' }];
  state.revoke.mockResolvedValue({}); state.remove.mockResolvedValue({}); state.published.mockResolvedValue({});
});
describe('corrections de l’audit du Registre', () => {
  it('conserve le vrai nom et permet de vider une recherche au clavier', async () => {
    state.items.push({ ...item, cartularyId: 'cart_other', displayTitle: 'Automobile essai', makerName: 'Constructeur', assetType: 'car' });
    const user = userEvent.setup(); render(<RegistryItems registry={registry} />);
    const search = await screen.findByRole('searchbox');
    await user.type(search, 'Rolex'); expect(screen.getAllByRole('link', { name: /Ouvrir le Cartulaire/ })).toHaveLength(1);
    await user.clear(search); expect((search as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Ouvrir le Cartulaire/ })).toHaveLength(2));
    expect(window.location.search).not.toContain('q='); expect(screen.getAllByText('Les cinq icônes').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Voir le mini-site/ })).toBeNull();
  });
  it('expose le mini-site automobile uniquement quand sa publication est confirmée', async () => {
    state.items = [{ ...item, assetType: 'car' }]; state.published.mockResolvedValue({ 'OBJ-00001': true });
    render(<RegistryItems registry={registry} />);
    const link = await screen.findByRole('link', { name: /Voir le mini-site/ });
    expect(link.getAttribute('href')).toContain('publicCode=OBJ-00001'); expect(link.getAttribute('href')).not.toContain('cartularyId');
  });
  it('ne présente pas zéro objet pendant un chargement et bloque les modifications', () => {
    state.pending = true; render(<RegistryCollections registry={registry} canManage />);
    expect(screen.getByRole('status').textContent).toContain('Chargement');
    expect((screen.getByRole('button', { name: 'Créer une collection' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Aucune collection')).toBeNull();
  });
  it('garde l’inventaire affiché en cas d’erreur et interdit une suppression fondée sur des données anciennes', async () => {
    render(<RegistryCollections registry={registry} canManage />);
    await screen.findByRole('heading', { name: 'Les cinq icônes' });
    act(() => state.itemsError?.());
    expect(screen.getByRole('alert').textContent).toContain('données encore affichées peuvent être anciennes');
    expect(screen.getByRole('heading', { name: 'Les cinq icônes' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Supprimer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(state.remove).not.toHaveBeenCalled();
  });
  it('n’offre pas de révocation à un lecteur', async () => {
    render(<RegistryAccessCenter registry={registry} canReadAccesses canManageAccesses={false} />);
    await screen.findByRole('heading', { name: item.displayTitle });
    expect(screen.queryByRole('button', { name: 'Révoquer' })).toBeNull();
  });
  it('les accès utilisent le type canonique de la projection, même pour une nouvelle montre', async () => {
    state.items = [{ ...item, cartularyId: 'cart_watch_user_123' }]; state.accesses[0].cartularyId = 'cart_watch_user_123';
    render(<RegistryAccessCenter registry={registry} canReadAccesses canManageAccesses />);
    const link = await screen.findByRole('link', { name: /Gérer dans le Cartulaire/ });
    expect(link.getAttribute('href')).toMatch(/^\/cartulary\?/); expect(link.getAttribute('href')).toContain('returnTo=');
  });
  it('un objet absent ne crée pas de route devinée depuis son identifiant', async () => {
    state.items = []; render(<RegistryAccessCenter registry={registry} canReadAccesses canManageAccesses />);
    await screen.findByText(/Objet indisponible dans ce Registre/); expect(screen.queryByRole('link', { name: /Gérer dans le Cartulaire/ })).toBeNull();
  });
  it('la fermeture de Collection et le rechargement de Nouvel objet gardent la saisie non enregistrée', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const view = render(<RegistryCollections registry={registry} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Créer une collection' }));
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Collection en cours' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' })); expect((screen.getByLabelText('Nom') as HTMLInputElement).value).toBe('Collection en cours');
    view.unmount(); render(<NewCartularyPage user={{ uid: 'owner_test' } as any} organization={{ id: 'org_demo' } as any} registry={registry} />);
    fireEvent.change(screen.getByLabelText('Type d’objet'), { target: { value: 'car' } });
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
  });
  it('exige confirmation et conserve un échec de révocation visible', async () => {
    state.revoke.mockRejectedValue(new Error('Service de révocation indisponible'));
    render(<RegistryAccessCenter registry={registry} canReadAccesses canManageAccesses />);
    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer' })); expect(state.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la révocation' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('La révocation n’a pas été confirmée'));
    expect(state.revoke).toHaveBeenCalledTimes(1);
  });
});
