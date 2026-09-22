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
  getMetadata,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { db, storage } from '../firebase.ts';
import { LocalVaultAccessError, type CartulariaLocalVault, type LocalBinaryRecord, type LocalStateRecord } from './localVault.ts';
import {
  assertCloudStateSize,
  decideBinarySync,
  decideStateSync,
  cloudBinaryIsAccepted,
  sameBinaryContent,
} from './syncModel.ts';
import type { CloudBinaryRecord, CloudStateRecord } from './syncModel.ts';
import { validateFileForUpload } from '../security/fileValidation.ts';
import { waitForPrivateUploadVerification } from '../services/privateUploadVerification.ts';
import { isRegistrySafeBinaryKind, isRegistrySafeStateKey } from '../domain/personalDataBoundary.ts';

const RETENTION_POLICY_VERSION = 'inactive-plus-2y-v1';
const STATE_DOCUMENT_MAXIMUM_BYTES = 900_000;
type SessionGuard = () => void;
const noSessionGuard: SessionGuard = () => undefined;
const vaultSessionGuard = (vault: CartulariaLocalVault, uid: string, cartularyId: string, assertActive = noSessionGuard): SessionGuard => () => {
  vault.assertAccessible();
  if ((vault.identityUid !== null && vault.identityUid !== uid) || vault.cartularyId !== cartularyId) throw new LocalVaultAccessError();
  assertActive();
};

export interface SyncConflict {
  kind: 'state' | 'binary';
  id: string;
  localRevision: number;
  cloudRevision: number;
}

