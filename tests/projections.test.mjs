import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import {
  buildIwcImportBundle,
  IWC_CARTULARY_ID,
  IWC_IMPORT_ACTOR_ID,
  IWC_IMPORT_DATE,
  IWC_IMPORT_REQUEST_ID,
} from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import {
  createReportProjection,
  projectRegistryItem,
  publishPublicBlocks,
  recordProjectionApproval,
  revokePublicPublication,
} from '../scripts/lib/projection-command.mjs';

const projectId = 'cartularia-wave3-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const publicCode = 'OP-4892-XZ9';

let adminApp;
let adminFirestore;
let testEnvironment;

const seedFoundations = async () => {
  const now = new Date('2026-08-14T08:00:00.000Z');
  await Promise.all([
    adminFirestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active', createdAt: now }),
    adminFirestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee',
      organizationId: 'org_demo',
      status: 'active',
      visibility: 'secret',
      itemCount: 0,
    }),
    adminFirestore.doc('organizations/org_demo/memberships/wave1-owner').set({
      uid: 'wave1-owner',
      organizationId: 'org_demo',
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: [
        'organization.read',
        'membership.read',
        'registry.read',
        'cartulary.read',
        'cartulary.edit',
        'publication.manage',
      ],
    }),
    adminFirestore.doc('organizations/org_isolation').set({ id: 'org_isolation', status: 'active' }),
    adminFirestore.doc('organizations/org_isolation/memberships/wave1-outsider').set({
      uid: 'wave1-outsider',
      organizationId: 'org_isolation',
      roles: ['account_holder'],
      status: 'active',
      scopes: { registryIds: ['reg_isolation'] },
      permissions: ['organization.read', 'registry.read', 'cartulary.read'],
    }),
    adminFirestore.doc('schemaCatalog/watch/versions/1.3.0').set({
      schemaId: 'watch',
      assetType: 'watch',
      version: '1.3.0',
      status: 'baseline',
    }),
  ]);
};

const importIwc = () => importCartularyBundle({
  firestore: adminFirestore,
  bundle: buildIwcImportBundle(),
  requestId: IWC_IMPORT_REQUEST_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  expectedRevision: 0,
  occurredAt: IWC_IMPORT_DATE,
});

const safePublicBlocks = () => [
  {
    id: 'cover-watch',
    title: "Identité de l’objet",
    payload: {
      eyebrow: 'IWC Schaffhausen',
      heading: 'Flieger UTC',
      facts: [
        { label: 'Référence', value: 'IW3251-001' },
        { label: 'Année', value: '2002' },
      ],
    },
  },
  {
    id: 'media-hero',
    title: 'Présentation',
    payload: {
      eyebrow: 'Montre de collection',
      heading: 'IWC Flieger UTC',
      paragraphs: ['Montre d’aviateur automatique en acier de 39 mm.'],
    },
    assetRefs: [{ assetId: 'ref-front', derivativeId: 'web-v1' }],
  },
  {
    id: 'reference-specs',
    title: 'Spécifications',
    payload: {
      heading: 'Spécifications de référence',
      groups: [{
        title: 'Boîtier',
        items: [
          { label: 'Diamètre', value: '39 mm' },
          { label: 'Matériau', value: 'Acier' },
        ],
      }],
    },
  },
  {
    id: 'condition-summary',
    title: 'État actuel',
    payload: {
      heading: 'État actuel',
      paragraphs: ['Synthèse examinée et sélectionnée pour cette projection.'],
      facts: [{ label: 'Conclusion', value: 'Bon état cohérent' }],
    },
  },
];

const seedPublicDerivative = async () => {
  await adminFirestore
    .doc(`cartularies/${IWC_CARTULARY_ID}/assets/ref-front/derivatives/web-v1`)
    .set({
      assetId: 'ref-front',
      derivativeId: 'web-v1',
      mediaKind: 'image',
      mimeDetected: 'image/webp',
      visibility: 'public',
      processingState: 'ready',
      publicCode,
      storagePath: `public/${publicCode}/ref-front/web-v1`,
      sha256: `sha256:${'a'.repeat(64)}`,
    });
};

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
  adminApp = getApps().find((app) => app.name === 'wave3-test-admin') || initializeApp({ projectId }, 'wave3-test-admin');
  adminFirestore = getFirestore(adminApp);
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedFoundations();
  await importIwc();
});

test('le Registre reçoit une projection privée minimale et isolée', async () => {
  const result = await projectRegistryItem({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-registry-projection-v1',
    expectedRevision: 1,
    occurredAt: '2026-08-14T10:00:00.000Z',
  });
  const item = await adminFirestore.doc(`registries/reg_collection_privee/items/${IWC_CARTULARY_ID}`).get();
  const itemText = JSON.stringify(item.data()).toLowerCase();
  const ownerFirestore = testEnvironment.authenticatedContext('wave1-owner').firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext('wave1-outsider').firestore();

  assert.equal(result.revision, 2);
  assert.equal(item.data().sourceRevision, 2);
  assert.equal(item.data().displayTitle, 'IWC Flieger UTC');
  for (const forbidden of ['serial', 'owner', 'acquisition', 'storage', 'address']) {
    assert.equal(itemText.includes(forbidden), false);
  }
  await assertSucceeds(getDoc(doc(ownerFirestore, 'registries', 'reg_collection_privee', 'items', IWC_CARTULARY_ID)));
  await assertSucceeds(getDocs(collection(ownerFirestore, 'registries', 'reg_collection_privee', 'items')));
  await assertFails(getDoc(doc(outsiderFirestore, 'registries', 'reg_collection_privee', 'items', IWC_CARTULARY_ID)));
});

