import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cert, initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signInWithCustomToken } from 'firebase/auth';
import { requireAdministrator, setAdministrationUserDisabled } from '../scripts/lib/administration-command.mjs';
import { assertActiveAccountSession } from '../scripts/lib/account-access-command.mjs';
import { assertActiveQueuedAccount } from '../scripts/lib/queued-account-access.mjs';
import { admitCommunityMember } from '../scripts/lib/community-command.mjs';

const projectId = 'demo-cartularia-p2';
if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:39621'
  || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:38620') throw new Error('Test P2 réservé aux émulateurs locaux dédiés 39621/38620.');
const runId = randomUUID().slice(0, 8);
const ownerUid = `p2-owner-${runId}`, adminUid = `p2-admin-${runId}`;
const password = 'Fictitious-P2-password!';
const clients = [];
let app, auth, firestore, environment;
const client = (name) => {
  const app = initializeApp({ projectId, apiKey: 'local-fictitious-api-key', appId: `p2-${name}` }, `p2-${runId}-${name}`);
  clients.push(app);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, 'http://127.0.0.1:39621', { disableWarnings: true });
  return auth;
};
const session = async (clientAuth, uid) => {
  const { user } = await signInWithEmailAndPassword(clientAuth, `${uid}@example.test`, password);
  const raw = await user.getIdToken(true);
  return { raw, requestAuth: { uid, token: await auth.verifyIdToken(raw) } };
};
const base = `http://127.0.0.1:38620/v1/projects/${projectId}/databases/(default)/documents`;
const readDossier = (token) => fetch(`${base}/cartularies/cart-${runId}`, { headers: { Authorization: `Bearer ${token}` } });
const heartbeat = (token, uid) => fetch(`${base}:commit`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ writes: [{ transform: {
    document: `projects/${projectId}/databases/(default)/documents/users/${uid}`,
    fieldTransforms: ['lastActiveAt', 'updatedAt'].map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
  } }] }),
});
const mutate = (uid, disabled) => setAdministrationUserDisabled({
  actorUid: 'p2-independent-operator', source: { id: 'registry', auth, firestore }, targetUid: uid,
  disabled, reason: 'Recette P2 exclusivement fictive', auditFirestore: firestore, timestamp: FieldValue.serverTimestamp(),
});
const afterCutoff = async (uid) => {
  const { validAfter } = (await firestore.doc(`accountAccess/${uid}`).get()).data();
  while (Math.floor(Date.now() / 1000) <= validAfter) await new Promise((resolve) => setTimeout(resolve, 100));
};

before(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 38620, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  app = initializeAdmin({ projectId, credential: cert({ projectId, clientEmail: `p2-local@${projectId}.iam.gserviceaccount.com`, privateKey }) }, `p2-admin-${runId}`);
  auth = getAuth(app); firestore = getFirestore(app);
  for (const uid of [ownerUid, adminUid]) {
    await auth.createUser({ uid, email: `${uid}@example.test`, password });
    await firestore.doc(`users/${uid}`).set({ uid, status: 'active' });
  }
  await auth.setCustomUserClaims(adminUid, { cartulariaAdmin: true });
  await firestore.doc(`organizations/org-${runId}/memberships/${ownerUid}`).set({
    uid: ownerUid, status: 'active', organizationId: `org-${runId}`, roles: ['legal_owner'],
    permissions: ['registry.read', 'cartulary.read', 'cartulary.edit'], scopes: { registryIds: [`reg-${runId}`] },
  });
  await firestore.doc(`cartularies/cart-${runId}`).set({ organizationId: `org-${runId}`, registryId: `reg-${runId}`, accountHolderId: ownerUid });
});
after(async () => {
  await Promise.all(clients.map(deleteApp));
  await environment?.cleanup();
  if (auth) await Promise.all([ownerUid, adminUid].map((uid) => auth.deleteUser(uid)));
  if (app) await deleteAdmin(app);
});

