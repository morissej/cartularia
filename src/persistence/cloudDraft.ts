import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase.ts';
import type { CartulariaLocalVault, LocalBinaryRecord, LocalStateRecord } from './localVault.ts';
import {
  assertCloudStateSize,
  decideBinarySync,
  decideStateSync,
} from './syncModel.ts';
import type { CloudBinaryRecord, CloudStateRecord } from './syncModel.ts';
import { validateFileForUpload } from '../security/fileValidation.ts';
import { waitForPrivateUploadVerification } from '../services/privateUploadVerification.ts';

const RETENTION_POLICY_VERSION = 'inactive-plus-2y-v1';
const STATE_DOCUMENT_MAXIMUM_BYTES = 900_000;

export interface SyncConflict {
  kind: 'state' | 'binary';
  id: string;
  localRevision: number;
  cloudRevision: number;
}

export interface CloudSyncReport {
  status: 'synced' | 'conflict' | 'remote_deleted';
  authoritativeSyncStatus: 'not_requested' | 'requested' | 'in_progress';
  authoritativeRequestId: string | null;
  pushed: number;
  pulled: number;
  pulledStateKeys: string[];
  pulledBinaryIds: string[];
  conflicts: SyncConflict[];
  lastSyncedAt: string;
}

const draftRef = (uid: string, cartularyId: string) => (
  doc(db, 'privateDrafts', uid, 'cartularies', cartularyId)
);

const stateRef = (uid: string, cartularyId: string, key: string) => {
  if (!/^cartularia-[A-Za-z0-9:_-]+$/.test(key)) throw new Error(`Clé cloud refusée : ${key}`);
  return doc(db, 'privateDrafts', uid, 'cartularies', cartularyId, 'state', key);
};

const binaryRef = (uid: string, cartularyId: string, binaryId: string) => {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(binaryId)) throw new Error(`Identifiant binaire cloud refusé : ${binaryId}`);
  return doc(db, 'privateDrafts', uid, 'cartularies', cartularyId, 'binaries', binaryId);
};

const authoritativeSyncRequestRef = (cartularyId: string) => (
  doc(db, 'cartularySyncRequests', cartularyId)
);

