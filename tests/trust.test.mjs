import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { buildCarDemoImportBundle, CAR_DEMO_CARTULARY_ID } from '../src/migrations/carDemoImport.ts';
import { buildIwcImportBundle, IWC_CARTULARY_ID } from '../src/migrations/iwcImport.ts';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';
import { canonicalize } from '../scripts/lib/canonical-json.mjs';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { verifyMerkleProof } from '../scripts/lib/merkle.mjs';
import {
  DeferredPublicAnchorAdapter,
  DeterministicTimestampAdapter,
  toPublicAnchorPayload,
} from '../scripts/lib/trust-adapters.mjs';
import {
  applyRevisionedIntegrityProjection,
  attachTimestampReceipt,
  createCartularyExport,
  createIntegrityBatch,
} from '../scripts/lib/trust-command.mjs';

const projectId = 'cartularia-wave6-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const ownerUid = 'wave1-owner';
const outsiderUid = 'wave1-outsider';

let adminApp;
let adminFirestore;
let testEnvironment;

const seedFoundations = async () => {
  await Promise.all([
    adminFirestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active' }),
    adminFirestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee', organizationId: 'org_demo', status: 'active', visibility: 'secret',
    }),
    adminFirestore.doc('organizations/org_demo/memberships/wave1-owner').set({
      uid: ownerUid,
      organizationId: 'org_demo',
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: ['cartulary.read', 'cartulary.edit', 'cartulary.export', 'integrity.batch'],
    }),
    adminFirestore.doc('organizations/org_demo/memberships/wave1-outsider').set({
      uid: outsiderUid,
      organizationId: 'org_demo',
      roles: ['account_holder'],
      status: 'active',
      scopes: { registryIds: [] },
      permissions: [],
    }),
    adminFirestore.doc('schemaCatalog/watch/versions/1.3.0').set({
      schemaId: 'watch', assetType: 'watch', version: '1.3.0', status: 'baseline',
    }),
    adminFirestore.doc('schemaCatalog/car/versions/1.0.0').set({
      schemaId: 'car', assetType: 'car', version: '1.0.0', status: 'baseline',
    }),
  ]);
};

const importFixture = (bundle, requestId, occurredAt) => importCartularyBundle({
  firestore: adminFirestore,
  bundle,
  requestId,
  actorId: ownerUid,
  expectedRevision: 0,
  occurredAt,
});

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  adminApp = getApps().find((app) => app.name === 'wave6-test-admin') || initializeApp({ projectId }, 'wave6-test-admin');
  adminFirestore = getFirestore(adminApp);
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedFoundations();
  await Promise.all([
    importFixture(buildIwcImportBundle(), 'wave6-import-iwc-test', '2026-08-14T08:00:00.000Z'),
    importFixture(buildCarDemoImportBundle(), 'wave6-import-car-test', '2026-08-14T08:01:00.000Z'),
  ]);
});

test('JCS produit une sérialisation stable et refuse les entrées non I-JSON', () => {
  assert.equal(canonicalize({ z: -0, a: 1, nested: { y: true, x: 'é' } }), '{"a":1,"nested":{"x":"é","y":true},"z":0}');
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
  assert.throws(() => canonicalize({ invalid: Number.NaN }), /JCS refuse/);
  assert.throws(() => canonicalize({ invalid: '\ud800' }), /surrogate haut isolé/);
});

