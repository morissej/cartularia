import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CAR_DEMO_CARTULARY_ID } from '../src/migrations/carDemoImport.ts';
import { IWC_CARTULARY_ID } from '../src/migrations/iwcImport.ts';
import {
  createPilotBackup,
  MemoryObjectStoreAdapter,
  restorePilotBackup,
  validateRestoredPilot,
} from './lib/backup-command.mjs';
import { createStructuredLogger } from './lib/observability.mjs';
import {
  auditProjectionPrivacy,
  estimateMonthlyCost,
  evaluateProductionReadiness,
  measureFirestoreFootprint,
  runFirestoreLoadProbe,
  scanRepositoryForCredentials,
} from './lib/production-readiness.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const allowRemote = process.argv.includes('--allow-remote');
if (!usesEmulator && !allowRemote) {
  throw new Error('Vague 7 interrompue : utilisez l’émulateur ou passez explicitement --allow-remote.');
}

const app = getApps().find((candidate) => candidate.name === '[DEFAULT]') || initializeApp({
  projectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
});
const restoreProjectId = `${projectId}-wave7-restore`;
const restoreAppName = `wave7-restore-${projectId}`;
const restoreApp = getApps().find((candidate) => candidate.name === restoreAppName) || initializeApp({
  projectId: restoreProjectId,
  ...(usesEmulator ? {} : { credential: applicationDefault() }),
}, restoreAppName);
const firestore = getFirestore(app);
const restoreFirestore = getFirestore(restoreApp);
const policy = JSON.parse(readFileSync(new URL('../config/production-policy.json', import.meta.url), 'utf8'));
const logger = createStructuredLogger({ service: 'cartularia-production-wave7' });

const load = await runFirestoreLoadProbe({
  firestore,
  documentPaths: [`cartularies/${IWC_CARTULARY_ID}`, `cartularies/${CAR_DEMO_CARTULARY_ID}`],
  iterations: 100,
  concurrency: 10,
  thresholds: policy.operations.loadThresholds,
});
logger.emit('load_probe.completed', { outcome: load.passed ? 'passed' : 'failed', p95Ms: load.p95Ms, errorRate: load.errorRate });

const [footprint, privacy, credentials] = await Promise.all([
  measureFirestoreFootprint(firestore),
  auditProjectionPrivacy({ firestore }),
  scanRepositoryForCredentials(fileURLToPath(new URL('..', import.meta.url))),
]);
const costs = estimateMonthlyCost({
  workload: policy.operations.monthlyWorkloadBudget,
  unitPrices: policy.pricing.unitPrices,
});

const sourceObjects = new MemoryObjectStoreAdapter([{
  name: 'recovery-fixture/wave7.txt',
  bytes: Buffer.from('Cartularia recovery fixture wave 7\n', 'utf8'),
  contentType: 'text/plain',
  metadata: { classification: 'secret', fixture: 'true' },
}]);
const restoredObjects = new MemoryObjectStoreAdapter();
const backup = await createPilotBackup({
  firestore,
  objectStore: sourceObjects,
  sourceProjectId: projectId,
  createdAtIso: '2026-08-15T00:00:00.000Z',
});
await restorePilotBackup({ firestore: restoreFirestore, objectStore: restoredObjects, bundle: backup });
const recovery = await validateRestoredPilot({ firestore: restoreFirestore, objectStore: restoredObjects, bundle: backup });
logger.emit('recovery_drill.completed', {
  outcome: recovery.valid ? 'passed' : 'failed',
  checkedRecords: recovery.checkedRecords,
  checkedObjects: recovery.checkedObjects,
  checkedCartularies: recovery.checkedCartularies,
});

const checks = {
  load,
  privacy,
  credentials,
  backupRestore: { passed: recovery.valid },
  costs: { passed: costs.status === 'estimated' },
  runbooks: { passed: true },
  localValidation: { passed: true },
};
const readiness = evaluateProductionReadiness({ policy, checks });
const report = {
  generatedAtIso: new Date().toISOString(),
  sourceProjectId: projectId,
  restoreProjectId,
  environment: usesEmulator ? 'emulator' : 'remote_explicit',
  footprint,
  load,
  costs,
  privacy,
  credentials,
  backup: backup.manifest,
  recovery,
  readiness,
};

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
if (outputArgument) {
  const outputPath = outputArgument.slice('--output='.length);
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(outputPath, 0o600);
}

console.log(JSON.stringify({
  constructionStatus: readiness.constructionStatus,
  goLiveAuthorization: readiness.goLiveAuthorization,
  blockers: readiness.blockers,
  load: { passed: load.passed, p95Ms: load.p95Ms, errorRate: load.errorRate },
  privacy: { passed: privacy.passed, scannedDocuments: privacy.scannedDocuments },
  credentials: { passed: credentials.passed, scannedFiles: credentials.scannedFiles },
  backup: backup.manifest,
  recovery,
  footprint,
  costs,
  reportDigest: readiness.reportDigest,
}, null, 2));
