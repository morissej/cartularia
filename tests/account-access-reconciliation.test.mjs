import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAccountAccessReconcileArgs, reconcileAccountAccess, resolveStaleAccountAccessOperation } from '../scripts/lib/account-access-reconciliation.mjs';

const fakeFirestore = (entries = []) => {
  const records = new Map(entries);
  const writes = [];
  const commits = [];
  let retryHook = null;
  let transactionCount = 0;
  const snapshot = (path) => {
    const value = records.get(path);
    return { exists: records.has(path), data: () => structuredClone(value) };
  };
  return {
    projectId: 'demo-account-access', records, writes, commits,
    get transactionCount() { return transactionCount; },
    setRetryHook(hook) { retryHook = hook; },
    doc: (path) => ({ path, get: async () => snapshot(path) }),
    async runTransaction(operation) {
      transactionCount += 1;
      const attempt = async () => {
        const pending = [];
        const result = await operation({
          get: async (ref) => snapshot(ref.path),
          set: (ref, data, options) => pending.push({ path: ref.path, data, merge: options?.merge }),
          update: (ref, data) => pending.push({ path: ref.path, data, merge: true }),
        });
        return { result, pending };
      };
      let staged = await attempt();
      if (retryHook) {
        const hook = retryHook;
        retryHook = null;
        await hook();
        staged = await attempt();
      }
      for (const write of staged.pending) {
        records.set(write.path, { ...(write.merge ? records.get(write.path) : {}), ...write.data });
        writes.push(write);
      }
      commits.push(staged.pending.map((write) => write.path));
      return staged.result;
    },
  };
};
const user = (uid, options = {}) => ({ uid, disabled: false, tokensValidAfterTime: new Date(100_000).toISOString(), ...options });
const fakeAuth = (initialUsers) => {
  const users = new Map(initialUsers.map((entry) => [entry.uid, entry]));
  const pages = [];
  const lookups = [];
  return {
    app: { options: { projectId: 'demo-account-access' } }, users, pages, lookups,
    async listUsers(size, token) {
      pages.push(token);
      const offset = Number(token || 0);
      const all = [...users.values()];
      return { users: structuredClone(all.slice(offset, offset + size)), ...(offset + size < all.length ? { pageToken: String(offset + size) } : {}) };
    },
    async getUser(uid) { lookups.push(uid); return structuredClone(users.get(uid)); },
    updateUser() { throw new Error('Auth must never be modified'); },
    revokeRefreshTokens() { throw new Error('Auth must never be modified'); },
  };
};
const run = (auth, firestore, options = {}) => reconcileAccountAccess({ auth, firestore,
  projectId: 'demo-account-access', database: 'registry', now: () => 200_000, ...options });

test('le projet et la base doivent être explicites, même en dry-run ou avec --apply', () => {
  assert.throws(() => parseAccountAccessReconcileArgs([]), /Projet Firebase explicite/);
  assert.throws(() => parseAccountAccessReconcileArgs(['--apply', '--database', 'registry']), /Projet Firebase explicite/);
  assert.throws(() => parseAccountAccessReconcileArgs(['--project=demo-account-access']), /Base explicite/);
  assert.throws(() => parseAccountAccessReconcileArgs(['--project=x', '--database=registry']), /Projet Firebase/);
  assert.throws(() => parseAccountAccessReconcileArgs(['--project=demo-account-access', '--database=wrong']), /Base explicite/);
  assert.throws(() => parseAccountAccessReconcileArgs(['--project=demo-account-access', '--project=another-project', '--database=registry']), /répété/);
  assert.equal(parseAccountAccessReconcileArgs(['--project', 'demo-account-access', '--database', 'personal']).apply, false);
  assert.equal(parseAccountAccessReconcileArgs(['--project=demo-account-access', '--database=bridge', '--apply']).apply, true);
  assert.equal(parseAccountAccessReconcileArgs(['--help']).help, true);
});

test('le dry-run paginé ne fait aucune écriture et ne rapporte pas le contenu des profils', async () => {
  const auth = fakeAuth([user('active'), user('disabled', { disabled: true }), user('third')]);
  const firestore = fakeFirestore([
    ['users/active', { status: 'active', displayName: 'SECRET_PROFILE' }],
    ['users/disabled', { status: 'active' }],
  ]);
  const before = structuredClone([...firestore.records]);
  const report = await run(auth, firestore, { pageSize: 2 });
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.counts.would_change, 3);
  assert.deepEqual(auth.pages, [undefined, '2']);
  assert.deepEqual(auth.lookups, ['active', 'disabled', 'third']);
  assert.equal(firestore.transactionCount, 0);
  assert.equal(firestore.writes.length, 0);
  assert.deepEqual([...firestore.records], before);
  assert.equal(JSON.stringify(report).includes('SECRET_PROFILE'), false);
});

