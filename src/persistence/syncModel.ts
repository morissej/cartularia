import type { LocalBinaryRecord, LocalStateRecord } from './localVault.ts';

export interface CloudStateRecord {
  key: string;
  value: string | null;
  deleted: boolean;
  revision: number;
  clientUpdatedAt: number;
}

export interface CloudBinaryRecord {
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
  uploadStatus: 'ready' | 'deleted';
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

const sameBinary = (local: LocalBinaryRecord, cloud: CloudBinaryRecord) => (
  local.deleted === cloud.deleted
  && local.sha256 === cloud.sha256
  && local.size === cloud.size
  && local.mimeType === cloud.mimeType
);

export const decideBinarySync = (
  local: LocalBinaryRecord,
  cloud: CloudBinaryRecord | null,
): SyncDecision => {
  if (!cloud) return local.cloudRevision === 0 ? 'push' : 'conflict';
  if (cloud.revision === local.cloudRevision && sameBinary(local, cloud)) return 'noop';
  if (local.dirty) {
    if (cloud.revision !== local.cloudRevision && !sameBinary(local, cloud)) return 'conflict';
    return sameBinary(local, cloud) ? 'noop' : 'push';
  }
  if (cloud.revision > local.cloudRevision) return 'pull';
  return sameBinary(local, cloud) ? 'noop' : 'conflict';
};

export const assertCloudStateSize = (value: string | null, maximumBytes = 900_000) => {
  if (value !== null && new TextEncoder().encode(value).byteLength > maximumBytes) {
    throw new Error(`État local supérieur à la limite de synchronisation (${maximumBytes} octets).`);
  }
};
