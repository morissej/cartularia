import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';
import { PersonalVaultApp } from '../../src/personalVault/PersonalVaultApp';
import { emptyPersonalVaultPayload } from '../../src/personalVault/types';
import { PERSONAL_VAULT_HIDDEN_MS, PERSONAL_VAULT_IDLE_MS, PERSONAL_VAULT_TOKEN_REFRESH_MS } from '../../src/personalVault/sessionSecurity';
import { forgetLockedVaultDraft, readLockedVaultDraft } from '../../src/personalVault/lockedDraft';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as User | null }, listener: null as null | ((user: User | null) => void),
  refresh: vi.fn(), authenticate: vi.fn(), load: vi.fn(), save: vi.fn(), lock: vi.fn(), codes: vi.fn(),
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, listener: (user: User | null) => void) => { mocks.listener = listener; listener(mocks.auth.currentUser); return () => { mocks.listener = null; }; } }));
vi.mock('../../src/personalVault/firebase', () => ({ personalVaultIsConfigured: true, personalAuth: mocks.auth }));
vi.mock('../../src/personalVault/repository', () => ({ authenticatePersonalVault: mocks.authenticate, loadPersonalVault: mocks.load, savePersonalVault: mocks.save, lockPersonalVault: mocks.lock }));
vi.mock('../../src/personalVault/codeBridgeRepository', () => ({ loadOwnerObjectCodes: async () => new Map(), saveCodeCorrespondences: mocks.codes }));
vi.mock('../../src/personalVault/PersonalRecovery', () => ({ PersonalRecoveryPanel: () => null, RecoveryAccessForm: () => null }));
vi.mock('../../src/personalVault/CodeHandoffSender', () => ({ CodeHandoffSender: () => null }));
const uid = 'session-lock-owner';
const emit = (next: string | null) => {
  mocks.auth.currentUser = next ? { uid: next, getIdToken: mocks.refresh } as unknown as User : null;
  mocks.listener?.(mocks.auth.currentUser);
};
const enter = () => {
  fireEvent.change(screen.getByLabelText('Nom utilisateur Cartularia'), { target: { value: 'atlas' } });
  fireEvent.change(screen.getByLabelText('Mot de passe dédié'), { target: { value: 'personal-password-only' } });
  fireEvent.click(screen.getByRole('button', { name: 'Entrer dans le Coffre' }));
};
const open = async () => {
  render(<PersonalVaultApp />); enter();
  await screen.findByRole('heading', { name: 'Propriétaires des biens' });
};
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  window.history.replaceState({}, '', '/personal-vault');
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  localStorage.clear(); forgetLockedVaultDraft(uid);
  mocks.auth.currentUser = null;
  mocks.refresh.mockResolvedValue('fresh-personal-token');
  mocks.authenticate.mockImplementation(async () => { emit(uid); return { personalUser: { uid }, bridgeUser: { uid: 'bridge-owner' } }; });
  mocks.load.mockResolvedValue(emptyPersonalVaultPayload('atlas'));
  mocks.save.mockResolvedValue(undefined); mocks.codes.mockResolvedValue(undefined);
  mocks.lock.mockImplementation(async () => { emit(null); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Coffre : fermeture de la frontière de session', () => {
  it('retire immédiatement les saisies à un changement de compte et ne les rend qu’après réauthentification puis reprise explicite', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Nom confidentiel du brouillon' } });
    act(() => emit('another-owner'));
    expect(screen.queryByLabelText('Nom', { exact: true })).toBeNull();
    expect(mocks.lock).not.toHaveBeenCalled(); // Never sign out the newly selected identity.
    await screen.findByText(/brouillon a été conservé chiffré/);
    const stored = localStorage.getItem(`cartularia:personal-vault:locked-draft:v1:${uid}`)!;
    expect(stored).not.toContain('Nom confidentiel'); expect(stored).not.toContain('personal-password-only');
    expect(await readLockedVaultDraft('another-owner', 'personal-password-only', 'atlas')).toBeNull();
    enter();
    await screen.findByRole('button', { name: 'Reprendre mon brouillon' });
    expect((screen.getByLabelText('Nom', { exact: true }) as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre mon brouillon' }));
    expect((screen.getByLabelText('Nom', { exact: true }) as HTMLInputElement).value).toBe('Nom confidentiel du brouillon');
    expect(screen.getByRole('status').textContent).toContain('Modifications non enregistrées');
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('verrouille après inactivité sans attendre la fin de la déconnexion distante', async () => {
    vi.useFakeTimers();
    render(<PersonalVaultApp />); enter();
    await act(async () => {});
    expect(screen.getByRole('heading', { name: 'Propriétaires des biens' })).toBeTruthy();
    mocks.lock.mockImplementation(() => new Promise(() => {}));
    act(() => { vi.advanceTimersByTime(PERSONAL_VAULT_IDLE_MS + 1_000); });
    expect(screen.queryByRole('heading', { name: 'Propriétaires des biens' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('inactive');
  });
  it('verrouille un onglet masqué même si son timer avait été suspendu', async () => {
    await open(); vi.useFakeTimers();
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      vi.setSystemTime(Date.now() + PERSONAL_VAULT_HIDDEN_MS + 1);
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.queryByLabelText('Nom', { exact: true })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('masqué trop longtemps');
    await act(async () => {});
  });
  it('ne réouvre pas le Coffre quand un ancien déchiffrement répond après la perte Auth', async () => {
    let finish!: (value: unknown) => void;
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<PersonalVaultApp />); enter();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    act(() => emit(null));
    await act(async () => finish(emptyPersonalVaultPayload('atlas')));
    expect(screen.queryByLabelText('Nom', { exact: true })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('session du Coffre a changé');
  });
  it('ignore un succès de sauvegarde ancien, ne synchronise pas ses codes et conserve la saisie capturée au verrouillage', async () => {
    let finish!: () => void;
    mocks.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await open();
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Avant envoi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chiffrer et enregistrer' }));
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Dernière saisie à préserver' } });
    act(() => emit(null));
    expect(screen.queryByLabelText('Nom', { exact: true })).toBeNull();
    await screen.findByText(/brouillon a été conservé chiffré/);
    enter();
    await screen.findByRole('button', { name: 'Reprendre mon brouillon' });
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Reprendre mon brouillon' })).toBeTruthy();
    expect(mocks.codes).not.toHaveBeenCalled();
    expect(await readLockedVaultDraft(uid, 'personal-password-only', 'atlas')).toMatchObject({ owners: [expect.objectContaining({ fields: expect.arrayContaining([expect.objectContaining({ value: 'Dernière saisie à préserver' })]) })] });
  });
  it('retire le formulaire sur refus de permission du Coffre et préserve le brouillon chiffré', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Nom', { exact: true }), { target: { value: 'Saisie avant refus' } });
    mocks.save.mockRejectedValueOnce(Object.assign(new Error('Access revoked'), { code: 'permission-denied' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chiffrer et enregistrer' }));
    await screen.findByText(/brouillon a été conservé chiffré/);
    expect(screen.queryByLabelText('Nom', { exact: true })).toBeNull();
    expect(mocks.codes).not.toHaveBeenCalled();
  });
  it('démarre une nouvelle période d’activité après une connexion depuis un écran verrouillé ancien', async () => {
    vi.useFakeTimers();
    render(<PersonalVaultApp />);
    act(() => { vi.advanceTimersByTime(PERSONAL_VAULT_IDLE_MS + 1_000); });
    enter(); await act(async () => {});
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByRole('heading', { name: 'Propriétaires des biens' })).toBeTruthy();
  });
  it('ferme sur révocation du token personnel à la vérification périodique', async () => {
    vi.useFakeTimers();
    render(<PersonalVaultApp />); enter(); await act(async () => {});
    mocks.refresh.mockRejectedValueOnce(Object.assign(new Error('Revoked'), { code: 'auth/user-token-expired' }));
    await act(async () => { vi.advanceTimersByTime(PERSONAL_VAULT_TOKEN_REFRESH_MS); });
    expect(mocks.refresh).toHaveBeenCalledWith(true);
    expect(screen.queryByLabelText('Nom', { exact: true })).toBeNull();
  });
  it('tolère une erreur réseau au retour focus et ignore ensuite un refus de token d’une ancienne session', async () => {
    await open();
    mocks.refresh.mockRejectedValueOnce(Object.assign(new Error('Offline'), { code: 'auth/network-request-failed' }));
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.getByLabelText('Nom', { exact: true })).toBeTruthy();
    let reject!: (error: unknown) => void;
    mocks.refresh.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    act(() => window.dispatchEvent(new Event('focus')));
    act(() => emit(null));
    enter(); await screen.findByRole('heading', { name: 'Propriétaires des biens' });
    await act(async () => reject(Object.assign(new Error('Old revoked token'), { code: 'auth/user-disabled' })));
    expect(screen.getByLabelText('Nom', { exact: true })).toBeTruthy();
  });
  it('ferme le rendu même si la déconnexion échoue', async () => {
    await open(); mocks.lock.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Verrouiller', exact: true }));
    expect(screen.queryByLabelText('Nom', { exact: true })).toBeNull();
    await screen.findByText(/verrouillé localement/);
  });
});