test('un ancien compte disabled reçoit une barrière fermée et ses miroirs dans le même commit', async () => {
  const auth = fakeAuth([user('disabled', { disabled: true })]);
  const firestore = fakeFirestore([
    ['users/disabled', { status: 'active', retained: 'profile' }],
    ['communityMemberships/disabled', { status: 'active', roles: ['moderator'] }],
  ]);
  const report = await run(auth, firestore, { apply: true });
  assert.equal(report.counts.applied, 1);
  assert.deepEqual(firestore.commits[0], ['accountAccess/disabled', 'users/disabled', 'communityMemberships/disabled']);
  assert.equal(firestore.records.get('accountAccess/disabled').status, 'suspended');
  assert.equal(firestore.records.get('accountAccess/disabled').validAfter, 100);
  assert.equal(firestore.records.get('users/disabled').status, 'suspended');
  assert.equal(firestore.records.get('users/disabled').retained, 'profile');
  assert.deepEqual(firestore.records.get('communityMemberships/disabled'), { status: 'active', roles: ['moderator'], accountAccess: { status: 'suspended', validAfter: 100 } });
});

test('un compte ancien actif reste actif avec cutoff explicite puis une seconde passe est sans écriture', async () => {
  const auth = fakeAuth([user('active')]);
  const firestore = fakeFirestore([['users/active', { status: 'active' }]]);
  await run(auth, firestore, { apply: true });
  assert.equal(firestore.records.get('accountAccess/active').status, 'active');
  assert.equal(firestore.records.get('accountAccess/active').validAfter, 100);
  assert.equal(firestore.records.get('users/active').status, 'active');
  firestore.writes.length = 0;
  const second = await run(auth, firestore, { apply: true });
  assert.equal(second.counts.unchanged, 1);
  assert.equal(firestore.writes.length, 0);
});

test('ni un profil fermé ni une barrière ou un miroir fermé ne sont rouverts par Auth actif', async () => {
  for (const entries of [
    [['users/member', { status: 'inactive' }]],
    [['accountAccess/member', { status: 'suspended', validAfter: 120, operationStatus: 'failed', operationId: 'preserved' }], ['users/member', { status: 'active' }]],
    [['users/member', { status: 'active', accountAccess: { status: 'suspended', validAfter: 130 } }]],
    [['communityMemberships/member', { status: 'active', accountAccess: { status: 'suspended', validAfter: 140 } }]],
  ]) {
    const auth = fakeAuth([user('member')]);
    const firestore = fakeFirestore(entries);
    await run(auth, firestore, { apply: true });
    assert.equal(firestore.records.get('accountAccess/member').status, 'suspended');
    if (entries[0][0] === 'accountAccess/member') {
      assert.equal(firestore.records.get('accountAccess/member').operationId, 'preserved');
      assert.equal(firestore.records.get('accountAccess/member').operationStatus, 'failed');
    }
    if (entries[0][1].status === 'inactive') assert.equal(firestore.records.get('users/member').status, 'inactive');
  }
});

test('le cutoff reste le maximum Auth, central et miroirs et ne diminue jamais', async () => {
  const auth = fakeAuth([user('member', { tokensValidAfterTime: new Date(151_900).toISOString() })]);
  const firestore = fakeFirestore([
    ['accountAccess/member', { status: 'active', validAfter: 160 }],
    ['users/member', { status: 'active', accountAccess: { status: 'active', validAfter: 180 } }],
    ['communityMemberships/member', { status: 'active', accountAccess: { status: 'active', validAfter: 175 } }],
  ]);
  await run(auth, firestore, { apply: true });
  assert.equal(firestore.records.get('accountAccess/member').validAfter, 180);
  assert.equal(firestore.records.get('communityMemberships/member').accountAccess.validAfter, 180);
  auth.users.set('member', user('member', { tokensValidAfterTime: new Date(190_900).toISOString() }));
  await run(auth, firestore, { apply: true });
  assert.equal(firestore.records.get('accountAccess/member').validAfter, 190);
});

