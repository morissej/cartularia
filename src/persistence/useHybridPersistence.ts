import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { CloudSyncReport } from './cloudDraft';
import {
  cartulariaLocalVault,
  LocalVaultAccessError,
  DEFAULT_LOCAL_CARTULARY_ID,
  VAULT_UPDATED_EVENT,
} from './localVault';
import { PRIVATE_SESSION_LOCK_EVENT } from '../security/privateSessionEvents.ts';
import {
  AUTHORITATIVE_SYNC_FOLLOW_UP_DELAY_MS,
  cloudSyncRetryDelay,
  LOCAL_CHANGE_COALESCE_DELAY_MS,
} from './syncQueuePolicy';

export type LocalPersistenceStatus = 'ready' | 'saving' | 'error' | 'deleted';
export type CloudPersistenceStatus = 'signed-out' | 'syncing' | 'synced' | 'conflict' | 'remote-deleted' | 'error';
export const CLOUD_PULL_APPLIED_EVENT = 'cartularia:cloud-pull-applied';

export interface CloudPullAppliedDetail {
  cartularyId: string;
  stateKeys: string[];
  binaryIds: string[];
}

const notifyCloudPullApplied = (detail: CloudPullAppliedDetail) => {
  if (detail.stateKeys.length === 0 && detail.binaryIds.length === 0) return;
  window.dispatchEvent(new CustomEvent<CloudPullAppliedDetail>(CLOUD_PULL_APPLIED_EVENT, { detail }));
};

export interface HybridPersistenceState {
  localStatus: LocalPersistenceStatus;
  cloudStatus: CloudPersistenceStatus;
  authenticated: boolean;
  accountLabel: string | null;
  lastSyncedAt: string | null;
  pendingCount: number;
  conflicts: CloudSyncReport['conflicts'];
  error: string | null;
  syncNow: () => Promise<void>;
  resolveConflict: (conflict: CloudSyncReport['conflicts'][number], strategy: 'keep-local' | 'take-cloud') => Promise<void>;
  deleteAllData: () => Promise<void>;
}

const emptyReport: {
  lastSyncedAt: string | null;
  pendingCount: number;
  conflicts: CloudSyncReport['conflicts'];
} = {
  lastSyncedAt: null,
  pendingCount: 0,
  conflicts: [] as CloudSyncReport['conflicts'],
};

const messageFromError = (error: unknown) => error instanceof Error ? error.message : 'Erreur de persistance inconnue.';

