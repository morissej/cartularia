import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/services/foundations', () => ({
  observeCartulariaSession: vi.fn((callback) => { callback({ uid: 'fictitious-admin' }); return () => {}; }),
  signInToCartularia: vi.fn(), signOutOfCartularia: vi.fn(),
}));
vi.mock('../../src/services/administration', () => ({
  userHasAdministrationRole: vi.fn(), loadAdministrationOverview: vi.fn(),
  loadAdministrationUserDashboard: vi.fn(), updateAdministrationUserState: vi.fn(),
}));
import { AdministrationApp } from '../../src/features/administration/AdministrationApp';
import { signOutOfCartularia } from '../../src/services/foundations';
import { loadAdministrationOverview, loadAdministrationUserDashboard, updateAdministrationUserState, userHasAdministrationRole, type AdministrationUser, type AdministrationUserDashboard } from '../../src/services/administration';

const overview = { generatedAt: '2026-09-06T12:00:00Z', databases: [{ id: 'registry' as const, label: 'Registre', state: 'ready' as const, users: [], error: null }], totals: { users: 0, disabled: 0, configured: 1 } };
describe('administration sans rupture de session', () => {
  beforeEach(() => vi.resetAllMocks());
  it('refuse le rôle sans appeler la déconnexion du Registre', async () => {
    vi.mocked(userHasAdministrationRole).mockResolvedValue(false);
    render(<AdministrationApp />);
    expect(await screen.findByText('Accès réservé aux administrateurs')).toBeTruthy();
    expect(signOutOfCartularia).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Revenir au Registre' }).getAttribute('href')).toBe('/registry');
  });
  it('signale un échec d’actualisation et ne présente pas les données anciennes comme à jour', async () => {
    vi.mocked(userHasAdministrationRole).mockResolvedValue(true);
    vi.mocked(loadAdministrationOverview).mockResolvedValueOnce(overview).mockRejectedValueOnce(new Error('expired'));
    render(<AdministrationApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Actualiser' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('peuvent être périmées'));
    expect(screen.getByRole('link', { name: 'Renouveler la connexion' })).toBeTruthy();
    expect(signOutOfCartularia).not.toHaveBeenCalled();
  });

  const suspendedUser = (accessOperationStatus: 'pending' | 'failed'): AdministrationUser => ({
    uid: 'member-1', label: 'Compte fermé', email: null, disabled: true, authDisabled: false, accessOperationStatus,
    emailVerified: true, createdAt: null, lastSignInAt: null, recordPresent: true, recordStatus: 'suspended', recordUpdatedAt: null, codedReference: null,
  });
  const withUser = (user: AdministrationUser) => ({ ...overview, databases: [{ ...overview.databases[0], users: [user] }], totals: { users: 1, disabled: 1, configured: 1 } });

  it('compte une barrière pending comme fermée et bloque la réactivation jusqu’à réconciliation', async () => {
    vi.mocked(userHasAdministrationRole).mockResolvedValue(true);
    vi.mocked(loadAdministrationOverview).mockResolvedValue(withUser(suspendedUser('pending')));
    render(<AdministrationApp />);
    expect(await screen.findByText('Vérification en cours')).toBeTruthy();
    expect(screen.getByText(/Une réconciliation administrative est requise/)).toBeTruthy();
    const reactivate = screen.getByRole('button', { name: 'Réactiver' }) as HTMLButtonElement;
    expect(reactivate.disabled).toBe(true);
    fireEvent.click(reactivate);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(updateAdministrationUserState).not.toHaveBeenCalled();
    const activeMetric = screen.getByText('Comptes actifs').closest('article')!;
    expect(within(activeMetric).getByText('0')).toBeTruthy();
  });

  it('permet un nouvel essai sur une opération échouée, sans présenter Auth.disabled=false comme un compte actif', async () => {
    vi.mocked(userHasAdministrationRole).mockResolvedValue(true);
    vi.mocked(loadAdministrationOverview).mockResolvedValue(withUser(suspendedUser('failed')));
    render(<AdministrationApp />);
    expect(await screen.findByText('Suspendu', { exact: true })).toBeTruthy();
    const reactivate = screen.getByRole('button', { name: 'Réactiver' }) as HTMLButtonElement;
    expect(reactivate.disabled).toBe(false);
    fireEvent.click(reactivate);
    expect(screen.getByRole('dialog').textContent).toContain('Réactiver ce compte ?');
  });

  it('le dashboard affiche le contrôle en cours aussi pour le compte lié', async () => {
    const user = suspendedUser('pending');
    vi.mocked(userHasAdministrationRole).mockResolvedValue(true);
    vi.mocked(loadAdministrationOverview).mockResolvedValue(withUser(user));
    const dashboard: AdministrationUserDashboard = {
      generatedAt: overview.generatedAt, selectedDatabase: { id: 'registry', label: 'Registre' }, selectedAccount: user,
      registryUid: user.uid, profile: null, linkedDatabases: [{ id: 'registry', label: 'Registre', state: 'ready', account: user }],
      organizations: [], memberships: [], registries: [], cartularies: [], collections: [], drafts: [], truncated: {},
      totals: { organizations: 0, registries: 0, cartularies: 0, collections: 0, drafts: 0 },
    };
    vi.mocked(loadAdministrationUserDashboard).mockResolvedValue(dashboard);
    render(<AdministrationApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir le dashboard de Compte fermé' }));
    await waitFor(() => expect(screen.getAllByText('Vérification en cours')).toHaveLength(2));
    expect(screen.queryByText('Actif', { exact: true })).toBeNull();
  });
});
