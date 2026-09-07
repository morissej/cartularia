import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';

export class RecoveryCommandError extends Error {
  constructor(code, message = 'La récupération n’a pas pu être autorisée.') {
    super(message);
    this.name = 'RecoveryCommandError';
    this.code = code;
  }
}
const fail = (code, message) => { throw new RecoveryCommandError(code, message); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validCredential = (value) => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const normalizeAlias = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 64).toLocaleLowerCase('fr') : '';

export const validateRecoveryInput = (input, maximumBytes = 8192) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-argument');
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(input), 'utf8'); } catch { fail('invalid-argument'); }
  if (bytes > maximumBytes) fail('invalid-argument', 'Demande de secours trop volumineuse.');
};

export const validateRecoverySigningKey = (jwk) => {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256'
    || Object.keys(jwk).some((key) => !['kty', 'crv', 'x', 'y', 'ext', 'key_ops'].includes(key))
    || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x || '') || !/^[A-Za-z0-9_-]{43}$/.test(jwk.y || '')) fail('invalid-argument');
  try { createPublicKey({ key: jwk, format: 'jwk' }); } catch { fail('invalid-argument'); }
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
};

const validateWrappingKey = (jwk) => {
  if (!jwk || jwk.kty !== 'RSA' || jwk.e !== 'AQAB'
    || Object.keys(jwk).some((key) => !['kty', 'n', 'e', 'alg', 'ext', 'key_ops'].includes(key))
    || !/^[A-Za-z0-9_-]{512,683}$/.test(jwk.n || '')) fail('invalid-argument');
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    if (key.asymmetricKeyDetails.modulusLength < 3072 || key.asymmetricKeyDetails.modulusLength > 4096) fail('invalid-argument');
  } catch { fail('invalid-argument'); }
  return { kty: jwk.kty, n: jwk.n, e: jwk.e };
};

export const verifyRecoverySignature = ({ signingPublicKeyJwk, message, signature }) => {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  try {
    return verify('sha256', Buffer.from(message, 'utf8'), {
      key: createPublicKey({ key: validateRecoverySigningKey(signingPublicKeyJwk), format: 'jwk' }),
      dsaEncoding: 'ieee-p1363',
    }, Buffer.from(signature, 'base64'));
  } catch { return false; }
};

/** Generic proof-of-possession engine. Its database and namespace must belong to one trust boundary. */
export const createRecoveryProofCommands = ({
  db, recordCollection, namespace, issueSession, assertEnabled,
  now = () => Date.now(), challengeTtlMs = 5 * 60_000,
  rateWindowMs = 10 * 60_000, maxChallenges = 6, maxAttempts = 3,
}) => {
  if (!/^[a-zA-Z][a-zA-Z0-9-]{0,60}$/.test(recordCollection) || !/^[a-z-]{1,40}$/.test(namespace)) fail('invalid-argument');
  const reference = (ownerUid) => db.doc(`${recordCollection}/${ownerUid}`);
  const validate = (input) => {
    validateRecoveryInput(input);
    const { ownerUid, credentialId } = input;
    if (!validId(ownerUid) || !validCredential(credentialId)) fail('permission-denied');
  };
  const begin = async (input) => {
    validate(input);
    const { ownerUid, credentialId } = input;
    const challengeId = randomUUID();
    const issuedAt = now();
    const expiresAt = issuedAt + challengeTtlMs;
    const message = ['cartularia-recovery-v1', namespace, ownerUid, credentialId, challengeId,
      String(expiresAt), randomBytes(32).toString('base64url')].join('\n');
    const record = await db.runTransaction(async (transaction) => {
      const ref = reference(ownerUid);
      const snapshot = await transaction.get(ref);
      const state = snapshot.exists ? snapshot.data() : null;
      if (!state || state.revokedAt || state.credentialId !== credentialId) fail('permission-denied');
      const bucket = state.challengeWindowEndsAt > issuedAt ? {
        challengeWindowEndsAt: state.challengeWindowEndsAt, challengeCount: Number(state.challengeCount || 0),
      } : { challengeWindowEndsAt: issuedAt + rateWindowMs, challengeCount: 0 };
      if (bucket.challengeCount >= maxChallenges) fail('resource-exhausted', 'Trop de demandes. Réessayez dans quelques minutes.');
      transaction.update(ref, { ...bucket, challengeCount: bucket.challengeCount + 1 });
      transaction.set(db.doc(`${recordCollection}/${ownerUid}/challenges/${challengeId}`), {
        credentialId, message, expiresAt, attempts: 0, usedAt: null,
        // Firestore TTL can remove expired records; authorization never relies on that cleanup.
        expiresAtTimestamp: new Date(expiresAt),
      });
      return state;
    });
    await assertEnabled(ownerUid, record);
    return { challengeId, message, expiresAt: new Date(expiresAt).toISOString() };
  };
  const complete = async (input) => {
    validate(input);
    if (!validCredential(input.challengeId)) fail('permission-denied');
    const { ownerUid, credentialId, challengeId, signature } = input;
    const ref = reference(ownerUid);
    const stateSnapshot = await ref.get();
    if (!stateSnapshot.exists) fail('permission-denied');
    await assertEnabled(ownerUid, stateSnapshot.data());
    const result = await db.runTransaction(async (transaction) => {
      const challengeRef = db.doc(`${recordCollection}/${ownerUid}/challenges/${challengeId}`);
      const [recordSnapshot, challengeSnapshot] = await Promise.all([transaction.get(ref), transaction.get(challengeRef)]);
      const record = recordSnapshot.exists ? recordSnapshot.data() : null;
      const challenge = challengeSnapshot.exists ? challengeSnapshot.data() : null;
      if (!record || record.revokedAt || record.credentialId !== credentialId
        || !challenge || challenge.credentialId !== credentialId || challenge.usedAt
        || challenge.expiresAt <= now() || challenge.attempts >= maxAttempts) fail('permission-denied');
      if (!verifyRecoverySignature({ signingPublicKeyJwk: record.signingPublicKeyJwk, message: challenge.message, signature })) {
        transaction.update(challengeRef, { attempts: challenge.attempts + 1 });
        return null;
      }
      transaction.update(challengeRef, { usedAt: now() });
      return record;
    });
    if (!result) fail('permission-denied');
    // Recheck suspensions after the transaction and before minting sessions.
    await assertEnabled(ownerUid, result);
    return issueSession(ownerUid, result);
  };
  return { begin, complete };
};

