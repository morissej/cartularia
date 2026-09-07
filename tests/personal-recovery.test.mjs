import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createPersonalRecoveryKit, parsePersonalRecoveryKit, signRecoveryChallenge, unwrapRecoveryPassword, wrapRecoveryPassword } from '../src/personalVault/recoveryCrypto.ts';
import { createPersonalRecoveryCommands, createRecoveryProofCommands, verifyRecoverySignature } from '../scripts/lib/personal-recovery-command.mjs';
import { encryptPersonalPayload, decryptPersonalPayload } from '../src/personalVault/crypto.ts';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const makeDb = () => {
  let records = new Map();
  let queue = Promise.resolve();
  const snapshot = (path, source = records) => ({ exists: source.has(path), data: () => structuredClone(source.get(path)) });
  return {
    doc: (path) => ({ path, get: async () => snapshot(path), set: async (value) => records.set(path, structuredClone(value)) }),
    record: (path) => records.get(path),
    runTransaction(task) {
      const promise = queue.then(async () => {
        const draft = structuredClone(records);
        const result = await task({
          get: async ({ path }) => snapshot(path, draft),
          set: ({ path }, value) => draft.set(path, structuredClone(value)),
          update: ({ path }, value) => draft.set(path, { ...draft.get(path), ...structuredClone(value) }),
        });
        records = draft;
        return result;
      });
      queue = promise.catch(() => undefined);
      return promise;
    },
  };
};
const kitPromise = createPersonalRecoveryKit({ personalUid: 'personal-owner', personalProjectId: 'personal-project', userAlias: 'Atlas' });

test('le kit vérifie ses paires de clés, signe et déchiffre une enveloppe sans envoyer de clé privée', async () => {
  const kit = await kitPromise;
  assert.equal((await parsePersonalRecoveryKit(JSON.stringify(kit), 'personal-project')).credentialId, kit.credentialId);
  const longPassword = 'Très-long-mot-de-passe-🔑'.repeat(24);
  const wrapped = await wrapRecoveryPassword(longPassword, kit.wrappingPublicKeyJwk, kit.credentialId);
  assert.equal(wrapped.includes(longPassword), false);
  assert.equal(await unwrapRecoveryPassword(wrapped, kit), longPassword);
  await assert.rejects(unwrapRecoveryPassword(wrapped, { ...kit, credentialId: crypto.randomUUID() }));
  await assert.rejects(parsePersonalRecoveryKit(JSON.stringify(kit), 'another-project'));
  const signature = await signRecoveryChallenge(kit, 'proof');
  assert.equal(verifyRecoverySignature({ signingPublicKeyJwk: kit.signingPublicKeyJwk, message: 'proof', signature }), true);
  assert.equal(verifyRecoverySignature({ signingPublicKeyJwk: kit.signingPublicKeyJwk, message: 'changed', signature }), false);
});

