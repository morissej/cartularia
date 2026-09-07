import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdministrationCommandError,
  loadAdministrationOverview,
  loadAdministrationUserDashboard,
  requireAdministrator,
  setAdministrationUserDisabled,
} from '../scripts/lib/administration-command.mjs';

const authUser = (uid, overrides = {}) => ({
  uid,
  email: `${uid}@technical.invalid`,
  displayName: '',
  disabled: false,
  emailVerified: true,
  metadata: { creationTime: '2026-08-01T10:00:00.000Z', lastSignInTime: '2026-08-22T10:00:00.000Z' },
  ...overrides,
});

const fakeFirestore = (records = new Map()) => {
  const snapshot = (path) => ({
    id: path.split('/').at(-1),
    exists: records.has(path),
    data: () => records.get(path),
  });
  const query = (matchesPath) => {
    const filters = [];
    let maximum = Infinity;
    const chain = {
      where(field, operator, value) {
        filters.push({ field, operator, value });
        return chain;
      },
      limit(value) {
        maximum = value;
        return chain;
      },
      async get() {
        const docs = [...records.entries()]
          .filter(([path]) => matchesPath(path))
          .filter(([, data]) => filters.every(({ field, operator, value }) => operator === '==' && data?.[field] === value))
          .slice(0, maximum)
          .map(([path]) => snapshot(path));
        return { docs, size: docs.length };
      },
    };
    return chain;
  };
  return {
    records,
    doc(path) {
    return {
      path,
      get: async () => snapshot(path),
      update: async (data) => records.set(path, { ...(records.get(path) || {}), ...data }),
      set: async (data) => records.set(path, { ...data }),
    };
    },
    collection(path) {
      const depth = path.split('/').length + 1;
      return query((candidate) => candidate.startsWith(`${path}/`) && candidate.split('/').length === depth);
    },
    collectionGroup(name) {
      return query((candidate) => candidate.split('/').at(-2) === name);
    },
    getAll: async (...references) => references.map(({ path }) => snapshot(path)),
  };
};

test('la console exige mot de passe récent et claim serveur', () => {
  const now = 2_000_000;
  assert.throws(() => requireAdministrator(null, now), AdministrationCommandError);
  assert.throws(
    () => requireAdministrator({ uid: 'operator', token: { auth_time: now } }, now),
    (error) => error.code === 'permission_denied',
  );
  assert.throws(
    () => requireAdministrator({ uid: 'operator', token: { cartulariaAdmin: true, auth_time: now - 901 } }, now),
    (error) => error.code === 'unauthenticated',
  );
  assert.equal(requireAdministrator({ uid: 'operator', token: { cartulariaAdmin: true, auth_time: now - 30 } }, now), 'operator');
});

test('la synthèse borne les lectures et masque les emails des bases isolées', async () => {
  const registryFirestore = fakeFirestore(new Map([['users/reg-1', { displayName: 'Atelier Horizon', status: 'active' }]]));
  const personalFirestore = fakeFirestore(new Map([['vaultUsers/vault-1/vault/profile', { ciphertext: 'SECRET' }]]));
  const bridgeFirestore = fakeFirestore(new Map([['codeAccounts/bridge-1/account/profile', { primaryClientNumber: 'CLI-ABCDEF12' }]]));
  const sources = [
    { id: 'registry', label: 'Registre', auth: { listUsers: async () => ({ users: [authUser('reg-1')] }) }, firestore: registryFirestore },
    { id: 'personal', label: 'Coffre personnel', auth: { listUsers: async () => ({ users: [authUser('vault-1')] }) }, firestore: personalFirestore },
    { id: 'bridge', label: 'Base de correspondance', auth: { listUsers: async () => ({ users: [authUser('bridge-1', { disabled: true })] }) }, firestore: bridgeFirestore },
  ];
  const result = await loadAdministrationOverview({ sources, pageSize: 9999 });
  assert.equal(result.totals.users, 3);
  assert.equal(result.totals.disabled, 1);
  assert.equal(result.databases[0].users[0].label, 'Atelier Horizon');
  assert.equal(result.databases[1].users[0].email, null);
  assert.equal(result.databases[1].users[0].ciphertext, undefined);
  assert.equal(result.databases[2].users[0].codedReference, 'CLI-ABCDEF12');
});

test('une base absente est signalée sans rabattement vers le Registre', async () => {
  const result = await loadAdministrationOverview({
    sources: [{ id: 'personal', label: 'Coffre personnel', auth: null, firestore: null }],
  });
  assert.equal(result.databases[0].state, 'unconfigured');
  assert.deepEqual(result.databases[0].users, []);
});

