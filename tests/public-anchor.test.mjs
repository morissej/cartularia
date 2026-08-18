import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc } from 'firebase/firestore';
import { buildIwcImportBundle, IWC_CARTULARY_ID } from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import {
  processIntegrityBatchPublicAnchor,
  runScheduledPublicAnchoring,
} from '../scripts/lib/public-anchor-command.mjs';
import { verifyPortableCartularyExport } from '../scripts/lib/portable-integrity-verifier.mjs';
import { sha256Bytes } from '../scripts/lib/canonical-json.mjs';
import {
  OpenTimestampsPublicAnchorAdapter,
  toPublicAnchorPayload,
} from '../scripts/lib/trust-adapters.mjs';
import {
  attachTimestampReceipt,
  createCartularyExport,
  createIntegrityBatch,
} from '../scripts/lib/trust-command.mjs';

const projectId = 'cartularia-public-anchor-test';
const [host = '127.0.0.1', portValue = '28080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const ownerUid = 'wave1-owner';
const outsiderUid = 'wave1-outsider';
let adminApp;
let firestore;
let testEnvironment;

test('le client officiel désérialise une preuve OpenTimestamps portable', () => {
  const require = createRequire(import.meta.url);
  const OpenTimestamps = require('opentimestamps');
  const proof = readFileSync(new URL('../node_modules/opentimestamps/examples/hello-world.txt.ots', import.meta.url));
  const detached = OpenTimestamps.DetachedTimestampFile.deserialize(proof);
  assert.equal(Buffer.from(detached.fileDigest()).length, 32);
  assert.equal(Buffer.from(detached.serializeToBytes()).equals(proof), true);
});

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  adminApp = getApps().find((app) => app.name === 'public-anchor-test-admin')
    || initializeApp({ projectId }, 'public-anchor-test-admin');
  firestore = getFirestore(adminApp);
  await testEnvironment.clearFirestore();
  await Promise.all([
    firestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active' }),
    firestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee', organizationId: 'org_demo', status: 'active', visibility: 'secret',
    }),
    firestore.doc(`organizations/org_demo/memberships/${ownerUid}`).set({
      uid: ownerUid,
      organizationId: 'org_demo',
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: ['cartulary.read', 'cartulary.edit', 'cartulary.export', 'integrity.batch'],
    }),
    firestore.doc(`organizations/org_demo/memberships/${outsiderUid}`).set({
      uid: outsiderUid,
      organizationId: 'org_demo',
      roles: ['account_holder'],
      status: 'active',
      scopes: { registryIds: [] },
      permissions: [],
    }),
    firestore.doc('schemaCatalog/watch/versions/1.3.0').set({
      schemaId: 'watch', assetType: 'watch', version: '1.3.0', status: 'baseline',
    }),
  ]);
  await importCartularyBundle({
    firestore,
    bundle: buildIwcImportBundle(),
    requestId: 'anchor-import-iwc-test',
    actorId: ownerUid,
    expectedRevision: 0,
    occurredAt: '2026-08-17T01:00:00.000Z',
  });
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
});

test('la charge publique exclut identités, Cartulaire, série, valeur et localisation', () => {
  const payload = toPublicAnchorPayload({
    algorithm: 'sha256-binary-merkle-v1',
    canonicalizationVersion: 'jcs-1',
    merkleRoot: `sha256:${'a'.repeat(64)}`,
    leafCount: 1,
    cartularyId: IWC_CARTULARY_ID,
    ownerUid,
    identity: 'Jérôme Exemple',
    serialNumber: 'SECRET-SERIAL',
    value: 25_000,
    location: 'Adresse privée',
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    'algorithm', 'canonicalizationVersion', 'leafCount', 'merkleRoot',
  ]);
  const publicBytes = JSON.stringify(payload);
  for (const forbidden of [IWC_CARTULARY_ID, ownerUid, 'Jérôme Exemple', 'SECRET-SERIAL', '25000', 'Adresse privée']) {
    assert.equal(publicBytes.includes(forbidden), false, `donnée privée exposée: ${forbidden}`);
  }
});