export function useHybridPersistence(
  cartularyId = DEFAULT_LOCAL_CARTULARY_ID,
  remoteSyncEnabled = true,
): HybridPersistenceState {
  const [user, setUser] = useState<User | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalPersistenceStatus>('ready');
  const [cloudStatus, setCloudStatus] = useState<CloudPersistenceStatus>('signed-out');
  const [report, setReport] = useState(emptyReport);
  const [error, setError] = useState<string | null>(null);
  // Keep this handle immutable: a callback from account A must never target account B's export.
  const vault = useRef(cartulariaLocalVault).current;
  const lifecycle = useRef({ mounted: false, closed: false, terminal: false, epoch: 0, uid: vault?.identityUid ?? null });
  const syncInFlight = useRef<Promise<void> | null>(null);
  const syncNowRef = useRef<() => Promise<void>>(async () => undefined);
  const followUpTimer = useRef<number | undefined>(undefined);
  const retryAttempt = useRef(0);
  const rerunRequested = useRef(false);

  const invalidate = useCallback(() => {
    lifecycle.current.closed = true;
    lifecycle.current.epoch += 1;
    if (followUpTimer.current !== undefined) window.clearTimeout(followUpTimer.current);
    followUpTimer.current = undefined;
    retryAttempt.current = 0;
    rerunRequested.current = false;
    syncInFlight.current = null;
  }, []);

  useEffect(() => {
    const session = lifecycle.current;
    session.mounted = true;
    session.closed = session.terminal;
    const onLock = () => {
      session.terminal = true;
      invalidate();
      setUser(null);
      setCloudStatus('signed-out');
      setReport(emptyReport);
    };
    window.addEventListener(PRIVATE_SESSION_LOCK_EVENT, onLock);
    return () => {
      session.mounted = false;
      invalidate();
      window.removeEventListener(PRIVATE_SESSION_LOCK_EVENT, onLock);
    };
  }, [invalidate, cartularyId, remoteSyncEnabled]);

  const captureOperation = useCallback(() => {
    const epoch = lifecycle.current.epoch;
    const isCurrent = () => Boolean(vault?.isAccessible && vault.cartularyId === cartularyId && lifecycle.current.mounted
      && !lifecycle.current.closed && lifecycle.current.epoch === epoch
      && (!remoteSyncEnabled || (user && lifecycle.current.uid === user.uid)));
    const assertActive = () => {
      if (!isCurrent()) throw new LocalVaultAccessError();
      vault!.assertAccessible();
    };
    return { isCurrent, assertActive };
  }, [user, vault, cartularyId, remoteSyncEnabled]);

  useEffect(() => {
    if (!remoteSyncEnabled) {
      setUser(null);
      setCloudStatus('signed-out');
      setReport(emptyReport);
      return undefined;
    }
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void Promise.all([
      import('firebase/auth'),
      import('../firebase.ts'),
    ]).then(([{ onAuthStateChanged }, { auth }]) => {
      if (!active) return;
      unsubscribe = onAuthStateChanged(auth, (nextUser) => {
        if (!active || !lifecycle.current.mounted || lifecycle.current.closed) return;
        if (!nextUser || (lifecycle.current.uid && lifecycle.current.uid !== nextUser.uid)) {
          lifecycle.current.terminal = true;
          invalidate();
          vault?.revokeAccess();
          setUser(null);
          setCloudStatus('signed-out');
          setReport(emptyReport);
          return;
        }
        lifecycle.current.uid = nextUser.uid;
        setUser(nextUser);
        setCloudStatus('syncing');
      });
    }).catch((authError: unknown) => {
      if (!active || lifecycle.current.closed) return;
      lifecycle.current.terminal = true;
      invalidate();
      vault?.revokeAccess();
      setUser(null);
      setCloudStatus('error');
      setError(messageFromError(authError));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [remoteSyncEnabled, invalidate, vault]);

  const syncNow = useCallback(async () => {
    const { isCurrent, assertActive } = captureOperation();
    if (!vault || !isCurrent()) return;
    if (!remoteSyncEnabled || !user) {
      await vault.flush();
      if (!isCurrent()) return;
      setLocalStatus('ready');
      setCloudStatus('signed-out');
      return;
    }
    if (syncInFlight.current) {
      rerunRequested.current = true;
      return syncInFlight.current;
    }
    if (followUpTimer.current !== undefined) {
      window.clearTimeout(followUpTimer.current);
      followUpTimer.current = undefined;
    }

    const operation = (async () => {
      setCloudStatus('syncing');
      setError(null);
      try {
        const {
          markUserActivity,
          synchronizePrivateDraft,
          waitForAuthoritativeSyncCycle,
        } = await import('./cloudDraft.ts');
        assertActive();
        await markUserActivity(user.uid, assertActive).catch(() => undefined);
        assertActive();
        const nextReport = await synchronizePrivateDraft({ uid: user.uid, cartularyId, vault, assertActive });
        if (!isCurrent()) return;
        setReport({
          lastSyncedAt: nextReport.status === 'synced' ? nextReport.lastSyncedAt : null,
          pendingCount: nextReport.pendingCount,
          conflicts: nextReport.conflicts,
        });
        setCloudStatus(nextReport.status === 'remote_deleted'
          ? 'remote-deleted'
          : nextReport.status === 'pending' ? 'syncing' : nextReport.status);
        if (nextReport.status === 'pending') rerunRequested.current = true;
        setLocalStatus('ready');
        notifyCloudPullApplied({
          cartularyId,
          stateKeys: nextReport.pulledStateKeys,
          binaryIds: nextReport.pulledBinaryIds,
        });
        retryAttempt.current = 0;
        if (
          nextReport.authoritativeSyncStatus === 'in_progress'
          && nextReport.authoritativeRequestId
          && nextReport.pushed > 0
        ) {
          await waitForAuthoritativeSyncCycle(cartularyId, nextReport.authoritativeRequestId);
          if (!isCurrent()) return;
          rerunRequested.current = true;
        }
      } catch (syncError) {
        if (!isCurrent()) return;
        const retryDelay = cloudSyncRetryDelay(retryAttempt.current);
        if (retryDelay === null) {
          setCloudStatus('error');
          setError(messageFromError(syncError));
        } else {
          retryAttempt.current += 1;
          setCloudStatus('syncing');
          followUpTimer.current = window.setTimeout(() => {
            followUpTimer.current = undefined;
            if (isCurrent()) void syncNowRef.current();
          }, retryDelay);
        }
      }
    })();
    syncInFlight.current = operation;
    await operation.finally(() => {
      if (syncInFlight.current === operation) syncInFlight.current = null;
      if (!isCurrent()) return;
      if (rerunRequested.current && followUpTimer.current === undefined) {
        rerunRequested.current = false;
        followUpTimer.current = window.setTimeout(() => {
          followUpTimer.current = undefined;
          if (isCurrent()) void syncNowRef.current();
        }, AUTHORITATIVE_SYNC_FOLLOW_UP_DELAY_MS);
      }
    });
  }, [cartularyId, remoteSyncEnabled, user, vault, captureOperation]);

  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  useEffect(() => () => {
    if (followUpTimer.current !== undefined) window.clearTimeout(followUpTimer.current);
    followUpTimer.current = undefined;
    retryAttempt.current = 0;
    rerunRequested.current = false;
  }, [cartularyId, user?.uid]);

  useEffect(() => {
    const { isCurrent } = captureOperation();
    if (!vault || !isCurrent()) return;
    let active = true;
    let timer: number | undefined;
    const handleUpdate = () => {
      if (!active || !isCurrent()) return;
      setLocalStatus('saving');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!active || !isCurrent()) return;
        void vault.flush()
          .then(() => {
            if (!active || !isCurrent()) return;
            setLocalStatus('ready');
            return syncNow();
          })
          .catch((localError: unknown) => {
            if (!active || !isCurrent()) return;
            setLocalStatus('error');
            setError(messageFromError(localError));
          });
      }, LOCAL_CHANGE_COALESCE_DELAY_MS);
    };
    window.addEventListener(VAULT_UPDATED_EVENT, handleUpdate);
    void syncNow();
    return () => {
      active = false;
      window.removeEventListener(VAULT_UPDATED_EVENT, handleUpdate);
      window.clearTimeout(timer);
    };
  }, [syncNow, vault, captureOperation]);

  const deleteAllData = useCallback(async () => {
    const { isCurrent, assertActive } = captureOperation();
    if (!vault || !isCurrent()) return;
    setError(null);
    try {
      if (remoteSyncEnabled && user) {
        const { deletePrivateCloudDraft } = await import('./cloudDraft.ts');
        assertActive();
        await deletePrivateCloudDraft(user.uid, cartularyId, assertActive);
      }
      assertActive();
      await vault.deleteAllLocalData();
      if (!isCurrent()) return;
      setLocalStatus('deleted');
      setCloudStatus(user ? 'remote-deleted' : 'signed-out');
    } catch (deleteError) {
      if (!isCurrent()) return;
      setError(messageFromError(deleteError));
      throw deleteError;
    }
  }, [cartularyId, remoteSyncEnabled, user, vault, captureOperation]);

  const resolveConflict = useCallback(async (
    conflict: CloudSyncReport['conflicts'][number],
    strategy: 'keep-local' | 'take-cloud',
  ) => {
    const { isCurrent, assertActive } = captureOperation();
    if (!vault || !user || !isCurrent()) return;
    setCloudStatus('syncing');
    setError(null);
    try {
      const { resolvePrivateDraftConflict } = await import('./cloudDraft.ts');
      assertActive();
      const nextReport = await resolvePrivateDraftConflict({
        uid: user.uid,
        cartularyId,
        vault,
        assertActive,
        conflict,
        strategy,
      });
      if (!isCurrent()) return;
      setReport({
        lastSyncedAt: nextReport.status === 'synced' ? nextReport.lastSyncedAt : null,
        pendingCount: nextReport.pendingCount,
        conflicts: nextReport.conflicts,
      });
      setCloudStatus(nextReport.status === 'remote_deleted' ? 'remote-deleted' : nextReport.status === 'pending' ? 'syncing' : nextReport.status);
      if (nextReport.status === 'pending') void syncNowRef.current();
      notifyCloudPullApplied({
        cartularyId,
        stateKeys: [
          ...nextReport.pulledStateKeys,
          ...(strategy === 'take-cloud' && conflict.kind === 'state' ? [conflict.id] : []),
        ],
        binaryIds: [
          ...nextReport.pulledBinaryIds,
          ...(strategy === 'take-cloud' && conflict.kind === 'binary' ? [conflict.id] : []),
        ],
      });
    } catch (resolutionError) {
      if (!isCurrent()) return;
      setCloudStatus('error');
      setError(messageFromError(resolutionError));
    }
  }, [cartularyId, user, vault, captureOperation]);

  return {
    localStatus,
    cloudStatus,
    authenticated: Boolean(user),
    accountLabel: user?.email ?? user?.uid ?? null,
    lastSyncedAt: report.lastSyncedAt,
    pendingCount: report.pendingCount,
    conflicts: report.conflicts,
    error,
    syncNow,
    resolveConflict,
    deleteAllData,
  };
}
