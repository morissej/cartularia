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
    batch: () => ({
      create: (reference, data) => writes.push({ operation: 'create', path: reference.path, data }),
      update: (reference, data) => writes.push({ operation: 'update', path: reference.path, data }),
      commit: async () => {
        for (const write of writes) records.set(write.path, { ...(records.get(write.path) || {}), ...write.data });
      },
    }),
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
  assert.deepEqual(firestore.writes.map(({ operation, path }) => [operation, path]), [['update', 'users/same-user']]);
  assert.equal(firestore.records.get(`registries/${first.registryId}`).itemCount, 7);
});

test('un nom utilisateur invalide est refusé avant toute écriture', async () => {
  const firestore = fakeFirestore();
  await assert.rejects(
    activateRegistryAccount({ firestore, uid: 'owner', email: '', userName: 'x', timestamp: 'NOW' }),
    (error) => error instanceof AccountCommandError && error.code === 'invalid_argument',
  );
  assert.equal(firestore.writes.length, 0);
});
