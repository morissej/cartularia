import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => ({
  observer: null as null | ((user: unknown) => void),
  signOut: vi.fn(async () => undefined),
}));

vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: vi.fn() },
  getIdTokenResult: vi.fn(),
  onAuthStateChanged: vi.fn((_auth, observer) => {
    firebaseAuth.observer = observer;
    return () => undefined;
  }),
  reauthenticateWithCredential: vi.fn(),
  signOut: firebaseAuth.signOut,
}));

import {
  SESSION_LOCK_STORAGE_KEY,
  installSessionLock,
} from '../../src/security/sessionSecurity.ts';

describe('écran de verrouillage de session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    document.getElementById('cartularia-session-lock-screen')?.remove();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    document.getElementById('cartularia-session-lock-screen')?.remove();
  });

  it('masque le Cartulaire et ferme Auth lorsque le délai est atteint', async () => {
    let now = 1_000;
    const user = { uid: 'owner-session-lock' };
    const auth = { currentUser: user };
    const cleanup = installSessionLock(auth as never, {
      idleTimeoutMs: 1_000,
      hiddenTimeoutMs: 500,
      checkIntervalMs: 100,
      now: () => now,
    });
    firebaseAuth.observer?.(user);

    now = 2_000;
    await vi.advanceTimersByTimeAsync(100);

    expect(firebaseAuth.signOut).toHaveBeenCalledWith(auth);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Session verrouillée');
    expect(window.localStorage.getItem(SESSION_LOCK_STORAGE_KEY)).toBe('locked');
    cleanup();
  });
});