test('le dashboard d’un compte agrège ses Cartulaires, Collections et droits sans contenu privé', async () => {
  const uid = 'member-dashboard';
  const firestore = fakeFirestore(new Map([
    [`users/${uid}`, { displayName: 'Collectionneur Test', status: 'active', updatedAt: '2026-08-24T10:00:00.000Z' }],
    [`organizations/org-test`, { id: 'org-test', name: 'Espace Test', status: 'active' }],
    [`organizations/org-test/memberships/${uid}`, {
      uid, organizationId: 'org-test', status: 'active', roles: ['account_holder'], permissions: ['registry.read', 'cartulary.read'], scopes: { registryIds: ['reg-test'] },
    }],
    ['registries/reg-test', { id: 'reg-test', organizationId: 'org-test', name: 'Registre Test', status: 'active', itemCount: 1 }],
    ['registries/reg-test/collections/col-test', { id: 'col-test', name: 'Collection Test', status: 'draft', visibility: 'secret', publishedCartularyIds: [] }],
    ['cartularies/cart-test', {
      accountHolderId: uid, displayTitle: 'Montre Test', makerName: 'Maison', modelName: 'Modèle', assetType: 'watch', lifecycleStatus: 'active', publicationStatus: 'none', registryId: 'reg-test', collectionId: 'col-test', publicCode: 'OBJ-TEST', revision: 3,
    }],
    [`privateDrafts/${uid}/cartularies/draft-test`, { status: 'active', assetType: 'watch', registryId: 'reg-test' }],
  ]));
  const registryUser = authUser(uid, { displayName: 'Collectionneur Test' });
  const source = {
    id: 'registry',
    label: 'Registre',
    firestore,
    auth: {
      getUser: async () => registryUser,
      listUsers: async () => ({ users: [registryUser] }),
    },
  };
  const result = await loadAdministrationUserDashboard({ sources: [source], databaseId: 'registry', targetUid: uid });
  assert.deepEqual(result.totals, { organizations: 1, registries: 1, cartularies: 1, collections: 1, drafts: 1 });
  assert.equal(result.cartularies[0].displayTitle, 'Montre Test');
  assert.equal(result.collections[0].name, 'Collection Test');
  assert.deepEqual(result.memberships[0].permissions, ['registry.read', 'cartulary.read']);
  assert.equal(result.cartularies[0].ciphertext, undefined);
});

test('la suspension exige un motif, interdit l’auto-suspension et écrit un audit', async () => {
  const updates = [];
  const audits = [];
  const source = {
    id: 'registry',
    auth: {
      getUser: async () => ({ disabled: false }),
      updateUser: async (uid, data) => updates.push({ uid, data }),
    },
    firestore: fakeFirestore(new Map([['users/member-1', { status: 'active' }]])),
  };
  const auditFirestore = { collection: () => ({ add: async (entry) => audits.push(entry) }) };
  await assert.rejects(
    setAdministrationUserDisabled({ actorUid: 'operator', source, targetUid: 'member-1', disabled: true, reason: 'court', auditFirestore, timestamp: 'NOW' }),
    (error) => error.code === 'invalid_argument',
  );
  await assert.rejects(
    setAdministrationUserDisabled({ actorUid: 'operator', source, targetUid: 'operator', disabled: true, reason: 'Contrôle demandé', auditFirestore, timestamp: 'NOW' }),
    (error) => error.code === 'failed_precondition',
  );
  const result = await setAdministrationUserDisabled({ actorUid: 'operator', source, targetUid: 'member-1', disabled: true, reason: 'Compte compromis', auditFirestore, timestamp: 'NOW' });
  assert.deepEqual(result, { database: 'registry', uid: 'member-1', disabled: true });
  assert.deepEqual(updates, [{ uid: 'member-1', data: { disabled: true } }]);
  assert.equal(source.firestore.records.get('users/member-1').status, 'suspended');
  assert.equal(audits[0].action, 'user.suspend');
  assert.equal(audits[0].reason, 'Compte compromis');
});

test('un échec d’audit compense la modification Authentication', async () => {
  const updates = [];
  const source = {
    id: 'registry',
    auth: {
      getUser: async () => ({ disabled: false }),
      updateUser: async (uid, data) => updates.push({ uid, data }),
    },
    firestore: fakeFirestore(new Map([['users/vault-1', { status: 'active', updatedAt: 'BEFORE' }]])),
  };
  await assert.rejects(setAdministrationUserDisabled({
    actorUid: 'operator',
    source,
    targetUid: 'vault-1',
    disabled: true,
    reason: 'Demande de sécurité',
    auditFirestore: { collection: () => ({ add: async () => { throw new Error('audit unavailable'); } }) },
    timestamp: 'NOW',
  }));
  assert.deepEqual(updates, [
    { uid: 'vault-1', data: { disabled: true } },
    { uid: 'vault-1', data: { disabled: false } },
  ]);
  assert.deepEqual(source.firestore.records.get('users/vault-1'), { status: 'active', updatedAt: 'BEFORE' });
});
