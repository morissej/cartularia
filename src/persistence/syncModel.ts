import type { LocalBinaryRecord, LocalStateRecord } from './localVault.ts';

export interface CloudStateRecord {
  key: string;
  value: string | null;
  deleted: boolean;
  revision: number;
  clientUpdatedAt: number;
}

export interface CloudBinaryRecord {
  ownerUid?: string;
  cartularyId?: string;
  binaryId: string;
  deleted: boolean;
  revision: number;
  fileName: string;
  mimeType: string;
  size: number;
  sha256: string;
  kind: LocalBinaryRecord['kind'];
  storagePath: string | null;
  clientUpdatedAt: number;
  uploadStatus: 'pending_upload' | 'verifying' | 'ready' | 'failed' | 'deleted';
  verificationStatus?: 'processing' | 'accepted' | 'rejected' | null;
  verificationIdentity?: Record<string, unknown> | null;
}

export type SyncDecision = 'push' | 'pull' | 'noop' | 'conflict';

const sameState = (local: LocalStateRecord, cloud: CloudStateRecord) => (
  local.deleted === cloud.deleted && local.value === cloud.value
);

export const decideStateSync = (
  local: LocalStateRecord,
  cloud: CloudStateRecord | null,
): SyncDecision => {
  if (!cloud) return local.cloudRevision === 0 ? 'push' : 'conflict';
  if (cloud.revision === local.cloudRevision && sameState(local, cloud)) return 'noop';
  if (local.dirty) {
    if (cloud.revision !== local.cloudRevision && !sameState(local, cloud)) return 'conflict';
    return sameState(local, cloud) ? 'noop' : 'push';
  }
  if (cloud.revision > local.cloudRevision) return 'pull';
  return sameState(local, cloud) ? 'noop' : 'conflict';
};

export const sameBinaryContent = (local: LocalBinaryRecord, cloud: CloudBinaryRecord) => (
  local.deleted === cloud.deleted
  && local.sha256 === cloud.sha256
  && local.size === cloud.size
  && local.mimeType === cloud.mimeType
  && local.kind === cloud.kind
);

export const cloudBinaryIsAccepted = (cloud: CloudBinaryRecord) => {
  const identity = cloud.verificationIdentity;
  return !cloud.deleted && cloud.uploadStatus === 'ready' && cloud.verificationStatus === 'accepted'
    && identity?.schemaVersion === 'private-binary-identity@1.0.0'
    && typeof cloud.ownerUid === 'string' && typeof cloud.cartularyId === 'string'
    && identity.ownerUid === cloud.ownerUid && identity.cartularyId === cloud.cartularyId
    && identity.binaryId === cloud.binaryId && identity.sha256 === cloud.sha256
    && identity.size === cloud.size && identity.storagePath === cloud.storagePath
    && /^sha256:[a-f0-9]{64}$/.test(cloud.sha256) && cloud.size > 0
    && cloud.storagePath === `private-drafts/${cloud.ownerUid}/${cloud.cartularyId}/${cloud.binaryId}/${cloud.sha256.slice(7)}/original`
    && typeof identity.bucket === 'string' && identity.bucket.length > 0
    && typeof identity.generation === 'string' && /^[1-9][0-9]*$/.test(identity.generation);
};

export type BinarySyncDecision = SyncDecision | 'resume' | 'wait' | 'rejected';

export const decideBinarySync = (
  local: LocalBinaryRecord,
  cloud: CloudBinaryRecord | null,
): BinarySyncDecision => {
  if (!cloud) return local.cloudRevision === 0 ? 'push' : 'conflict';
  const same = sameBinaryContent(local, cloud) && local.fileName === cloud.fileName;
  if (!cloud.deleted && sameBinaryContent(local, cloud) && !cloudBinaryIsAccepted(cloud)) {
    if (cloud.uploadStatus === 'failed' || cloud.verificationStatus === 'rejected') return 'rejected';
    return cloud.uploadStatus === 'pending_upload' ? 'resume' : 'wait';
  }
  if (cloud.revision === local.cloudRevision && same) return 'noop';
  if (local.dirty) {
    if (cloud.revision !== local.cloudRevision && !same) return 'conflict';
    return same ? 'noop' : 'push';
  }
  if (cloud.revision > local.cloudRevision) return 'pull';
  return same ? 'noop' : 'conflict';
};

export const assertCloudStateSize = (value: string | null, maximumBytes = 900_000) => {
  if (value !== null && new TextEncoder().encode(value).byteLength > maximumBytes) {
    throw new Error(`État local supérieur à la limite de synchronisation (${maximumBytes} octets).`);
  }
};
