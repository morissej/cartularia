import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { markCartularyCreateRequestFailed } from '../scripts/lib/create-cartulary-command.mjs';
import { assertActiveQueuedAccount } from '../scripts/lib/queued-account-access.mjs';

const requestDocumentId = 'retry-cartulary';
const requestId = 'same-request-id';
const ownerUid = 'owner';
const oldAttempt = { ownerUid, requestId, status: 'pending', requestedAt: new Timestamp(1_000, 0) };

function memoryContext(currentRequest) {
  const documents = new Map([
    [`cartularyCreateRequests/${requestDocumentId}`, { ...currentRequest }],
    [`accountAccess/${ownerUid}`, { status: 'active', validAfter: 1_500 }],
    [`users/${ownerUid}`, { status: 'active' }],
  ]);
  const snapshot = (path) => ({ exists: documents.has(path), data: () => documents.get(path) });
  const writes = [];
  return {
    auth: { getUser: async () => ({ uid: ownerUid, disabled: false }) },
    firestore: {
      doc: (path) => ({ path, get: async () => snapshot(path) }),
      runTransaction: async (callback) => callback({
        get: async (reference) => snapshot(reference.path),
        update: (reference, patch) => {
          writes.push(patch);
          documents.set(reference.path, { ...documents.get(reference.path), ...patch });
        },
      }),
    },
    current: () => documents.get(`cartularyCreateRequests/${requestDocumentId}`),
    writes,
  };
}

async function rejectOldEvent(context) {
  let failure;
  await assert.rejects(
    () => assertActiveQueuedAccount({ ...context, requestDocument: oldAttempt }),
    (error) => { failure = error; return error.code === 'permission_denied'; },
  );
  await markCartularyCreateRequestFailed({
    firestore: context.firestore, requestDocumentId, requestId,
    error: failure, expectedRequestDocument: oldAttempt,
  });
}

for (const status of ['pending', 'processing']) {
  test(`un ancien événement refusé ne remplace pas une nouvelle tentative ${status}`, async () => {
    const current = { ...oldAttempt, status, requestedAt: new Timestamp(2_000, 0) };
    const context = memoryContext(current);
    await assertActiveQueuedAccount({ ...context, requestDocument: current });
    await rejectOldEvent(context);
    assert.deepEqual(context.current(), current);
    assert.equal(context.writes.length, 0);
  });

  test(`un refus de la tentative courante ${status} reste enregistré`, async () => {
    const context = memoryContext({ ...oldAttempt, status, updatedAt: new Timestamp(1_200, 0) });
    await rejectOldEvent(context);
    assert.equal(context.current().status, 'failed');
    assert.equal(context.current().errorCode, 'permission_denied');
    assert.equal(context.writes.length, 1);
  });
}

test('la comparaison conserve les nanosecondes de requestedAt', async () => {
  const expected = { ...oldAttempt, requestedAt: new Timestamp(2_000, 100) };
  const context = memoryContext({ ...expected, requestedAt: new Timestamp(2_000, 101) });
  await markCartularyCreateRequestFailed({
    firestore: context.firestore, requestDocumentId, requestId,
    error: new Error('Ancienne tentative'), expectedRequestDocument: expected,
  });
  assert.equal(context.current().status, 'pending');
  assert.equal(context.writes.length, 0);
});

test('une Date et un Timestamp identiques désignent la même tentative', async () => {
  const expected = { ...oldAttempt, requestedAt: new Date(2_000_123) };
  const context = memoryContext({ ...expected, requestedAt: Timestamp.fromDate(expected.requestedAt) });
  await markCartularyCreateRequestFailed({
    firestore: context.firestore, requestDocumentId, requestId,
    error: new Error('Tentative courante'), expectedRequestDocument: expected,
  });
  assert.equal(context.current().status, 'failed');
  assert.equal(context.writes.length, 1);
});

test('les workers existants sans version attendue conservent leur contrat', async () => {
  const context = memoryContext(oldAttempt);
  await markCartularyCreateRequestFailed({
    firestore: context.firestore, requestDocumentId, requestId, error: new Error('Échec worker'),
  });
  assert.equal(context.current().status, 'failed');
  assert.equal(context.current().errorMessage, 'Échec worker');
});

test('le trigger fournit le document de son événement au marquage transactionnel', async () => {
  const source = await readFile(new URL('../scripts/firebase-functions.mjs', import.meta.url), 'utf8');
  const trigger = source.slice(source.indexOf('export const createCartularyFromPrivateDraft ='), source.indexOf('export const syncCartularyToRegistry ='));
  assert.match(trigger, /markCartularyCreateRequestFailed\(\{[^}]*expectedRequestDocument: after\.data\(\)/);
});