const proofFixture = async (options = {}) => {
  const kit = await kitPromise;
  const db = makeDb();
  let now = 1_800_000_000_000;
  let enabled = true;
  await db.doc('testRecovery/personal-owner').set({ credentialId: kit.credentialId, signingPublicKeyJwk: kit.signingPublicKeyJwk });
  const commands = createRecoveryProofCommands({ db, recordCollection: 'testRecovery', namespace: 'personal-vault', now: () => now,
    assertEnabled: async () => { if (!enabled) throw Object.assign(new Error('disabled'), { code: 'permission-denied' }); },
    issueSession: async () => ({ token: 'test-session' }), ...options });
  const input = { ownerUid: 'personal-owner', credentialId: kit.credentialId };
  return { db, kit, commands, input, advance: (ms) => { now += ms; }, disable: () => { enabled = false; } };
};
test('preuve valide à usage unique, même en concurrence', async () => {
  const { kit, commands, input } = await proofFixture();
  const challenge = await commands.begin(input);
  const request = { ...input, challengeId: challenge.challengeId, signature: await signRecoveryChallenge(kit, challenge.message) };
  const results = await Promise.allSettled([commands.complete(request), commands.complete(request)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
});
test('expiration, suspension, remplacement de kit et nombre d’essais sont réellement refusés', async () => {
  for (const mode of ['expired', 'disabled', 'rotated', 'attempts']) {
    const fixture = await proofFixture();
    const { kit, commands, input, db } = fixture;
    const challenge = await commands.begin(input);
    if (mode === 'expired') fixture.advance(301_000);
    if (mode === 'disabled') fixture.disable();
    if (mode === 'rotated') await db.doc('testRecovery/personal-owner').set({ credentialId: crypto.randomUUID(), signingPublicKeyJwk: kit.signingPublicKeyJwk });
    if (mode === 'attempts') for (let index = 0; index < 3; index++) await assert.rejects(commands.complete({ ...input, challengeId: challenge.challengeId, signature: 'invalid' }));
    await assert.rejects(commands.complete({ ...input, challengeId: challenge.challengeId, signature: await signRecoveryChallenge(kit, challenge.message) }));
  }
});
test('le quota de demandes se réinitialise seulement après sa fenêtre', async () => {
  const { commands, input, advance } = await proofFixture({ maxChallenges: 2 });
  await commands.begin(input); await commands.begin(input);
  await assert.rejects(commands.begin(input), (error) => error.code === 'resource-exhausted');
  advance(601_000); await commands.begin(input);
});

test('enrôlement vérifié, séparation des secrets, déchiffrement puis rotation atomique reprenable', async () => {
  const kit = await kitPromise;
  const db = makeDb();
  const now = 1_800_000_000_000;
  const personalUser = { uid: kit.personalUid, email: `${hash('alias\u0000atlas')}@access.cartularia.invalid` };
  const bridgeUser = { uid: 'bridge-owner', email: `${hash('bridge\u0000atlas')}@codes.cartularia.invalid` };
  const auth = (user) => ({ verifyIdToken: async () => ({ uid: user.uid, auth_time: now / 1000 }), getUser: async () => user, createCustomToken: async () => `token-${user.uid}` });
  const commands = createPersonalRecoveryCommands({ personalDb: db, personalAuth: auth(personalUser), bridgeAuth: auth(bridgeUser), now: () => now });
  const payload = { owners: [{ name: 'Donnée privée de test' }] };
  const password = 'old-password-for-test';
  const envelope = await encryptPersonalPayload({ payload, password, userAlias: 'Atlas' });
  const profilePath = `vaultUsers/${kit.personalUid}/vault/profile`;
  await db.doc(profilePath).set({ ...envelope, ownerUid: kit.personalUid, accountId: kit.accountId });
  const tokens = { personalIdToken: 'private-token', bridgeIdToken: 'bridge-token' };
  const enroll = { ...tokens, credentialId: kit.credentialId, signingPublicKeyJwk: kit.signingPublicKeyJwk, wrappingPublicKeyJwk: kit.wrappingPublicKeyJwk,
    wrappedPassword: await wrapRecoveryPassword(password, kit.wrappingPublicKeyJwk, kit.credentialId), accountId: kit.accountId, userAlias: 'Atlas', expectedCiphertextHash: hash(envelope.ciphertext) };
  await assert.rejects(commands.enroll({ ...enroll, userAlias: 'SomeoneElse' }));
  await commands.enroll(enroll);
  const stored = JSON.stringify(db.record(`vaultRecovery/${kit.personalUid}`));
  for (const secret of [password, 'Atlas', kit.signingPrivateKey, kit.wrappingPrivateKey, 'private-token', 'Donnée privée de test']) assert.equal(stored.includes(secret), false);
  const challenge = await commands.begin({ personalUid: kit.personalUid, credentialId: kit.credentialId });
  const session = await commands.complete({ personalUid: kit.personalUid, credentialId: kit.credentialId, challengeId: challenge.challengeId, signature: await signRecoveryChallenge(kit, challenge.message) });
  assert.deepEqual(await decryptPersonalPayload({ envelope, userAlias: 'Atlas', password: await unwrapRecoveryPassword(session.wrappedPassword, kit) }), payload);
  const newPassword = 'new-password-for-test';
  const newEnvelope = await encryptPersonalPayload({ payload, password: newPassword, userAlias: 'Atlas' });
  const rotation = { ...tokens, credentialId: kit.credentialId, operationId: crypto.randomUUID(), expectedCiphertextHash: hash(envelope.ciphertext), envelope: newEnvelope,
    wrappedPassword: await wrapRecoveryPassword(newPassword, kit.wrappingPublicKeyJwk, kit.credentialId) };
  await commands.commitPasswordRotation(rotation);
  await commands.commitPasswordRotation(rotation);
  const secret = await unwrapRecoveryPassword(db.record(`vaultRecovery/${kit.personalUid}`).wrappedPassword, kit);
  assert.equal(secret, newPassword);
  assert.deepEqual(await decryptPersonalPayload({ envelope: db.record(profilePath), userAlias: 'Atlas', password: secret }), payload);
  await assert.rejects(commands.commitPasswordRotation({ ...rotation, operationId: crypto.randomUUID() }), (error) => error.code === 'aborted');
  await commands.revoke(tokens);
  await assert.rejects(commands.begin({ personalUid: kit.personalUid, credentialId: kit.credentialId }));
});
