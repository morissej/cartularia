import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalVaultApp } from '../../src/personalVault/PersonalVaultApp';
import { emptyPersonalVaultPayload } from '../../src/personalVault/types';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), load: vi.fn(), save: vi.fn(), lock: vi.fn(), codes: vi.fn(), configured: true }));
vi.mock('../../src/personalVault/firebase', () => ({ get personalVaultIsConfigured() { return mocks.configured; } }));
vi.mock('../../src/personalVault/repository', () => ({ authenticatePersonalVault: mocks.authenticate, loadPersonalVault: mocks.load, savePersonalVault: mocks.save, lockPersonalVault: mocks.lock }));
vi.mock('../../src/personalVault/codeBridgeRepository', () => ({ loadOwnerObjectCodes: async () => new Map(), saveCodeCorrespondences: mocks.codes }));
vi.mock('../../src/personalVault/PersonalRecovery', () => ({ PersonalRecoveryPanel: () => null, RecoveryAccessForm: () => null }));
vi.mock('../../src/personalVault/CodeHandoffSender', () => ({ CodeHandoffSender: () => null }));

const open = async () => {
  render(<PersonalVaultApp />);
  fireEvent.change(screen.getByLabelText('Nom utilisateur Cartularia'), { target: { value: 'Atlas' } });
  fireEvent.change(screen.getByLabelText('Mot de passe dédié'), { target: { value: 'valid-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrer dans le Coffre' }));
  await screen.findByRole('heading', { name: 'Propriétaires des biens' });
};
beforeEach(() => {
  window.history.replaceState({}, '', '/personal-vault');
  mocks.configured = true;
  mocks.authenticate.mockResolvedValue({ personalUser: { uid: 'owner' }, bridgeUser: { uid: 'bridge-owner' } });
  mocks.load.mockResolvedValue(emptyPersonalVaultPayload('Atlas'));
  mocks.save.mockResolvedValue(undefined);
  mocks.lock.mockResolvedValue(undefined);
  mocks.codes.mockResolvedValue(undefined);
});

describe('conservation des saisies du Coffre', () => {
  it('empêche la connexion si les bases dédiées ne sont pas disponibles', () => {
    mocks.configured = false;
    render(<PersonalVaultApp />);
    expect(screen.getByRole('button', { name: 'Entrer dans le Coffre' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('temporairement indisponible');
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
  it('signale une nouvelle saisie après succès et permet d’annuler le verrouillage', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Première saisie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chiffrer et enregistrer' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Coffre chiffré enregistré'));
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Nouvelle saisie' } });
    expect(screen.getByRole('status').textContent).toContain('Modifications non enregistrées');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Verrouiller', exact: true }));
    expect(mocks.lock).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Nom', { exact: true }) as HTMLInputElement).value).toBe('Nouvelle saisie');
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });
  it('n’écrase pas une saisie tardive et ne verrouille pas avec une ancienne réponse', async () => {
    let resolveSave!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    await open();
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Avant sauvegarde' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer et verrouiller' }));
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Après début sauvegarde' } });
    await act(async () => resolveSave());
    expect(mocks.lock).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Nom', { exact: true }) as HTMLInputElement).value).toBe('Après début sauvegarde');
    expect(screen.getByRole('status').textContent).toContain('Modifications non enregistrées');
  });
  it('conserve les saisies après un échec et ne confirme aucune sauvegarde', async () => {
    mocks.save.mockRejectedValue(new Error('offline'));
    await open();
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'À conserver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer et verrouiller' }));
    await screen.findByRole('alert');
    expect(mocks.lock).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Nom', { exact: true }) as HTMLInputElement).value).toBe('À conserver');
  });
  it('demande confirmation avant suppression et présente les gestionnaires comme des contacts', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un lieu de stockage' }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer ce lieu' }));
    expect(screen.getByLabelText('Nom usuel du lieu')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Contacts gestionnaires' })).toBeTruthy();
    expect(screen.getByText(/ne crée aucun compte, invitation ou droit/)).toBeTruthy();
  });
  it('garde l’alerte après enregistrer/verrouiller si la synchronisation des codes échoue', async () => {
    mocks.codes.mockRejectedValue(new Error('offline'));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer et verrouiller' }));
    await waitFor(() => expect(mocks.lock).toHaveBeenCalledOnce());
    expect(screen.getByRole('status').textContent).toContain('Vérifiez la synchronisation des codes dans la dernière version');
    expect(mocks.save.mock.calls[0][0].payload.codeSyncPending).toBe(true);
  });
  it('propose une reprise après réouverture du marqueur enregistré dans le Coffre chiffré', async () => {
    mocks.load.mockResolvedValue({ ...emptyPersonalVaultPayload('Atlas'), codeSyncPending: true });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer la synchronisation des codes' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Réessayer la synchronisation des codes' })).toBeNull());
    expect(mocks.codes).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls.at(-1)?.[0].payload.codeSyncPending).toBe(false);
  });
});
