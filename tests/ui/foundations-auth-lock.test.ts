import type { User } from 'firebase/auth';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  auth: { currentUser: null as User | null },
  signIn: vi.fn(), createUser: vi.fn(), updateProfile: vi.fn(), getDoc: vi.fn(), activate: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ auth: api.auth, db: {}, functions: {} }));
vi.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: api.createUser,
  signInWithEmailAndPassword: api.signIn,
  updateProfile: api.updateProfile,
  onAuthStateChanged: vi.fn(), signOut: vi.fn(), EmailAuthProvider: {}, getIdTokenResult: vi.fn(), reauthenticateWithCredential: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'), getDoc: api.getDoc,
  collection: vi.fn(), collectionGroup: vi.fn(), documentId: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => api.activate }));

import {
  createCartulariaAccount,
  registryAuthenticationEmail,
  resumeRegistryAccountActivation,
  signInToCartularia,
} from '../../src/services/foundations';
import { SESSION_LOCK_STORAGE_KEY } from '../../src/security/sessionSecurity';

const user = { uid: 'fresh-user', email: 'owner@example.test', displayName: 'Atelier test' } as User;
const marker = () => window.localStorage.getItem(SESSION_LOCK_STORAGE_KEY);
const overlay = () => document.getElementById('cartularia-session-lock-screen');
const expectLocked = () => {
  expect(marker()).toBe('locked');
  expect(overlay()).not.toBeNull();
};
const expectUnlocked = () => {
  expect(marker()).toBeNull();
  expect(overlay()).toBeNull();
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  api.auth.currentUser = null;
  api.signIn.mockReset().mockResolvedValue({ user });
  api.createUser.mockReset().mockResolvedValue({ user });
  api.updateProfile.mockReset().mockResolvedValue(undefined);
  api.getDoc.mockReset().mockResolvedValue({ exists: () => true });
  api.activate.mockReset().mockResolvedValue({ data: { registryId: 'registry-new' } });
  window.localStorage.setItem(SESSION_LOCK_STORAGE_KEY, 'locked');
  const lockScreen = document.createElement('div');
  lockScreen.id = 'cartularia-session-lock-screen';
  document.body.append(lockScreen);
});

afterEach(() => {
  window.localStorage.removeItem(SESSION_LOCK_STORAGE_KEY);
  overlay()?.remove();
  vi.unstubAllGlobals();
});

describe('déverrouillage après authentification explicite du Registre', () => {
  it('retire le verrou dès la connexion Firebase réussie, avant l’activation', async () => {
    api.getDoc.mockImplementation(async () => { expectUnlocked(); return { exists: () => true }; });
    expect(await signInToCartularia('owner@example.test', 'correct-password')).toBe(user);
    expectUnlocked();
  });

  it('retire le verrou après la création Firebase, avant le profil et l’activation', async () => {
    const newUser = { ...user, displayName: null } as User;
    api.createUser.mockResolvedValue({ user: newUser });
    api.updateProfile.mockImplementation(async () => { expectUnlocked(); });
    api.getDoc.mockImplementation(async () => { expectUnlocked(); return { exists: () => false }; });
    expect(await createCartulariaAccount('Atelier test', 'correct-password')).toBe(newUser);
    expect(api.createUser).toHaveBeenCalledOnce();
    expect(api.activate).toHaveBeenCalledWith({ userName: 'Atelier test' });
    expectUnlocked();
  });

  it.each(['sign-in', 'create'] as const)('garde le verrou si Firebase refuse %s', async (action) => {
    const error = new Error('auth/invalid-credential');
    api.signIn.mockRejectedValue(error);
    api.createUser.mockRejectedValue(error);
    const attempt = action === 'sign-in'
      ? signInToCartularia('owner@example.test', 'incorrect-password')
      : createCartulariaAccount('Atelier test', 'incorrect-password');
    await expect(attempt).rejects.toBe(error);
    expectLocked();
    expect(api.getDoc).not.toHaveBeenCalled();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it.each(['sign-in', 'create'] as const)('conserve la preuve d’authentification %s même si l’activation échoue ensuite', async (action) => {
    api.getDoc.mockRejectedValue(new Error('network-unavailable'));
    const attempt = action === 'sign-in'
      ? signInToCartularia('owner@example.test', 'correct-password')
      : createCartulariaAccount('Atelier test', 'correct-password');
    await expect(attempt).rejects.toMatchObject({ code: 'account/activation-incomplete' });
    expectUnlocked();
  });

  it('ne retire pas le verrou quand la création reprend la session déjà présente', async () => {
    api.auth.currentUser = { ...user, email: await registryAuthenticationEmail('Atelier test') } as User;
    api.getDoc.mockResolvedValue({ exists: () => false });
    expect(await createCartulariaAccount('Atelier test', 'unused-password')).toBe(api.auth.currentUser);
    expect(api.createUser).not.toHaveBeenCalled();
    expect(api.signIn).not.toHaveBeenCalled();
    expect(api.activate).toHaveBeenCalledOnce();
    expectLocked();
  });

  it('ne retire pas le verrou lors d’une simple reprise d’activation', async () => {
    api.auth.currentUser = user;
    api.getDoc.mockResolvedValue({ exists: () => false });
    expect(await resumeRegistryAccountActivation('Atelier test')).toBe(user);
    expect(api.createUser).not.toHaveBeenCalled();
    expect(api.signIn).not.toHaveBeenCalled();
    expect(api.activate).toHaveBeenCalledOnce();
    expectLocked();
  });

  it('garde le verrou quand la reprise ne dispose d’aucune session', async () => {
    await expect(resumeRegistryAccountActivation()).rejects.toThrow('account/sign-in-required');
    expectLocked();
    expect(api.getDoc).not.toHaveBeenCalled();
  });
});
