import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { loadAdministrationOverview, userHasAdministrationRole } from '../../src/services/administration';

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
});
