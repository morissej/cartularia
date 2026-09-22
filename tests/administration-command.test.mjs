import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdministrationCommandError,
  loadAdministrationOverview,
  loadAdministrationUserDashboard,
  requireAdministrator,
  setAdministrationUserDisabled,
} from '../scripts/lib/administration-command.mjs';
import { assertActiveAccount, assertActiveAccountSession } from '../scripts/lib/account-access-command.mjs';

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
  let transactionQueue = Promise.resolve();
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
      set: async (data, options) => records.set(path, { ...(options?.merge ? records.get(path) : {}), ...data }),
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
    async runTransaction(operation) {
      let release;
      const previous = transactionQueue;
      transactionQueue = new Promise((resolve) => { release = resolve; });
      await previous;
      const changes = [];
      try {
        const result = await operation({
          get: async (reference) => snapshot(reference.path),
          set: (reference, data, options) => changes.push(() => records.set(reference.path, { ...(options?.merge ? records.get(reference.path) : {}), ...data })),
          update: (reference, data) => changes.push(() => records.set(reference.path, { ...records.get(reference.path), ...data })),
        });
        changes.forEach((commit) => commit());
        return result;
      } finally { release(); }
    },
  };
};

test('la console exige une session récente, un compte actif et un claim administrateur encore actuel', async () => {
  const now = 2_000_000;
  let current = authUser('operator', { customClaims: { cartulariaAdmin: true } });
  const auth = { getUser: async () => current };
  const firestore = fakeFirestore(new Map([['users/operator', { status: 'active' }]]));
  const request = (token = {}) => ({ uid: 'operator', token: { auth_time: now - 30, cartulariaAdmin: true, ...token } });
  const call = (requestAuth) => requireAdministrator({ auth, firestore, requestAuth, nowSeconds: now });
  await assert.rejects(call(null), AdministrationCommandError);
  await assert.rejects(call(request({ cartulariaAdmin: false })), (error) => error.code === 'permission_denied');
  await assert.rejects(call(request({ auth_time: now - 901 })), (error) => error.code === 'unauthenticated');
  await assert.rejects(call(request({ auth_time: now + 1 })), (error) => error.code === 'unauthenticated');
  assert.equal(await call(request()), 'operator');
  current = { ...current, customClaims: {} };
  await assert.rejects(call(request()), (error) => error.code === 'permission_denied');
  current = { ...current, customClaims: { cartulariaAdmin: true }, disabled: true };
  await assert.rejects(call(request()), (error) => error.code === 'permission_denied');
  current = { ...current, disabled: false };
  firestore.records.set('users/operator', { status: 'suspended' });
  await assert.rejects(call(request()), (error) => error.code === 'permission_denied');
});

test('le contrôle commun distingue la révocation Auth inclusive et la barrière explicite stricte', async () => {
  const now = 2_000_000;
  const uid = 'member';
  const auth = { getUser: async () => authUser(uid, { tokensValidAfterTime: new Date((now - 30) * 1000).toISOString() }) };
  const firestore = fakeFirestore(new Map([['users/member', { status: 'active' }]]));
  const requestAuth = { uid, token: { auth_time: now - 30 } };
  assert.equal((await assertActiveAccountSession({ auth, firestore, requestAuth, nowSeconds: now })).uid, uid);
  await assert.rejects(assertActiveAccountSession({ auth, firestore, requestAuth: { uid, token: { auth_time: now - 31 } }, nowSeconds: now }), (error) => error.code === 'unauthenticated');
  firestore.records.set('accountAccess/member', { status: 'active', validAfter: now - 30 });
  await assert.rejects(assertActiveAccountSession({ auth, firestore, requestAuth, nowSeconds: now }), (error) => error.code === 'unauthenticated');
  assert.equal((await assertActiveAccountSession({ auth, firestore, requestAuth: { uid, token: { auth_time: now - 29 } }, nowSeconds: now })).validAfter, now - 30);
  firestore.records.set('accountAccess/member', { status: 'suspended', validAfter: now - 30 });
  await assert.rejects(assertActiveAccount({ auth, firestore, uid }), (error) => error.code === 'permission_denied');
});