test('vrais jetons : suspension, réactivation, lectures et écritures de la session existante', async () => {
  const owner = client('owner');
  const old = await session(owner, ownerUid);
  assert.equal((await readDossier(old.raw)).status, 200);
  assert.equal((await heartbeat(old.raw, ownerUid)).status, 200);
  const oldQueued = { ownerUid, requestedAt: new Date(Date.now() - 10_000) };
  await mutate(ownerUid, true);
  assert.equal((await readDossier(old.raw)).status, 403);
  assert.equal((await heartbeat(old.raw, ownerUid)).status, 403);
  await assert.rejects(assertActiveAccountSession({ auth, firestore, requestAuth: old.requestAuth }));
  await assert.rejects(assertActiveQueuedAccount({ auth, firestore, requestDocument: oldQueued }));
  assert.equal((await firestore.doc(`organizations/org-${runId}/memberships/${ownerUid}`).get()).data().status, 'active', 'Les droits métier ne sont pas détruits par la suspension.');
  await mutate(ownerUid, false);
  assert.equal((await readDossier(old.raw)).status, 403, 'Réactiver ne ressuscite pas le jeton ancien.');
  assert.equal((await heartbeat(old.raw, ownerUid)).status, 403);
  await assert.rejects(assertActiveQueuedAccount({ auth, firestore, requestDocument: oldQueued }));
  const { validAfter } = (await firestore.doc(`accountAccess/${ownerUid}`).get()).data();
  await assert.rejects(assertActiveQueuedAccount({ auth, firestore, requestDocument: { ownerUid, requestedAt: new Date(validAfter * 1000 + 500) } }), 'La totalité de la seconde de révocation est fermée.');
  await afterCutoff(ownerUid);
  const fresh = await session(owner, ownerUid);
  assert.equal((await readDossier(fresh.raw)).status, 200);
  assert.equal((await heartbeat(fresh.raw, ownerUid)).status, 200);
  await assertActiveAccountSession({ auth, firestore, requestAuth: fresh.requestAuth });
  await assertActiveQueuedAccount({ auth, firestore, requestDocument: { ownerUid, requestedAt: new Date() } });
});

test('vrai ancien jeton administrateur : claim retiré, suspension et réactivation', async () => {
  const administrator = client('administrator');
  const old = await session(administrator, adminUid);
  assert.equal(await requireAdministrator({ auth, firestore, requestAuth: old.requestAuth }), adminUid);
  await auth.setCustomUserClaims(adminUid, {});
  assert.equal(old.requestAuth.token.cartulariaAdmin, true);
  await assert.rejects(requireAdministrator({ auth, firestore, requestAuth: old.requestAuth }));
  await auth.setCustomUserClaims(adminUid, { cartulariaAdmin: true });
  await mutate(adminUid, true);
  await assert.rejects(requireAdministrator({ auth, firestore, requestAuth: old.requestAuth }));
  await mutate(adminUid, false);
  await assert.rejects(requireAdministrator({ auth, firestore, requestAuth: old.requestAuth }));
  await afterCutoff(adminUid);
  const fresh = await session(administrator, adminUid);
  assert.equal(await requireAdministrator({ auth, firestore, requestAuth: fresh.requestAuth }), adminUid);
});

test('vrai échange custom : le jeton de secours antérieur ne survit pas à la suspension', async () => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const oldCustom = await auth.createCustomToken(ownerUid, { cartulariaRecoveryIssuedAt: issuedAt });
  const oldWithoutClaim = await auth.createCustomToken(ownerUid);
  await mutate(ownerUid, true); await mutate(ownerUid, false); await afterCutoff(ownerUid);
  const recovered = client('recovered');
  for (const customToken of [oldCustom, oldWithoutClaim]) {
    const { user } = await signInWithCustomToken(recovered, customToken);
    const raw = await user.getIdToken(true);
    const token = await auth.verifyIdToken(raw);
    assert.equal(token.firebase.sign_in_provider, 'custom');
    if (customToken === oldCustom) assert.equal(token.cartulariaRecoveryIssuedAt, issuedAt);
    assert.equal((await readDossier(raw)).status, 403);
    await assert.rejects(assertActiveAccountSession({ auth, firestore, requestAuth: { uid: ownerUid, token } }));
  }
  const freshCustom = await auth.createCustomToken(ownerUid, { cartulariaRecoveryIssuedAt: Math.floor(Date.now() / 1000) });
  const { user } = await signInWithCustomToken(recovered, freshCustom);
  const raw = await user.getIdToken(true);
  assert.equal((await readDossier(raw)).status, 200);
  await assertActiveAccountSession({ auth, firestore, requestAuth: { uid: ownerUid, token: await auth.verifyIdToken(raw) } });
});

test('une admission communautaire refuse une cible suspendue et conserve le seuil après réactivation', async () => {
  const targetUid = `p2-community-${runId}`;
  await firestore.doc(`communityMemberships/${adminUid}`).set({ uid: adminUid, status: 'active', permissions: ['community.moderate'] });
  await firestore.doc(`users/${targetUid}`).set({ status: 'suspended' });
  await firestore.doc(`accountAccess/${targetUid}`).set({ status: 'suspended', validAfter: 100 });
  const input = { firestore, actorId: adminUid, targetUid, pseudonym: 'Fiction P2', requestId: `p2-admission-${runId}` };
  await assert.rejects(admitCommunityMember(input));
  await firestore.doc(`users/${targetUid}`).update({ status: 'active' });
  await firestore.doc(`accountAccess/${targetUid}`).update({ status: 'active' });
  await admitCommunityMember(input);
  assert.deepEqual((await firestore.doc(`communityMemberships/${targetUid}`).get()).data().accountAccess, { status: 'active', validAfter: 100 });
});
