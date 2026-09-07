import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { cert, initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectAuthEmulator, initializeAuth, inMemoryPersistence, signInWithCustomToken, signInWithEmailAndPassword, signOut, updatePassword } from 'firebase/auth';
import { activateRegistryAccount } from '../scripts/lib/account-command.mjs';
import { createRegistryRecoveryCommands } from '../scripts/lib/registry-recovery-command.mjs';
import { createPersonalRecoveryCommands } from '../scripts/lib/personal-recovery-command.mjs';
import { createPersonalRecoveryKit, signRecoveryChallenge, wrapRecoveryPassword, unwrapRecoveryPassword } from '../src/personalVault/recoveryCrypto.ts';
import { encryptPersonalPayload, decryptPersonalPayload, vaultAccountDocumentId, vaultAuthenticationEmail } from '../src/personalVault/crypto.ts';

// Auth Emulator ignores API keys when selecting the project of public SDK calls.
// All local Auth actors therefore use its dedicated startup project. This test
// proves real token/session/state behavior, not production cross-project signing.
const projectId = process.env.CARTULARIA_AUDIT_AUTH_PROJECT_ID || 'cartularia-audit-local';
const dataProjectId = process.env.GCLOUD_PROJECT || 'cartularia-audit-recovery-test';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
if (projectId !== 'cartularia-audit-local' || dataProjectId !== 'cartularia-audit-recovery-test'
  || authHost !== '127.0.0.1:39499' || firestoreHost !== '127.0.0.1:38480') {
  throw new Error('Test réservé au projet audit et aux émulateurs locaux 39499/38480.');
}
const hash = (value) => createHash('sha256').update(value).digest('hex');
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const adminApps = [];
const clientApps = [];
const createdUsers = [];
const cleanupDocuments = [];
let registryDb, personalDb, adminAuth;
const ownedDoc = (db, path) => { const ref = db.doc(path); cleanupDocuments.push({ db, ref }); return ref; };
const client = (label) => {
  const app = initializeApp({ projectId, apiKey: 'audit-emulator-public-api-key', appId: `audit-${runId}-${label}` }, `audit-${runId}-${label}`);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  clientApps.push(app);
  return auth;
};
const createUser = async (label, email, password) => {
  const user = await adminAuth.createUser({ uid: `audit-${runId}-${label}`, email, password });
  createdUsers.push(user.uid);
  return user;
};
const actualSession = async (auth, email, password) => {
  const session = await signInWithEmailAndPassword(auth, email, password);
  const token = await session.user.getIdToken(true);
  const decoded = await adminAuth.verifyIdToken(token, true);
  assert.equal(decoded.aud, projectId, 'Le projet de démarrage Auth Emulator doit correspondre au projet du test.');
  return { user: session.user, requestAuth: { uid: decoded.uid, token: decoded }, token };
};
before(() => {
  // A fresh local test key avoids any ADC/metadata discovery. It has no cloud
  // authority; the guarded emulator transports do not require a real signer.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const credential = cert({ projectId, clientEmail: `test-only@${projectId}.iam.gserviceaccount.com`, privateKey });
  const authentication = initializeAdmin({ projectId, credential }, `audit-admin-${runId}-auth`);
  const registry = initializeAdmin({ projectId: dataProjectId, credential }, `audit-admin-${runId}-registry`);
  const personal = initializeAdmin({ projectId: `${dataProjectId}-personal`, credential }, `audit-admin-${runId}-personal`);
  adminApps.push(authentication, registry, personal);
  registryDb = getFirestore(registry); personalDb = getFirestore(personal); adminAuth = getAdminAuth(authentication);
});
after(async () => {
  // Only exact, generated test-owned documents/users are removed. No namespace flush.
  for (const { db, ref } of cleanupDocuments.reverse()) await db.recursiveDelete(ref);
  for (const uid of createdUsers) await adminAuth.deleteUser(uid);
  await Promise.all(clientApps.map((app) => deleteApp(app)));
  await Promise.all([registryDb?.terminate(), personalDb?.terminate()]);
  await Promise.all(adminApps.map((app) => deleteAdmin(app)));
});