test('la compatibilité sans profil reste explicite et ne contourne pas une barrière locale ou un profil suspendu', async () => {
  const uid = 'isolated';
  const auth = { getUser: async () => authUser(uid) };
  const firestore = fakeFirestore();
  assert.equal((await assertActiveAccount({ auth, firestore, uid, allowMissingProfile: true })).accountAccess, null);
  await assert.rejects(assertActiveAccount({ auth, firestore, uid }), (error) => error.code === 'permission_denied');
  firestore.records.set('accountAccess/isolated', { status: 'active', validAfter: 'invalid' });
  await assert.rejects(assertActiveAccount({ auth, firestore, uid, allowMissingProfile: true }), (error) => error.code === 'permission_denied');
  firestore.records.delete('accountAccess/isolated');
  firestore.records.set('users/isolated', { status: 'suspended' });
  await assert.rejects(assertActiveAccount({ auth, firestore, uid, allowMissingProfile: true }), (error) => error.code === 'permission_denied');
});

test('un ancien custom token ne contourne pas la suspension en étant échangé après réactivation', async () => {
  const now = 2_000_000;
  const uid = 'recovery-member';
  const auth = { getUser: async () => authUser(uid, { tokensValidAfterTime: new Date((now - 20) * 1000).toISOString() }) };
  const firestore = fakeFirestore(new Map([
    [`users/${uid}`, { status: 'active' }],
    [`accountAccess/${uid}`, { status: 'active', validAfter: now - 20 }],
  ]));
  const check = (issuedAt, provider = 'custom') => assertActiveAccountSession({
    auth, firestore, nowSeconds: now,
    requestAuth: { uid, token: { auth_time: now - 1, firebase: { sign_in_provider: provider },
      ...(issuedAt === undefined ? {} : { cartulariaRecoveryIssuedAt: issuedAt }) } },
  });
  await assert.rejects(check(undefined), (error) => error.code === 'unauthenticated');
  await assert.rejects(check(now - 21), (error) => error.code === 'unauthenticated');
  await assert.rejects(check(now - 20), (error) => error.code === 'unauthenticated');
  await assert.rejects(check(now + 1), (error) => error.code === 'unauthenticated');
  assert.equal((await check(now - 19)).uid, uid);
  assert.equal((await check(undefined, 'password')).uid, uid);
  firestore.records.delete(`accountAccess/${uid}`);
  await assert.rejects(check(now - 21), (error) => error.code === 'unauthenticated');
  assert.equal((await check(now - 20)).uid, uid);
  assert.equal((await check(undefined)).uid, uid); // compatibility before an explicit barrier
});