test('le journal canonique valide la chaîne et détecte une altération', async () => {
  const root = await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  const events = await adminFirestore.collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`).get();
  const payload = events.docs.map((document) => document.data());
  const valid = verifyAuditChain({ events: payload, integrityHead: root.data().integrityHead, integritySequence: 1 });
  const altered = structuredClone(payload);
  altered[0].action = 'cartulary.tampered';
  const invalid = verifyAuditChain({ events: altered, integrityHead: root.data().integrityHead, integritySequence: 1 });
  assert.equal(valid.valid, true);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.code === 'event_hash_mismatch'));
});

test('un lot Merkle multi-actifs est idempotent et chaque reçu prouve son inclusion', async () => {
  const first = await createIntegrityBatch({
    firestore: adminFirestore,
    batchId: 'batch_wave6_test_001',
    cartularyIds: [IWC_CARTULARY_ID, CAR_DEMO_CARTULARY_ID],
    actorId: ownerUid,
    requestId: 'wave6-create-batch-test',
    occurredAt: '2026-08-14T16:00:00.000Z',
  });
  const replay = await createIntegrityBatch({
    firestore: adminFirestore,
    batchId: 'batch_wave6_test_001',
    cartularyIds: [CAR_DEMO_CARTULARY_ID, IWC_CARTULARY_ID],
    actorId: ownerUid,
    requestId: 'wave6-create-batch-test',
    occurredAt: '2026-08-14T16:00:00.000Z',
  });
  const receipts = await adminFirestore.collection('integrityBatches/batch_wave6_test_001/receipts').get();
  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
  await assertSucceeds(getDoc(doc(owner, 'integrityBatches', 'batch_wave6_test_001')));
  await assertSucceeds(getDoc(doc(owner, 'integrityBatches', 'batch_wave6_test_001', 'receipts', 'leaf_0000')));
  await assertFails(getDoc(doc(outsider, 'integrityBatches', 'batch_wave6_test_001')));
  await assertFails(setDoc(doc(owner, 'integrityBatches', 'forbidden_client_batch'), { readerUids: [ownerUid] }));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(receipts.size, 2);
  receipts.docs.forEach((document) => {
    const receipt = document.data();
    assert.equal(verifyMerkleProof({ ...receipt, merkleRoot: first.merkleRoot }), true);
  });
  const tampered = receipts.docs[0].data();
  assert.equal(verifyMerkleProof({ ...tampered, leafHash: `${tampered.leafHash.slice(0, -1)}0`, merkleRoot: first.merkleRoot }), false);
});

test('le reçu d’horodatage de test reste non qualifié et rejette un mauvais digest', async () => {
  const batch = await createIntegrityBatch({
    firestore: adminFirestore,
    batchId: 'batch_wave6_timestamp',
    cartularyIds: [IWC_CARTULARY_ID],
    actorId: ownerUid,
    requestId: 'wave6-create-timestamp-batch',
  });
  const adapter = new DeterministicTimestampAdapter();
  const invalidReceipt = await adapter.issue({
    digest: `sha256:${'f'.repeat(64)}`,
    requestId: 'wave6-invalid-timestamp',
    issuedAt: '2026-08-14T16:10:00.000Z',
  });
  await assert.rejects(
    () => attachTimestampReceipt({
      firestore: adminFirestore,
      batchId: batch.batchId,
      actorId: ownerUid,
      requestId: 'wave6-attach-invalid-timestamp',
      receipt: invalidReceipt,
    }),
    (error) => error.code === 'digest_mismatch',
  );
  const receipt = await adapter.issue({
    digest: batch.merkleRoot,
    requestId: 'wave6-valid-timestamp',
    issuedAt: '2026-08-14T16:11:00.000Z',
  });
  await assert.rejects(
    () => attachTimestampReceipt({
      firestore: adminFirestore,
      batchId: batch.batchId,
      actorId: ownerUid,
      requestId: 'wave6-false-qualified-timestamp',
      receipt: {
        ...receipt,
        receiptId: 'tsr_false_qualified_wave6',
        protocol: 'rfc3161-v1',
        fixture: false,
        verificationStatus: 'qualified_eidas',
        signatureVerified: true,
        chainVerified: true,
        nonceMatched: true,
        hashAlgorithm: 'sha256',
        qualified: true,
        qualificationStatus: 'QTSA',
      },
    }),
    (error) => error.code === 'unproven_qualified_timestamp',
  );
  const attached = await attachTimestampReceipt({
    firestore: adminFirestore,
    batchId: batch.batchId,
    actorId: ownerUid,
    requestId: 'wave6-attach-valid-timestamp',
    receipt,
  });
  assert.equal(attached.qualified, false);
  assert.equal(attached.verificationStatus, 'test_fixture');
  assert.equal(attached.publicAnchoringStatus, 'deferred');
});

test('T-15 — l’export propriétaire est portable, en lecture seule et idempotent', async () => {
  const first = await createCartularyExport({
    firestore: adminFirestore,
    exportId: 'export_wave6_iwc_test',
    cartularyId: IWC_CARTULARY_ID,
    actorId: ownerUid,
    requestId: 'wave6-export-iwc-test',
    expectedRevision: 1,
    occurredAt: '2026-08-14T16:20:00.000Z',
  });
  const replay = await createCartularyExport({
    firestore: adminFirestore,
    exportId: 'export_wave6_iwc_test',
    cartularyId: IWC_CARTULARY_ID,
    actorId: ownerUid,
    requestId: 'wave6-export-iwc-test',
    expectedRevision: 1,
    occurredAt: '2026-08-14T16:20:00.000Z',
  });
  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
  const job = await assertSucceeds(getDoc(doc(owner, 'cartularyExports', 'export_wave6_iwc_test')));
  const records = await assertSucceeds(getDocs(collection(owner, 'cartularyExports', 'export_wave6_iwc_test', 'records')));
  await assertFails(getDoc(doc(outsider, 'cartularyExports', 'export_wave6_iwc_test')));
  await assertFails(setDoc(doc(owner, 'cartularyExports', 'forbidden_client_export'), { status: 'ready' }));
  const root = await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  const auditEvents = await adminFirestore.collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`).get();
  assert.equal(first.status, 'ready');
  assert.equal(replay.replayed, true);
  assert.equal(root.data().revision, 2);
  assert.equal(auditEvents.size, 2);
  assert.equal(job.data().manifest.auditChainValid, true);
  assert.equal(records.size, first.portableBundle.records.length);
  assert.ok(first.portableBundle.records.some((record) => record.collectionName === 'cartularies'));
});