test('pending, barrières malformées et profils malformés restent intacts avec revue manuelle', async () => {
  for (const entries of [
    [['accountAccess/member', { status: 'suspended', validAfter: 120, operationStatus: 'pending' }]],
    [['accountAccess/member', { status: 'active', validAfter: 'unsafe' }]],
    [['accountAccess/member', { status: 'active', validAfter: 120, operationStatus: 'failed' }]],
    [['users/member', { status: 'active', accountAccess: null }]],
    [['users/member', { missingStatus: true }]],
  ]) {
    const auth = fakeAuth([user('member')]);
    const firestore = fakeFirestore(entries);
    const before = structuredClone([...firestore.records]);
    const report = await run(auth, firestore, { apply: true });
    assert.equal(report.counts.manual, 1);
    assert.equal(firestore.writes.length, 0);
    assert.deepEqual([...firestore.records], before);
  }
});

test('un conflit transactionnel relit Auth et une barrière devenue pending au lieu de publier le plan ancien', async () => {
  const auth = fakeAuth([user('member')]);
  const firestore = fakeFirestore([['users/member', { status: 'active' }]]);
  firestore.setRetryHook(() => {
    auth.users.set('member', user('member', { disabled: true }));
    firestore.records.set('accountAccess/member', { status: 'suspended', validAfter: 250, operationStatus: 'pending', operationId: 'admin-operation' });
  });
  const report = await run(auth, firestore, { apply: true });
  assert.equal(report.results[0].reason, 'pending_operation');
  assert.deepEqual(auth.lookups, ['member', 'member']);
  assert.equal(firestore.writes.length, 0);
  assert.equal(firestore.records.get('accountAccess/member').operationId, 'admin-operation');
});

test('un conflit qui modifie Auth uniquement est relu avant le commit final du faux retry', async () => {
  const auth = fakeAuth([user('member')]);
  const firestore = fakeFirestore([['users/member', { status: 'active' }]]);
  firestore.setRetryHook(() => auth.users.set('member', user('member', { disabled: true, tokensValidAfterTime: new Date(250_000).toISOString() })));
  await run(auth, firestore, { apply: true });
  assert.deepEqual(auth.lookups, ['member', 'member']);
  assert.equal(firestore.records.get('accountAccess/member').status, 'suspended');
  assert.equal(firestore.records.get('accountAccess/member').validAfter, 250);
});

for (const database of ['personal', 'bridge']) {
  test(`la base ${database} ne consulte ni ne modifie les profils Registre homonymes`, async () => {
    const auth = fakeAuth([user('same-uid')]);
    const firestore = fakeFirestore([['users/same-uid', { status: 'suspended', retained: 'unrelated' }]]);
    await run(auth, firestore, { apply: true, database });
    assert.deepEqual(firestore.commits[0], ['accountAccess/same-uid']);
    assert.equal(firestore.records.get('accountAccess/same-uid').status, 'active');
    assert.deepEqual(firestore.records.get('users/same-uid'), { status: 'suspended', retained: 'unrelated' });
  });
}

test('un client initialisé pour un autre projet est refusé avant toute lecture', async () => {
  const auth = fakeAuth([user('member')]);
  const firestore = fakeFirestore();
  await assert.rejects(run(auth, firestore, { projectId: 'another-explicit-project' }), /ne correspond pas/);
  assert.equal(auth.pages.length, 0);
  assert.equal(firestore.writes.length, 0);
});

const pendingOptions = (firestore, overrides = {}) => ({
  firestore, projectId: 'demo-account-access', database: 'registry', uid: 'member',
  expectedOperationId: 'expected-operation-123', reason: 'Traitement interrompu confirmé par opérateur', operator: 'test-operator',
  now: () => 2_000_000, ...overrides,
});
const oldPending = () => ({ status: 'suspended', validAfter: 800, operationId: 'expected-operation-123', operationStatus: 'pending', updatedAt: new Date(1_000_000).toISOString(), actorUid: 'original-actor' });