test('quatre blocs W et un dérivé séparé sont publics, idempotents et scellés', async () => {
  await seedPublicDerivative();
  await projectRegistryItem({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-registry-before-public-v1',
    expectedRevision: 1,
    occurredAt: '2026-08-14T10:00:00.000Z',
  });
  await recordProjectionApproval({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-public-safe-v1',
    audience: 'public',
    blocks: safePublicBlocks(),
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-approve-public-safe-v1',
    expectedRevision: 2,
    occurredAt: '2026-08-14T10:05:00.000Z',
  });
  const first = await publishPublicBlocks({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-public-safe-v1',
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-publish-public-safe-v1',
    expectedRevision: 3,
    occurredAt: '2026-08-14T10:10:00.000Z',
  });
  const replay = await publishPublicBlocks({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-public-safe-v1',
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-publish-public-safe-v1',
    expectedRevision: 3,
    occurredAt: '2026-08-14T10:10:00.000Z',
  });
  const anonymousFirestore = testEnvironment.unauthenticatedContext().firestore();
  const publication = await assertSucceeds(getDoc(doc(anonymousFirestore, 'publications', publicCode)));
  const blocks = await assertSucceeds(getDocs(collection(anonymousFirestore, 'publications', publicCode, 'blocks')));
  const seal = await assertSucceeds(getDoc(doc(anonymousFirestore, 'seals', publicCode)));
  const publicText = JSON.stringify({ publication: publication.data(), blocks: blocks.docs.map((item) => item.data()) })
    .toLowerCase();

  assert.equal(first.revision, 4);
  assert.equal(replay.replayed, true);
  assert.equal(blocks.size, 4);
  assert.equal(publication.data().assetCount, 1);
  assert.equal(seal.data().contentHash, publication.data().contentHash);
  assert.equal(publicText.includes('/private/'), false);
  assert.equal(publicText.includes('serialnumber'), false);
  assert.equal(publicText.includes('acquisitionprice'), false);
  assert.equal(publicText.includes('accountHolderId'.toLowerCase()), false);
  assert.match(publicText, new RegExp(`public/${publicCode.toLowerCase()}/ref-front/web-v1`));
  await assertFails(getDoc(doc(anonymousFirestore, 'cartularies', IWC_CARTULARY_ID)));
});

test('owner, transmission, stockage et champ Secret sont refusés avant toute écriture', async () => {
  await assert.rejects(
    () => recordProjectionApproval({
      firestore: adminFirestore,
      cartularyId: IWC_CARTULARY_ID,
      approvalId: 'approval-owner-forbidden-v1',
      audience: 'public',
      blocks: [
        ...safePublicBlocks().slice(0, 3),
        { id: 'cover-owner', title: 'Propriétaire', payload: { heading: 'Identité' } },
      ],
      actorId: IWC_IMPORT_ACTOR_ID,
      requestId: 'wave3-approve-owner-forbidden-v1',
      expectedRevision: 1,
    }),
    (error) => error.code === 'block_not_allowlisted',
  );
  await assert.rejects(
    () => recordProjectionApproval({
      firestore: adminFirestore,
      cartularyId: IWC_CARTULARY_ID,
      approvalId: 'approval-report-owner-forbidden-v1',
      audience: 'report',
      blocks: [{ id: 'cover-owner', title: 'Propriétaire', payload: { heading: 'Identité' } }],
      actorId: IWC_IMPORT_ACTOR_ID,
      requestId: 'wave3-approve-report-owner-forbidden-v1',
      expectedRevision: 1,
    }),
    (error) => error.code === 'block_not_allowlisted',
  );
  await assert.rejects(
    () => recordProjectionApproval({
      firestore: adminFirestore,
      cartularyId: IWC_CARTULARY_ID,
      approvalId: 'approval-secret-field-v1',
      audience: 'public',
      blocks: safePublicBlocks().map((block, index) => index === 0
        ? { ...block, payload: { ...block.payload, serialNumber: 'interdit' } }
        : block),
      actorId: IWC_IMPORT_ACTOR_ID,
      requestId: 'wave3-approve-secret-field-v1',
      expectedRevision: 1,
    }),
    (error) => error.code === 'secret_field_detected',
  );
  const approvals = await adminFirestore.collection(`cartularies/${IWC_CARTULARY_ID}/publicationApprovals`).get();
  assert.equal(approvals.empty, true);
});

