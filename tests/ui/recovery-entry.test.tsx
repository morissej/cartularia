import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ status: vi.fn(), prepare: vi.fn(), download: vi.fn(), activate: vi.fn(), revoke: vi.fn(), user: { uid: 'owner' } }));
vi.mock('../../src/services/foundations', () => ({ observeCartulariaSession: (next: (user: unknown) => void) => { next(state.user); return () => {}; } }));
vi.mock('../../src/services/registryRecovery', () => ({
  loadRegistryRecoveryStatus: (...args: unknown[]) => state.status(...args),
  activateRegistryRecoveryKit: (...args: unknown[]) => state.activate(...args), changeRecoveredRegistryPassword: vi.fn(), createRegistryRecoveryKit: (...args: unknown[]) => state.prepare(...args),
  downloadRegistryRecoveryKit: (...args: unknown[]) => state.download(...args), parseRegistryRecoveryKit: vi.fn(), recoverRegistrySession: vi.fn(), revokeRegistryRecoveryKit: (...args: unknown[]) => state.revoke(...args),
}));
import { RegistryRecoveryPage } from '../../src/features/public/RegistryRecoveryPage';
beforeEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); window.history.replaceState({}, '', '/account/security?onboarding=1&returnTo=%2Fregistry%2Ftest%2Fitems'); });
describe('entrée du secours après création du compte', () => {
  it('explique une panne de service sans prétendre que le kit est absent, et permet de poursuivre ou réessayer', async () => {
    state.status.mockRejectedValueOnce({ code: 'functions/unavailable' }).mockResolvedValue({ active: false });
    render(<RegistryRecoveryPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('service de secours est indisponible');
    expect(screen.queryByText(/Aucun kit actif :/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Préparer le kit' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('link', { name: 'Continuer vers mon Registre' }).getAttribute('href')).toBe('/registry/test/items');
    fireEvent.click(screen.getByRole('button', { name: 'Revérifier le service de secours' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Préparer le kit' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/Aucun kit actif :/)).toBeTruthy();
  });

  it('prépare, télécharge, confirme, active et révoque le kit en vérifiant chaque réponse', async () => {
    const kit = { ownerUid: 'owner', credentialId: 'kit-test' };
    const active = { active: true, credentialId: 'kit-test', createdAt: '2026-10-03T12:00:00Z' };
    state.status.mockResolvedValueOnce({ active: false }).mockResolvedValueOnce(active).mockResolvedValueOnce({ active: false });
    state.prepare.mockResolvedValue(kit);
    render(<RegistryRecoveryPage />);
    const prepare = screen.getByRole('button', { name: 'Préparer le kit' }) as HTMLButtonElement;
    await waitFor(() => expect(prepare.disabled).toBe(false));
    fireEvent.click(prepare);
    const download = await screen.findByRole('button', { name: 'Télécharger le kit secret' });
    const activate = screen.getByRole('button', { name: '2. Activer ce kit' }) as HTMLButtonElement;
    expect(activate.disabled).toBe(true);
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(download);
    expect(state.download).toHaveBeenCalledWith(kit);
    expect(activate.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(activate);
    await screen.findByText('Kit activé et vérifié. Tout kit précédent a été remplacé.');
    expect(state.activate).toHaveBeenCalledWith(kit);
    expect(screen.queryByRole('button', { name: 'Télécharger le kit secret' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Préparer un kit de remplacement' })).toBeTruthy();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Révoquer le kit actif' }));
    expect(state.revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Révoquer le kit actif' }));
    await screen.findByText('Kit révoqué. Préparez un nouveau secours si nécessaire.');
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(state.revoke).toHaveBeenCalledTimes(1);
    expect(state.status).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('button', { name: 'Révoquer le kit actif' })).toBeNull();
    const signIn = new URL(screen.getByRole('link', { name: 'Renouveler ma connexion' }).getAttribute('href')!, window.location.origin);
    const back = new URL(signIn.searchParams.get('returnTo')!, window.location.origin);
    expect(back.pathname).toBe('/account/security');
    expect(back.searchParams.get('returnTo')).toBe('/registry/test/items');
    expect(back.searchParams.get('onboarding')).toBe('1');
  });

  it('empêche l’activation après un échec de téléchargement', async () => {
    state.status.mockResolvedValue({ active: false });
    state.prepare.mockResolvedValue({ ownerUid: 'owner', credentialId: 'kit-test' });
    state.download.mockImplementation(() => { throw new Error('download failed'); });
    render(<RegistryRecoveryPage />);
    const prepare = screen.getByRole('button', { name: 'Préparer le kit' }) as HTMLButtonElement;
    await waitFor(() => expect(prepare.disabled).toBe(false));
    fireEvent.click(prepare);
    fireEvent.click(await screen.findByRole('button', { name: 'Télécharger le kit secret' }));
    expect(screen.getByRole('alert').textContent).toContain('téléchargement n’a pas pu démarrer');
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '2. Activer ce kit' }) as HTMLButtonElement).disabled).toBe(true);
    expect(state.activate).not.toHaveBeenCalled();
  });

  it('ne confirme pas une révocation si le serveur annonce encore un kit actif', async () => {
    state.status.mockResolvedValue({ active: true, credentialId: 'kit-test', createdAt: '2026-10-03T12:00:00Z' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<RegistryRecoveryPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Révoquer le kit actif' }));
    expect((await screen.findByRole('alert')).textContent).toContain('n’a pas pu être confirmée');
    expect(screen.queryByText('Kit révoqué. Préparez un nouveau secours si nécessaire.')).toBeNull();
  });
});