test('T-11 — une projection arrivée en retard ne remplace pas la révision la plus haute', async () => {
  const high = await applyRevisionedIntegrityProjection({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    sourceRevision: 8,
    integrityHead: `sha256:${'8'.repeat(64)}`,
    batchId: 'batch_wave6_projection_high',
  });
  const low = await applyRevisionedIntegrityProjection({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    sourceRevision: 7,
    integrityHead: `sha256:${'7'.repeat(64)}`,
    batchId: 'batch_wave6_projection_low',
  });
  const projection = await adminFirestore.doc(`integrityProjections/${IWC_CARTULARY_ID}`).get();
  assert.equal(high.applied, true);
  assert.equal(low.reason, 'older_revision');
  assert.equal(projection.data().sourceRevision, 8);
  assert.equal(projection.data().integrityHead, `sha256:${'8'.repeat(64)}`);
});

test('la charge d’ancrage ne contient aucun secret et l’adaptateur public reste différé', async () => {
  const payload = toPublicAnchorPayload({
    algorithm: 'sha256-binary-merkle-v1',
    canonicalizationVersion: 'jcs-1',
    merkleRoot: `sha256:${'a'.repeat(64)}`,
    leafCount: 2,
    cartularyId: IWC_CARTULARY_ID,
    serialNumber: 'SECRET-SERIAL',
    ownerUid,
    value: 15000,
  });
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('SECRET-SERIAL'), false);
  assert.equal(serialized.includes(IWC_CARTULARY_ID), false);
  assert.equal(serialized.includes(ownerUid), false);
  await assert.rejects(() => new DeferredPublicAnchorAdapter().anchor(payload), (error) => error.code === 'anchoring_deferred');
});