test('la révocation invalide publication, blocs, Sceau et futures lectures anonymes', async () => {
  await seedPublicDerivative();
  await recordProjectionApproval({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-revoke-safe-v1',
    audience: 'public',
    blocks: safePublicBlocks(),
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-approve-revoke-safe-v1',
    expectedRevision: 1,
    occurredAt: '2026-08-14T11:00:00.000Z',
  });
  await publishPublicBlocks({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-revoke-safe-v1',
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-publish-revoke-safe-v1',
    expectedRevision: 2,
    occurredAt: '2026-08-14T11:05:00.000Z',
  });
  const result = await revokePublicPublication({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-revoke-public-safe-v1',
    expectedRevision: 3,
    occurredAt: '2026-08-14T11:10:00.000Z',
  });
  const anonymousFirestore = testEnvironment.unauthenticatedContext().firestore();

  assert.equal(result.revision, 4);
  assert.equal(result.revokedBlockCount, 4);
  await assertFails(getDoc(doc(anonymousFirestore, 'publications', publicCode)));
  await assertFails(getDoc(doc(anonymousFirestore, 'publications', publicCode, 'blocks', 'cover-watch')));
  await assertFails(getDoc(doc(anonymousFirestore, 'seals', publicCode)));
  const publicationAdmin = await adminFirestore.doc(`publications/${publicCode}`).get();
  const sealAdmin = await adminFirestore.doc(`seals/${publicCode}`).get();
  assert.equal(publicationAdmin.data().status, 'revoked');
  assert.equal(sealAdmin.data().status, 'revoked');
  assert.equal((await publicationAdmin.ref.collection('blocks').get()).empty, true);
});

test('une sélection R approuvée produit un rapport privé daté et empreinté', async () => {
  const reportBlocks = [
    {
      id: 'value-market',
      title: 'Marché',
      payload: { heading: 'Valeur de travail', facts: [{ label: 'Devise', value: 'EUR' }] },
    },
    {
      id: 'condition-summary',
      title: 'État',
      payload: { heading: 'Synthèse de l’état', paragraphs: ['Contenu réservé au rapport.'] },
    },
  ];
  await recordProjectionApproval({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-report-owner-v1',
    audience: 'report',
    blocks: reportBlocks,
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-approve-report-owner-v1',
    expectedRevision: 1,
    occurredAt: '2026-08-14T12:00:00.000Z',
  });
  const first = await createReportProjection({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-report-owner-v1',
    reportId: 'report-owner-20260814',
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-create-report-owner-v1',
    expectedRevision: 2,
    occurredAt: '2026-08-14T12:05:00.000Z',
  });
  const replay = await createReportProjection({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-report-owner-v1',
    reportId: 'report-owner-20260814',
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-create-report-owner-v1',
    expectedRevision: 2,
    occurredAt: '2026-08-14T12:05:00.000Z',
  });
  const ownerFirestore = testEnvironment.authenticatedContext('wave1-owner').firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext('wave1-outsider').firestore();
  const anonymousFirestore = testEnvironment.unauthenticatedContext().firestore();
  const reportPath = ['cartularies', IWC_CARTULARY_ID, 'reportProjections', 'report-owner-20260814'];

  assert.equal(first.revision, 3);
  assert.equal(replay.replayed, true);
  await assertSucceeds(getDoc(doc(ownerFirestore, ...reportPath)));
  await assertFails(getDoc(doc(outsiderFirestore, ...reportPath)));
  await assertFails(getDoc(doc(anonymousFirestore, ...reportPath)));
  const report = await adminFirestore.doc(reportPath.join('/')).get();
  assert.equal(report.data().publicationStatus, 'generated');
  assert.equal(report.data().blockIds.length, 2);
  assert.match(report.data().contentHash, /^sha256:[a-f0-9]{64}$/);
});

test('les commandes sensibles incrémentent la révision et chaînent les événements', async () => {
  await projectRegistryItem({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-chain-registry-v1',
    expectedRevision: 1,
    occurredAt: '2026-08-14T13:00:00.000Z',
  });
  await recordProjectionApproval({
    firestore: adminFirestore,
    cartularyId: IWC_CARTULARY_ID,
    approvalId: 'approval-chain-report-v1',
    audience: 'report',
    blocks: [{ id: 'condition-summary', title: 'État', payload: { heading: 'État' } }],
    actorId: IWC_IMPORT_ACTOR_ID,
    requestId: 'wave3-chain-approval-v1',
    expectedRevision: 2,
    occurredAt: '2026-08-14T13:05:00.000Z',
  });
  const root = await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  const events = await adminFirestore
    .collection(`cartularies/${IWC_CARTULARY_ID}/auditEvents`)
    .orderBy('sequence', 'asc')
    .get();

  assert.equal(root.data().revision, 3);
  assert.equal(root.data().integritySequence, 3);
  assert.equal(events.size, 3);
  for (let index = 1; index < events.docs.length; index += 1) {
    assert.equal(events.docs[index].data().previousEventHash, events.docs[index - 1].data().hash);
  }
  assert.equal(root.data().integrityHead, events.docs.at(-1).data().hash);
});