test('les lectures de barrière participent à la transaction qui protège la mutation', async () => {
  const paths = [];
  const firestore = fakeFirestore(new Map([['users/member', { status: 'active' }]]));
  const result = await assertActiveAccount({
    auth: { getUser: async () => authUser('member') }, firestore, uid: 'member',
    transaction: { get: async (ref) => { paths.push(ref.path); return ref.get(); } },
  });
  assert.equal(result.uid, 'member');
  assert.deepEqual(paths.sort(), ['accountAccess/member', 'users/member']);
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

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const administrationFixture = (database = 'registry') => {
  const updates = [];
  const revocations = [];
  let user = authUser('member-1');
  const source = {
    id: database,
    firestore: fakeFirestore(new Map(database === 'registry' ? [
      ['users/member-1', { status: 'active', retained: 'profile' }],
      ['communityMemberships/member-1', { status: 'active', roles: ['moderator'] }],
    ] : [])),
    auth: {
      getUser: async () => ({ ...user }),
      updateUser: async (uid, data) => { updates.push({ uid, data }); user = { ...user, ...data }; return user; },
      revokeRefreshTokens: async (uid) => { revocations.push(uid); user.tokensValidAfterTime = new Date(2_000_000 * 1000).toISOString(); },
    },
  };
  const auditFirestore = fakeFirestore();
  const run = (overrides = {}) => setAdministrationUserDisabled({ actorUid: 'operator', source, targetUid: 'member-1', disabled: true,
    reason: 'Compte compromis', auditFirestore, timestamp: 'NOW', nowSeconds: 2_000_000, ...overrides });
  return { source, auditFirestore, run, updates, revocations };
};

test('la console et le dashboard affichent la barrière effective après un échec Auth sans exposer son motif', async () => {
  const { source, run } = administrationFixture();
  source.label = 'Registre';
  source.auth.listUsers = async () => ({ users: [await source.auth.getUser('member-1')] });
  source.auth.updateUser = async () => { throw new Error('auth unavailable'); };
  await assert.rejects(run(), (error) => error.code === 'failed_precondition');
  assert.equal((await source.auth.getUser('member-1')).disabled, false);
  assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
  const overview = await loadAdministrationOverview({ sources: [source] });
  assert.equal(overview.totals.disabled, 1);
  assert.equal(overview.databases[0].users[0].disabled, true);
  assert.equal(overview.databases[0].users[0].authDisabled, false);
  assert.equal(overview.databases[0].users[0].accessOperationStatus, 'failed');
  const dashboard = await loadAdministrationUserDashboard({ sources: [source], databaseId: 'registry', targetUid: 'member-1' });
  assert.equal(dashboard.selectedAccount.disabled, true);
  assert.equal(dashboard.selectedAccount.authDisabled, false);
  assert.equal(dashboard.selectedAccount.accessOperationStatus, 'failed');
  assert.equal(dashboard.linkedDatabases[0].account.disabled, true);
  assert.equal(dashboard.selectedAccount.reason, undefined);
  assert.equal(dashboard.selectedAccount.failureCode, undefined);
});

test('les métadonnées distinguent les opérations en cours, les guards invalides et les profils suspendus', async () => {
  for (const database of ['registry', 'personal', 'bridge']) {
    const { source } = administrationFixture(database);
    source.auth.listUsers = async () => ({ users: [authUser('member-1')] });
    for (const access of [
      { status: 'suspended', validAfter: 100, operationStatus: 'pending' },
      { status: 'active', validAfter: 'invalid' },
      { validAfter: 100 },
    ]) {
      source.firestore.records.set('accountAccess/member-1', access);
      const overview = await loadAdministrationOverview({ sources: [source] });
      const user = overview.databases[0].users[0];
      assert.equal(user.disabled, true, `${database}: une barrière fermée reste affichée fermée`);
      assert.equal(user.authDisabled, false);
      assert.equal(user.accessOperationStatus, access.operationStatus || null);
    }
    source.firestore.records.delete('accountAccess/member-1');
    if (database === 'registry') source.firestore.records.set('users/member-1', { status: 'suspended' });
    const overview = await loadAdministrationOverview({ sources: [source] });
    assert.equal(overview.databases[0].users[0].disabled, database === 'registry');
  }
});

test('la suspension exige un motif, interdit l’auto-suspension et écrit audit, barrière et miroirs', async () => {
  const { source, auditFirestore, run, updates, revocations } = administrationFixture();
  await assert.rejects(run({ reason: 'court' }), (error) => error.code === 'invalid_argument');
  await assert.rejects(run({ targetUid: 'operator' }), (error) => error.code === 'failed_precondition');
  await assert.rejects(run({ disabled: 'true' }), (error) => error.code === 'invalid_argument');
  assert.equal(source.firestore.records.has('accountAccess/member-1'), false);
  const result = await run();
  assert.deepEqual(result, { database: 'registry', uid: 'member-1', disabled: true });
  assert.deepEqual(updates, [{ uid: 'member-1', data: { disabled: true } }]);
  assert.deepEqual(revocations, ['member-1']);
  const barrier = source.firestore.records.get('accountAccess/member-1');
  assert.equal(barrier.status, 'suspended');
  assert.equal(barrier.validAfter, 2_000_000);
  assert.equal(barrier.operationStatus, 'completed');
  assert.equal(source.firestore.records.get('users/member-1').status, 'suspended');
  assert.equal(source.firestore.records.get('users/member-1').retained, 'profile');
  assert.deepEqual(source.firestore.records.get('users/member-1').accountAccess, { status: 'suspended', validAfter: barrier.validAfter });
  assert.deepEqual(source.firestore.records.get('communityMemberships/member-1'), { status: 'active', roles: ['moderator'], accountAccess: { status: 'suspended', validAfter: barrier.validAfter } });
  const [audit] = [...auditFirestore.records.values()];
  assert.equal(audit.action, 'user.suspend');
  assert.equal(audit.reason, 'Compte compromis');
});

test('la barrière transactionnelle est déjà fermée pendant le disable et la révocation Auth', async () => {
  const { source, run } = administrationFixture();
  const begun = deferred();
  const finishing = deferred();
  const original = source.auth.updateUser;
  source.auth.updateUser = async (...args) => { begun.resolve(); await finishing.promise; return original(...args); };
  const operation = run();
  await begun.promise;
  assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
  assert.equal(source.firestore.records.get('accountAccess/member-1').operationStatus, 'pending');
  assert.equal(source.firestore.records.get('users/member-1').status, 'suspended');
  assert.equal(source.firestore.records.get('communityMemberships/member-1').accountAccess.status, 'suspended');
  await assert.rejects(run({ disabled: false }), (error) => error.code === 'failed_precondition');
  finishing.resolve();
  await operation;
});

test('un échec d’audit ne réactive jamais le compte suspendu', async () => {
  const { source, run, updates } = administrationFixture();
  const unavailableAudit = { doc: () => ({ set: async () => { throw new Error('audit unavailable'); } }) };
  await assert.rejects(run({ auditFirestore: unavailableAudit }), (error) => error.code === 'failed_precondition' && error.details.accessStatus === 'suspended');
  assert.deepEqual(updates, [{ uid: 'member-1', data: { disabled: true } }]);
  assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
  assert.equal(source.firestore.records.get('accountAccess/member-1').operationStatus, 'failed');
  assert.equal(source.firestore.records.get('users/member-1').status, 'suspended');
});

test('un échec de révocation reste fermé et est audité sans rollback vers actif', async () => {
  const { source, auditFirestore, run, updates } = administrationFixture();
  source.auth.revokeRefreshTokens = async () => { throw new Error('revoke unavailable'); };
  await assert.rejects(run(), (error) => error.code === 'failed_precondition');
  assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
  assert.equal(source.firestore.records.get('accountAccess/member-1').operationStatus, 'failed');
  assert.equal(updates.some(({ data }) => data.disabled === false), false);
  assert.equal([...auditFirestore.records.values()][0].outcome, 'failed_closed');
});

test('un disable défaillant tente quand même la révocation et conserve la barrière fermée', async () => {
  const { source, run, revocations } = administrationFixture();
  source.auth.updateUser = async () => { throw new Error('disable unavailable'); };
  await assert.rejects(run());
  assert.deepEqual(revocations, ['member-1']);
  assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
});

test('la réactivation ne rouvre qu’après Auth et audit et conserve le cutoff monotone', async () => {
  const { source, run, auditFirestore } = administrationFixture();
  await run();
  const previousCutoff = source.firestore.records.get('accountAccess/member-1').validAfter;
  const begun = deferred();
  const finishing = deferred();
  const originalDoc = auditFirestore.doc.bind(auditFirestore);
  auditFirestore.doc = (path) => ({ ...originalDoc(path), set: async (...args) => { begun.resolve(); await finishing.promise; return originalDoc(path).set(...args); } });
  const operation = run({ disabled: false, nowSeconds: previousCutoff + 10 });
  await begun.promise;
  assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
  finishing.resolve();
  await operation;
  const barrier = source.firestore.records.get('accountAccess/member-1');
  assert.equal(barrier.status, 'active');
  assert.equal(barrier.validAfter, previousCutoff + 10);
  assert.equal(source.firestore.records.get('users/member-1').status, 'active');
  assert.deepEqual(source.firestore.records.get('communityMemberships/member-1').accountAccess, { status: 'active', validAfter: previousCutoff + 10 });
  await assert.rejects(assertActiveAccountSession({ auth: source.auth, firestore: source.firestore,
    requestAuth: { uid: 'member-1', token: { auth_time: previousCutoff + 10 } }, nowSeconds: previousCutoff + 20 }), (error) => error.code === 'unauthenticated');
});

test('une réactivation dont l’audit échoue garde la barrière et Authentication fermés', async () => {
  const { source, run } = administrationFixture();
  await run();
  await assert.rejects(run({ disabled: false, auditFirestore: { doc: () => ({ set: async () => { throw new Error('audit unavailable'); } }) } }));
  assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
  assert.equal(source.firestore.records.get('users/member-1').status, 'suspended');
  assert.equal((await source.auth.getUser('member-1')).disabled, true);
});

test('une réactivation dont Authentication échoue ne rouvre jamais la barrière', async () => {
  const { source, run } = administrationFixture();
  await run();
  const original = source.auth.updateUser;
  source.auth.updateUser = async (uid, options) => { if (!options.disabled) throw new Error('enable failed'); return original(uid, options); };
  await assert.rejects(run({ disabled: false }));
  assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
  assert.equal((await source.auth.getUser('member-1')).disabled, true);
});

test('un échec traité peut être retenté sans perdre le cutoff ni les données du profil', async () => {
  const { source, run } = administrationFixture();
  await assert.rejects(run({ auditFirestore: { doc: () => ({ set: async () => { throw new Error('audit unavailable'); } }) } }));
  const cutoff = source.firestore.records.get('accountAccess/member-1').validAfter;
  await run({ disabled: false, nowSeconds: cutoff - 10 });
  const barrier = source.firestore.records.get('accountAccess/member-1');
  assert.equal(barrier.status, 'active');
  assert.equal(barrier.operationStatus, 'completed');
  assert.equal(barrier.validAfter, cutoff);
  assert.equal(source.firestore.records.get('users/member-1').retained, 'profile');
});

test('une finalisation obsolète ne remplace jamais une barrière plus récente', async () => {
  const { source, auditFirestore, run } = administrationFixture();
  const begun = deferred();
  const finishing = deferred();
  const originalDoc = auditFirestore.doc.bind(auditFirestore);
  let first = true;
  auditFirestore.doc = (path) => ({ ...originalDoc(path), set: async (...args) => {
    if (first) { first = false; begun.resolve(); await finishing.promise; }
    return originalDoc(path).set(...args);
  } });
  const operation = run();
  await begun.promise;
  const newer = { ...source.firestore.records.get('accountAccess/member-1'), operationId: 'newer-operation', validAfter: 2_000_100 };
  source.firestore.records.set('accountAccess/member-1', newer);
  finishing.resolve();
  await assert.rejects(operation, (error) => error.code === 'failed_precondition');
  assert.deepEqual(source.firestore.records.get('accountAccess/member-1'), newer);
});

for (const database of ['personal', 'bridge']) {
  test(`la suspension ${database} écrit uniquement la barrière de son propre projet`, async () => {
    const { source, run } = administrationFixture(database);
    await run();
    assert.deepEqual([...source.firestore.records.keys()], ['accountAccess/member-1']);
    assert.equal(source.firestore.records.get('accountAccess/member-1').status, 'suspended');
  });
}