test('l’ancrage quotidien conserve la preuve, confirme Bitcoin et reste idempotent', async () => {
  const batch = await createIntegrityBatch({
    firestore,
    batchId: 'batch_public_anchor_001',
    cartularyIds: [IWC_CARTULARY_ID],
    actorId: ownerUid,
    requestId: 'anchor-create-batch-test',
    occurredAt: '2026-08-17T02:00:00.000Z',
  });
  const timestampToken = Buffer.from('rfc3161-test-token');
  const timestampReceipt = {
    receiptId: 'tsr_public_anchor_test',
    protocol: 'rfc3161-v1',
    digest: batch.merkleRoot,
    tokenBase64: timestampToken.toString('base64'),
    tokenSha256: sha256Bytes(timestampToken),
    verificationStatus: 'trusted_rfc3161',
    qualificationStatus: 'non_qualified',
    qualified: false,
    signatureVerified: true,
    chainVerified: true,
    nonceMatched: true,
    hashAlgorithm: 'sha256',
  };
  await attachTimestampReceipt({
    firestore,
    batchId: batch.batchId,
    actorId: ownerUid,
    requestId: 'anchor-attach-timestamp-test',
    receipt: timestampReceipt,
  });

  let providerCalls = 0;
  const adapter = new OpenTimestampsPublicAnchorAdapter({
    client: {
      anchor: async ({ payloadDigest, proofBase64 }) => {
        providerCalls += 1;
        const confirmed = Boolean(proofBase64);
        const proofBytes = Buffer.from(confirmed ? 'confirmed-ots-proof' : 'pending-ots-proof');
        return {
          provider: 'opentimestamps',
          network: 'bitcoin-mainnet',
          protocol: 'opentimestamps-v1',
          status: confirmed ? 'anchored' : 'pending_confirmation',
          payloadDigest,
          proofBase64: proofBytes.toString('base64'),
          proofSha256: sha256Bytes(proofBytes),
          ...(confirmed ? { blockHeight: 1_234_567, confirmedAtIso: '2026-08-17T03:00:00.000Z' } : {}),
        };
      },
    },
  });

  const pending = await processIntegrityBatchPublicAnchor({
    firestore, batchId: batch.batchId, adapter, now: new Date('2026-08-17T03:00:00.000Z'),
  });
  assert.equal(pending.status, 'pending_confirmation');
  const scheduled = await runScheduledPublicAnchoring({
    firestore, adapter, now: new Date('2026-08-18T03:20:00.000Z'),
  });
  assert.equal(scheduled.anchored, 1);
  const replay = await processIntegrityBatchPublicAnchor({
    firestore, batchId: batch.batchId, adapter, now: new Date('2026-08-18T03:21:00.000Z'),
  });
  assert.equal(replay.status, 'anchored');
  assert.equal(replay.replayed, true);
  assert.equal(providerCalls, 2);

  const anchor = await firestore.doc(`integrityBatches/${batch.batchId}/publicAnchors/opentimestamps`).get();
  assert.equal(anchor.data().status, 'anchored');
  assert.equal(anchor.data().blockHeight, 1_234_567);
  assert.equal(anchor.data().proofBase64, Buffer.from('confirmed-ots-proof').toString('base64'));
  const projection = await firestore.doc(`integrityProjections/${IWC_CARTULARY_ID}`).get();
  assert.equal(projection.data().publicAnchoringStatus, 'anchored');

  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
  await assertSucceeds(getDoc(doc(owner, 'integrityBatches', batch.batchId, 'publicAnchors', 'opentimestamps')));
  await assertSucceeds(getDoc(doc(owner, 'integrityProjections', IWC_CARTULARY_ID)));
  await assertFails(getDoc(doc(outsider, 'integrityBatches', batch.batchId, 'publicAnchors', 'opentimestamps')));
  await assertFails(getDoc(doc(outsider, 'integrityProjections', IWC_CARTULARY_ID)));

  const exported = await createCartularyExport({
    firestore,
    exportId: 'export_public_anchor_iwc',
    cartularyId: IWC_CARTULARY_ID,
    actorId: ownerUid,
    requestId: 'anchor-export-test',
    expectedRevision: 1,
    occurredAt: '2026-08-18T04:00:00.000Z',
  });
  const verifierOptions = {
    verifyRfc3161Receipt: async () => ({ valid: true, errors: [] }),
    verifyOpenTimestamps: async () => ({
      valid: true,
      blockHeight: 1_234_567,
      confirmedAtIso: '2026-08-17T03:00:00.000Z',
    }),
  };
  const verified = await verifyPortableCartularyExport(exported.portableBundle, verifierOptions);
  assert.equal(verified.valid, true);
  assert.equal(verified.integrityProofCount, 1);
  assert.equal(verified.verifiedProofs[0].blockHeight, 1_234_567);

  const altered = structuredClone(exported.portableBundle);
  const proofRecord = altered.records.find((record) => record.collectionName === 'integrityProofs');
  proofRecord.data.inclusion.integrityHead = `sha256:${'f'.repeat(64)}`;
  const rejected = await verifyPortableCartularyExport(altered, verifierOptions);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some((error) => (
    error.code === 'record_digest_mismatch' || error.code === 'leaf_hash_mismatch'
  )));
});
