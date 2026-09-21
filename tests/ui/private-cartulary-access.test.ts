import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as null | { uid: string; getIdToken: ReturnType<typeof vi.fn> } },
  authObserver: null as null | ((user: unknown) => void),
  snapshots: new Map<string, { next: (value: unknown) => void; error: (error: unknown) => void }>(),
  stop: vi.fn(),
}));
vi.mock('../../src/firebase.ts', () => ({ auth: mocks.auth, db: {} }));
vi.mock('../../src/security/sessionSecurity.ts', () => ({ SESSION_LOCK_STORAGE_KEY: 'cartularia-session-lock-v1' }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: vi.fn((_auth, next) => { mocks.authObserver = next; return mocks.stop; }) }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...parts: string[]) => parts.join('/')),
  onSnapshot: vi.fn((path, _options, next, error) => { mocks.snapshots.set(path, { next, error }); return mocks.stop; }),
}));
import { observePrivateCartularyAccess } from '../../src/security/privateCartularyAccess.ts';
const account = (fromCache = false, status = 'active', hasPendingWrites = false) => ({ metadata: { fromCache, hasPendingWrites }, exists: () => true, data: () => ({ status }) });
const dossier = (fromCache = false, hasPendingWrites = false) => ({ metadata: { fromCache, hasPendingWrites }, exists: () => true, data: () => ({}) });
const signIn = (uid = 'owner-A') => {
  mocks.auth.currentUser = { uid, getIdToken: vi.fn(async () => 'token') };
  mocks.authObserver?.(mocks.auth.currentUser);
};
beforeEach(() => { mocks.snapshots.clear(); window.localStorage.clear(); mocks.auth.currentUser = null; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); window.localStorage.clear(); });
describe('autorisation privée exigeant le serveur', () => {
  it('ne permet jamais au cache Firestore d’ouvrir le dossier', () => {
    const observer = vi.fn();
    const stop = observePrivateCartularyAccess('cart-private', observer);
    signIn();
    mocks.snapshots.get('users/owner-A')!.next(account(true));
    mocks.snapshots.get('cartularies/cart-private')!.next(dossier(true));
    expect(observer).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'authorized' }));
    mocks.snapshots.get('users/owner-A')!.next(account());
    mocks.snapshots.get('cartularies/cart-private')!.next(dossier());
    expect(observer).toHaveBeenLastCalledWith({ status: 'authorized', uid: 'owner-A' });
    stop();
  });
  it('ferme après révocation des droits ou suspension du compte', () => {
    const observer = vi.fn();
    const stop = observePrivateCartularyAccess('cart-private', observer);
    signIn();
    mocks.snapshots.get('users/owner-A')!.next(account());
    mocks.snapshots.get('cartularies/cart-private')!.next(dossier());
    mocks.snapshots.get('users/owner-A')!.next(account(false, 'suspended'));
    expect(observer).toHaveBeenLastCalledWith({ status: 'denied' });
    mocks.snapshots.get('cartularies/cart-private')!.error({ code: 'permission-denied' });
    expect(observer).toHaveBeenLastCalledWith({ status: 'denied' });
    stop();
  });
  it('attend aussi la confirmation des écritures locales optimistes', () => {
    const observer = vi.fn();
    const stop = observePrivateCartularyAccess('cart-private', observer);
    signIn();
    mocks.snapshots.get('users/owner-A')!.next(account(false, 'active', true));
    mocks.snapshots.get('cartularies/cart-private')!.next(dossier(false, true));
    expect(observer).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'authorized' }));
    mocks.snapshots.get('users/owner-A')!.next(account());
    expect(observer).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'authorized' }));
    mocks.snapshots.get('cartularies/cart-private')!.next(dossier());
    expect(observer).toHaveBeenLastCalledWith({ status: 'authorized', uid: 'owner-A' });
    stop();
  });
  it('ignore un ancien callback même lorsque A revient après B', () => {
    const observer = vi.fn();
    const stop = observePrivateCartularyAccess('cart-private', observer);
    signIn();
    const oldAccount = mocks.snapshots.get('users/owner-A')!;
    const oldDossier = mocks.snapshots.get('cartularies/cart-private')!;
    signIn('owner-B'); signIn('owner-A');
    oldAccount.next(account()); oldDossier.next(dossier());
    expect(observer).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'authorized' }));
    stop();
  });
  it('reste fermé sur timeout hors ligne', async () => {
    const observer = vi.fn();
    const stop = observePrivateCartularyAccess('cart-private', observer);
    signIn();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observer).toHaveBeenLastCalledWith({ status: 'error' });
    stop();
  });
  it('détecte le token révoqué au retour sur la fenêtre', async () => {
    const observer = vi.fn();
    const stop = observePrivateCartularyAccess('cart-private', observer);
    signIn();
    mocks.auth.currentUser!.getIdToken.mockRejectedValueOnce({ code: 'auth/user-token-expired' });
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(observer).toHaveBeenLastCalledWith({ status: 'denied' }));
    stop();
  });
  it('un marqueur de verrouillage ne se rouvre pas avec un token encore en mémoire', () => {
    window.localStorage.setItem('cartularia-session-lock-v1', 'locked');
    const observer = vi.fn();
    const stop = observePrivateCartularyAccess('cart-private', observer);
    signIn();
    expect(observer).toHaveBeenLastCalledWith({ status: 'signed-out' });
    expect(mocks.snapshots.size).toBe(0);
    stop();
  });
});
