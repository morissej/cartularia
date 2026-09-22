import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIVATE_SESSION_LOCK_EVENT } from '../../src/security/privateSessionEvents.ts';

const mocks = vi.hoisted(() => ({
  accessible: true,
  cartularyId: 'cart-private',
  flush: vi.fn(async () => undefined),
  deleteLocal: vi.fn(async () => undefined),
  deleteCloud: vi.fn(async () => undefined),
  resolveConflict: vi.fn(),
  onAuthStateChanged: vi.fn(),
  unsubscribe: vi.fn(),
  markUserActivity: vi.fn(async () => undefined),
  synchronizePrivateDraft: vi.fn(async () => ({
    status: 'synced',
    pendingCount: 0,
    pushed: 0,
    pulled: 0,
    conflicts: [],
    pulledStateKeys: [],
    pulledBinaryIds: [],
    lastSyncedAt: '2026-08-18T00:00:00.000Z',
    authoritativeSyncStatus: 'not_requested',
  })),
}));

vi.mock('../../src/persistence/localVault.ts', () => ({
  cartulariaLocalVault: {
    flush: mocks.flush,
    deleteAllLocalData: mocks.deleteLocal,
    identityUid: 'owner-pf5',
    get cartularyId() { return mocks.cartularyId; },
    get isAccessible() { return mocks.accessible; },
    assertAccessible: () => { if (!mocks.accessible) throw new Error('revoked'); },
    revokeAccess: () => { mocks.accessible = false; },
  },
  LocalVaultAccessError: class extends Error {},
  DEFAULT_LOCAL_CARTULARY_ID: 'cart-test',
  VAULT_UPDATED_EVENT: 'cartularia:vault-updated',
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mocks.onAuthStateChanged,
}));

vi.mock('../../src/firebase.ts', () => ({ auth: { currentUser: null } }));

vi.mock('../../src/persistence/cloudDraft.ts', () => ({
  markUserActivity: mocks.markUserActivity,
  synchronizePrivateDraft: mocks.synchronizePrivateDraft,
  waitForAuthoritativeSyncCycle: vi.fn(async () => undefined),
  deletePrivateCloudDraft: mocks.deleteCloud,
  resolvePrivateDraftConflict: mocks.resolveConflict,
}));

import { CLOUD_PULL_APPLIED_EVENT, useHybridPersistence } from '../../src/persistence/useHybridPersistence.ts';

const report = () => ({ status: 'synced' as const, pendingCount: 0, pushed: 0, pulled: 1, conflicts: [], pulledStateKeys: ['cartularia-specification-groups'], pulledBinaryIds: [], lastSyncedAt: '2026-08-18T00:00:00.000Z', authoritativeSyncStatus: 'not_requested' as const });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const connect = async () => {
  let observer!: (user: { uid: string; email: string } | null) => void;
  mocks.onAuthStateChanged.mockImplementation((_auth, callback) => { observer = callback; return mocks.unsubscribe; });
  const hook = renderHook(() => useHybridPersistence('cart-private', true));
  await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalled());
  await act(async () => observer({ uid: 'owner-pf5', email: 'owner@example.test' }));
  return { ...hook, observer };
};

