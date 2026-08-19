import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flush: vi.fn(async () => undefined),
  onAuthStateChanged: vi.fn(),
  unsubscribe: vi.fn(),
  markUserActivity: vi.fn(async () => undefined),
  synchronizePrivateDraft: vi.fn(async () => ({
    status: 'synced',
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
    deleteAllLocalData: vi.fn(async () => undefined),
  },
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
  deletePrivateCloudDraft: vi.fn(async () => undefined),
  resolvePrivateDraftConflict: vi.fn(),
}));

import { useHybridPersistence } from '../../src/persistence/useHybridPersistence.ts';

describe('chargement distant conditionnel PF5', () => {
  beforeEach(() => {
    mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
      callback(null);
      return mocks.unsubscribe;
    });
  });

  it('reste entièrement local quand la synchronisation distante est désactivée', async () => {
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
});
