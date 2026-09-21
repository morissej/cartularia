import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createPersonalRecoveryKit, parsePersonalRecoveryKit, signRecoveryChallenge, unwrapRecoveryPassword, wrapRecoveryPassword } from '../src/personalVault/recoveryCrypto.ts';
import { createPersonalRecoveryCommands, createRecoveryProofCommands, verifyRecoverySignature } from '../scripts/lib/personal-recovery-command.mjs';
import { assertActiveAccountSession } from '../scripts/lib/account-access-command.mjs';
import { createRegistryRecoveryCommands } from '../scripts/lib/registry-recovery-command.mjs';
import { encryptPersonalPayload, decryptPersonalPayload } from '../src/personalVault/crypto.ts';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const makeDb = () => {
  let records = new Map();
  let queue = Promise.resolve();
  const snapshot = (path, source = records) => ({ exists: source.has(path), data: () => structuredClone(source.get(path)) });
  return {
    doc: (path) => ({ path, get: async () => snapshot(path), set: async (value) => records.set(path, structuredClone(value)) }),
    record: (path) => records.get(path),
    beforeTransaction: null,
    runTransaction(task) {
      const before = this.beforeTransaction; this.beforeTransaction = null;
      const promise = queue.then(async () => {
        await before?.();
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
  const commands = createPersonalRecoveryCommands({ personalDb: db, personalAuth: auth(personalUser), bridgeDb: makeDb(), bridgeAuth: auth(bridgeUser), now: () => now });
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

const permissionDenied = (error) => ['permission-denied', 'permission_denied'].includes(error.code);
const accessFixture = async (kind = 'personal') => {
  const kit = await kitPromise;
  const db = makeDb(); const bridgeDb = makeDb();
  let clock = 1_800_000_000_000;
  let authenticatedAt = clock / 1000;
  const personalUser = { uid: kit.personalUid, email: `${hash('alias\u0000atlas')}@access.cartularia.invalid`, disabled: false };
  const bridgeUser = { uid: 'independent-bridge-identity', email: `${hash('bridge\u0000atlas')}@codes.cartularia.invalid`, disabled: false };
  const minted = []; const mintedClaims = [];
  const auth = (user) => ({
    // Deliberately model a verified, already issued token; the local barrier must still reject it.
    verifyIdToken: async (_token, revoked) => { assert.equal(revoked, true); return { uid: user.uid, auth_time: authenticatedAt }; },
    getUser: async (uid) => { assert.equal(uid, user.uid); return user; },
    createCustomToken: async (uid, claims) => { assert.equal(uid, user.uid); minted.push(uid); mintedClaims.push({ uid, claims }); return `session-${uid}`; },
  });
  const personalAuth = auth(personalUser); const bridgeAuth = auth(bridgeUser);
  const envelope = { version: 2, algorithm: 'AES-GCM', keyDerivation: 'PBKDF2-SHA-256', iterations: 600_000, salt: 'salt', iv: 'iv', ciphertext: 'initial-ciphertext' };
  await db.doc(`vaultUsers/${personalUser.uid}/vault/profile`).set({ ...envelope, ownerUid: personalUser.uid, accountId: kit.accountId });
  if (kind === 'registry') await db.doc(`users/${personalUser.uid}`).set({ status: 'active' });
  const commands = kind === 'registry'
    ? createRegistryRecoveryCommands({ db, auth: personalAuth, projectId: 'registry-project', now: () => clock })
    : createPersonalRecoveryCommands({ personalDb: db, personalAuth, bridgeDb, bridgeAuth, now: () => clock });
  const requestAuth = () => ({ uid: personalUser.uid, token: { auth_time: authenticatedAt } });
  const tokens = { personalIdToken: 'personal-project-token', bridgeIdToken: 'bridge-project-token' };
  const enrollment = { ...tokens, ownerUid: personalUser.uid, projectId: 'registry-project', credentialId: kit.credentialId,
    signingPublicKeyJwk: kit.signingPublicKeyJwk, wrappingPublicKeyJwk: kit.wrappingPublicKeyJwk,
    wrappedPassword: 'A'.repeat(512), expectedCiphertextHash: hash(envelope.ciphertext), accountId: kit.accountId, userAlias: 'Atlas' };
  const rotation = { ...tokens, credentialId: kit.credentialId, operationId: crypto.randomUUID(), expectedCiphertextHash: hash(envelope.ciphertext), envelope: { ...envelope, ciphertext: 'rotated-ciphertext' }, wrappedPassword: 'B'.repeat(512) };
  const call = (operation) => kind === 'registry'
    ? commands[operation](requestAuth(), operation === 'enroll' ? enrollment : undefined)
    : commands[operation](operation === 'enroll' ? enrollment : operation === 'commitPasswordRotation' ? rotation : tokens);
  await call('enroll');
  const proofInput = kind === 'registry' ? { ownerUid: personalUser.uid, credentialId: kit.credentialId } : { personalUid: personalUser.uid, credentialId: kit.credentialId };
  const signed = async (challenge) => ({ ...proofInput, challengeId: challenge.challengeId, signature: await signRecoveryChallenge(kit, challenge.message) });
  const guard = async (scope, status, cutoff) => (scope === 'bridge' ? bridgeDb : db).doc(`accountAccess/${scope === 'bridge' ? bridgeUser.uid : personalUser.uid}`).set({ status, validAfter: cutoff });
  return { kit, db, bridgeDb, commands, call, proofInput, signed, guard, personalUser, bridgeUser, personalAuth, bridgeAuth, minted, mintedClaims,
    seconds: () => clock / 1000, advance: (seconds) => { clock += seconds * 1000; }, fresh: () => { authenticatedAt = clock / 1000; },
    authenticateAt: (seconds) => { authenticatedAt = seconds; },
    profilePath: `vaultUsers/${personalUser.uid}/vault/profile`,
    recordPath: `${kind === 'registry' ? 'registryRecovery' : 'vaultRecovery'}/${personalUser.uid}` };
};

for (const kind of ['registry', 'personal']) {
  test(`${kind} : une suspension ferme enrôlement, statut, révocation et rotation malgré les tokens déjà émis`, async () => {
    for (const scope of kind === 'registry' ? ['personal'] : ['personal', 'bridge']) {
      const fixture = await accessFixture(kind);
      const before = structuredClone(fixture.db.record(fixture.recordPath));
      await fixture.guard(scope, 'suspended', fixture.seconds());
      for (const operation of kind === 'registry' ? ['enroll', 'status', 'revoke'] : ['enroll', 'status', 'revoke', 'commitPasswordRotation']) {
        await assert.rejects(fixture.call(operation), permissionDenied);
      }
      await assert.rejects(fixture.commands.begin(fixture.proofInput), permissionDenied);
      assert.deepEqual(fixture.db.record(fixture.recordPath), before);
      assert.deepEqual(fixture.minted, []);
    }
  });
  test(`${kind} : réactivation ne réhabilite ni l’ancien token ni le token de la seconde de révocation`, async () => {
    const fixture = await accessFixture(kind);
    const scope = kind === 'registry' ? 'personal' : 'bridge';
    fixture.advance(1);
    const cutoff = fixture.seconds();
    await fixture.guard(scope, 'suspended', cutoff);
    await fixture.guard(scope, 'active', cutoff);
    await assert.rejects(fixture.call('status'), (error) => error.code === 'unauthenticated');
    fixture.authenticateAt(cutoff);
    await assert.rejects(fixture.call('status'), (error) => error.code === 'unauthenticated');
    fixture.advance(1); fixture.fresh();
    assert.equal((await fixture.call('status')).active, true);
    await fixture.call('revoke');
    assert.equal((await fixture.call('status')).active, false);
  });
  test(`${kind} : le secours refuse un défi antérieur à suspension puis accepte un nouveau défi après réactivation`, async () => {
    for (const scope of kind === 'registry' ? ['personal'] : ['personal', 'bridge']) {
      const fixture = await accessFixture(kind);
      const oldChallenge = await fixture.commands.begin(fixture.proofInput);
      const oldProof = await fixture.signed(oldChallenge);
      fixture.advance(1);
      await fixture.guard(scope, 'suspended', fixture.seconds());
      await assert.rejects(fixture.commands.complete(oldProof), permissionDenied);
      await fixture.guard(scope, 'active', fixture.seconds());
      fixture.advance(1);
      await assert.rejects(fixture.commands.complete(oldProof), permissionDenied);
      assert.deepEqual(fixture.minted, []);
      const challenge = await fixture.commands.begin(fixture.proofInput);
      await fixture.commands.complete(await fixture.signed(challenge));
      assert.deepEqual(fixture.minted.sort(), kind === 'registry' ? [fixture.personalUser.uid] : [fixture.personalUser.uid, fixture.bridgeUser.uid].sort());
    }
  });
  test(`${kind} : un custom token de secours émis avant suspension reste refusé même échangé avec une auth_time fraîche`, async () => {
    const fixture = await accessFixture(kind);
    const initialIssuedAt = fixture.seconds();
    const challenge = await fixture.commands.begin(fixture.proofInput);
    await fixture.commands.complete(await fixture.signed(challenge));
    for (const token of fixture.mintedClaims) {
      assert.deepEqual(token.claims, { cartulariaRecoveryIssuedAt: initialIssuedAt });
      const bridge = token.uid === fixture.bridgeUser.uid;
      await fixture.guard(bridge ? 'bridge' : 'personal', 'suspended', initialIssuedAt);
      await fixture.guard(bridge ? 'bridge' : 'personal', 'active', initialIssuedAt);
      fixture.advance(1);
      const requestAuth = { uid: token.uid, token: { auth_time: fixture.seconds(), firebase: { sign_in_provider: 'custom' }, ...token.claims } };
      await assert.rejects(assertActiveAccountSession({
        auth: bridge ? fixture.bridgeAuth : fixture.personalAuth, firestore: bridge ? fixture.bridgeDb : fixture.db,
        requestAuth, allowMissingProfile: kind !== 'registry', nowSeconds: fixture.seconds(),
      }), (error) => error.code === 'unauthenticated');
    }
  });
  test(`${kind} : une suspension arrivée entre le contrôle initial et la transaction empêche sa mutation`, async () => {
    const fixture = await accessFixture(kind);
    const before = structuredClone(fixture.db.record(fixture.recordPath));
    fixture.db.beforeTransaction = () => fixture.guard('personal', 'suspended', fixture.seconds());
    await assert.rejects(fixture.call('revoke'), permissionDenied);
    assert.deepEqual(fixture.db.record(fixture.recordPath), before);
  });
  test(`${kind} : le cutoff natif Auth refuse un token révoqué même sans nouveau document de barrière`, async () => {
    const fixture = await accessFixture(kind);
    fixture.advance(1);
    fixture.personalUser.tokensValidAfterTime = new Date(fixture.seconds() * 1000).toISOString();
    await assert.rejects(fixture.call('status'), (error) => error.code === 'unauthenticated');
    fixture.fresh(); // Native Firebase cutoff remains inclusive for a fresh Auth sign-in.
    assert.equal((await fixture.call('status')).active, true);
  });
}
