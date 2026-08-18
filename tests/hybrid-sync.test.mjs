import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCloudStateSize,
  decideBinarySync,
  decideStateSync,
} from '../src/persistence/syncModel.ts';
import {
  CLOUD_SYNC_RETRY_DELAYS_MS,
  cloudSyncRetryDelay,
  LOCAL_CHANGE_COALESCE_DELAY_MS,
} from '../src/persistence/syncQueuePolicy.ts';

const localState = (patch = {}) => ({
  id: 'cart::cartularia-owner-fields',
  cartularyId: 'cart',
  key: 'cartularia-owner-fields',
  value: '[{"value":"local"}]',
  updatedAt: 100,
  dirty: true,
  deleted: false,
  cloudRevision: 2,
  ...patch,
});

const cloudState = (patch = {}) => ({
  key: 'cartularia-owner-fields',
  value: '[{"value":"cloud"}]',
  deleted: false,
  revision: 3,
  clientUpdatedAt: 90,
  ...patch,
});

test('un état local neuf est poussé vers un cloud absent', () => {
  assert.equal(decideStateSync(localState({ cloudRevision: 0 }), null), 'push');
});

test('deux modifications concurrentes produisent un conflit sans écrasement', () => {
  assert.equal(decideStateSync(localState(), cloudState()), 'conflict');
});

test('un état local propre reçoit la révision cloud plus récente', () => {
  assert.equal(decideStateSync(localState({ dirty: false }), cloudState()), 'pull');
});

test('un tombstone identique est un rejeu sans effet', () => {
  const local = localState({ value: null, deleted: true, dirty: false, cloudRevision: 4 });
  const cloud = cloudState({ value: null, deleted: true, revision: 4 });
  assert.equal(decideStateSync(local, cloud), 'noop');
});

test('un binaire modifié sur deux appareils ne peut pas être remplacé silencieusement', () => {
  const local = {
    id: 'cart::binary', cartularyId: 'cart', binaryId: 'binary', kind: 'media', fileName: 'local.mp4',
    mimeType: 'video/mp4', size: 5, sha256: `sha256:${'a'.repeat(64)}`, blob: new Blob(['local']),
    updatedAt: 100, dirty: true, deleted: false, cloudRevision: 1, cloudStoragePath: null,
  };
  const cloud = {
    binaryId: 'binary', kind: 'media', fileName: 'cloud.mp4', mimeType: 'video/mp4', size: 5,
    sha256: `sha256:${'b'.repeat(64)}`, deleted: false, revision: 2, storagePath: 'private/path',
    clientUpdatedAt: 90, uploadStatus: 'ready',
  };
  assert.equal(decideBinarySync(local, cloud), 'conflict');
});

test('une valeur trop grande est refusée avant Firestore', () => {
  assert.throws(() => assertCloudStateSize('123456', 5), /limite de synchronisation/);
});

test('les saisies rapprochées sont regroupées et les reprises restent bornées', () => {
  assert.equal(LOCAL_CHANGE_COALESCE_DELAY_MS, 1_200);
  assert.deepEqual(CLOUD_SYNC_RETRY_DELAYS_MS, [1_000, 2_500, 5_000, 10_000, 20_000]);
  assert.equal(cloudSyncRetryDelay(0), 1_000);
  assert.equal(cloudSyncRetryDelay(CLOUD_SYNC_RETRY_DELAYS_MS.length), null);
  assert.equal(cloudSyncRetryDelay(-1), null);
});
