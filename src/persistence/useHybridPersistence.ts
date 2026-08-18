import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import {
  deletePrivateCloudDraft,
  markUserActivity,
  resolvePrivateDraftConflict,
  synchronizePrivateDraft,
  type CloudSyncReport,
} from './cloudDraft';
import {
  cartulariaLocalVault,
  DEFAULT_LOCAL_CARTULARY_ID,
  VAULT_UPDATED_EVENT,
} from './localVault';

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
    if (syncInFlight.current) return syncInFlight.current;

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
      } catch (syncError) {
        setCloudStatus('error');
        setError(messageFromError(syncError));
      }
    })();
    syncInFlight.current = operation;
    await operation.finally(() => {
      syncInFlight.current = null;
    });
  }, [cartularyId, user]);

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
      }, 800);
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