test('la résolution pending exige UID, operationId, raison et opérateur explicites', () => {
  const args = ['--project=demo-account-access', '--database=registry', '--resolve-pending'];
  assert.throws(() => parseAccountAccessReconcileArgs(args), /UID explicite/);
  assert.throws(() => parseAccountAccessReconcileArgs([...args, '--uid=member']), /opération attendu/);
  assert.throws(() => parseAccountAccessReconcileArgs([...args, '--uid=member', '--operation-id=expected-operation-123']), /Motif explicite/);
  assert.throws(() => parseAccountAccessReconcileArgs([...args, '--uid=member', '--operation-id=expected-operation-123', '--reason=Crash confirmé']), /opérateur explicite/);
  assert.throws(() => parseAccountAccessReconcileArgs(['--project=demo-account-access', '--database=registry', '--uid=member']), /--resolve-pending/);
  const parsed = parseAccountAccessReconcileArgs([...args, '--uid=member', '--operation-id=expected-operation-123', '--reason=Crash confirmé', '--operator=test-operator']);
  assert.equal(parsed.apply, false);
  assert.equal(parsed.expectedOperationId, 'expected-operation-123');
});

test('la simulation de résolution pending ne modifie ni barrière ni audit', async () => {
  const firestore = fakeFirestore([['accountAccess/member', oldPending()]]);
  const before = structuredClone([...firestore.records]);
  const report = await resolveStaleAccountAccessOperation(pendingOptions(firestore));
  assert.equal(report.counts.would_change, 1);
  assert.equal(firestore.writes.length, 0);
  assert.equal(firestore.transactionCount, 0);
  assert.deepEqual([...firestore.records], before);
});

test('un ancien pending passe uniquement à failed avec fermeture et audit dans le même commit', async () => {
  const firestore = fakeFirestore([['accountAccess/member', oldPending()]]);
  const report = await resolveStaleAccountAccessOperation(pendingOptions(firestore, { apply: true }));
  assert.equal(report.counts.applied, 1);
  const access = firestore.records.get('accountAccess/member');
  assert.equal(access.status, 'suspended');
  assert.equal(access.validAfter, 800);
  assert.equal(access.operationStatus, 'failed');
  assert.equal(access.operationId, 'expected-operation-123');
  assert.equal(access.actorUid, 'original-actor');
  const auditPath = `accountAccessReconciliations/${access.reconciliationId}`;
  assert.deepEqual(firestore.commits[0], ['accountAccess/member', auditPath]);
  const audit = firestore.records.get(auditPath);
  assert.equal(audit.action, 'pending.fail_closed');
  assert.equal(audit.reason, 'Traitement interrompu confirmé par opérateur');
  assert.deepEqual(audit.actor, { kind: 'cli', operator: 'test-operator' });
  assert.equal(audit.status, 'suspended');
});

test('un pending récent, une date invérifiable ou un operationId différent restent intacts', async () => {
  for (const change of [
    { updatedAt: new Date(1_400_000).toISOString() }, // exactement dix minutes : refus
    { updatedAt: new Date(1_900_000).toISOString() },
    { updatedAt: new Date(2_100_000).toISOString() },
    { updatedAt: 'unverifiable' },
    { operationId: 'newer-operation-456' },
    { status: 'active' },
    { operationStatus: 'completed' },
  ]) {
    const value = { ...oldPending(), ...change };
    const firestore = fakeFirestore([['accountAccess/member', value]]);
    const report = await resolveStaleAccountAccessOperation(pendingOptions(firestore, { apply: true }));
    assert.equal(report.counts.manual, 1);
    assert.equal(firestore.writes.length, 0);
    assert.deepEqual(firestore.records.get('accountAccess/member'), value);
  }
});

test('un conflit de résolution relit l’operationId et ne ferme pas la nouvelle opération', async () => {
  const firestore = fakeFirestore([['accountAccess/member', oldPending()]]);
  const newer = { ...oldPending(), operationId: 'newer-operation-456', validAfter: 900 };
  firestore.setRetryHook(() => firestore.records.set('accountAccess/member', newer));
  const report = await resolveStaleAccountAccessOperation(pendingOptions(firestore, { apply: true }));
  assert.equal(report.results[0].reason, 'operation_id_mismatch');
  assert.equal(firestore.writes.length, 0);
  assert.deepEqual(firestore.records.get('accountAccess/member'), newer);
});

test('un conflit qui rafraîchit la date pending interdit aussi la finalisation du plan ancien', async () => {
  const firestore = fakeFirestore([['accountAccess/member', oldPending()]]);
  const refreshed = { ...oldPending(), updatedAt: new Date(1_900_000).toISOString() };
  firestore.setRetryHook(() => firestore.records.set('accountAccess/member', refreshed));
  const report = await resolveStaleAccountAccessOperation(pendingOptions(firestore, { apply: true }));
  assert.equal(report.results[0].reason, 'pending_operation_too_recent');
  assert.equal(firestore.writes.length, 0);
});
