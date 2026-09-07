import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalVaultApp } from '../../src/personalVault/PersonalVaultApp';
import { emptyPersonalVaultPayload } from '../../src/personalVault/types';
import { decryptPersonalPayload, encryptPersonalPayload } from '../../src/personalVault/crypto';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), load: vi.fn(), save: vi.fn() }));
vi.mock('../../src/personalVault/firebase', () => ({ personalVaultIsConfigured: true }));
vi.mock('../../src/personalVault/repository', () => ({ authenticatePersonalVault: mocks.authenticate, loadPersonalVault: mocks.load, savePersonalVault: mocks.save, lockPersonalVault: vi.fn() }));
vi.mock('../../src/personalVault/codeBridgeRepository', () => ({ loadOwnerObjectCodes: async () => new Map(), saveCodeCorrespondences: async () => undefined }));
vi.mock('../../src/personalVault/PersonalRecovery', () => ({ PersonalRecoveryPanel: () => null, RecoveryAccessForm: () => null }));
vi.mock('../../src/personalVault/CodeHandoffSender', () => ({ CodeHandoffSender: () => null }));
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); window.history.replaceState({}, '', '/personal-vault'); mocks.load.mockResolvedValue(emptyPersonalVaultPayload('atlas')); });
afterEach(() => vi.unstubAllGlobals());
const enter = () => {
  fireEvent.change(screen.getByLabelText('Nom utilisateur Cartularia'), { target: { value: 'atlas' } });
  fireEvent.change(screen.getByLabelText('Mot de passe dédié'), { target: { value: 'auth-password-original' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrer dans le Coffre' }));
};
describe('AC01 : seule la clé de la session confirmée chiffre les données', () => {
  it.each(['authentification', 'déchiffrement'])('écarte une réponse tardive pendant %s puis permet une nouvelle ouverture', async (stage) => {
    let finish!: (value: unknown) => void;
    if (stage === 'authentification') mocks.authenticate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    else {
      mocks.authenticate.mockResolvedValueOnce({ personalUser: { uid: 'owner' }, bridgeUser: { uid: 'bridge' } });
      mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    }
    render(<PersonalVaultApp />); enter();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    expect((screen.getByLabelText('Mot de passe dédié') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Mot de passe dédié'), { target: { value: 'saisie-pendant-attente' } });
    await act(async () => finish(stage === 'authentification' ? { personalUser: { uid: 'owner' }, bridgeUser: { uid: 'bridge' } } : emptyPersonalVaultPayload('atlas')));
    expect(screen.queryByRole('heading', { name: 'Propriétaires des biens' })).toBeNull();
    expect(mocks.load).toHaveBeenCalledTimes(stage === 'authentification' ? 0 : 1); expect(mocks.save).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('identifiants ont changé');
    mocks.authenticate.mockResolvedValueOnce({ personalUser: { uid: 'owner' }, bridgeUser: { uid: 'bridge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrer dans le Coffre' }));
    await screen.findByRole('heading', { name: 'Propriétaires des biens' });
    expect(mocks.load.mock.calls.at(-1)![0].password).toBe('saisie-pendant-attente');
  });
  it('après ouverture et effacement du formulaire, chaque sauvegarde utilise encore le mot de passe Auth confirmé', async () => {
    let envelope: Awaited<ReturnType<typeof encryptPersonalPayload>> | undefined;
    mocks.authenticate.mockResolvedValue({ personalUser: { uid: 'owner' }, bridgeUser: { uid: 'bridge' } });
    mocks.save.mockImplementation(async ({ payload, password }) => { envelope = await encryptPersonalPayload({ payload, password, userAlias: 'atlas' }); });
    render(<PersonalVaultApp />); enter();
    await screen.findByRole('heading', { name: 'Propriétaires des biens' });
    fireEvent.click(screen.getByRole('button', { name: 'Chiffrer et enregistrer' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Coffre chiffré enregistré'));
    expect(mocks.save.mock.calls.every(([input]) => input.password === 'auth-password-original')).toBe(true);
    await expect(decryptPersonalPayload({ envelope: envelope!, password: 'auth-password-original', userAlias: 'atlas' })).resolves.toHaveProperty('userName', 'atlas');
    await expect(decryptPersonalPayload({ envelope: envelope!, password: '', userAlias: 'atlas' })).rejects.toThrow();
  });
});
