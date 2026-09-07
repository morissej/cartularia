import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalVaultApp } from '../../src/personalVault/PersonalVaultApp';
import { emptyPersonalVaultPayload } from '../../src/personalVault/types';

const mocks = vi.hoisted(() => ({ recover: vi.fn(), save: vi.fn(), authenticate: vi.fn(), load: vi.fn(), lock: vi.fn() }));
vi.mock('../../src/personalVault/firebase', () => ({ personalVaultIsConfigured: true, personalVaultProjectId: 'vault-test' }));
vi.mock('../../src/personalVault/repository', () => ({ authenticatePersonalVault: mocks.authenticate, loadPersonalVault: mocks.load, savePersonalVault: mocks.save, lockPersonalVault: mocks.lock }));
vi.mock('../../src/personalVault/codeBridgeRepository', () => ({ loadOwnerObjectCodes: async () => new Map(), saveCodeCorrespondences: async () => undefined }));
vi.mock('../../src/personalVault/CodeHandoffSender', () => ({ CodeHandoffSender: () => null }));
vi.mock('../../src/personalVault/recoveryRepository', () => ({ recoverPersonalVault: mocks.recover, getPersonalRecoveryStatus: async () => ({ active: false }) }));
beforeEach(() => {
  window.history.replaceState({}, '', '/personal-vault');
  mocks.authenticate.mockResolvedValue({ personalUser: { uid: 'owner' }, bridgeUser: null });
  mocks.load.mockResolvedValue(emptyPersonalVaultPayload('atlas'));
  mocks.save.mockResolvedValue(undefined); mocks.lock.mockResolvedValue(undefined);
});
const open = async () => {
  render(<PersonalVaultApp />);
  fireEvent.change(screen.getByLabelText('Nom utilisateur Cartularia'), { target: { value: 'atlas' } });
  fireEvent.change(screen.getByLabelText('Mot de passe dédié'), { target: { value: 'test-password-only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrer dans le Coffre' }));
  await screen.findByRole('heading', { name: 'Propriétaires des biens' });
};
const begin = async () => {
  const file = new File(['{}'], 'kit.json', { type: 'application/json' }); Object.assign(file, { text: async () => '{}' });
  fireEvent.change(screen.getByLabelText('Mon fichier de secours'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Récupérer mon Coffre' }));
  await waitFor(() => expect(mocks.recover).toHaveBeenCalledOnce());
};
describe('récupération du Coffre et réponses retardées', () => {
  it('bloque édition, sauvegarde et verrouillage pendant une récupération', async () => {
    let resolve!: (value: unknown) => void; mocks.recover.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await open(); await begin();
    expect(screen.getByLabelText('Nom', { exact: true }).closest('fieldset')?.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Chiffrer et enregistrer' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Verrouiller', exact: true }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ personalUser: { uid: 'owner' }, bridgeUser: null, payload: emptyPersonalVaultPayload('atlas'), password: 'test-only', kit: { userAlias: 'atlas', credentialId: 'kit-test' } }));
    expect(screen.getByLabelText('Nom', { exact: true }).closest('fieldset')?.disabled).toBe(false);
  });
  it('refuse malgré tout une réponse ancienne si une saisie a changé programmatiquement', async () => {
    let resolve!: (value: unknown) => void; mocks.recover.mockImplementation(() => new Promise((done) => { resolve = done; }));
    await open(); await begin();
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Saisie arrivée après le départ' } });
    await act(async () => resolve({ personalUser: { uid: 'owner' }, bridgeUser: null, payload: emptyPersonalVaultPayload('atlas'), password: 'test-only', kit: { userAlias: 'atlas', credentialId: 'kit-test' } }));
    expect((screen.getByLabelText('Nom', { exact: true }) as HTMLInputElement).value).toBe('Saisie arrivée après le départ');
    expect(screen.getByRole('alert').textContent).toContain('elles sont conservées');
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
