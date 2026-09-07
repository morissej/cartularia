import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountCommandError, activateRegistryAccount } from '../scripts/lib/account-command.mjs';

const fakeFirestore = () => {
  const writes = [];
  const records = new Map();
  return {
    writes,
    records,
    doc: (path) => ({ path }),
    getAll: async (...references) => references.map(({ path }) => ({ exists: records.has(path), data: () => records.get(path) })),
    runTransaction: async (callback) => {
      const pending = [];
      const result = await callback({
        getAll: async (...references) => references.map(({ path }) => ({ exists: records.has(path), data: () => records.get(path) })),
        create: (reference, data) => pending.push({ operation: 'create', path: reference.path, data }),
      });
      for (const write of pending) records.set(write.path, write.data);
      writes.push(...pending);
      return result;
    },
  };
};

test('l’activation crée un compte, une organisation, un membership et un Registre secret', async () => {
  const firestore = fakeFirestore();
  const result = await activateRegistryAccount({
    firestore,
    uid: 'account-owner-1',
    email: 'opaque@registry.cartularia.invalid',
    userName: '  Atelier   Horizon ',
    timestamp: 'NOW',
  });

  assert.match(result.organizationId, /^org_[a-f0-9]{24}$/);
  assert.match(result.registryId, /^reg_[a-f0-9]{24}$/);
  assert.deepEqual(firestore.writes.map(({ path }) => path), [
    'users/account-owner-1',
    `organizations/${result.organizationId}`,
    `organizations/${result.organizationId}/memberships/account-owner-1`,
    `registries/${result.registryId}`,
  ]);
  assert.equal(firestore.writes[0].data.displayName, 'Atelier Horizon');
  assert.equal(firestore.writes[2].data.scopes.registryIds[0], result.registryId);
  assert.ok(firestore.writes[2].data.permissions.includes('cartulary.edit'));
  assert.equal(firestore.writes[3].data.visibility, 'secret');
  assert.equal(firestore.writes[3].data.itemCount, 0);
  assert.ok(firestore.writes.every(({ operation }) => operation === 'create'));
});

test('une reprise conserve le Registre existant et son compteur', async () => {
  const firestore = fakeFirestore();
  const first = await activateRegistryAccount({ firestore, uid: 'same-user', email: '', userName: 'Même compte', timestamp: 'NOW' });
  firestore.records.set(`registries/${first.registryId}`, { ...firestore.records.get(`registries/${first.registryId}`), itemCount: 7 });
  firestore.writes.length = 0;
  const second = await activateRegistryAccount({ firestore, uid: 'same-user', email: '', userName: 'Même compte', timestamp: 'LATER' });
  assert.deepEqual(first, second);
  assert.deepEqual(firestore.writes, []);
  assert.equal(firestore.records.get(`registries/${first.registryId}`).itemCount, 7);
});

test('une activation répétée ne restaure ni un compte suspendu ni un membership supprimé', async () => {
  for (const removed of ['suspended', 'membership']) {
    const firestore = fakeFirestore();
    const first = await activateRegistryAccount({ firestore, uid: 'protected-user', email: '', userName: 'Compte protégé', timestamp: 'NOW' });
    if (removed === 'suspended') firestore.records.set('users/protected-user', { ...firestore.records.get('users/protected-user'), status: 'suspended' });
    else firestore.records.delete(`organizations/${first.organizationId}/memberships/protected-user`);
    firestore.writes.length = 0;
    await assert.rejects(activateRegistryAccount({ firestore, uid: 'protected-user', email: '', userName: 'Compte protégé' }),
      (error) => error instanceof AccountCommandError && ['permission_denied', 'failed_precondition'].includes(error.code));
    assert.deepEqual(firestore.writes, []);
  }
});

test('un nom utilisateur invalide est refusé avant toute écriture', async () => {
  const firestore = fakeFirestore();
  await assert.rejects(
    activateRegistryAccount({ firestore, uid: 'owner', email: '', userName: 'x', timestamp: 'NOW' }),
    (error) => error instanceof AccountCommandError && error.code === 'invalid_argument',
  );
  assert.equal(firestore.writes.length, 0);
});