export const requestAuthoritativeCartularySync = async ({
  uid,
  cartularyId,
  reason = 'private_draft_synchronized',
}: {
  uid: string;
  cartularyId: string;
  reason?: string;
}) => {
  const reference = authoritativeSyncRequestRef(cartularyId);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data() as { requestId?: unknown; status?: unknown } | undefined;
    if (current?.status === 'pending' || current?.status === 'processing') {
      return {
        requestId: typeof current.requestId === 'string' ? current.requestId : null,
        status: 'in_progress' as const,
      };
    }

    const requestId = `sync_${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    transaction.set(reference, {
      requestDocumentId: cartularyId,
      requestId,
      ownerUid: uid,
      cartularyId,
      reason,
      status: 'pending',
      requestedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { requestId, status: 'requested' as const };
  });
};

export const waitForAuthoritativeSyncCycle = (
  cartularyId: string,
  requestId: string,
  timeoutMs = 125_000,
) => new Promise<void>((resolve, reject) => {
  let unsubscribe: () => void = () => undefined;
  let settled = false;
  const finish = (error?: unknown) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    unsubscribe();
    if (error) reject(error);
    else resolve();
  };
  const timeout = window.setTimeout(() => {
    finish(new Error('La synchronisation autoritaire tarde à se terminer. Une reprise automatique est prévue.'));
  }, timeoutMs);
  unsubscribe = onSnapshot(authoritativeSyncRequestRef(cartularyId), (snapshot) => {
    if (!snapshot.exists()) return finish();
    const current = snapshot.data() as { requestId?: unknown; status?: unknown };
    if (current.requestId !== requestId || !['pending', 'processing'].includes(String(current.status))) finish();
  }, finish);
});

const parseCloudState = (key: string, data: Record<string, unknown>): CloudStateRecord => ({
  key,
  value: typeof data.value === 'string' ? data.value : null,
  deleted: data.deleted === true,
  revision: Number.isInteger(data.revision) ? Number(data.revision) : 0,
  clientUpdatedAt: typeof data.clientUpdatedAt === 'number' ? data.clientUpdatedAt : 0,
});

const parseCloudBinary = (binaryId: string, data: Record<string, unknown>): CloudBinaryRecord => ({
  binaryId,
  deleted: data.deleted === true,
  revision: Number.isInteger(data.revision) ? Number(data.revision) : 0,
  fileName: typeof data.fileName === 'string' ? data.fileName : binaryId,
  mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'application/octet-stream',
  size: typeof data.size === 'number' ? data.size : 0,
  sha256: typeof data.sha256 === 'string' ? data.sha256 : '',
  kind: data.kind === 'owner_document' || data.kind === 'condition_attachment' ? data.kind : 'media',
  storagePath: typeof data.storagePath === 'string' ? data.storagePath : null,
  clientUpdatedAt: typeof data.clientUpdatedAt === 'number' ? data.clientUpdatedAt : 0,
  uploadStatus: data.deleted === true
    ? 'deleted'
    : ['pending_upload', 'verifying', 'ready', 'failed'].includes(String(data.uploadStatus))
      ? data.uploadStatus as CloudBinaryRecord['uploadStatus']
      : 'ready',
  verificationStatus: ['processing', 'accepted', 'rejected'].includes(String(data.verificationStatus))
    ? data.verificationStatus as CloudBinaryRecord['verificationStatus']
    : null,
});

const uploadPathFor = (uid: string, cartularyId: string, binary: LocalBinaryRecord) => (
  `private-drafts/${uid}/${cartularyId}/${binary.binaryId}/${binary.sha256.replace('sha256:', '')}/original`
);

const deleteStorageObjectIfPresent = async (storagePath: string) => {
  try {
    await deleteObject(ref(storage, storagePath));
  } catch (error) {
    if ((error as { code?: string })?.code !== 'storage/object-not-found') throw error;
  }
};

const downloadStorageBlob = async (storagePath: string) => {
  const downloadUrl = await getDownloadURL(ref(storage, storagePath));
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`Téléchargement Storage impossible (${response.status}) pour ${storagePath}.`);
  return response.blob();
};

const applyCloudBinaryMetadata = async (
  vault: CartulariaLocalVault,
  cartularyId: string,
  cloud: CloudBinaryRecord,
) => {
  await vault.applyCloudBinary({
    id: '',
    cartularyId,
    binaryId: cloud.binaryId,
    kind: cloud.kind,
    fileName: cloud.fileName,
    mimeType: cloud.mimeType,
    size: cloud.size,
    sha256: cloud.sha256,
    blob: null,
    updatedAt: cloud.clientUpdatedAt,
    dirty: false,
    deleted: cloud.deleted,
    cloudRevision: cloud.revision,
    cloudStoragePath: cloud.storagePath,
  });
};

const syncStateRecord = async (
  uid: string,
  cartularyId: string,
  vault: CartulariaLocalVault,
  local: LocalStateRecord,
): Promise<{ decision: 'push' | 'pull' | 'noop' | 'conflict'; cloud: CloudStateRecord | null }> => {
  assertCloudStateSize(local.value, STATE_DOCUMENT_MAXIMUM_BYTES);
  const reference = stateRef(uid, cartularyId, local.key);
  const result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const cloud = snapshot.exists() ? parseCloudState(local.key, snapshot.data()) : null;
    const decision = decideStateSync(local, cloud);
    if (decision === 'push') {
      const revision = (cloud?.revision ?? 0) + 1;
      transaction.set(reference, {
        ownerUid: uid,
        cartularyId,
        key: local.key,
        value: local.deleted ? null : local.value,
        deleted: local.deleted,
        revision,
        clientUpdatedAt: local.updatedAt,
        updatedAt: serverTimestamp(),
      });
      return { decision, cloud: { key: local.key, value: local.value, deleted: local.deleted, revision, clientUpdatedAt: local.updatedAt } };
    }
    return { decision, cloud };
  });

  if (result.decision === 'push' && result.cloud) {
    await vault.markStateCloudSynced(local.key, result.cloud.revision);
  } else if (result.decision === 'pull' && result.cloud) {
    assertCloudStateSize(result.cloud.value, STATE_DOCUMENT_MAXIMUM_BYTES);
    await vault.applyCloudState({
      ...local,
      value: result.cloud.value,
      deleted: result.cloud.deleted,
      updatedAt: result.cloud.clientUpdatedAt,
      dirty: false,
      cloudRevision: result.cloud.revision,
    });
  } else if (result.decision === 'noop' && result.cloud) {
    await vault.markStateCloudSynced(local.key, result.cloud.revision);
  }
  return result;
};

const pullCloudStateWithoutLocal = async (
  vault: CartulariaLocalVault,
  cloud: CloudStateRecord,
) => {
  assertCloudStateSize(cloud.value, STATE_DOCUMENT_MAXIMUM_BYTES);
  await vault.applyCloudState({
    id: '',
    cartularyId: vault.cartularyId,
    key: cloud.key,
    value: cloud.value,
    updatedAt: cloud.clientUpdatedAt,
    dirty: false,
    deleted: cloud.deleted,
    cloudRevision: cloud.revision,
  });
};

const syncBinaryRecord = async (
  uid: string,
  cartularyId: string,
  vault: CartulariaLocalVault,
  local: LocalBinaryRecord,
  knownCloud: CloudBinaryRecord | null,
): Promise<{ decision: 'push' | 'pull' | 'noop' | 'conflict'; cloud: CloudBinaryRecord | null }> => {
  const initialDecision = decideBinarySync(local, knownCloud);
  if (initialDecision === 'pull' && knownCloud) {
    if (knownCloud.deleted || !knownCloud.storagePath) {
      await vault.applyCloudBinary({
        ...local,
        blob: null,
        deleted: true,
        dirty: false,
        cloudRevision: knownCloud.revision,
        cloudStoragePath: knownCloud.storagePath,
        updatedAt: knownCloud.clientUpdatedAt,
      });
    } else {
      // Les originaux peuvent représenter plusieurs centaines de Mo. La
      // synchronisation de démarrage ne rapatrie que leur manifeste ; le corps
      // binaire est chargé et mis en cache lorsqu'un média devient visible.
      await applyCloudBinaryMetadata(vault, cartularyId, knownCloud);
    }
    return { decision: 'pull', cloud: knownCloud };
  }
  if (initialDecision === 'conflict') return { decision: 'conflict', cloud: knownCloud };
  if (initialDecision === 'noop' && knownCloud) {
    await vault.markBinaryCloudSynced(local.binaryId, knownCloud.revision, knownCloud.storagePath);
    return { decision: 'noop', cloud: knownCloud };
  }

  const storagePath = local.deleted ? knownCloud?.storagePath ?? local.cloudStoragePath : uploadPathFor(uid, cartularyId, local);
  let uploadInspection: Awaited<ReturnType<typeof validateFileForUpload>> | null = null;
  if (!local.deleted) {
    if (!local.blob) throw new Error(`Original local absent pour ${local.binaryId}.`);
    uploadInspection = await validateFileForUpload({
      blob: local.blob,
      fileName: local.fileName,
      declaredMimeType: local.mimeType,
    });
  }

  const reference = binaryRef(uid, cartularyId, local.binaryId);
  const result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const currentCloud = snapshot.exists() ? parseCloudBinary(local.binaryId, snapshot.data()) : null;
    const decision = decideBinarySync(local, currentCloud);
    if (decision !== 'push') return { decision, cloud: currentCloud };
    const revision = (currentCloud?.revision ?? 0) + 1;
    const cloud: CloudBinaryRecord = {
      binaryId: local.binaryId,
      deleted: local.deleted,
      revision,
      fileName: local.fileName,
      mimeType: local.mimeType,
      size: local.size,
      sha256: local.sha256,
      kind: local.kind,
      storagePath: local.deleted ? null : storagePath!,
      clientUpdatedAt: local.updatedAt,
      uploadStatus: local.deleted
        ? 'deleted'
        : currentCloud?.storagePath === storagePath && currentCloud.uploadStatus === 'ready'
          ? 'ready'
          : 'pending_upload',
    };
    transaction.set(reference, {
      ownerUid: uid,
      cartularyId,
      ...cloud,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return { decision, cloud };
  });

  if (result.decision === 'push' && result.cloud) {
    if (local.deleted && storagePath) await deleteStorageObjectIfPresent(storagePath);
    if (!local.deleted && result.cloud.uploadStatus === 'pending_upload') {
      await uploadBytes(ref(storage, storagePath!), local.blob!, {
        contentType: uploadInspection!.canonicalMimeType,
        customMetadata: {
          ownerUid: uid,
          cartularyId,
          binaryId: local.binaryId,
          sha256: local.sha256,
          kind: local.kind,
          originalFileName: local.fileName,
          inspectionRequested: 'true',
        },
      });
      await waitForPrivateUploadVerification({ uid, cartularyId, binaryId: local.binaryId });
    }
    await vault.markBinaryCloudSynced(local.binaryId, result.cloud.revision, result.cloud.storagePath);
  } else if (result.decision === 'noop' && result.cloud) {
    if (local.deleted && local.cloudStoragePath) await deleteStorageObjectIfPresent(local.cloudStoragePath);
    await vault.markBinaryCloudSynced(local.binaryId, result.cloud.revision, result.cloud.storagePath);
  } else if (result.decision === 'conflict' && !local.deleted && storagePath && storagePath !== result.cloud?.storagePath) {
    await deleteStorageObjectIfPresent(storagePath);
  }
  return result;
};

export const synchronizePrivateDraft = async ({
  uid,
  cartularyId,
  vault,
}: {
  uid: string;
  cartularyId: string;
  vault: CartulariaLocalVault;
}): Promise<CloudSyncReport> => {
  await vault.mirrorLocalStorage();
  const root = draftRef(uid, cartularyId);
  const existingRoot = await getDoc(root);
  if (existingRoot.exists() && existingRoot.data().status === 'deleted') {
    return {
      status: 'remote_deleted',
      authoritativeSyncStatus: 'not_requested',
      authoritativeRequestId: null,
      pushed: 0,
      pulled: 0,
      pulledStateKeys: [],
      pulledBinaryIds: [],
      conflicts: [],
      lastSyncedAt: new Date().toISOString(),
    };
  }
  await setDoc(root, {
    ownerUid: uid,
    cartularyId,
    status: 'active',
    retentionPolicyVersion: RETENTION_POLICY_VERSION,
    purgeAfter: null,
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  const [localStates, localBinaries, cloudStatesSnapshot, cloudBinariesSnapshot] = await Promise.all([
    vault.listStateRecords(),
    vault.listBinaryRecords(),
    getDocs(collection(root, 'state')),
    getDocs(collection(root, 'binaries')),
  ]);
  const cloudStates = new Map(cloudStatesSnapshot.docs.map((snapshot) => [snapshot.id, parseCloudState(snapshot.id, snapshot.data())]));
  const cloudBinaries = new Map(cloudBinariesSnapshot.docs.map((snapshot) => [snapshot.id, parseCloudBinary(snapshot.id, snapshot.data())]));
  const conflicts: SyncConflict[] = [];
  const pulledStateKeys: string[] = [];
  const pulledBinaryIds: string[] = [];
  let pushed = 0;
  let pulled = 0;

  for (const local of localStates) {
    const result = await syncStateRecord(uid, cartularyId, vault, local);
    if (result.decision === 'push') pushed += 1;
    if (result.decision === 'pull') {
      pulled += 1;
      pulledStateKeys.push(local.key);
    }
    if (result.decision === 'conflict') conflicts.push({
      kind: 'state', id: local.key, localRevision: local.cloudRevision, cloudRevision: result.cloud?.revision ?? 0,
    });
    cloudStates.delete(local.key);
  }
  for (const cloud of cloudStates.values()) {
    await pullCloudStateWithoutLocal(vault, cloud);
    pulled += 1;
    pulledStateKeys.push(cloud.key);
  }

  for (const local of localBinaries) {
    const result = await syncBinaryRecord(uid, cartularyId, vault, local, cloudBinaries.get(local.binaryId) ?? null);
    if (result.decision === 'push') pushed += 1;
    if (result.decision === 'pull') {
      pulled += 1;
      pulledBinaryIds.push(local.binaryId);
    }
    if (result.decision === 'conflict') conflicts.push({
      kind: 'binary', id: local.binaryId, localRevision: local.cloudRevision, cloudRevision: result.cloud?.revision ?? 0,
    });
    cloudBinaries.delete(local.binaryId);
  }
  for (const cloud of cloudBinaries.values()) {
    if (cloud.deleted || !cloud.storagePath) continue;
    await applyCloudBinaryMetadata(vault, cartularyId, cloud);
    pulled += 1;
    pulledBinaryIds.push(cloud.binaryId);
  }

  const report: CloudSyncReport = {
    status: conflicts.length > 0 ? 'conflict' : 'synced',
    authoritativeSyncStatus: 'not_requested',
    authoritativeRequestId: null,
    pushed,
    pulled,
    pulledStateKeys,
    pulledBinaryIds,
    conflicts,
    lastSyncedAt: new Date().toISOString(),
  };
  await updateDoc(root, {
    lastSyncStatus: report.status,
    conflictCount: conflicts.length,
    stateRecordCount: localStates.length + cloudStates.size,
    binaryRecordCount: localBinaries.length + cloudBinaries.size,
    updatedAt: serverTimestamp(),
  });
  if (report.status === 'synced') {
    const authoritativeRequest = await requestAuthoritativeCartularySync({ uid, cartularyId });
    report.authoritativeSyncStatus = authoritativeRequest.status;
    report.authoritativeRequestId = authoritativeRequest.requestId;
  }
  return report;
};

export const primePrivateDraftState = async ({
  uid,
  cartularyId,
  vault,
}: {
  uid: string;
  cartularyId: string;
  vault: CartulariaLocalVault;
}) => {
  const localStates = new Map((await vault.listStateRecords()).map((record) => [record.key, record]));
  const cloudStates = await getDocs(collection(draftRef(uid, cartularyId), 'state'));
  let pulled = 0;
  for (const snapshot of cloudStates.docs) {
    const cloud = parseCloudState(snapshot.id, snapshot.data());
    const local = localStates.get(cloud.key);
    if (local?.dirty) continue;
    if (local && local.cloudRevision >= cloud.revision) continue;
    await pullCloudStateWithoutLocal(vault, cloud);
    pulled += 1;
  }
  return pulled;
};

export const markUserActivity = async (uid: string) => {
  await updateDoc(doc(db, 'users', uid), {
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const resolvePrivateDraftConflict = async ({
  uid,
  cartularyId,
  vault,
  conflict,
  strategy,
}: {
  uid: string;
  cartularyId: string;
  vault: CartulariaLocalVault;
  conflict: SyncConflict;
  strategy: 'keep-local' | 'take-cloud';
}) => {
  if (conflict.kind === 'state') {
    const snapshot = await getDoc(stateRef(uid, cartularyId, conflict.id));
    if (!snapshot.exists()) throw new Error(`Version cloud absente pour ${conflict.id}.`);
    const cloud = parseCloudState(conflict.id, snapshot.data());
    if (strategy === 'keep-local') await vault.prepareStateConflictResolution(conflict.id, cloud.revision);
    else await pullCloudStateWithoutLocal(vault, cloud);
  } else {
    const snapshot = await getDoc(binaryRef(uid, cartularyId, conflict.id));
    if (!snapshot.exists()) throw new Error(`Original cloud absent pour ${conflict.id}.`);
    const cloud = parseCloudBinary(conflict.id, snapshot.data());
    if (strategy === 'keep-local') {
      await vault.prepareBinaryConflictResolution(conflict.id, cloud.revision);
    } else if (cloud.deleted || !cloud.storagePath) {
      const local = await vault.getBinary(conflict.id);
      if (!local) throw new Error(`Original local absent pour ${conflict.id}.`);
      await vault.applyCloudBinary({ ...local, blob: null, deleted: true, dirty: false, cloudRevision: cloud.revision, cloudStoragePath: null, updatedAt: cloud.clientUpdatedAt });
    } else {
      const blob = await downloadStorageBlob(cloud.storagePath);
      await vault.applyCloudBinary({
        id: '', cartularyId, binaryId: cloud.binaryId, kind: cloud.kind,
        fileName: cloud.fileName, mimeType: cloud.mimeType, size: cloud.size,
        sha256: cloud.sha256, blob, updatedAt: cloud.clientUpdatedAt, dirty: false,
        deleted: false, cloudRevision: cloud.revision, cloudStoragePath: cloud.storagePath,
      });
    }
  }
  return synchronizePrivateDraft({ uid, cartularyId, vault });
};

export const deletePrivateCloudDraft = async (uid: string, cartularyId: string) => {
  const root = draftRef(uid, cartularyId);
  const [states, binaries] = await Promise.all([
    getDocs(collection(root, 'state')),
    getDocs(collection(root, 'binaries')),
  ]);
  await Promise.all(binaries.docs.map((snapshot) => {
    const cloud = parseCloudBinary(snapshot.id, snapshot.data());
    return cloud.storagePath ? deleteStorageObjectIfPresent(cloud.storagePath) : Promise.resolve();
  }));
  const references = [...states.docs, ...binaries.docs].map((snapshot) => snapshot.ref);
  for (let index = 0; index < references.length; index += 400) {
    const batch = writeBatch(db);
    references.slice(index, index + 400).forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
  await setDoc(root, {
    ownerUid: uid,
    cartularyId,
    status: 'deleted',
    deletedAt: serverTimestamp(),
    retentionPolicyVersion: RETENTION_POLICY_VERSION,
    purgeAfter: null,
    updatedAt: serverTimestamp(),
  });
};

export const purgePrivateCloudDraftTombstone = async (uid: string, cartularyId: string) => {
  await deleteDoc(draftRef(uid, cartularyId));
};