test('V02 — activation concurrente réelle, réponse perdue, compte suspendu et droits retirés', async () => {
  const email = `audit-${runId}-registry@registry.cartularia.invalid`;
  const identity = await createUser('registry-activation', email, 'fictitious-registry-password');
  const input = { firestore: registryDb, uid: identity.uid, email, userName: `Audit ${runId}` };
  // The identity exists, but no Firestore activation has yet occurred.
  ownedDoc(registryDb, `users/${identity.uid}`);
  assert.equal((await registryDb.doc(`users/${identity.uid}`).get()).exists, false);
  const results = await Promise.all(Array.from({ length: 6 }, () => activateRegistryAccount(input)));
  assert.ok(results.every((result) => result.registryId === results[0].registryId && result.organizationId === results[0].organizationId));
  const { registryId, organizationId } = results[0];
  ownedDoc(registryDb, `organizations/${organizationId}`);
  ownedDoc(registryDb, `registries/${registryId}`);
  const refs = [registryDb.doc(`users/${identity.uid}`), registryDb.doc(`organizations/${organizationId}`), registryDb.doc(`organizations/${organizationId}/memberships/${identity.uid}`), registryDb.doc(`registries/${registryId}`)];
  const documents = await registryDb.getAll(...refs);
  assert.equal(documents.filter((doc) => doc.exists && doc.data().status === 'active').length, 4);
  await refs[3].update({ itemCount: 7 });
  assert.deepEqual(await activateRegistryAccount(input), results[0]);
  assert.equal((await refs[3].get()).data().itemCount, 7);
  await refs[0].update({ status: 'suspended' });
  await assert.rejects(activateRegistryAccount(input), (error) => error.code === 'permission_denied');
  await refs[0].update({ status: 'active' });
  await refs[2].delete();
  await assert.rejects(activateRegistryAccount(input), (error) => error.code === 'failed_precondition');
  assert.equal((await refs[2].get()).exists, false);
});

test('V03 Registre — vrai jeton custom, nouvelle session SDK et changement de mot de passe', async () => {
  const email = `audit-${runId}-recovery@registry.cartularia.invalid`;
  const originalPassword = 'fictitious-registry-original';
  const identity = await createUser('registry-recovery', email, originalPassword);
  ownedDoc(registryDb, `users/${identity.uid}`);
  await registryDb.doc(`users/${identity.uid}`).set({ uid: identity.uid, status: 'active' });
  ownedDoc(registryDb, `registryRecovery/${identity.uid}`);
  const owner = client('registry-owner');
  const session = await actualSession(owner, email, originalPassword);
  const commands = createRegistryRecoveryCommands({ db: registryDb, auth: adminAuth, projectId });
  const kit = await createPersonalRecoveryKit({ personalUid: identity.uid, personalProjectId: projectId, userAlias: `Audit ${runId}` });
  await commands.enroll(session.requestAuth, { ownerUid: identity.uid, projectId, credentialId: kit.credentialId, signingPublicKeyJwk: kit.signingPublicKeyJwk });
  await signOut(owner);
  const input = { ownerUid: identity.uid, credentialId: kit.credentialId };
  const challenge = await commands.begin(input);
  const proof = { ...input, challengeId: challenge.challengeId, signature: await signRecoveryChallenge(kit, challenge.message) };
  const attempts = await Promise.allSettled([commands.complete(proof), commands.complete(proof)]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.find((result) => result.status === 'rejected').reason.code, 'permission-denied');
  const recovered = attempts.find((result) => result.status === 'fulfilled').value;
  const independent = client('registry-independent');
  assert.equal(independent.currentUser, null);
  const signedIn = await signInWithCustomToken(independent, recovered.registryToken);
  assert.equal(signedIn.user.uid, identity.uid);
  assert.equal((await adminAuth.verifyIdToken(await signedIn.user.getIdToken(true), true)).aud, projectId);
  await assert.rejects(commands.complete(proof), (error) => error.code === 'permission-denied');
  const changedPassword = 'fictitious-registry-changed';
  await updatePassword(signedIn.user, changedPassword);
  await signOut(independent);
  await assert.rejects(signInWithEmailAndPassword(independent, email, originalPassword));
  await actualSession(independent, email, changedPassword);
  const issuedBeforeSuspension = await commands.begin(input);
  const suspendedProof = { ...input, challengeId: issuedBeforeSuspension.challengeId, signature: await signRecoveryChallenge(kit, issuedBeforeSuspension.message) };
  await adminAuth.updateUser(identity.uid, { disabled: true });
  await assert.rejects(commands.begin(input), (error) => error.code === 'permission-denied');
  await assert.rejects(commands.complete(suspendedProof), (error) => error.code === 'permission-denied');
  await adminAuth.updateUser(identity.uid, { disabled: false });
  await registryDb.doc(`users/${identity.uid}`).update({ status: 'suspended' });
  await assert.rejects(commands.begin(input), (error) => error.code === 'permission-denied');
  await registryDb.doc(`users/${identity.uid}`).update({ status: 'active' });
  const refreshed = await actualSession(independent, email, changedPassword);
  await commands.revoke(refreshed.requestAuth);
  await assert.rejects(commands.begin(input), (error) => error.code === 'permission-denied');
});