export interface CloudSyncReport {
  status: 'synced' | 'pending' | 'conflict' | 'remote_deleted';
  authoritativeSyncStatus: 'not_requested' | 'requested' | 'in_progress';
  authoritativeRequestId: string | null;
  pendingCount: number;
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
  assertActive = noSessionGuard,
}: {
  uid: string;
  cartularyId: string;
  reason?: string;
  assertActive?: SessionGuard;
}) => {
  assertActive();
  const reference = authoritativeSyncRequestRef(cartularyId);
  return runTransaction(db, async (transaction) => {
    assertActive();
    const snapshot = await transaction.get(reference);
    assertActive();
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
  ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : undefined,
  cartularyId: typeof data.cartularyId === 'string' ? data.cartularyId : undefined,
  verificationIdentity: data.verificationIdentity && typeof data.verificationIdentity === 'object'
    ? data.verificationIdentity as Record<string, unknown> : null,
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
      : 'pending_upload',
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

const downloadStorageBlob = async (storagePath: string, assertActive: SessionGuard) => {
  assertActive();
  const downloadUrl = await getDownloadURL(ref(storage, storagePath));
  assertActive();
  const response = await fetch(downloadUrl);
  assertActive();
  if (!response.ok) throw new Error(`Téléchargement Storage impossible (${response.status}) pour ${storagePath}.`);
  return response.blob();
};

const applyCloudBinaryMetadata = async (
  vault: CartulariaLocalVault,
  cartularyId: string,
  cloud: CloudBinaryRecord,
  expected: LocalBinaryRecord | null,
  allowDirty = false,
) => {
  return vault.applyCloudBinary({
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
  }, expected, { allowDirty });
};

const syncStateRecord = async (
  uid: string,
  cartularyId: string,
  vault: CartulariaLocalVault,
  local: LocalStateRecord,
  assertActive: SessionGuard,
): Promise<{ decision: 'push' | 'pull' | 'noop' | 'conflict' | 'deferred'; cloud: CloudStateRecord | null }> => {
  assertActive();
  assertCloudStateSize(local.value, STATE_DOCUMENT_MAXIMUM_BYTES);
  const reference = stateRef(uid, cartularyId, local.key);
  const result = await runTransaction(db, async (transaction) => {
    assertActive();
    const snapshot = await transaction.get(reference);
    assertActive();
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

  assertActive();

  if (result.decision === 'push' && result.cloud) {
    if (!await vault.markStateCloudSynced(local.key, result.cloud.revision, local)) return { ...result, decision: 'deferred' };
  } else if (result.decision === 'pull' && result.cloud) {
    assertCloudStateSize(result.cloud.value, STATE_DOCUMENT_MAXIMUM_BYTES);
    const applied = await vault.applyCloudState({
      ...local,
      value: result.cloud.value,
      deleted: result.cloud.deleted,
      updatedAt: result.cloud.clientUpdatedAt,
      dirty: false,
      cloudRevision: result.cloud.revision,
    }, local);
    if (!applied) return { ...result, decision: 'deferred' };
  } else if (result.decision === 'noop' && result.cloud) {
    if (!await vault.markStateCloudSynced(local.key, result.cloud.revision, local)) return { ...result, decision: 'deferred' };
  }
  return result;
};

const pullCloudStateWithoutLocal = async (
  vault: CartulariaLocalVault,
  cloud: CloudStateRecord,
  expected: LocalStateRecord | null = null,
  allowDirty = false,
) => {
  assertCloudStateSize(cloud.value, STATE_DOCUMENT_MAXIMUM_BYTES);
  return vault.applyCloudState({
    id: '',
    cartularyId: vault.cartularyId,
    key: cloud.key,
    value: cloud.value,
    updatedAt: cloud.clientUpdatedAt,
    dirty: false,
    deleted: cloud.deleted,
    cloudRevision: cloud.revision,
  }, expected, { allowDirty });
};

// A completed transfer and an accepted verification are separate checkpoints.
// Never replace an original merely because its previous upload response was lost.
const ensureCloudBinaryAccepted = async (
  uid: string,
  cartularyId: string,
  cloud: CloudBinaryRecord,
  local: LocalBinaryRecord | null,
  assertActive: SessionGuard,
): Promise<CloudBinaryRecord> => {
  if (cloud.deleted) return cloud;
  const path = `private-drafts/${uid}/${cartularyId}/${cloud.binaryId}/${cloud.sha256.replace(/^sha256:/, '')}/original`;
  if (cloud.storagePath !== path || cloud.ownerUid !== uid || cloud.cartularyId !== cartularyId) {
    throw new Error(`Identité de l’original incohérente pour ${cloud.binaryId}.`);
  }
  if (cloud.uploadStatus === 'failed' || cloud.verificationStatus === 'rejected') {
    throw new Error(`Le fichier ${cloud.fileName} a été refusé. Conservez l’original et importez une nouvelle version corrigée.`);
  }
  const object = ref(storage, path);
  const readMetadata = async () => {
    assertActive();
    try {
      const metadata = await getMetadata(object);
      assertActive();
      return metadata;
    } catch (error) {
      assertActive();
      if ((error as { code?: string }).code === 'storage/object-not-found') return null;
      throw error;
    }
  };
  let metadata = await readMetadata();
  if (!metadata) {
    if (cloud.verificationStatus === 'accepted') throw new Error(`Original accepté absent pour ${cloud.binaryId}.`);
    if (!local?.blob || !sameBinaryContent(local, cloud)) throw new Error(`Transfert inachevé : original local nécessaire pour ${cloud.binaryId}.`);
    const inspection = await validateFileForUpload({ blob: local.blob, fileName: local.fileName, declaredMimeType: local.mimeType });
    assertActive();
    try {
      await uploadBytes(object, local.blob, {
        contentType: inspection.canonicalMimeType,
        customMetadata: { ownerUid: uid, cartularyId, binaryId: local.binaryId, sha256: local.sha256,
          kind: local.kind, originalFileName: local.fileName, inspectionRequested: 'true' },
      });
    } catch (error) {
      // A concurrent tab may have completed the immutable upload, or the
      // network may have lost its response. Re-read; do not delete/overwrite.
      metadata = await readMetadata();
      if (!metadata) throw error;
    }
    assertActive();
    metadata = await readMetadata();
    if (!metadata) throw new Error(`Transfert non confirmé pour ${cloud.binaryId}.`);
  }
  const custom = metadata.customMetadata;
  if (metadata.size !== cloud.size || custom?.ownerUid !== uid || custom?.cartularyId !== cartularyId
    || custom?.binaryId !== cloud.binaryId || custom?.sha256 !== cloud.sha256 || custom?.kind !== cloud.kind) {
    throw new Error(`L’original distant ne correspond pas au fichier ${cloud.binaryId}.`);
  }
  if (!cloudBinaryIsAccepted(cloud)) {
    await waitForPrivateUploadVerification({ uid, cartularyId, binaryId: cloud.binaryId,
      expectedOriginal: { storagePath: path, sha256: cloud.sha256, size: cloud.size, generation: metadata.generation },
      assertActive });
    assertActive();
  }
  // Read the final manifest even after a no-op. A snapshot captured before
  // verification (or in another tab) is never a successful acknowledgement.
  const snapshot = await getDoc(binaryRef(uid, cartularyId, cloud.binaryId));
  assertActive();
  if (!snapshot.exists()) throw new Error(`Manifeste disparu pour ${cloud.binaryId}.`);
  const accepted = parseCloudBinary(cloud.binaryId, snapshot.data());
  if (!cloudBinaryIsAccepted(accepted) || accepted.storagePath !== path || accepted.sha256 !== cloud.sha256
    || accepted.size !== cloud.size || accepted.verificationIdentity?.generation !== metadata.generation
    || accepted.verificationIdentity?.bucket !== metadata.bucket) {
    throw new Error(`La validation de l’original ${cloud.binaryId} reste à confirmer.`);
  }
  return accepted;
};

const syncBinaryRecord = async (
  uid: string,
  cartularyId: string,
  vault: CartulariaLocalVault,
  local: LocalBinaryRecord,
  assertActive: SessionGuard,
): Promise<{ decision: 'push' | 'pull' | 'noop' | 'conflict' | 'deferred'; cloud: CloudBinaryRecord | null }> => {
  assertActive();
  const reference = binaryRef(uid, cartularyId, local.binaryId);
  const result = await runTransaction(db, async (transaction) => {
    assertActive();
    const snapshot = await transaction.get(reference);
    assertActive();
    const current = snapshot.exists() ? parseCloudBinary(local.binaryId, snapshot.data()) : null;
    const decision = decideBinarySync(local, current);
    if (decision !== 'push') return { decision, cloud: current, previousPath: current?.storagePath };
    // Accepted identities cannot be substituted (also enforced by P3 rules).
    if (!local.deleted && current?.verificationStatus === 'accepted' && !sameBinaryContent(local, current)) {
      return { decision: 'conflict' as const, cloud: current, previousPath: current.storagePath };
    }
    const cloud: CloudBinaryRecord = {
      ownerUid: uid, cartularyId, binaryId: local.binaryId, deleted: local.deleted,
      revision: (current?.revision ?? 0) + 1, fileName: local.fileName, mimeType: local.mimeType,
      size: local.size, sha256: local.sha256, kind: local.kind,
      storagePath: local.deleted ? null : uploadPathFor(uid, cartularyId, local), clientUpdatedAt: local.updatedAt,
      uploadStatus: local.deleted ? 'deleted' : current && cloudBinaryIsAccepted(current) ? 'ready' : 'pending_upload',
    };
    transaction.set(reference, { ...cloud, updatedAt: serverTimestamp() }, { merge: true });
    return { decision, cloud: { ...current, ...cloud }, previousPath: current?.storagePath };
  });
  assertActive();
  if (result.decision === 'conflict' || !result.cloud) return { decision: 'conflict', cloud: result.cloud };
  let cloud = result.cloud;
  if (result.decision === 'push') await vault.rebaseBinaryCloudRevision(local.binaryId, cloud.revision, local);
  if (!cloud.deleted) cloud = await ensureCloudBinaryAccepted(uid, cartularyId, cloud, local, assertActive);
  assertActive();
  if (result.decision === 'pull' || (!local.dirty && cloud.fileName !== local.fileName)) {
    const applied = await applyCloudBinaryMetadata(vault, cartularyId, cloud, local);
    return { decision: applied ? 'pull' : 'deferred', cloud };
  }
  if (!local.deleted && cloud.fileName !== local.fileName) {
    await vault.rebaseBinaryCloudRevision(local.binaryId, cloud.revision, local);
    return { decision: 'deferred', cloud };
  }
  if (local.deleted) {
    // A crash may leave the cloud tombstone committed before object deletion,
    // including when the first upload was never acknowledged locally.
    const originalPath = result.previousPath || local.cloudStoragePath || uploadPathFor(uid, cartularyId, local);
    await deleteStorageObjectIfPresent(originalPath);
    assertActive();
  }
  const cleaned = await vault.markBinaryCloudSynced(local.binaryId, cloud.revision, cloud.storagePath, local);
  return { decision: !cleaned ? 'deferred' : result.decision === 'noop' ? 'noop' : 'push', cloud };
};

export const synchronizePrivateDraft = async ({
  uid,
  cartularyId,
  vault,
  assertActive,
}: {
  uid: string;
  cartularyId: string;
  vault: CartulariaLocalVault;
  assertActive?: SessionGuard;
}): Promise<CloudSyncReport> => {
  const assertSession = vaultSessionGuard(vault, uid, cartularyId, assertActive);
  assertSession();
  await vault.mirrorLocalStorage();
  assertSession();
  const root = draftRef(uid, cartularyId);
  const existingRoot = await getDoc(root);
  assertSession();
  if (existingRoot.exists() && existingRoot.data().status === 'deleted') {
    return {
      status: 'remote_deleted',
      authoritativeSyncStatus: 'not_requested',
      authoritativeRequestId: null,
      pendingCount: 0,
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
  assertSession();

  const [allLocalStates, allLocalBinaries, cloudStatesSnapshot, cloudBinariesSnapshot] = await Promise.all([
    vault.listStateRecords(),
    vault.listBinaryRecords(),
    getDocs(collection(root, 'state')),
    getDocs(collection(root, 'binaries')),
  ]);
  assertSession();
  const localStates = allLocalStates.filter((record) => isRegistrySafeStateKey(record.key));
  const localBinaries = allLocalBinaries.filter((record) => isRegistrySafeBinaryKind(record.kind));
  const cloudStates = new Map(cloudStatesSnapshot.docs
    .filter((snapshot) => isRegistrySafeStateKey(snapshot.id))
    .map((snapshot) => [snapshot.id, parseCloudState(snapshot.id, snapshot.data())]));
  const cloudBinaries = new Map(cloudBinariesSnapshot.docs
    .map((snapshot) => [snapshot.id, parseCloudBinary(snapshot.id, snapshot.data())] as const)
    .filter(([, record]) => isRegistrySafeBinaryKind(record.kind)));
  const conflicts: SyncConflict[] = [];
  const pulledStateKeys: string[] = [];
  const pulledBinaryIds: string[] = [];
  let deferred = false;
  let pushed = 0;
  let pulled = 0;

  for (const local of localStates) {
    const result = await syncStateRecord(uid, cartularyId, vault, local, assertSession);
    assertSession();
    if (result.decision === 'deferred') deferred = true;
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
    assertSession();
    if (await pullCloudStateWithoutLocal(vault, cloud)) {
      pulled += 1;
      pulledStateKeys.push(cloud.key);
    }
  }

  for (const local of localBinaries) {
    const result = await syncBinaryRecord(uid, cartularyId, vault, local, assertSession);
    assertSession();
    if (result.decision === 'deferred') deferred = true;
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
    assertSession();
    if (cloud.deleted || !cloud.storagePath) continue;
    const accepted = await ensureCloudBinaryAccepted(uid, cartularyId, cloud, null, assertSession);
    if (await applyCloudBinaryMetadata(vault, cartularyId, accepted, null)) {
      pulled += 1;
      pulledBinaryIds.push(cloud.binaryId);
    } else deferred = true;
  }

  const [remainingState, remainingBinaries] = await Promise.all([vault.listStateRecords(), vault.listBinaryRecords()]);
  assertSession();
  const pendingCount = remainingState.filter((record) => isRegistrySafeStateKey(record.key) && record.dirty).length
    + remainingBinaries.filter((record) => isRegistrySafeBinaryKind(record.kind) && record.dirty).length;
  const report: CloudSyncReport = {
    status: conflicts.length > 0 ? 'conflict' : pendingCount > 0 || deferred ? 'pending' : 'synced',
    pendingCount,
    authoritativeSyncStatus: 'not_requested',
    authoritativeRequestId: null,
    pushed,
    pulled,
    pulledStateKeys,
    pulledBinaryIds,
    conflicts,
    lastSyncedAt: new Date().toISOString(),
  };
  assertSession();
  await updateDoc(root, {
    lastSyncStatus: report.status,
    conflictCount: conflicts.length,
    stateRecordCount: localStates.length + cloudStates.size,
    binaryRecordCount: localBinaries.length + cloudBinaries.size,
    updatedAt: serverTimestamp(),
  });
  assertSession();
  if (report.status === 'synced') {
    const authoritativeRequest = await requestAuthoritativeCartularySync({ uid, cartularyId, assertActive: assertSession });
    assertSession();
    report.authoritativeSyncStatus = authoritativeRequest.status;
    report.authoritativeRequestId = authoritativeRequest.requestId;
  }
  // Another tab can close after staging a durable intent but before its IDB
  // transaction. Include that edit before reporting a fully saved draft.
  await vault.mirrorLocalStorage();
  assertSession();
  const [finalStates, finalBinaries] = await Promise.all([vault.listStateRecords(), vault.listBinaryRecords()]);
  assertSession();
  report.pendingCount = finalStates.filter((record) => isRegistrySafeStateKey(record.key) && record.dirty).length
    + finalBinaries.filter((record) => isRegistrySafeBinaryKind(record.kind) && record.dirty).length;
  if (report.status === 'synced' && report.pendingCount > 0) report.status = 'pending';
  return report;
};

export const primePrivateDraftState = async ({
  uid,
  cartularyId,
  vault,
  readTimeoutMs = 5_000,
  authoritativeHydration,
  assertActive,
}: {
  uid: string;
  cartularyId: string;
  vault: CartulariaLocalVault;
  readTimeoutMs?: number;
  assertActive?: SessionGuard;
  authoritativeHydration?: {
    id: string;
    stateKeys: readonly string[];
  };
}) => {
  const assertSession = vaultSessionGuard(vault, uid, cartularyId, assertActive);
  assertSession();
  const hydrationMarkerKey = authoritativeHydration
    ? `cartularia:cloud-hydration:${encodeURIComponent(uid)}:${cartularyId}:${authoritativeHydration.id}`
    : null;
  let hydrationAlreadyApplied = false;
  if (hydrationMarkerKey) {
    try {
      hydrationAlreadyApplied = globalThis.localStorage?.getItem(hydrationMarkerKey) === 'done';
    } catch {
      hydrationAlreadyApplied = false;
    }
  }
  const authoritativeStateKeys = hydrationAlreadyApplied
    ? new Set<string>()
    : new Set(authoritativeHydration?.stateKeys ?? []);
  const localStates = new Map((await vault.listStateRecords())
    .filter((record) => isRegistrySafeStateKey(record.key))
    .map((record) => [record.key, record]));
  assertSession();
  const cloudStates = await new Promise<Awaited<ReturnType<typeof getDocs>>>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      operation();
    };
    const timeout = globalThis.setTimeout(() => finish(() => reject(new Error('Lecture du brouillon cloud expirée.'))), readTimeoutMs);
    void getDocs(collection(draftRef(uid, cartularyId), 'state')).then(
      (snapshot) => finish(() => resolve(snapshot)),
      (error) => finish(() => reject(error)),
    );
  });
  assertSession();
  let pulled = 0;
  for (const snapshot of cloudStates.docs) {
    assertSession();
    if (!isRegistrySafeStateKey(snapshot.id)) continue;
    const cloud = parseCloudState(snapshot.id, snapshot.data() as Record<string, unknown>);
    const local = localStates.get(cloud.key);
    const cloudIsAuthoritative = authoritativeStateKeys.has(cloud.key);
    if (local?.dirty) continue;
    if (local && local.cloudRevision >= cloud.revision && !cloudIsAuthoritative) continue;
    if (await pullCloudStateWithoutLocal(vault, cloud, local ?? null)) pulled += 1;
  }
  assertSession();
  if (hydrationMarkerKey && !hydrationAlreadyApplied) {
    try {
      globalThis.localStorage?.setItem(hydrationMarkerKey, 'done');
    } catch {
      // Le marqueur n'est qu'une optimisation locale ; la copie cloud reste intacte.
    }
  }
  return pulled;
};

export const markUserActivity = async (uid: string, assertActive = noSessionGuard) => {
  assertActive();
  await updateDoc(doc(db, 'users', uid), {
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  assertActive();
};

export const resolvePrivateDraftConflict = async ({
  uid,
  cartularyId,
  vault,
  conflict,
  strategy,
  assertActive,
}: {
  uid: string;
  cartularyId: string;
  vault: CartulariaLocalVault;
  conflict: SyncConflict;
  strategy: 'keep-local' | 'take-cloud';
  assertActive?: SessionGuard;
}) => {
  const assertSession = vaultSessionGuard(vault, uid, cartularyId, assertActive);
  assertSession();
  if (conflict.kind === 'state') {
    if (!isRegistrySafeStateKey(conflict.id)) throw new Error('Cette donnée personnelle relève du Coffre personnel.');
    const local = (await vault.listStateRecords()).find((record) => record.key === conflict.id) ?? null;
    assertSession();
    const snapshot = await getDoc(stateRef(uid, cartularyId, conflict.id));
    assertSession();
    if (!snapshot.exists()) throw new Error(`Version cloud absente pour ${conflict.id}.`);
    const cloud = parseCloudState(conflict.id, snapshot.data());
    const applied = strategy === 'keep-local'
      ? local && await vault.prepareStateConflictResolution(conflict.id, cloud.revision, local)
      : await pullCloudStateWithoutLocal(vault, cloud, local, true);
    if (!applied) throw new Error('La saisie a changé pendant la résolution. Relancez la comparaison des versions.');
  } else {
    const local = await vault.getBinary(conflict.id);
    assertSession();
    const snapshot = await getDoc(binaryRef(uid, cartularyId, conflict.id));
    assertSession();
    if (!snapshot.exists()) throw new Error(`Original cloud absent pour ${conflict.id}.`);
    let cloud = parseCloudBinary(conflict.id, snapshot.data());
    if (!isRegistrySafeBinaryKind(cloud.kind)) throw new Error('Ce document personnel relève du Coffre personnel.');
    let applied: boolean;
    if (strategy === 'keep-local') {
      applied = Boolean(local && await vault.prepareBinaryConflictResolution(conflict.id, cloud.revision, local));
    } else {
      if (!cloud.deleted) cloud = await ensureCloudBinaryAccepted(uid, cartularyId, cloud, null, assertSession);
      const blob = cloud.deleted || !cloud.storagePath ? null : await downloadStorageBlob(cloud.storagePath, assertSession);
      assertSession();
      applied = await vault.applyCloudBinary({
        id: '', cartularyId, binaryId: cloud.binaryId, kind: cloud.kind,
        fileName: cloud.fileName, mimeType: cloud.mimeType, size: cloud.size,
        sha256: cloud.sha256, blob, updatedAt: cloud.clientUpdatedAt, dirty: false,
        deleted: cloud.deleted, cloudRevision: cloud.revision, cloudStoragePath: cloud.storagePath,
      }, local, { allowDirty: true });
    }
    if (!applied) throw new Error('Le fichier local a changé pendant la résolution. Relancez la comparaison des versions.');
  }
  assertSession();
  return synchronizePrivateDraft({ uid, cartularyId, vault, assertActive: assertSession });
};

export const deletePrivateCloudDraft = async (uid: string, cartularyId: string, assertActive = noSessionGuard) => {
  assertActive();
  const root = draftRef(uid, cartularyId);
  const [states, binaries] = await Promise.all([
    getDocs(collection(root, 'state')),
    getDocs(collection(root, 'binaries')),
  ]);
  assertActive();
  // Accepted manifests are immutable attestations: P3 permits a logical
  // tombstone, never hard deletion/recreation under the same binary ID.
  const records = binaries.docs.map((snapshot) => ({ reference: snapshot.ref, cloud: parseCloudBinary(snapshot.id, snapshot.data()) }));
  const writes = [
    ...states.docs.map((snapshot) => ({ kind: 'state' as const, reference: snapshot.ref })),
    ...records.map(({ reference, cloud }) => ({ kind: 'binary' as const, reference, cloud })),
  ];
  for (let index = 0; index < writes.length; index += 400) {
    assertActive();
    const batch = writeBatch(db);
    for (const write of writes.slice(index, index + 400)) {
      if (write.kind === 'state') batch.delete(write.reference);
      else batch.set(write.reference, { deleted: true, storagePath: null, uploadStatus: 'deleted',
        revision: write.cloud.revision + 1, updatedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
  }
  assertActive();
  await Promise.all(records.map(({ cloud }) => {
    assertActive();
    // Recover the canonical path even if an earlier attempt already wrote its tombstone.
    const canonical = /^sha256:[a-f0-9]{64}$/.test(cloud.sha256)
      ? `private-drafts/${uid}/${cartularyId}/${cloud.binaryId}/${cloud.sha256.slice(7)}/original` : null;
    return cloud.storagePath || canonical ? deleteStorageObjectIfPresent(cloud.storagePath || canonical!) : Promise.resolve();
  }));
  assertActive();
  await setDoc(root, {
    ownerUid: uid,
    cartularyId,
    status: 'deleted',
    deletedAt: serverTimestamp(),
    retentionPolicyVersion: RETENTION_POLICY_VERSION,
    purgeAfter: null,
    updatedAt: serverTimestamp(),
  });
  assertActive();
};

export const purgePrivateCloudDraftTombstone = async (uid: string, cartularyId: string) => {
  await deleteDoc(draftRef(uid, cartularyId));
};
