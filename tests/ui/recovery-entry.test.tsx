import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ status: vi.fn(), user: { uid: 'owner' } }));
vi.mock('../../src/services/foundations', () => ({ observeCartulariaSession: (next: (user: unknown) => void) => { next(state.user); return () => {}; } }));
vi.mock('../../src/services/registryRecovery', () => ({
  loadRegistryRecoveryStatus: (...args: unknown[]) => state.status(...args),
  activateRegistryRecoveryKit: vi.fn(), changeRecoveredRegistryPassword: vi.fn(), createRegistryRecoveryKit: vi.fn(),
  downloadRegistryRecoveryKit: vi.fn(), parseRegistryRecoveryKit: vi.fn(), recoverRegistrySession: vi.fn(), revokeRegistryRecoveryKit: vi.fn(),
}));
import { RegistryRecoveryPage } from '../../src/features/public/RegistryRecoveryPage';
beforeEach(() => { vi.clearAllMocks(); window.history.replaceState({}, '', '/account/security?onboarding=1&returnTo=%2Fregistry%2Ftest%2Fitems'); });
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
});
