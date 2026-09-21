import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { activateRegistryAccount } from '../scripts/lib/account-command.mjs';
import { acceptRegistryInvitation } from '../scripts/lib/invitation-command.mjs';

const memoryFirestore = () => {
  const records = new Map();
  const writes = [];
  const snapshot = (path) => ({ exists: records.has(path), data: () => records.get(path) });
  return {
    records, writes,
    doc: (path) => ({ path }),
    runTransaction: async (operation) => {
      const pending = [];
      const read = ({ path }) => { assert.equal(pending.length, 0, 'Firestore exige les lectures avant toute écriture'); return snapshot(path); };
      const result = await operation({
        get: async (ref) => read(ref), getAll: async (...refs) => refs.map(read),
        create: (ref, data) => pending.push({ path: ref.path, data }),
        set: (ref, data, options) => pending.push({ path: ref.path, data: { ...(options?.merge ? records.get(ref.path) : {}), ...data } }),
        update: (ref, data) => pending.push({ path: ref.path, data: { ...records.get(ref.path), ...data } }),
      });
      for (const write of pending) { records.set(write.path, write.data); writes.push(write); }
      return result;
    },
  };
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fixture = (kind) => {
  const firestore = memoryFirestore();
  const uid = 'new-local-user';
  const invitationId = 'invite_test';
  firestore.records.set(`registryInvitations/${invitationId}`, {
    status: 'pending', organizationId: 'org_test', registryId: 'reg_test', scopeType: 'registry', scopeId: 'reg_test',
    tokenHash: sha256('test-token'), recipientEmailHash: sha256('guest@example.test'),
    expiresAt: { toDate: () => new Date('2030-01-01T00:00:00Z') },
  });
  firestore.records.set(`registries/reg_test/accesses/${invitationId}`, { sourceRevision: 1 });
  return { firestore, uid,
    run: () => kind === 'activation'
      ? activateRegistryAccount({ firestore, uid, email: 'guest@example.test', userName: 'Atelier Test', timestamp: 'NOW' })
      : acceptRegistryInvitation({ firestore, actorUid: uid, actorEmail: 'guest@example.test', invitationId, token: 'test-token', now: new Date('2026-09-18T00:00:00Z') }),
  };
};

for (const kind of ['activation', 'invitation']) {
  test(`${kind} : profil créé après réactivation conserve le cutoff Storage du projet`, async () => {
    const { firestore, uid, run } = fixture(kind);
    firestore.records.set(`accountAccess/${uid}`, { status: 'active', validAfter: 1_800_000_000, operationStatus: 'completed' });
    await run();
    assert.deepEqual(firestore.records.get(`users/${uid}`).accountAccess, { status: 'active', validAfter: 1_800_000_000 });
  });
  test(`${kind} : suspension et barrière mal formée ne créent aucun profil ni droit`, async () => {
    for (const guard of [{ status: 'suspended', validAfter: 5 }, { status: 'active' }, { status: 'active', validAfter: -1 }, { status: 'active', validAfter: 5.5 }]) {
      const { firestore, uid, run } = fixture(kind);
      firestore.records.set(`accountAccess/${uid}`, guard);
      await assert.rejects(run(), (error) => error.code === 'permission_denied');
      assert.equal(firestore.records.has(`users/${uid}`), false);
      assert.deepEqual(firestore.writes, []);
    }
  });
  test(`${kind} : une reprise vérifie la barrière avant de retourner un ancien succès`, async () => {
    const { firestore, uid, run } = fixture(kind);
    await run(); firestore.writes.length = 0;
    firestore.records.set(`accountAccess/${uid}`, { status: 'suspended', validAfter: 1_800_000_000 });
    await assert.rejects(run(), (error) => error.code === 'permission_denied');
    assert.deepEqual(firestore.writes, []);
  });
  test(`${kind} : une reprise répare le miroir absent sans modifier les droits ni le profil`, async () => {
    const { firestore, uid, run } = fixture(kind);
    await run();
    const before = { ...firestore.records.get(`users/${uid}`) };
    const guard = { status: 'active', validAfter: 1_800_000_000 };
    firestore.records.set(`accountAccess/${uid}`, guard); firestore.writes.length = 0;
    await run();
    assert.deepEqual(firestore.records.get(`users/${uid}`), { ...before, accountAccess: guard });
    assert.deepEqual(firestore.writes.map(({ path }) => path), [`users/${uid}`]);
  });
}
