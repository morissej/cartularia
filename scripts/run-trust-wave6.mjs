import { writeFileSync } from 'node:fs';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CAR_DEMO_CARTULARY_ID } from '../src/migrations/carDemoImport.ts';
import { IWC_CARTULARY_ID, IWC_IMPORT_ACTOR_ID } from '../src/migrations/iwcImport.ts';
import { DeterministicTimestampAdapter, toPublicAnchorPayload } from './lib/trust-adapters.mjs';
import {
  applyRevisionedIntegrityProjection,
  attachTimestampReceipt,
  createCartularyExport,
  createIntegrityBatch,
} from './lib/trust-command.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');
if (!usesEmulator && !allowRemote) {
  throw new Error('Vague 6 interrompue : utilisez l’émulateur ou passez explicitement --allow-remote.');
}

const app = getApps()[0] || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const firestore = getFirestore(app);

const exported = await createCartularyExport({
  firestore,
  exportId: 'export_iwc_wave6_portable_v1',
  cartularyId: IWC_CARTULARY_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  requestId: 'wave6-export-iwc-portable-v1',
  expectedRevision: 3,
  occurredAt: '2026-08-14T16:00:00.000Z',
});

const [iwcRoot, carRoot] = await Promise.all([
  firestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get(),
  firestore.doc(`cartularies/${CAR_DEMO_CARTULARY_ID}`).get(),
]);
const batch = await createIntegrityBatch({
  firestore,
  batchId: 'batch_wave6_pilot_20260814',
  cartularyIds: [IWC_CARTULARY_ID, CAR_DEMO_CARTULARY_ID],
  actorId: IWC_IMPORT_ACTOR_ID,
  requestId: 'wave6-create-integrity-batch-v1',
  occurredAt: '2026-08-14T16:05:00.000Z',
});
const timestampReceipt = await new DeterministicTimestampAdapter().issue({
  digest: batch.merkleRoot,
  requestId: 'wave6-timestamp-batch-v1',
  issuedAt: '2026-08-14T16:06:00.000Z',
});
const timestamp = await attachTimestampReceipt({
  firestore,
  batchId: batch.batchId,
  actorId: IWC_IMPORT_ACTOR_ID,
  requestId: 'wave6-attach-timestamp-v1',
  receipt: timestampReceipt,
});
const projections = await Promise.all([
  applyRevisionedIntegrityProjection({
    firestore,
    cartularyId: IWC_CARTULARY_ID,
    sourceRevision: iwcRoot.data().revision,
    integrityHead: iwcRoot.data().integrityHead,
    batchId: batch.batchId,
  }),
  applyRevisionedIntegrityProjection({
    firestore,
    cartularyId: CAR_DEMO_CARTULARY_ID,
    sourceRevision: carRoot.data().revision,
    integrityHead: carRoot.data().integrityHead,
    batchId: batch.batchId,
  }),
]);

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
if (outputArgument) {
  const outputPath = outputArgument.slice('--output='.length);
  writeFileSync(outputPath, `${JSON.stringify(exported.portableBundle, null, 2)}\n`, { flag: 'wx' });
}

console.log(JSON.stringify({
  export: {
    exportId: exported.exportId,
    status: exported.status,
    sourceRevision: exported.revision,
    complete: exported.manifest.complete,
    pendingAssetCount: exported.manifest.pendingAssetCount,
    replayed: exported.replayed,
  },
  batch,
  timestamp,
  publicAnchorPayload: toPublicAnchorPayload({
    algorithm: 'sha256-binary-merkle-v1',
    canonicalizationVersion: 'jcs-1',
    merkleRoot: batch.merkleRoot,
    leafCount: batch.leafCount,
  }),
  publicAnchoringStatus: 'deferred',
  projections,
}, null, 2));
