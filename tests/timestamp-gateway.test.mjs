import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { issueRfc3161Timestamp } from '../scripts/lib/rfc3161-timestamp.mjs';
import { verifyPortableRfc3161Receipt } from '../scripts/lib/rfc3161-verifier.mjs';
import {
  markTimestampRequestFailed,
  processTimestampRequest,
} from '../scripts/lib/timestamp-request-command.mjs';

const execFileAsync = promisify(execFile);
const projectId = 'cartularia-timestamp-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const ownerUid = 'timestamp-owner';
const outsiderUid = 'timestamp-outsider';
const cartularyId = 'cart-timestamp-test';
const organizationId = 'org-timestamp';
const registryId = 'reg-timestamp';

let testEnvironment;
let adminApp;
let adminFirestore;
let tsaDirectory;
let tsaCaPem;

const runOpenSsl = (args, cwd = tsaDirectory) => execFileAsync('openssl', args, {
  cwd,
  maxBuffer: 2 * 1024 * 1024,
});

const createTestTsa = async () => {
  tsaDirectory = await mkdtemp(join(tmpdir(), 'cartularia-test-tsa-'));
  await runOpenSsl([
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
    '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=Cartularia Test Root',
  ]);
  await runOpenSsl([
    'req', '-newkey', 'rsa:2048', '-nodes', '-sha256',
    '-keyout', 'tsa.key', '-out', 'tsa.csr', '-subj', '/CN=Cartularia Test TSA',
  ]);
  await writeFile(join(tsaDirectory, 'tsa.ext'), [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,nonRepudiation',
    'extendedKeyUsage=critical,timeStamping',
    'subjectKeyIdentifier=hash',
    'authorityKeyIdentifier=keyid,issuer',
    '',
  ].join('\n'));
  await runOpenSsl([
    'x509', '-req', '-in', 'tsa.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key',
    '-CAcreateserial', '-out', 'tsa.pem', '-days', '2', '-sha256', '-extfile', 'tsa.ext',
  ]);
  await writeFile(join(tsaDirectory, 'serial'), '01\n');
  await writeFile(join(tsaDirectory, 'tsa.cnf'), [
    '[ tsa ]',
    'default_tsa = tsa_config',
    '[ tsa_config ]',
    'serial = serial',
    'crypto_device = builtin',
    'signer_cert = tsa.pem',
    'certs = ca.pem',
    'signer_key = tsa.key',
    'signer_digest = sha256',
    'default_policy = 1.2.3.4.1',
    'other_policies = 1.2.3.4.2',
    'digests = sha256',
    'accuracy = secs:1',
    'ordering = yes',
    'tsa_name = yes',
    'ess_cert_id_chain = no',
    'ess_cert_id_alg = sha256',
    '',
  ].join('\n'));
  tsaCaPem = await readFile(join(tsaDirectory, 'ca.pem'), 'utf8');
};

const tsaFetch = ({ wrongDigest = null } = {}) => async (_url, options) => {
  const queryPath = join(tsaDirectory, `query-${crypto.randomUUID()}.tsq`);
  const responsePath = join(tsaDirectory, `response-${crypto.randomUUID()}.tsr`);
  if (wrongDigest) {
    await runOpenSsl(['ts', '-query', '-digest', wrongDigest.slice(7), '-sha256', '-cert', '-out', queryPath]);
  } else {
    await writeFile(queryPath, Buffer.from(options.body));
  }
  await runOpenSsl([
    'ts', '-reply', '-config', 'tsa.cnf', '-section', 'tsa_config',
    '-queryfile', queryPath, '-out', responsePath,
  ]);
  const bytes = await readFile(responsePath);
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
};

const issueFromTestTsa = ({ digest, requestId }) => issueRfc3161Timestamp({
  digest,
  requestId,
  tsaUrl: 'https://tsa.cartularia.test/rfc3161',
  provider: 'Cartularia test TSA',
  fetchImpl: tsaFetch(),
  trustStorePem: tsaCaPem,
});

