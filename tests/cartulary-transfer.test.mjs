import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { buildIwcImportBundle, IWC_CARTULARY_ID } from '../src/migrations/iwcImport.ts';
import { verifyAuditChain } from '../scripts/lib/audit-verifier.mjs';
import { sha256Bytes } from '../scripts/lib/canonical-json.mjs';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import { verifyPortableCartularyExport } from '../scripts/lib/portable-integrity-verifier.mjs';
import { OpenTimestampsPublicAnchorAdapter } from '../scripts/lib/trust-adapters.mjs';
import { createCartularyExport } from '../scripts/lib/trust-command.mjs';
import {
  acceptCartularyTransfer,
  completeCartularyTransfer,
  expireCartularyTransfer,
  findWithheldTransferMarker,
  proposeCartularyTransfer,
  rejectCartularyTransfer,
  sealAcceptedTransferHead,
} from '../scripts/lib/transfer-command.mjs';

const projectId = 'cartularia-transfer-test';
const [host = '127.0.0.1', portValue = '28080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const sellerUid = 'wave1-owner';
const buyerUid = 'transfer-buyer';
const outsiderUid = 'transfer-outsider';
const registryId = 'reg_collection_privee';

let adminApp;
let firestore;
let testEnvironment;

const membership = (uid, overrides = {}) => ({
  uid,
  organizationId: 'org_demo',
  roles: ['account_holder', 'legal_owner'],
  status: 'active',
  scopes: { registryIds: [registryId] },
  permissions: [
    'cartulary.read',
    'cartulary.edit',
    'cartulary.export',
    'integrity.batch',
    'publication.manage',
  ],
  ...overrides,
});

const seed = async () => {
  await Promise.all([
    firestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active' }),
    firestore.doc(`registries/${registryId}`).set({
      id: registryId,
      organizationId: 'org_demo',
      status: 'active',
      visibility: 'secret',
    }),
    firestore.doc(`organizations/org_demo/memberships/${sellerUid}`).set(membership(sellerUid)),
    firestore.doc(`organizations/org_demo/memberships/${buyerUid}`).set(membership(buyerUid)),
    firestore.doc(`organizations/org_demo/memberships/${outsiderUid}`).set(membership(outsiderUid, {
      roles: ['account_holder'],
      scopes: { registryIds: [] },
      permissions: [],
    })),
    firestore.doc(`users/${sellerUid}`).set({ uid: sellerUid, status: 'active' }),
    firestore.doc(`users/${buyerUid}`).set({ uid: buyerUid, status: 'active' }),
    firestore.doc(`users/${outsiderUid}`).set({ uid: outsiderUid, status: 'active' }),
    firestore.doc('schemaCatalog/watch/versions/1.3.0').set({
      schemaId: 'watch',
      assetType: 'watch',
      version: '1.3.0',
      status: 'baseline',
    }),
  ]);
  await importCartularyBundle({
    firestore,
    bundle: buildIwcImportBundle(),
    requestId: 'transfer-import-iwc-test',
    actorId: sellerUid,
    expectedRevision: 0,
    occurredAt: '2026-08-17T08:00:00.000Z',
  });
};

const expectCode = (code) => (error) => error?.code === code;

const anchoredAdapter = () => new OpenTimestampsPublicAnchorAdapter({
  client: {
    anchor: async ({ payloadDigest }) => {
      const proof = Buffer.from('transfer-anchored-ots-proof');
      return {
        provider: 'opentimestamps',
        network: 'bitcoin-mainnet',
        protocol: 'opentimestamps-v1',
        status: 'anchored',
        payloadDigest,
        proofBase64: proof.toString('base64'),
        proofSha256: sha256Bytes(proof),
        blockHeight: 1_234_890,
        confirmedAtIso: '2026-08-17T08:12:00.000Z',
      };
    },
  },
});

const issueTrustedTimestamp = async ({ digest }) => {
  const token = Buffer.from(`transfer-rfc3161:${digest}`);
  return {
    receiptId: 'tsr_transfer_head_test',
    protocol: 'rfc3161-v1',
    digest,
    tokenBase64: token.toString('base64'),
    tokenSha256: sha256Bytes(token),
    verificationStatus: 'trusted_rfc3161',
    qualificationStatus: 'non_qualified',
    qualified: false,
    signatureVerified: true,
    chainVerified: true,
    nonceMatched: true,
    hashAlgorithm: 'sha256',
  };
};

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  adminApp = getApps().find((app) => app.name === 'transfer-test-admin')
    || initializeApp({ projectId }, 'transfer-test-admin');
  firestore = getFirestore(adminApp);
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seed();
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
});

