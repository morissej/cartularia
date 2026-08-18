import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import {
  deletePrivateCloudDraft,
  markUserActivity,
  resolvePrivateDraftConflict,
  synchronizePrivateDraft,
  waitForAuthoritativeSyncCycle,
  type CloudSyncReport,
} from './cloudDraft';
import {
  cartulariaLocalVault,
  DEFAULT_LOCAL_CARTULARY_ID,
  VAULT_UPDATED_EVENT,
} from './localVault';
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

export function useHybridPersistence(cartularyId = DEFAULT_LOCAL_CARTULARY_ID): HybridPersistenceState {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [localStatus, setLocalStatus] = useState<LocalPersistenceStatus>('ready');
  const [cloudStatus, setCloudStatus] = useState<CloudPersistenceStatus>(auth.currentUser ? 'syncing' : 'signed-out');
  const [report, setReport] = useState(emptyReport);
  const [error, setError] = useState<string | null>(null);
  const syncInFlight = useRef<Promise<void> | null>(null);
  const syncNowRef = useRef<() => Promise<void>>(async () => undefined);
  const followUpTimer = useRef<number | undefined>(undefined);
  const retryAttempt = useRef(0);
  const rerunRequested = useRef(false);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setCloudStatus(nextUser ? 'syncing' : 'signed-out');
    if (!nextUser) setReport(emptyReport);
  }), []);

  const syncNow = useCallback(async () => {
    if (!cartulariaLocalVault) return;
    const vault = cartulariaLocalVault;
    if (!user) {
      await vault.flush();
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
        await markUserActivity(user.uid).catch(() => undefined);
        const nextReport = await synchronizePrivateDraft({ uid: user.uid, cartularyId, vault });
        setReport({
          lastSyncedAt: nextReport.lastSyncedAt,
          pendingCount: nextReport.pushed + nextReport.pulled,
          conflicts: nextReport.conflicts,
        });
        setCloudStatus(nextReport.status === 'remote_deleted'
          ? 'remote-deleted'
          : nextReport.status);
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
          rerunRequested.current = true;
        }
      } catch (syncError) {
        const retryDelay = cloudSyncRetryDelay(retryAttempt.current);
        if (retryDelay === null) {
          setCloudStatus('error');
          setError(messageFromError(syncError));
        } else {
          retryAttempt.current += 1;
          setCloudStatus('syncing');
          followUpTimer.current = window.setTimeout(() => {
            followUpTimer.current = undefined;
            void syncNowRef.current();
          }, retryDelay);
        }
      }
    })();
    syncInFlight.current = operation;
    await operation.finally(() => {
      syncInFlight.current = null;
      if (rerunRequested.current && followUpTimer.current === undefined) {
        rerunRequested.current = false;
        followUpTimer.current = window.setTimeout(() => {
          followUpTimer.current = undefined;
          void syncNowRef.current();
        }, AUTHORITATIVE_SYNC_FOLLOW_UP_DELAY_MS);
      }
    });
  }, [cartularyId, user]);

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
    if (!cartulariaLocalVault) return;
    const vault = cartulariaLocalVault;
    let timer: number | undefined;
    const handleUpdate = () => {
      setLocalStatus('saving');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void vault.flush()
          .then(() => {
            setLocalStatus('ready');
            return syncNow();
          })
          .catch((localError: unknown) => {
            setLocalStatus('error');
            setError(messageFromError(localError));
          });
      }, LOCAL_CHANGE_COALESCE_DELAY_MS);
    };
    window.addEventListener(VAULT_UPDATED_EVENT, handleUpdate);
    void syncNow();
    return () => {
      window.removeEventListener(VAULT_UPDATED_EVENT, handleUpdate);
      window.clearTimeout(timer);
    };
  }, [syncNow]);

  const deleteAllData = useCallback(async () => {
    if (!cartulariaLocalVault) return;
    setError(null);
    try {
      if (user) await deletePrivateCloudDraft(user.uid, cartularyId);
      await cartulariaLocalVault.deleteAllLocalData();
      setLocalStatus('deleted');
      setCloudStatus(user ? 'remote-deleted' : 'signed-out');
    } catch (deleteError) {
      setError(messageFromError(deleteError));
      throw deleteError;
    }
  }, [cartularyId, user]);

  const resolveConflict = useCallback(async (
    conflict: CloudSyncReport['conflicts'][number],
    strategy: 'keep-local' | 'take-cloud',
  ) => {
    if (!cartulariaLocalVault || !user) return;
    setCloudStatus('syncing');
    setError(null);
    try {
      const nextReport = await resolvePrivateDraftConflict({
        uid: user.uid,
        cartularyId,
        vault: cartulariaLocalVault,
        conflict,
        strategy,
      });
      setReport({
        lastSyncedAt: nextReport.lastSyncedAt,
        pendingCount: nextReport.pushed + nextReport.pulled,
        conflicts: nextReport.conflicts,
      });
      setCloudStatus(nextReport.status === 'remote_deleted' ? 'remote-deleted' : nextReport.status);
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
      setCloudStatus('error');
      setError(messageFromError(resolutionError));
    }
  }, [cartularyId, user]);

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
