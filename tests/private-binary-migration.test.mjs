import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  migratePrivateBinaryVerification,
  parsePrivateBinaryMigrationArgs,
} from '../scripts/lib/private-binary-migration.mjs';
import { privateBinaryIsVerified } from '../scripts/lib/private-upload-command.mjs';
import { createMemoryFirestore } from './helpers/memory-firestore.mjs';

const projectId = 'demo-cartularia-migration';
const bucketName = `${projectId}.appspot.com`;
const uid = 'migration-owner';
const cartularyId = 'migration-cartulary';
const binaryId = 'binary-historical';
const options = { projectId, bucketName, uid, cartularyId, binaryIds: [binaryId], apply: false };
const cliArgs = ['--project', projectId, '--bucket', bucketName, '--uid', uid, '--cartulary', cartularyId];
const manifestPath = (id = binaryId) => `privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${id}`;
const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function fixture({ missingOriginal = false, manifestPatch = {}, corruptOriginal = false } = {}) {
  const original = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#79603c' } }).jpeg().toBuffer();
  const storagePath = `private-drafts/${uid}/${cartularyId}/${binaryId}/${digestOf(original).slice(7)}/original`;
  const manifest = {
    ownerUid: uid, cartularyId, binaryId, kind: 'media', fileName: 'original.jpg', mimeType: 'image/jpeg',
    size: original.length, sha256: digestOf(original), storagePath, deleted: false,
    uploadStatus: 'ready', clientUpdatedAt: 0, revision: 1, ...manifestPatch,
  };
  const firestore = createMemoryFirestore({
    [manifestPath()]: manifest,
    [manifestPath('binary-outside-selection')]: { note: 'Do not inspect or change this record.' },
  });
  firestore.projectId = projectId;
  const writes = [];
  const reads = [];
  const originalDoc = firestore.doc;
  firestore.doc = (path) => {
    const reference = originalDoc(path);
    return {
      ...reference,
      get: async () => { reads.push(path); return reference.get(); },
      ...Object.fromEntries(['set', 'update', 'create', 'delete'].map((method) => [method, async (...args) => {
        writes.push({ method, path }); return reference[method](...args);
      }])),
    };
  };
  const runTransaction = firestore.runTransaction;
  firestore.runTransaction = (callback) => runTransaction((transaction) => callback({
    ...transaction,
    ...Object.fromEntries(['set', 'update', 'create', 'delete'].map((method) => [method, (ref, ...args) => {
      writes.push({ method: `transaction.${method}`, path: ref.path });
      return transaction[method](ref, ...args);
    }])),
  }));
  const blobs = new Map();
  const storageEvents = [];
  let generation = 100;
  const makeBlob = (path, bytes, metadata, currentGeneration = String(++generation)) => ({
    bytes: Buffer.from(bytes),
    metadata: { ...metadata, name: path, bucket: bucketName, size: String(bytes.length), generation: currentGeneration },
  });
  if (!missingOriginal) {
    const bytes = Buffer.from(original);
    if (corruptOriginal) bytes[bytes.length - 1] ^= 1;
    blobs.set(storagePath, makeBlob(storagePath, bytes, {
      contentType: 'image/jpeg',
      metadata: { ownerUid: uid, cartularyId, binaryId, sha256: digestOf(original), kind: 'media', originalFileName: 'original.jpg' },
    }));
  }
  const bucket = {
    name: bucketName,
    file: (path, { generation: selectedGeneration } = {}) => {
      const read = () => {
        const blob = blobs.get(path);
        if (!blob || (selectedGeneration !== undefined && selectedGeneration !== blob.metadata.generation)) {
          throw Object.assign(new Error('Missing original generation.'), { code: 404 });
        }
        return blob;
      };
      return {
        name: path,
        getMetadata: async () => { storageEvents.push({ method: 'metadata', path }); return [structuredClone(read().metadata)]; },
        download: async ({ destination } = {}) => {
          storageEvents.push({ method: 'download', path, generation: selectedGeneration });
          const bytes = read().bytes;
          if (destination) { await writeFile(destination, bytes); return []; }
          return [Buffer.from(bytes)];
        },
        save: async (bytes, settings) => {
          storageEvents.push({ method: 'save', path });
          blobs.set(path, makeBlob(path, bytes, settings?.metadata));
        },
        delete: async () => { storageEvents.push({ method: 'delete', path }); blobs.delete(path); },
        exists: async () => [blobs.has(path)],
      };
    },
  };
  const storage = { app: { options: { projectId } }, bucket: (name = bucketName) => {
    assert.equal(name, bucketName); return bucket;
  } };
  return { firestore, storage, bucket, original, storagePath, manifest, blobs, writes, reads, storageEvents };
}