const requestDocument = (requestId, digest, uid = ownerUid) => ({
  requestDocumentId: requestId,
  requestId,
  ownerUid: uid,
  cartularyId,
  digest,
  status: 'pending',
  requestedAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

before(async () => {
  await createTestTsa();
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
  adminApp = getApps().find((app) => app.name === 'timestamp-test-admin')
    || initializeApp({ projectId }, 'timestamp-test-admin');
  adminFirestore = getFirestore(adminApp);
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
  await rm(tsaDirectory, { recursive: true, force: true });
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await Promise.all([
    adminFirestore.doc(`users/${ownerUid}`).set({ uid: ownerUid, status: 'active' }),
    adminFirestore.doc(`users/${outsiderUid}`).set({ uid: outsiderUid, status: 'active' }),
    adminFirestore.doc(`organizations/${organizationId}`).set({ id: organizationId, status: 'active' }),
    adminFirestore.doc(`registries/${registryId}`).set({ id: registryId, organizationId, status: 'active' }),
    adminFirestore.doc(`organizations/${organizationId}/memberships/${ownerUid}`).set({
      uid: ownerUid,
      organizationId,
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: [registryId] },
      permissions: ['cartulary.read', 'integrity.batch'],
    }),
    adminFirestore.doc(`organizations/${organizationId}/memberships/${outsiderUid}`).set({
      uid: outsiderUid,
      organizationId,
      roles: ['account_holder'],
      status: 'active',
      scopes: { registryIds: [] },
      permissions: [],
    }),
    adminFirestore.doc(`cartularies/${cartularyId}`).set({
      id: cartularyId,
      organizationId,
      registryId,
      accountHolderId: ownerUid,
      revision: 1,
      integrityHead: `sha256:${'0'.repeat(64)}`,
      integritySequence: 0,
    }),
  ]);
});

test('la Function produit un reçu complet revérifiable hors application et idempotent', async () => {
  const requestId = 'timestamp_0123456789abcdef0123456789abcdef';
  const digest = `sha256:${'a'.repeat(64)}`;
  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
  await assertSucceeds(setDoc(doc(owner, 'timestampRequests', requestId), requestDocument(requestId, digest)));
  await assertFails(setDoc(doc(outsider, 'timestampRequests', requestId), requestDocument(requestId, digest, outsiderUid)));

  const first = await processTimestampRequest({
    firestore: adminFirestore,
    requestDocumentId: requestId,
    issueTimestamp: issueFromTestTsa,
    occurredAt: '2026-08-17T10:15:00.000Z',
  });
  const receiptSnapshot = await assertSucceeds(getDoc(doc(owner, 'timestampReceipts', requestId)));
  const receipt = receiptSnapshot.data();
  const independentVerification = await verifyPortableRfc3161Receipt(receipt, { trustStorePem: tsaCaPem });
  const auditEventsBeforeReplay = await adminFirestore.collection(`cartularies/${cartularyId}/auditEvents`).get();
  const replay = await processTimestampRequest({
    firestore: adminFirestore,
    requestDocumentId: requestId,
    issueTimestamp: async () => { throw new Error('La TSA ne doit pas être rappelée au rejeu.'); },
    occurredAt: '2026-08-17T10:16:00.000Z',
  });
  const storedReceipts = await adminFirestore.collection('timestampReceipts').get();
  const rateWindow = await adminFirestore.doc(`timestampRateLimits/${ownerUid}/windows/2026081710`).get();
  const auditEventsAfterReplay = await adminFirestore.collection(`cartularies/${cartularyId}/auditEvents`).get();

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(independentVerification.valid, true);
  assert.equal(receipt.digest, digest);
  assert.ok(receipt.requestBase64.length > 0);
  assert.ok(receipt.tokenBase64.length > 0);
  assert.equal(storedReceipts.size, 1);
  assert.equal(rateWindow.data().count, 1);
  assert.equal(auditEventsBeforeReplay.size, auditEventsAfterReplay.size);
  await assertFails(getDocs(collection(owner, 'timestampReceipts')));
  await assertFails(getDoc(doc(outsider, 'timestampReceipts', requestId)));
  await assertFails(setDoc(doc(owner, 'timestampReceipts', requestId), { status: 'forged' }, { merge: true }));
});

test('une altération du jeton est détectée par le vérificateur indépendant', async () => {
  const digest = `sha256:${'b'.repeat(64)}`;
  const receipt = await issueFromTestTsa({
    digest,
    requestId: 'timestamp_11111111111111111111111111111111',
  });
  const altered = structuredClone(receipt);
  const token = Buffer.from(altered.tokenBase64, 'base64');
  token[Math.floor(token.length / 2)] ^= 0x01;
  altered.tokenBase64 = token.toString('base64');
  const verification = await verifyPortableRfc3161Receipt(altered, { trustStorePem: tsaCaPem });
  assert.equal(verification.valid, false);
  assert.ok(verification.errors.some((error) => error.code === 'timestamp_token_digest_mismatch'));

  const alteredDigest = structuredClone(receipt);
  alteredDigest.digest = `sha256:${'0'.repeat(64)}`;
  const digestVerification = await verifyPortableRfc3161Receipt(alteredDigest, { trustStorePem: tsaCaPem });
  assert.equal(digestVerification.valid, false);
  assert.ok(digestVerification.errors.some((error) => error.code === 'timestamp_message_imprint_mismatch'));
});

test('un jeton RFC 3161 visant un autre digest est rejeté sans fixture de repli', async () => {
  const requestedDigest = `sha256:${'c'.repeat(64)}`;
  const wrongDigest = `sha256:${'d'.repeat(64)}`;
  await assert.rejects(() => issueRfc3161Timestamp({
    digest: requestedDigest,
    requestId: 'timestamp_22222222222222222222222222222222',
    tsaUrl: 'https://tsa.cartularia.test/rfc3161',
    provider: 'Cartularia test TSA',
    fetchImpl: tsaFetch({ wrongDigest }),
    trustStorePem: tsaCaPem,
  }), (error) => error.code === 'openssl_verification_failed');
});

test('le quota est appliqué par compte et un échec ne crée aucun reçu', async () => {
  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const firstRequestId = 'timestamp_33333333333333333333333333333333';
  const secondRequestId = 'timestamp_44444444444444444444444444444444';
  const receiptFactory = async ({ digest, requestId }) => ({
    receiptId: `tsr_${requestId.slice(-24)}`,
    protocol: 'rfc3161-v1',
    status: 'ExternalReceipt',
    provider: 'Injected verified test boundary',
    tsaEndpoint: 'https://tsa.cartularia.test/rfc3161',
    digest,
    requestId,
    requestBase64: 'AQ==',
    requestSha256: `sha256:${'1'.repeat(64)}`,
    tokenBase64: 'Ag==',
    tokenSha256: `sha256:${'2'.repeat(64)}`,
    issuedAt: '2026-08-17T11:00:00.000Z',
    policyOid: '1.2.3.4.1',
    serialNumber: '0x01',
    hashAlgorithm: 'sha256',
    nonce: '0x01',
    signerSubject: 'CN=Cartularia Test TSA',
    signerIssuer: 'CN=Cartularia Test Root',
    signerCertificateSha256: `sha256:${'3'.repeat(64)}`,
    verificationStatus: 'trusted_rfc3161',
    signatureVerified: true,
    chainVerified: true,
    nonceMatched: true,
    qualified: false,
    qualificationStatus: 'not_assessed',
    publicAnchoringStatus: 'deferred',
    validationEvidence: {
      verifiedAt: '2026-08-17T11:00:00.000Z',
      verifier: 'injected boundary',
      trustStore: 'test',
    },
  });
  await assertSucceeds(setDoc(doc(owner, 'timestampRequests', firstRequestId), requestDocument(firstRequestId, `sha256:${'e'.repeat(64)}`)));
  await processTimestampRequest({
    firestore: adminFirestore,
    requestDocumentId: firstRequestId,
    issueTimestamp: receiptFactory,
    occurredAt: '2026-08-17T11:00:00.000Z',
    rateLimitPerHour: 1,
  });
  await assertSucceeds(setDoc(doc(owner, 'timestampRequests', secondRequestId), requestDocument(secondRequestId, `sha256:${'f'.repeat(64)}`)));
  let failure;
  await assert.rejects(async () => {
    try {
      await processTimestampRequest({
        firestore: adminFirestore,
        requestDocumentId: secondRequestId,
        issueTimestamp: receiptFactory,
        occurredAt: '2026-08-17T11:01:00.000Z',
        rateLimitPerHour: 1,
      });
    } catch (error) {
      failure = error;
      throw error;
    }
  }, (error) => error.code === 'rate_limited');
  await markTimestampRequestFailed({
    firestore: adminFirestore,
    requestDocumentId: secondRequestId,
    requestId: secondRequestId,
    error: failure,
  });
  const failedRequest = await getDoc(doc(owner, 'timestampRequests', secondRequestId));
  const absentReceipt = await adminFirestore.doc(`timestampReceipts/${secondRequestId}`).get();
  assert.equal(failedRequest.data().status, 'failed');
  assert.equal(absentReceipt.exists, false);
});