test('la cession à deux consentements scelle la tête héritée, transfère le droit et résiste à une altération', async () => {
  const rootRef = firestore.doc(`cartularies/${IWC_CARTULARY_ID}`);
  const initialRoot = (await rootRef.get()).data();
  const publicCode = initialRoot.publicCode;

  await Promise.all([
    rootRef.collection('sections').doc('owner.contact.private').set({
      id: 'owner.contact.private',
      schemaSectionId: 'cover.owner',
      title: 'Contact du propriétaire',
      fields: { email: { value: 'vendeur@example.test' }, phone: { value: '+33 1 00 00 00 00' } },
      visibility: 'secret',
    }),
    rootRef.collection('sections').doc('insurance.private').set({
      id: 'insurance.private',
      schemaSectionId: 'cover.insurance',
      title: 'Assurance',
      fields: { insurer: { value: 'Assureur privé' } },
      visibility: 'secret',
    }),
    rootRef.collection('sources').doc('seller-private-source').set({
      id: 'seller-private-source',
      locator: `private://${sellerUid}/acquisition-invoice.pdf`,
      visibility: 'secret',
    }),
    rootRef.collection('assets').doc('seller-private-asset').set({
      id: 'seller-private-asset',
      storagePath: `private/${sellerUid}/insurance.pdf`,
      binaryId: 'seller-insurance-binary',
      processingState: 'ready',
      visibility: 'secret',
    }),
    rootRef.collection('publicationApprovals').doc('approval_public_old').set({
      id: 'approval_public_old',
      audience: 'public',
      actorId: sellerUid,
      decisionSource: 'human_confirmed',
    }),
    rootRef.collection('reportProjections').doc('report_old').set({
      id: 'report_old',
      audience: 'report',
      ownerUid: sellerUid,
      status: 'ready',
    }),
    firestore.doc(`publications/${publicCode}`).set({
      publicCode,
      cartularyId: IWC_CARTULARY_ID,
      status: 'published',
      publicationStatus: 'published',
      contentHash: `sha256:${'a'.repeat(64)}`,
      blockIds: ['cover-watch'],
      assetCount: 1,
    }),
    firestore.doc(`publications/${publicCode}/blocks/cover-watch`).set({
      id: 'cover-watch',
      title: 'IWC',
      payload: { model: 'Flieger UTC' },
    }),
    firestore.doc(`seals/${publicCode}`).set({
      publicCode,
      cartularyId: IWC_CARTULARY_ID,
      status: 'issued',
    }),
    firestore.doc(`registries/${registryId}/items/${IWC_CARTULARY_ID}`).set({
      cartularyId: IWC_CARTULARY_ID,
      lifecycleStatus: 'review',
      possessionStatus: 'in_possession',
      publicationStatus: 'published',
      sourceRevision: 1,
    }),
  ]);
  await rootRef.collection('reportProjections').doc('report_old').collection('blocks').doc('value-cost-basis').set({
    id: 'value-cost-basis',
    payload: { acquisitionPrice: 12_500 },
  });

  const proposal = await proposeCartularyTransfer({
    firestore,
    transferId: 'transfer_full_success_001',
    cartularyId: IWC_CARTULARY_ID,
    sellerUid,
    buyerUid,
    requestId: 'transfer_propose_success_001',
    expectedRevision: 1,
    occurredAt: '2026-08-17T08:05:00.000Z',
    expiresAt: '2026-08-24T08:05:00.000Z',
  });
  const proposalReplay = await proposeCartularyTransfer({
    firestore,
    transferId: 'transfer_full_success_001',
    cartularyId: IWC_CARTULARY_ID,
    sellerUid,
    buyerUid,
    requestId: 'transfer_propose_success_001',
    expectedRevision: 1,
    occurredAt: '2026-08-17T08:05:00.000Z',
    expiresAt: '2026-08-24T08:05:00.000Z',
  });
  assert.equal(proposal.revision, 2);
  assert.equal(proposalReplay.replayed, true);
  await assert.rejects(() => acceptCartularyTransfer({
    firestore,
    transferId: 'transfer_full_success_001',
    buyerUid,
    requestId: 'transfer_accept_stale_001',
    expectedRevision: 1,
    occurredAt: '2026-08-17T08:06:00.000Z',
  }), expectCode('revision_conflict'));

  const accepted = await acceptCartularyTransfer({
    firestore,
    transferId: 'transfer_full_success_001',
    buyerUid,
    requestId: 'transfer_accept_success_001',
    expectedRevision: 2,
    occurredAt: '2026-08-17T08:07:00.000Z',
  });
  const acceptReplay = await acceptCartularyTransfer({
    firestore,
    transferId: 'transfer_full_success_001',
    buyerUid,
    requestId: 'transfer_accept_success_001',
    expectedRevision: 2,
    occurredAt: '2026-08-17T08:07:00.000Z',
  });
  assert.equal(accepted.revision, 3);
  assert.equal(acceptReplay.replayed, true);

  const sealing = await sealAcceptedTransferHead({
    firestore,
    transferId: 'transfer_full_success_001',
    issueTimestamp: issueTrustedTimestamp,
    publicAnchorAdapter: anchoredAdapter(),
    occurredAt: '2026-08-17T08:10:00.000Z',
  });
  const sealingReplay = await sealAcceptedTransferHead({
    firestore,
    transferId: 'transfer_full_success_001',
    issueTimestamp: issueTrustedTimestamp,
    publicAnchorAdapter: anchoredAdapter(),
    occurredAt: '2026-08-17T08:10:00.000Z',
  });
  assert.equal(sealing.acceptedHead, accepted.acceptedHead);
  assert.equal(sealing.publicAnchoringStatus, 'anchored');
  assert.equal(sealingReplay.replayed, true);

  const completed = await completeCartularyTransfer({
    firestore,
    transferId: 'transfer_full_success_001',
    requestId: 'transfer_complete_success_001',
    expectedRevision: 3,
    occurredAt: '2026-08-17T08:15:00.000Z',
  });
  const completionReplay = await completeCartularyTransfer({
    firestore,
    transferId: 'transfer_full_success_001',
    requestId: 'transfer_complete_success_001',
    expectedRevision: 3,
    occurredAt: '2026-08-17T08:15:00.000Z',
  });
  assert.equal(completed.revision, 4);
  assert.equal(completed.inheritedHead, accepted.acceptedHead);
  assert.equal(completionReplay.replayed, true);

  const [root, transfer, previousRelation, nextRelation, auditEvents] = await Promise.all([
    rootRef.get(),
    firestore.doc('cartularyTransfers/transfer_full_success_001').get(),
    rootRef.collection('ownerRelations').doc('owner_relation_iwc_current').get(),
    rootRef.collection('ownerRelations').doc(completed.newLegalOwnerRelationId).get(),
    rootRef.collection('auditEvents').orderBy('sequence').get(),
  ]);
  assert.equal(root.data().accountHolderId, buyerUid);
  assert.equal(root.data().legalOwnerRelationId, completed.newLegalOwnerRelationId);
  assert.equal(root.data().ownershipRollover.inheritedHead, accepted.acceptedHead);
  assert.equal(previousRelation.data().status, 'transferred');
  assert.equal(nextRelation.data().userId, buyerUid);
  assert.equal(nextRelation.data().relationType, 'legal_owner');
  assert.equal(transfer.data().sellerDecision.decisionSource, 'human_confirmed');
  assert.equal(transfer.data().buyerDecision.decisionSource, 'human_confirmed');
  const events = auditEvents.docs.map((document) => document.data());
  const completedEvent = events.find((event) => event.action === 'cartulary.transfer.completed');
  assert.equal(completedEvent.previousEventHash, accepted.acceptedHead);
  assert.equal(completedEvent.resource.inheritedHead, accepted.acceptedHead);
  assert.deepEqual(events.filter((event) => event.action === 'cartulary.transfer.proposed').length, 1);
  assert.deepEqual(events.filter((event) => event.action === 'cartulary.transfer.accepted').length, 1);
  assert.equal(verifyAuditChain({
    events,
    integrityHead: root.data().integrityHead,
    integritySequence: root.data().integritySequence,
  }).valid, true);

  const alteredEvents = structuredClone(events);
  alteredEvents[0].action = 'cartulary.history.rewritten';
  const alteredVerification = verifyAuditChain({
    events: alteredEvents,
    integrityHead: root.data().integrityHead,
    integritySequence: root.data().integritySequence,
  });
  assert.equal(alteredVerification.valid, false);
  assert.ok(alteredVerification.errors.some((error) => error.code === 'event_hash_mismatch'));

  for (const withheldSection of ['value.purchase', 'storage.current', 'owner.contact.private', 'insurance.private']) {
    assert.equal((await rootRef.collection('sections').doc(withheldSection).get()).exists, false);
  }
  assert.equal((await rootRef.collection('reports').get()).empty, true);
  assert.equal((await rootRef.collection('reminders').get()).empty, true);
  assert.equal((await rootRef.collection('publicationApprovals').get()).empty, true);
  assert.equal((await rootRef.collection('reportProjections').get()).empty, true);
  assert.equal((await rootRef.collection('sources').doc('seller-private-source').get()).data().locator, 'withheld:previous-owner-private-source');
  assert.equal((await rootRef.collection('assets').doc('seller-private-asset').get()).data().storagePath, null);

  const archive = await firestore.doc('transferPrivateArchives/transfer_full_success_001').get();
  const archiveRecords = await firestore.collection('transferPrivateArchives/transfer_full_success_001/records').get();
  assert.equal(archive.data().sellerUid, sellerUid);
  assert.ok(archiveRecords.size >= 8);
  for (const record of archiveRecords.docs) {
    assert.equal(findWithheldTransferMarker(record.data().data) !== null
      || record.data().reason.startsWith('previous_owner_'), true);
  }

  const publication = await firestore.doc(`publications/${publicCode}`).get();
  const seal = await firestore.doc(`seals/${publicCode}`).get();
  const registryItem = await firestore.doc(`registries/${registryId}/items/${IWC_CARTULARY_ID}`).get();
  assert.equal(publication.data().status, 'revoked');
  assert.equal(publication.data().reexaminationRequired, true);
  assert.equal((await firestore.collection(`publications/${publicCode}/blocks`).get()).empty, true);
  assert.equal(seal.data().status, 'revoked');
  assert.equal(seal.data().reexaminationRequired, true);
  assert.equal(registryItem.data().publicationStatus, 'review_required');

  await assert.rejects(() => createCartularyExport({
    firestore,
    exportId: 'export_transfer_seller_forbidden',
    cartularyId: IWC_CARTULARY_ID,
    actorId: sellerUid,
    requestId: 'transfer_export_seller_forbidden',
    expectedRevision: 4,
    occurredAt: '2026-08-17T08:20:00.000Z',
  }), expectCode('permission_denied'));

  const exported = await createCartularyExport({
    firestore,
    exportId: 'export_transfer_buyer_verified',
    cartularyId: IWC_CARTULARY_ID,
    actorId: buyerUid,
    requestId: 'transfer_export_buyer_verified',
    expectedRevision: 4,
    occurredAt: '2026-08-17T08:21:00.000Z',
  });
  const verified = await verifyPortableCartularyExport(exported.portableBundle, {
    verifyRfc3161Receipt: async () => ({ valid: true, errors: [] }),
    verifyOpenTimestamps: async () => ({
      valid: true,
      blockHeight: 1_234_890,
      confirmedAtIso: '2026-08-17T08:12:00.000Z',
    }),
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.integrityProofCount, 1);
  const portableAcceptedEvent = exported.portableBundle.records.find((record) => (
    record.collectionName === 'auditEvents' && record.data.action === 'cartulary.transfer.accepted'
  ));
  assert.equal(portableAcceptedEvent.data.hash, accepted.acceptedHead);
  const alteredBundle = structuredClone(exported.portableBundle);
  alteredBundle.records.find((record) => record.collectionName === 'auditEvents').data.action = 'cartulary.history.rewritten';
  const rejectedBundle = await verifyPortableCartularyExport(alteredBundle, {
    verifyRfc3161Receipt: async () => ({ valid: true, errors: [] }),
    verifyOpenTimestamps: async () => ({ valid: true }),
  });
  assert.equal(rejectedBundle.valid, false);
  assert.ok(rejectedBundle.errors.some((error) => ['record_digest_mismatch', 'event_hash_mismatch'].includes(error.code)));

  const seller = testEnvironment.authenticatedContext(sellerUid).firestore();
  const buyer = testEnvironment.authenticatedContext(buyerUid).firestore();
  const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
  await assertSucceeds(getDoc(doc(seller, 'cartularyTransfers', 'transfer_full_success_001')));
  await assertSucceeds(getDoc(doc(buyer, 'cartularyTransfers', 'transfer_full_success_001')));
  await assertFails(getDoc(doc(outsider, 'cartularyTransfers', 'transfer_full_success_001')));
  await assertSucceeds(getDoc(doc(seller, 'transferPrivateArchives', 'transfer_full_success_001')));
  await assertFails(getDoc(doc(buyer, 'transferPrivateArchives', 'transfer_full_success_001')));
  await assertFails(getDoc(doc(outsider, 'transferPrivateArchives', 'transfer_full_success_001')));
  await assertSucceeds(getDoc(doc(buyer, 'integrityBatches', sealing.batchId)));
  await assertSucceeds(getDocs(collection(buyer, 'integrityBatches', sealing.batchId, 'receipts')));
});

test('une action unilatérale est refusée et le refus contradictoire ferme la proposition de façon idempotente', async () => {
  await proposeCartularyTransfer({
    firestore,
    transferId: 'transfer_rejection_case_001',
    cartularyId: IWC_CARTULARY_ID,
    sellerUid,
    buyerUid,
    requestId: 'transfer_propose_reject_001',
    expectedRevision: 1,
    occurredAt: '2026-08-17T09:00:00.000Z',
    expiresAt: '2026-08-24T09:00:00.000Z',
  });
  const seller = testEnvironment.authenticatedContext(sellerUid).firestore();
  await assertFails(setDoc(doc(seller, 'cartularyTransferRequests', 'transfer_request_aaaaaaaaaaaaaaaaaaaaaaaa'), {
    requestDocumentId: 'transfer_request_aaaaaaaaaaaaaaaaaaaaaaaa',
    requestId: 'transfer_request_aaaaaaaaaaaaaaaaaaaaaaaa',
    transferId: 'transfer_rejection_case_001',
    cartularyId: IWC_CARTULARY_ID,
    ownerUid: sellerUid,
    counterpartyUid: buyerUid,
    action: 'accept',
    expectedRevision: 2,
    decisionSource: 'human_confirmed',
    expiresAtIso: null,
    status: 'pending',
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  const rejected = await rejectCartularyTransfer({
    firestore,
    transferId: 'transfer_rejection_case_001',
    buyerUid,
    requestId: 'transfer_reject_confirmed_001',
    expectedRevision: 2,
    occurredAt: '2026-08-17T09:05:00.000Z',
  });
  const replay = await rejectCartularyTransfer({
    firestore,
    transferId: 'transfer_rejection_case_001',
    buyerUid,
    requestId: 'transfer_reject_confirmed_001',
    expectedRevision: 2,
    occurredAt: '2026-08-17T09:05:00.000Z',
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(replay.replayed, true);
  const root = await firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  assert.equal(root.data().accountHolderId, sellerUid);
  assert.equal(root.data().currentTransferId, null);
  const events = await firestore.collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`).get();
  assert.equal(events.docs.filter((event) => event.data().action === 'cartulary.transfer.rejected').length, 1);
});

test('une proposition expirée est close sans transfert de propriété', async () => {
  await proposeCartularyTransfer({
    firestore,
    transferId: 'transfer_expiration_case_001',
    cartularyId: IWC_CARTULARY_ID,
    sellerUid,
    buyerUid,
    requestId: 'transfer_propose_expire_001',
    expectedRevision: 1,
    occurredAt: '2026-08-17T10:00:00.000Z',
    expiresAt: '2026-08-17T11:00:00.000Z',
  });
  const ignored = await expireCartularyTransfer({
    firestore,
    transferId: 'transfer_expiration_case_001',
    occurredAt: '2026-08-17T10:30:00.000Z',
  });
  const expired = await expireCartularyTransfer({
    firestore,
    transferId: 'transfer_expiration_case_001',
    occurredAt: '2026-08-17T11:01:00.000Z',
  });
  const replay = await expireCartularyTransfer({
    firestore,
    transferId: 'transfer_expiration_case_001',
    occurredAt: '2026-08-17T11:02:00.000Z',
  });
  assert.equal(ignored.reason, 'not_expired');
  assert.equal(expired.status, 'expired');
  assert.equal(replay.reason, 'expired');
  const root = await firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  assert.equal(root.data().accountHolderId, sellerUid);
  assert.equal(root.data().transferStatus, 'expired');
  assert.equal(root.data().currentTransferId, null);
});