test('migration CLI : cible complète obligatoire, simulation par défaut et apply explicite', () => {
  assert.deepEqual(parsePrivateBinaryMigrationArgs([...cliArgs, '--binary', binaryId]), options);
  assert.equal(parsePrivateBinaryMigrationArgs([...cliArgs, '--binary', binaryId, '--apply']).apply, true);
  for (const name of ['--project', '--bucket', '--uid', '--cartulary']) {
    const index = cliArgs.indexOf(name);
    const incomplete = cliArgs.filter((_, position) => position !== index && position !== index + 1);
    assert.throws(() => parsePrivateBinaryMigrationArgs([...incomplete, '--binary', binaryId]));
  }
  assert.throws(() => parsePrivateBinaryMigrationArgs(cliArgs), /1 et 100/);
});

test('migration CLI : entre 1 et 100 identifiants explicites distincts, aucun parcours implicite', () => {
  const hundred = Array.from({ length: 100 }, (_, index) => ['--binary', `binary-${index}`]).flat();
  assert.equal(parsePrivateBinaryMigrationArgs([...cliArgs, ...hundred]).binaryIds.length, 100);
  for (const extra of [
    [...hundred, '--binary', 'binary-100'],
    ['--binary', binaryId, '--binary', binaryId],
    ['--binary', '../another-owner'],
    ['--binary', '*'],
    ['--binary', binaryId, '--all'],
    ['--binary', binaryId, '--apply', '--apply'],
    ['--binary', binaryId, '--bucket', bucketName],
  ]) assert.throws(() => parsePrivateBinaryMigrationArgs([...cliArgs, ...extra]));
});

test('migration CLI : aide sans initialisation et aucun repli sur les cibles de l’environnement', async () => {
  const run = promisify(execFile);
  const cli = fileURLToPath(new URL('../scripts/migrate-private-binary-verification.mjs', import.meta.url));
  const env = { ...process.env, GCLOUD_PROJECT: projectId, GOOGLE_CLOUD_PROJECT: projectId, FIREBASE_STORAGE_BUCKET: bucketName };
  const help = await run(process.execPath, [cli, '--help'], { env, timeout: 10_000 });
  assert.match(help.stdout, /Dry-run by default/);
  await assert.rejects(run(process.execPath, [cli], { env, timeout: 10_000 }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Projet explicite requis/);
    return true;
  });
});

test('migration : clients projet ou bucket différents refusés avant lecture', async () => {
  const env = await fixture();
  await assert.rejects(migratePrivateBinaryVerification({ ...env, ...options, projectId: 'another-project' }), /Client Firebase/);
  const wrongStorage = { app: { options: { projectId } }, bucket: () => ({ name: 'wrong-bucket' }) };
  await assert.rejects(migratePrivateBinaryVerification({ ...env, ...options, storage: wrongStorage }), /Bucket différent/);
  assert.deepEqual(env.reads, []);
  assert.deepEqual(env.writes, []);
});

test('migration dry-run : inspection des vrais octets sélectionnés, aucune écriture distante', async () => {
  const env = await fixture();
  const before = env.firestore.dump();
  const original = env.blobs.get(env.storagePath);
  const result = await migratePrivateBinaryVerification({ ...env, ...options });
  assert.equal(result.mode, 'dry-run');
  assert.deepEqual(result.results, [{ binaryId, status: 'would_verify' }]);
  assert.deepEqual(env.firestore.dump(), before);
  assert.deepEqual(env.writes, []);
  assert.ok(env.storageEvents.some((event) => event.method === 'download' && event.generation === original.metadata.generation));
  assert.ok(env.storageEvents.every((event) => event.method === 'metadata' || event.method === 'download'));
  assert.ok(env.reads.every((path) => path === manifestPath()));
  assert.equal(env.blobs.get(env.storagePath), original);
});