describe('chargement distant conditionnel PF5', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    mocks.accessible = true;
    mocks.cartularyId = 'cart-private';
    mocks.markUserActivity.mockReset().mockResolvedValue(undefined);
    mocks.synchronizePrivateDraft.mockReset().mockResolvedValue(report());
    mocks.deleteCloud.mockReset().mockResolvedValue(undefined);
    mocks.deleteLocal.mockReset().mockResolvedValue(undefined);
    mocks.flush.mockReset().mockResolvedValue(undefined);
    mocks.resolveConflict.mockReset().mockResolvedValue(report());
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null);
      return mocks.unsubscribe;
    });
  });

  it('reste entièrement local quand la synchronisation distante est désactivée', async () => {
    mocks.cartularyId = 'cart-iwc';
    const { result } = renderHook(() => useHybridPersistence('cart-iwc', false));

    await waitFor(() => expect(mocks.flush).toHaveBeenCalled());
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled();
    expect(mocks.synchronizePrivateDraft).not.toHaveBeenCalled();
    expect(result.current.cloudStatus).toBe('signed-out');
    expect(result.current.authenticated).toBe(false);
  });

  it('charge Auth puis le brouillon cloud pour un Cartulaire privé distant', async () => {
    let authCallback: ((user: { uid: string; email: string } | null) => void) | undefined;
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      authCallback = callback;
      return mocks.unsubscribe;
    });
    const { result, unmount } = renderHook(() => useHybridPersistence('cart-private', true));

    await waitFor(() => expect(mocks.onAuthStateChanged).toHaveBeenCalledOnce());
    await act(async () => authCallback?.({ uid: 'owner-pf5', email: 'owner@example.test' }));
    await waitFor(() => expect(mocks.synchronizePrivateDraft).toHaveBeenCalled());
    expect(result.current.authenticated).toBe(true);
    expect(result.current.cloudStatus).toBe('synced');
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalled();
  });

  it('ne lance pas la synchronisation après un changement de compte pendant la mise à jour activité', async () => {
    const activity = deferred<void>();
    mocks.markUserActivity.mockReturnValueOnce(activity.promise);
    const { observer, result } = await connect();
    await waitFor(() => expect(mocks.markUserActivity).toHaveBeenCalledOnce());
    await act(async () => observer({ uid: 'other-account', email: 'other@example.test' }));
    await act(async () => activity.resolve());
    expect(mocks.synchronizePrivateDraft).not.toHaveBeenCalled();
    expect(result.current.authenticated).toBe(false);
    expect(result.current.lastSyncedAt).toBeNull();
  });

  it('ne publie pas le résultat tardif d’une synchronisation après déconnexion', async () => {
    const sync = deferred<ReturnType<typeof report>>();
    mocks.synchronizePrivateDraft.mockReturnValueOnce(sync.promise);
    const event = vi.fn();
    window.addEventListener(CLOUD_PULL_APPLIED_EVENT, event);
    const { observer, result } = await connect();
    await waitFor(() => expect(mocks.synchronizePrivateDraft).toHaveBeenCalledOnce());
    await act(async () => observer(null));
    await act(async () => sync.resolve(report()));
    expect(event).not.toHaveBeenCalled();
    expect(result.current.lastSyncedAt).toBeNull();
    expect(result.current.cloudStatus).toBe('signed-out');
    window.removeEventListener(CLOUD_PULL_APPLIED_EVENT, event);
  });

  it('arrête le callback cloud et ne programme aucune reprise après démontage', async () => {
    const sync = deferred<ReturnType<typeof report>>();
    mocks.synchronizePrivateDraft.mockReturnValueOnce(sync.promise);
    const { unmount } = await connect();
    await waitFor(() => expect(mocks.synchronizePrivateDraft).toHaveBeenCalledOnce());
    const input = mocks.synchronizePrivateDraft.mock.calls[0][0] as unknown as { assertActive: () => void };
    unmount();
    expect(() => input.assertActive()).toThrow();
    vi.useFakeTimers();
    await act(async () => sync.reject(new Error('late failure')));
    await act(async () => vi.runAllTimersAsync());
    expect(mocks.synchronizePrivateDraft).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('l’événement de verrouillage invalide la réponse et les reprises avant le signOut distant', async () => {
    const sync = deferred<ReturnType<typeof report>>();
    mocks.synchronizePrivateDraft.mockReturnValueOnce(sync.promise);
    const { result } = await connect();
    await waitFor(() => expect(mocks.synchronizePrivateDraft).toHaveBeenCalledOnce());
    await act(async () => window.dispatchEvent(new Event(PRIVATE_SESSION_LOCK_EVENT)));
    vi.useFakeTimers();
    await act(async () => sync.reject(new Error('late failure')));
    await act(async () => vi.runAllTimersAsync());
    expect(result.current.authenticated).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mocks.synchronizePrivateDraft).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('une suppression distante en cours ne purge pas les brouillons locaux après changement de compte', async () => {
    const deletion = deferred<void>();
    mocks.deleteCloud.mockReturnValueOnce(deletion.promise);
    const { result, observer } = await connect();
    await waitFor(() => expect(result.current.cloudStatus).toBe('synced'));
    let deleting!: Promise<void>;
    act(() => { deleting = result.current.deleteAllData(); });
    await waitFor(() => expect(mocks.deleteCloud).toHaveBeenCalledOnce());
    await act(async () => observer({ uid: 'other-account', email: 'other@example.test' }));
    await act(async () => { deletion.resolve(); await deleting; });
    expect(mocks.deleteLocal).not.toHaveBeenCalled();
    expect(result.current.localStatus).not.toBe('deleted');
  });


it('une synchronisation pending reste affichée en cours et programme son rejeu', async () => {
  const next = report();
  mocks.synchronizePrivateDraft.mockResolvedValueOnce({ ...next, status: 'pending', pendingCount: 1 });
  const paused = deferred<ReturnType<typeof report>>();
  mocks.synchronizePrivateDraft.mockReturnValueOnce(paused.promise);
  const { result, unmount } = await connect();
  await waitFor(() => expect(mocks.synchronizePrivateDraft).toHaveBeenCalledOnce());
  expect(result.current.cloudStatus).toBe('syncing');
  expect(result.current.pendingCount).toBe(1);
  expect(result.current.lastSyncedAt).toBeNull();
  await waitFor(() => expect(mocks.synchronizePrivateDraft).toHaveBeenCalledTimes(2), { timeout: 2_000 });
  await act(async () => paused.resolve(report()));
  expect(result.current.cloudStatus).toBe('synced');
  unmount();
});

});
