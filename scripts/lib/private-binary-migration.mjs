import { assertPrivateBinaryOriginal, inspectPrivateBinaryOriginal, privateBinaryIsVerified, processPrivateDraftUpload } from './private-upload-command.mjs';

const segment = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
export const PRIVATE_BINARY_MIGRATION_HELP = `Usage: node scripts/migrate-private-binary-verification.mjs
  --project <id> --bucket <bucket> --uid <uid> --cartulary <id>
  --binary <id> [--binary <id> ...] [--apply]

Dry-run by default: inspect the explicitly selected originals without remote writes.
At most 100 binary IDs, all in one owner's private Cartulaire, per invocation.
--apply re-verifies the originals and writes server attestations and presentation derivatives.
Original objects are never rewritten or deleted. No project/bucket environment fallback.
`;

export function parsePrivateBinaryMigrationArgs(argv) {
  const options = { apply: false, binaryIds: [] };
  const seen = new Set();
  const names = { '--project': 'projectId', '--bucket': 'bucketName', '--uid': 'uid', '--cartulary': 'cartularyId' };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (name === '--help') return { help: true };
    if (name === '--apply') {
      if (seen.has(name)) throw new Error('Argument répété : --apply.');
      seen.add(name); options.apply = true; continue;
    }
    if (name !== '--binary' && !Object.hasOwn(names, name)) throw new Error(`Argument inconnu : ${name}.`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Valeur manquante : ${name}.`);
    if (name === '--binary') options.binaryIds.push(value);
    else {
      if (seen.has(name)) throw new Error(`Argument répété : ${name}.`);
      seen.add(name); options[names[name]] = value;
    }
  }
  validateMigrationOptions(options);
  return options;
}

function validateMigrationOptions({ projectId, bucketName, uid, cartularyId, binaryIds, apply }) {
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new Error('Projet explicite requis.');
  if (typeof bucketName !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketName)) throw new Error('Bucket explicite requis.');
  if (!segment(uid) || !segment(cartularyId)) throw new Error('Propriétaire et Cartulaire explicites requis.');
  if (!Array.isArray(binaryIds) || binaryIds.length < 1 || binaryIds.length > 100 || binaryIds.some((id) => !segment(id)) || new Set(binaryIds).size !== binaryIds.length) throw new Error('Sélectionnez entre 1 et 100 identifiants binaires distincts.');
  if (typeof apply !== 'boolean') throw new Error('Le mode d’écriture doit être explicite.');
}

/** Narrow, repeatable migration. Dates and legacy ready/accepted flags never establish trust. */
export async function migratePrivateBinaryVerification({ firestore, storage, ...options }) {
  validateMigrationOptions(options);
  const { projectId, bucketName, uid, cartularyId, binaryIds, apply } = options;
  for (const actual of [firestore?.projectId, storage?.app?.options?.projectId].filter(Boolean)) {
    if (actual !== projectId) throw new Error('Client Firebase différent du projet demandé.');
  }
  const bucket = storage.bucket(bucketName);
  if (bucket.name !== bucketName) throw new Error('Bucket différent de la cible demandée.');
  const results = [];
  for (const binaryId of binaryIds) {
    const ref = firestore.doc(`privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${binaryId}`);
    try {
      const snapshot = await ref.get();
      if (!snapshot.exists) { results.push({ binaryId, status: 'blocked', reason: 'manifest_missing' }); continue; }
      const manifest = snapshot.data();
      if (manifest.deleted !== false) { results.push({ binaryId, status: 'skipped', reason: 'deleted' }); continue; }
      if (privateBinaryIsVerified(manifest)) {
        await assertPrivateBinaryOriginal({ bucket, manifest, uid, cartularyId, binaryId });
        results.push({ binaryId, status: 'unchanged' }); continue;
      }
      // Inspection writes only into a temporary local directory and checks the pinned original.
      const { metadata } = await inspectPrivateBinaryOriginal({ bucket, manifest, uid, cartularyId, binaryId });
      if (!apply) { results.push({ binaryId, status: 'would_verify' }); continue; }
      // The normal server pipeline re-reads both sources and compares identity transactionally.
      const outcome = await processPrivateDraftUpload({ firestore, storage, object: { ...metadata, bucket: bucketName, name: manifest.storagePath } });
      results.push({ binaryId, status: outcome.status === 'accepted' ? 'verified' : 'blocked', ...(outcome.reason ? { reason: outcome.reason } : {}) });
    } catch (error) {
      results.push({ binaryId, status: 'blocked', reason: typeof error?.code === 'string' ? error.code : 'verification_failed' });
    }
  }
  const counts = { examined: results.length, verified: 0, would_verify: 0, unchanged: 0, skipped: 0, blocked: 0 };
  for (const result of results) counts[result.status] += 1;
  return { projectId, bucketName, uid, cartularyId, mode: apply ? 'apply' : 'dry-run', counts, results };
}