test('migration apply : ancien original valide attesté, octets et génération inchangés', async () => {
  const env = await fixture({ manifestPatch: { verificationStatus: 'accepted', verificationVersion: 'private-upload@1.0.0' } });
  const original = env.blobs.get(env.storagePath);
  assert.equal(privateBinaryIsVerified(env.manifest), false, 'l’ancienne acceptation ne remplace pas une attestation');
  const result = await migratePrivateBinaryVerification({ ...env, ...options, apply: true });
  assert.deepEqual(result.results, [{ binaryId, status: 'verified' }]);
  const stored = (await env.firestore.doc(manifestPath()).get()).data();
  assert.equal(privateBinaryIsVerified(stored), true);
  assert.equal(stored.verificationIdentity.generation, original.metadata.generation);
  assert.equal(stored.verificationIdentity.bucket, bucketName);
  assert.equal(stored.verificationIdentity.sha256, digestOf(env.original));
  assert.equal(env.blobs.get(env.storagePath), original);
  assert.deepEqual(env.blobs.get(env.storagePath).bytes, env.original);
  assert.ok(env.writes.length > 0);
  assert.ok(env.writes.every((write) => write.path === manifestPath()));
  assert.ok(env.storageEvents.filter((event) => event.method === 'save').every((event) => event.path.startsWith(`private-derivatives/${uid}/${cartularyId}/${binaryId}/`)));
  assert.equal(env.storageEvents.some((event) => event.method === 'delete'), false);
});

test('migration déjà attestée : vérification Storage puis aucun changement ni réinspection des octets', async () => {
  const env = await fixture();
  await migratePrivateBinaryVerification({ ...env, ...options, apply: true });
  const before = env.firestore.dump();
  for (const apply of [false, true]) {
    env.writes.length = 0;
    env.storageEvents.length = 0;
    const result = await migratePrivateBinaryVerification({ ...env, ...options, apply });
    assert.deepEqual(result.results, [{ binaryId, status: 'unchanged' }]);
    assert.deepEqual(env.firestore.dump(), before);
    assert.deepEqual(env.writes, []);
    assert.ok(env.storageEvents.length > 0);
    assert.ok(env.storageEvents.every((event) => event.method === 'metadata'));
  }
});

for (const scenario of ['missing', 'wrong-path', 'corrupt-bytes']) {
  test(`migration ${scenario} : refus sans mutation du manifeste ou de l’original`, async () => {
    const env = await fixture({
      missingOriginal: scenario === 'missing',
      corruptOriginal: scenario === 'corrupt-bytes',
      manifestPatch: scenario === 'wrong-path' ? { storagePath: `private-drafts/another-owner/${cartularyId}/${binaryId}/${'a'.repeat(64)}/original` } : {},
    });
    const before = env.firestore.dump();
    const original = env.blobs.get(env.storagePath);
    for (const apply of [false, true]) {
      const result = await migratePrivateBinaryVerification({ ...env, ...options, apply });
      assert.equal(result.counts.blocked, 1);
      assert.deepEqual(result.results, [{ binaryId, status: 'blocked', reason: {
        missing: 'original_missing', 'wrong-path': 'identity_mismatch', 'corrupt-bytes': 'digest_mismatch',
      }[scenario] }]);
      assert.deepEqual(env.firestore.dump(), before);
      assert.deepEqual(env.writes, []);
      assert.equal(env.blobs.get(env.storagePath), original);
      assert.ok(env.storageEvents.every((event) => event.method === 'metadata' || event.method === 'download'));
    }
  });
}

test('migration : exactement les 100 identifiants sélectionnés sont examinés, sans requête globale', async () => {
  const env = await fixture();
  const binaryIds = Array.from({ length: 100 }, (_, index) => `binary-missing-${index}`);
  const result = await migratePrivateBinaryVerification({ ...env, ...options, binaryIds });
  assert.equal(result.counts.examined, 100);
  assert.equal(result.counts.blocked, 100);
  assert.deepEqual(env.reads, binaryIds.map(manifestPath));
  assert.deepEqual(env.writes, []);
  assert.deepEqual(env.storageEvents, []);
});