const validEnvelope = (envelope) => envelope && envelope.version === 2 && envelope.algorithm === 'AES-GCM'
  && envelope.keyDerivation === 'PBKDF2-SHA-256' && envelope.iterations === 600_000
  && typeof envelope.salt === 'string' && envelope.salt.length <= 64
  && typeof envelope.iv === 'string' && envelope.iv.length <= 64
  && typeof envelope.ciphertext === 'string' && envelope.ciphertext.length <= 900_000
  && Object.keys(envelope).every((key) => ['version', 'algorithm', 'keyDerivation', 'iterations', 'salt', 'iv', 'ciphertext'].includes(key));
const validWrappedPassword = (value) => typeof value === 'string' && value.length <= 16_384 && /^[A-Za-z0-9+/]{512,}={0,2}$/.test(value);

/** These commands never receive passwords, recovery private keys or decrypted personal content. */
export const createPersonalRecoveryCommands = ({ personalDb, personalAuth, bridgeAuth, now = () => Date.now() }) => {
  const verifySessions = async (input, requireRecent = true, maximumBytes = 65_536) => {
    validateRecoveryInput(input, maximumBytes);
    if (typeof input.personalIdToken !== 'string' || typeof input.bridgeIdToken !== 'string') fail('unauthenticated');
    if (input.personalIdToken.length > 16_384 || input.bridgeIdToken.length > 16_384) fail('invalid-argument');
    let personalToken, bridgeToken;
    try {
      [personalToken, bridgeToken] = await Promise.all([
        personalAuth.verifyIdToken(input.personalIdToken, true), bridgeAuth.verifyIdToken(input.bridgeIdToken, true),
      ]);
    } catch { fail('unauthenticated'); }
    if (requireRecent && [personalToken, bridgeToken].some((token) => !token.auth_time || now() / 1000 - token.auth_time > 900 || now() / 1000 - token.auth_time < -60)) fail('unauthenticated', 'Reconnectez-vous avant de modifier vos moyens de secours.');
    const [personalUser, bridgeUser] = await Promise.all([personalAuth.getUser(personalToken.uid), bridgeAuth.getUser(bridgeToken.uid)]);
    if (personalUser.disabled || bridgeUser.disabled) fail('permission-denied');
    return { personalUser, bridgeUser };
  };
  const assertEnabled = async (uid, record) => {
    const [personalUser, bridgeUser] = await Promise.all([personalAuth.getUser(uid), bridgeAuth.getUser(record.bridgeUid)]);
    if (personalUser.disabled || bridgeUser.disabled) fail('permission-denied');
  };
  const proof = createRecoveryProofCommands({
    db: personalDb, recordCollection: 'vaultRecovery', namespace: 'personal-vault', now, assertEnabled,
    issueSession: async (uid, record) => {
      const [personalToken, bridgeToken] = await Promise.all([
        personalAuth.createCustomToken(uid), bridgeAuth.createCustomToken(record.bridgeUid),
      ]);
      return { personalToken, bridgeToken, wrappedPassword: record.wrappedPassword, credentialId: record.credentialId, wrappingPublicKeyJwk: record.wrappingPublicKeyJwk };
    },
  });
  const enroll = async (input) => {
    const { personalUser, bridgeUser } = await verifySessions(input);
    const alias = normalizeAlias(input.userAlias);
    if (alias.length < 3 || !validCredential(input.credentialId) || !validWrappedPassword(input.wrappedPassword)
      || !/^[a-f0-9]{64}$/.test(input.expectedCiphertextHash || '')) fail('invalid-argument');
    const accountId = sha256(`account\u0000${alias}`);
    if (input.accountId !== accountId
      || personalUser.email !== `${sha256(`alias\u0000${alias}`)}@access.cartularia.invalid`
      || bridgeUser.email !== `${sha256(`bridge\u0000${alias}`)}@codes.cartularia.invalid`) fail('permission-denied');
    const signingPublicKeyJwk = validateRecoverySigningKey(input.signingPublicKeyJwk);
    const wrappingPublicKeyJwk = validateWrappingKey(input.wrappingPublicKeyJwk);
    const createdAt = new Date(now()).toISOString();
    await personalDb.runTransaction(async (transaction) => {
      const profile = await transaction.get(personalDb.doc(`vaultUsers/${personalUser.uid}/vault/profile`));
      if (!profile.exists || profile.data().accountId !== accountId || profile.data().ownerUid !== personalUser.uid) fail('failed-precondition', 'Enregistrez le Coffre avant d’activer le kit.');
      if (sha256(profile.data().ciphertext) !== input.expectedCiphertextHash) fail('aborted', 'Le Coffre a changé. Rouvrez-le avant d’activer le kit.');
      transaction.set(personalDb.doc(`vaultRecovery/${personalUser.uid}`), {
        schemaVersion: 'personal-vault-recovery@1.0.0', credentialId: input.credentialId,
        accountId, bridgeUid: bridgeUser.uid, signingPublicKeyJwk, wrappingPublicKeyJwk,
        wrappedPassword: input.wrappedPassword, createdAt, revokedAt: null,
        challengeCount: 0, challengeWindowEndsAt: 0,
      });
    });
    return { credentialId: input.credentialId, createdAt };
  };
  const status = async (input) => {
    const { personalUser, bridgeUser } = await verifySessions(input, false);
    const snapshot = await personalDb.doc(`vaultRecovery/${personalUser.uid}`).get();
    if (!snapshot.exists || snapshot.data().revokedAt) return { active: false };
    const record = snapshot.data();
    if (record.bridgeUid !== bridgeUser.uid) fail('permission-denied');
    return { active: true, credentialId: record.credentialId, createdAt: record.createdAt };
  };
  const revoke = async (input) => {
    const { personalUser, bridgeUser } = await verifySessions(input);
    const ref = personalDb.doc(`vaultRecovery/${personalUser.uid}`);
    await personalDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data().bridgeUid !== bridgeUser.uid) fail('permission-denied');
      transaction.update(ref, { revokedAt: new Date(now()).toISOString() });
    });
    return { revoked: true };
  };
  const commitPasswordRotation = async (input) => {
    const { personalUser, bridgeUser } = await verifySessions(input, true, 1_100_000);
    if (!validCredential(input.operationId) || !validCredential(input.credentialId)
      || !validEnvelope(input.envelope) || !validWrappedPassword(input.wrappedPassword)
      || !/^[a-f0-9]{64}$/.test(input.expectedCiphertextHash || '')) fail('invalid-argument');
    const recoveryRef = personalDb.doc(`vaultRecovery/${personalUser.uid}`);
    const profileRef = personalDb.doc(`vaultUsers/${personalUser.uid}/vault/profile`);
    return personalDb.runTransaction(async (transaction) => {
      const [recoverySnapshot, profileSnapshot] = await Promise.all([transaction.get(recoveryRef), transaction.get(profileRef)]);
      if (!recoverySnapshot.exists || !profileSnapshot.exists) fail('failed-precondition');
      const record = recoverySnapshot.data();
      if (record.revokedAt || record.credentialId !== input.credentialId || record.bridgeUid !== bridgeUser.uid) fail('permission-denied');
      if (record.lastRotationId === input.operationId) return { committed: true };
      if (sha256(profileSnapshot.data().ciphertext) !== input.expectedCiphertextHash) fail('aborted', 'Le Coffre a changé. Rouvrez-le avec votre kit avant de réessayer.');
      transaction.update(profileRef, { ...input.envelope, updatedAt: new Date(now()) });
      transaction.update(recoveryRef, { wrappedPassword: input.wrappedPassword, lastRotationId: input.operationId });
      return { committed: true };
    });
  };
  return {
    enroll, status, revoke, commitPasswordRotation,
    begin: (input) => { validateRecoveryInput(input); return proof.begin({ ...input, ownerUid: input.personalUid }); },
    complete: (input) => { validateRecoveryInput(input); return proof.complete({ ...input, ownerUid: input.personalUid }); },
  };
};