test('V03 Coffre — identité liée vérifiée, récupération et reprise après interruption de rotation', async () => {
  const alias = `Atlas ${runId}`;
  const originalPassword = 'fictitious-vault-original';
  const personalEmail = await vaultAuthenticationEmail(alias);
  const bridgeEmail = `${hash(`bridge\u0000${alias.toLocaleLowerCase('fr')}`)}@codes.cartularia.invalid`;
  const identity = await createUser('personal', personalEmail, originalPassword);
  const bridgeIdentity = await createUser('bridge', bridgeEmail, originalPassword);
  const personalClient = client('personal-owner');
  const bridgeClient = client('bridge-owner');
  const personalSession = await actualSession(personalClient, personalEmail, originalPassword);
  const bridgeSession = await actualSession(bridgeClient, bridgeEmail, originalPassword);
  const payload = { userName: alias, owners: [{ name: 'Identité entièrement fictive de recette' }], storage: ['Adresse fictive de recette'] };
  const envelope = await encryptPersonalPayload({ payload, password: originalPassword, userAlias: alias });
  ownedDoc(personalDb, `vaultUsers/${identity.uid}`);
  const profile = personalDb.doc(`vaultUsers/${identity.uid}/vault/profile`);
  await profile.set({ ...envelope, ownerUid: identity.uid, accountId: await vaultAccountDocumentId(alias), schemaVersion: 'encrypted-personal-account@2.0.0' });
  ownedDoc(personalDb, `vaultRecovery/${identity.uid}`);
  const commands = createPersonalRecoveryCommands({ personalDb, personalAuth: adminAuth, bridgeAuth: adminAuth });
  const kit = await createPersonalRecoveryKit({ personalUid: identity.uid, personalProjectId: projectId, userAlias: alias });
  const enrollment = {
    personalIdToken: personalSession.token, bridgeIdToken: bridgeSession.token,
    userAlias: alias, accountId: kit.accountId, credentialId: kit.credentialId,
    signingPublicKeyJwk: kit.signingPublicKeyJwk, wrappingPublicKeyJwk: kit.wrappingPublicKeyJwk,
    wrappedPassword: await wrapRecoveryPassword(originalPassword, kit.wrappingPublicKeyJwk, kit.credentialId), expectedCiphertextHash: hash(envelope.ciphertext),
  };
  await assert.rejects(commands.enroll({ ...enrollment, bridgeIdToken: personalSession.token }), (error) => error.code === 'permission-denied');
  await commands.enroll(enrollment);
  assert.equal((await registryDb.doc(`vaultRecovery/${identity.uid}`).get()).exists, false);
  const stored = JSON.stringify((await personalDb.doc(`vaultRecovery/${identity.uid}`).get()).data());
  for (const value of [alias, originalPassword, kit.signingPrivateKey, kit.wrappingPrivateKey, 'Identité entièrement fictive']) assert.equal(stored.includes(value), false);
  await signOut(personalClient); await signOut(bridgeClient);
  const freshPersonal = client('personal-independent');
  const freshBridge = client('bridge-independent');
  const recover = async () => {
    const input = { personalUid: identity.uid, credentialId: kit.credentialId };
    const challenge = await commands.begin(input);
    const result = await commands.complete({ ...input, challengeId: challenge.challengeId, signature: await signRecoveryChallenge(kit, challenge.message) });
    const personal = await signInWithCustomToken(freshPersonal, result.personalToken);
    const bridge = await signInWithCustomToken(freshBridge, result.bridgeToken);
    assert.equal(personal.user.uid, identity.uid); assert.equal(bridge.user.uid, bridgeIdentity.uid);
    const password = await unwrapRecoveryPassword(result.wrappedPassword, kit);
    assert.deepEqual(await decryptPersonalPayload({ envelope: (await profile.get()).data(), password, userAlias: alias }), payload);
    return { personalUser: personal.user, bridgeUser: bridge.user, password };
  };
  const first = await recover();
  // Genuine partial operation: personal Auth changes; bridge Auth and ciphertext do not.
  const changedPassword = 'fictitious-vault-changed';
  await updatePassword(first.personalUser, changedPassword);
  await signOut(freshPersonal); await signOut(freshBridge);
  const resumed = await recover();
  assert.equal(resumed.password, originalPassword);
  await updatePassword(resumed.personalUser, changedPassword);
  await updatePassword(resumed.bridgeUser, changedPassword);
  const newEnvelope = await encryptPersonalPayload({ payload, password: changedPassword, userAlias: alias });
  const rotation = {
    personalIdToken: await resumed.personalUser.getIdToken(true), bridgeIdToken: await resumed.bridgeUser.getIdToken(true),
    credentialId: kit.credentialId, operationId: randomUUID(), expectedCiphertextHash: hash(envelope.ciphertext), envelope: newEnvelope,
    wrappedPassword: await wrapRecoveryPassword(changedPassword, kit.wrappingPublicKeyJwk, kit.credentialId),
  };
  await assert.rejects(commands.commitPasswordRotation({ ...rotation, expectedCiphertextHash: hash('stale-ciphertext') }), (error) => error.code === 'aborted');
  assert.equal((await profile.get()).data().ciphertext, envelope.ciphertext);
  assert.equal((await personalDb.doc(`vaultRecovery/${identity.uid}`).get()).data().wrappedPassword, enrollment.wrappedPassword);
  await commands.commitPasswordRotation(rotation);
  await commands.commitPasswordRotation(rotation); // a lost success response is safe to retry.
  await signOut(freshPersonal); await signOut(freshBridge);
  const final = await recover();
  assert.equal(final.password, changedPassword);
  await adminAuth.updateUser(bridgeIdentity.uid, { disabled: true });
  await assert.rejects(commands.begin({ personalUid: identity.uid, credentialId: kit.credentialId }), (error) => error.code === 'permission-denied');
});
