import { randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { listCartulariesToUpgrade, resolveUpgradeTarget, upgradeCartularySchema } from './lib/schema-upgrade-command.mjs';

/**
 * Remonte un ou plusieurs Cartulaires vers la version de création du catalogue (ADR-031).
 *   node scripts/upgrade-cartulary-schema.mjs --cartulary <id> [--target x.y.z] [--dry-run]
 *   node scripts/upgrade-cartulary-schema.mjs --all --schema watch [--target x.y.z] [--dry-run]
 */
const argument = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const cartularyId = argument('--cartulary');
const schemaId = argument('--schema');
const targetVersion = argument('--target');
const all = process.argv.includes('--all');
const dryRun = process.argv.includes('--dry-run');
const allowRemote = process.argv.includes('--allow-remote');
const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'cartularia-wave2-local';
const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

if (!usesEmulator && !allowRemote && !dryRun) {
  throw new Error('Remontée interrompue : utilisez l’émulateur Firestore, --dry-run ou passez explicitement --allow-remote.');
}
if (!cartularyId && !(all && schemaId)) {
  throw new Error('Indiquez --cartulary <id>, ou --all --schema <schemaId>.');
}

const app = getApps()[0] || initializeApp({ projectId, ...(usesEmulator ? {} : { credential: applicationDefault() }) });
const firestore = getFirestore(app);
const batchId = randomUUID().replaceAll('-', '').slice(0, 12);

const targets = cartularyId
  ? [{ cartularyId }]
  : await listCartulariesToUpgrade({ firestore, schemaId, targetVersion: targetVersion || (await resolveUpgradeTarget({ firestore, schemaId })).version });

const results = [];
for (const [index, target] of targets.entries()) {
  try {
    results.push(await upgradeCartularySchema({
      firestore,
      cartularyId: target.cartularyId,
      targetVersion,
      requestId: `schema_upgrade_${batchId}_${index}`,
      dryRun,
    }));
  } catch (error) {
    results.push({ cartularyId: target.cartularyId, status: 'failed', code: error?.code, message: error?.message });
  }
}

console.log(JSON.stringify({ event: 'CARTULARY_SCHEMA_UPGRADE', projectId, dryRun, count: results.length, results }, null, 2));
if (results.some((result) => result.status === 'failed')) process.exitCode = 1;
