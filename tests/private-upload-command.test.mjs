import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  detectTrustedFileFormat,
  inspectTrustedUpload,
  inspectPrivateBinaryOriginal,
  assertPrivateBinaryOriginal,
  processPrivateDraftUpload,
  processPrivateDraftUploadBacklog,
  PRIVATE_UPLOAD_LEASE_MS,
  PRIVATE_UPLOAD_RETRY_MAX_MS,
  privateBinaryIsVerified,
} from '../scripts/lib/private-upload-command.mjs';

import { createMemoryFirestore } from './helpers/memory-firestore.mjs';
import { createMemoryStorage, attestStoredManifest } from './helpers/verified-original-storage.mjs';
import { verifiedPrivateBinary } from './helpers/private-original-fixture.mjs';

const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const withFile = async (name, bytes, callback) => {
  const directory = await mkdtemp(join(tmpdir(), 'cartularia-upload-test-'));
  const path = join(directory, name);
  try {
    await writeFile(path, bytes);
    return await callback(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test('une image décodée produit un dérivé WebP sans bloc EXIF', async () => {
  const original = await sharp({
    create: { width: 16, height: 12, channels: 3, background: '#335577' },
  }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await withFile('preuve.jpg', original, async (path) => {
    const inspection = await inspectTrustedUpload({
      path,
      fileName: 'preuve.jpg',
      declaredMimeType: 'image/jpeg',
      expectedDigest: digestOf(original),
      expectedSize: original.length,
    });
    assert.equal(inspection.accepted, true);
    assert.equal(inspection.derivativeStatus, 'ready');
    assert.equal(inspection.publicationEligible, true);
    const metadata = await sharp(inspection.derivative.bytes).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
  });
});

test('un PDF actif et un PDF incomplet sont refusés', async () => {
  const active = Buffer.from('%PDF-1.7\n1 0 obj << /OpenAction 2 0 R >> endobj\n%%EOF');
  await withFile('actif.pdf', active, async (path) => {
    await assert.rejects(inspectTrustedUpload({
      path,
      fileName: 'actif.pdf',
      declaredMimeType: 'application/pdf',
      expectedDigest: digestOf(active),
      expectedSize: active.length,
    }), { code: 'active_pdf_content' });
  });
  const incomplete = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj');
  await withFile('incomplet.pdf', incomplete, async (path) => {
    await assert.rejects(inspectTrustedUpload({
      path,
      fileName: 'incomplet.pdf',
      declaredMimeType: 'application/pdf',
      expectedDigest: digestOf(incomplete),
      expectedSize: incomplete.length,
    }), { code: 'invalid_pdf' });
  });
});

test('un conteneur MP4 doit contenir ftyp, index et données média', async () => {
  const box = (type, payload = Buffer.alloc(0)) => {
    const result = Buffer.alloc(8 + payload.length);
    result.writeUInt32BE(result.length, 0);
    result.write(type, 4, 4, 'latin1');
    payload.copy(result, 8);
    return result;
  };
  const valid = Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov'), box('mdat', Buffer.from([1]))]);
  assert.equal(detectTrustedFileFormat(valid), 'mp4');
  await withFile('séquence.mp4', valid, async (path) => {
    const inspection = await inspectTrustedUpload({
      path,
      fileName: 'séquence.mp4',
      declaredMimeType: 'video/mp4',
      expectedDigest: digestOf(valid),
      expectedSize: valid.length,
    });
    assert.equal(inspection.mediaDecodeStatus, 'container_structure_verified');
    assert.equal(inspection.publicationEligible, false);
  });
  const truncated = box('ftyp', Buffer.from('isom0000'));
  await withFile('tronqué.mp4', truncated, async (path) => {
    await assert.rejects(inspectTrustedUpload({
      path,
      fileName: 'tronqué.mp4',
      declaredMimeType: 'video/mp4',
      expectedDigest: digestOf(truncated),
      expectedSize: truncated.length,
    }), { code: 'invalid_media_container' });
  });
});

test('seule une attestation serveur de l’identité complète autorise un binaire', () => {
  const manifest = verifiedPrivateBinary({ ownerUid: 'u', cartularyId: 'c', binaryId: 'b',
    deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', size: 42,
    sha256: `sha256:${'a'.repeat(64)}`, storagePath: `private-drafts/u/c/b/${'a'.repeat(64)}/original` });
  assert.equal(privateBinaryIsVerified(manifest), true);
  for (const field of ['schemaVersion', 'ownerUid', 'cartularyId', 'binaryId', 'storagePath', 'sha256', 'size', 'bucket', 'generation']) {
    assert.equal(privateBinaryIsVerified({ ...manifest, verificationIdentity: { ...manifest.verificationIdentity, [field]: null } }), false, field);
  }
  for (const patch of [{ verificationStatus: null, clientUpdatedAt: 1 }, { verificationIdentity: undefined, clientUpdatedAt: 1 },
    { deleted: true }, { uploadStatus: 'pending_upload' }, { ownerUid: 'other' }, { binaryId: 'other' }, { size: 43 }]) {
    assert.equal(privateBinaryIsVerified({ ...manifest, ...patch }), false);
  }
});

test('une image produit aussi les variantes v3 (derivativeId = nom de fichier complet) et une vignette inline issue de la 240', async () => {
  const original = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#8a6d3b' } }).jpeg().toBuffer();
  await withFile('objet.jpg', original, async (path) => {
    const inspection = await inspectTrustedUpload({ path, fileName: 'objet.jpg', declaredMimeType: 'image/jpeg', expectedDigest: digestOf(original), expectedSize: original.length });
    assert.deepEqual(inspection.variants.map((variant) => variant.derivativeId), ['presentation-v3-240.webp', 'presentation-v3-480.webp', 'presentation-v3-768.webp']);
    for (const variant of inspection.variants) {
      assert.equal(variant.derivativeId, `presentation-v3-${variant.nominalWidth}.webp`, 'le derivativeId doit être le dernier segment du chemin (storage.rules)');
      assert.ok(variant.width <= 900);
      assert.equal((await sharp(variant.bytes).metadata()).format, 'webp');
    }
    assert.equal(inspection.derivative.width, 900, 'copie principale ≤ 2400 inchangée');
    assert.equal(inspection.thumbnail.sha256, inspection.variants[0].sha256);
    assert.ok(inspection.thumbnail.dataUrl.length <= 24_000);
  });
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF');
  await withFile('note.pdf', pdf, async (path) => {
    const inspection = await inspectTrustedUpload({ path, fileName: 'note.pdf', declaredMimeType: 'application/pdf', expectedDigest: digestOf(pdf), expectedSize: pdf.length });
    assert.deepEqual(inspection.variants, [], 'aucune variante image pour un document');
    assert.equal(inspection.thumbnail, null);
  });
});

const seedUpload = async (originalBytes) => {
  const firestore = createMemoryFirestore();
  const memory = createMemoryStorage();
  const bytes = originalBytes ?? await sharp({ create: { width: 480, height: 320, channels: 3, background: '#224466' } }).jpeg().toBuffer();
  const manifest = { ownerUid: 'owner', cartularyId: 'cart', binaryId: 'binary', kind: 'media', fileName: 'original.jpg', mimeType: 'image/jpeg',
    size: bytes.length, sha256: digestOf(bytes), deleted: false, uploadStatus: 'ready', clientUpdatedAt: 1 };
  manifest.storagePath = `private-drafts/owner/cart/binary/${manifest.sha256.slice(7)}/original`;
  await memory.bucket.file(manifest.storagePath).save(bytes, { metadata: { contentType: 'image/jpeg', metadata: {
    ownerUid: 'owner', cartularyId: 'cart', binaryId: 'binary', kind: 'media', sha256: manifest.sha256, originalFileName: manifest.fileName,
  } } });
  const ref = firestore.doc('privateDrafts/owner/cartularies/cart/binaries/binary');
  await ref.set(manifest);
  const [object] = await memory.bucket.file(manifest.storagePath).getMetadata();
  return { firestore, ...memory, bytes, manifest, ref, object };
};

const hookFiles = (bucket, wrap) => {
  const file = bucket.file;
  bucket.file = (path, options) => wrap(file(path, options), path, options);
  return () => { bucket.file = file; };
};

test('inspection lecture seule : génération pinée, attestation exacte, alias MIME et renommage admis', async () => {
  const env = await seedUpload();
  const manifest = { ...env.manifest, fileName: 'nom affiché sans extension', mimeType: 'image/jpg' };
  const before = env.firestore.dump();
  const writes = env.journal.length;
  const result = await inspectPrivateBinaryOriginal({ bucket: env.bucket, manifest });
  assert.equal(result.verificationIdentity.generation, env.object.generation);
  assert.equal(result.inspection.digest, manifest.sha256);
  assert.equal(env.downloads[0].generation, env.object.generation, 'download doit cibler la génération lue');
  assert.equal(env.journal.length, writes);
  assert.deepEqual(env.firestore.dump(), before);
  assert.deepEqual(env.blobs.get(manifest.storagePath).bytes, env.bytes);
  const accepted = { ...manifest, uploadStatus: 'ready', verificationStatus: 'accepted', verificationIdentity: result.verificationIdentity };
  const downloads = env.downloads.length;
  await assertPrivateBinaryOriginal({ storage: env.storage, manifest: accepted });
  assert.equal(env.downloads.length, downloads, 'les consommateurs ne téléchargent jamais les octets');
});

test('le consommateur refuse original absent, attestation copiée, métadonnées altérées ou génération remplacée', async () => {
  for (const change of ['missing', 'generation', 'bucket', 'path', 'size', 'owner', 'hash', 'kind', 'mime']) {
    const env = await seedUpload();
    const manifest = await attestStoredManifest(env.bucket, { ...env.manifest, verificationStatus: 'accepted' });
    const blob = env.blobs.get(manifest.storagePath);
    if (change === 'missing') env.blobs.delete(manifest.storagePath);
    if (change === 'generation') await env.bucket.file(manifest.storagePath).save(env.bytes, blob.options);
    if (change === 'bucket') manifest.verificationIdentity.bucket = 'another-bucket';
    if (change === 'path') manifest.storagePath = manifest.storagePath.replace('/binary/', '/another/');
    if (change === 'size') blob.bytes = Buffer.concat([blob.bytes, Buffer.from('x')]);
    if (change === 'owner') blob.options.metadata.metadata.ownerUid = 'stranger';
    if (change === 'hash') blob.options.metadata.metadata.sha256 = `sha256:${'b'.repeat(64)}`;
    if (change === 'kind') blob.options.metadata.metadata.kind = 'document';
    if (change === 'mime') blob.options.metadata.contentType = 'text/html';
    await assert.rejects(assertPrivateBinaryOriginal({ storage: env.storage, manifest }), undefined, change);
    assert.equal(env.downloads.length, 0);
  }
});

test('une substitution entre getMetadata et download ne peut pas être inspectée sous l’ancienne génération', async () => {
  const env = await seedUpload();
  let substituted = false;
  hookFiles(env.bucket, (file, path, options) => ({ ...file, download: async (...args) => {
    if (options?.generation && !substituted) {
      substituted = true;
      await env.bucket.file(path).save(env.bytes, env.blobs.get(path).options);
    }
    return file.download(...args);
  } }));
  await assert.rejects(inspectPrivateBinaryOriginal({ storage: env.storage, manifest: env.manifest }), { code: 404 });
  assert.equal((await env.ref.get()).data().verificationIdentity, undefined);
});

test('le commit d’acceptation refuse le manifeste substitué pendant le téléchargement', async () => {
  const env = await seedUpload();
  hookFiles(env.bucket, (file) => ({ ...file, download: async (...args) => {
    const result = await file.download(...args);
    await env.ref.update({ sha256: `sha256:${'c'.repeat(64)}` });
    return result;
  } }));
  const result = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object });
  assert.equal(result.status, 'ignored');
  assert.equal(result.reason, 'stale_inspection');
  assert.equal((await env.ref.get()).data().verificationIdentity, undefined);
  assert.equal(env.journal.length, 1, 'aucun dérivé de l’ancien manifeste écrit');
});

test('le commit final refuse une substitution après écriture des dérivés', async () => {
  const env = await seedUpload();
  hookFiles(env.bucket, (file, path) => ({ ...file, save: async (...args) => {
    const result = await file.save(...args);
    if (path.endsWith('/presentation-v2.webp')) await env.ref.update({ size: env.manifest.size + 1 });
    return result;
  } }));
  const result = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object });
  assert.equal(result.status, 'ignored');
  assert.equal((await env.ref.get()).data().verificationStatus, 'processing');
  assert.equal((await env.ref.get()).data().verificationIdentity, undefined);
});

test('un événement ancien et un original manquant ne dégradent jamais une acceptation existante', async () => {
  const env = await seedUpload();
  const accepted = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object });
  assert.equal(accepted.status, 'accepted');
  const snapshot = env.firestore.dump();
  const writes = env.journal.length;
  const replay = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object });
  assert.equal(replay.status, 'accepted');
  assert.equal(replay.replayed, true);
  assert.equal(env.journal.length, writes);
  const stale = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: { ...env.object, generation: '1' } });
  assert.equal(stale.reason, 'stale_generation');
  env.blobs.delete(env.manifest.storagePath);
  const missing = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object });
  assert.equal(missing.status, 'ignored');
  assert.equal(missing.reason, 'original_missing');
  assert.deepEqual(env.firestore.dump(), snapshot);
});

test('une écriture tardive de dérivé ne peut pas écraser la génération d’un nouveau worker accepté', async () => {
  const env = await seedUpload();
  let newer;
  let clock = Date.now();
  const now = () => clock;
  let raced = false;
  hookFiles(env.bucket, (file, path) => ({ ...file, save: async (...args) => {
    if (path.endsWith('presentation-v3-240.webp') && !raced) {
      raced = true;
      clock += PRIVATE_UPLOAD_LEASE_MS + 1;
      newer = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object, now });
    }
    return file.save(...args);
  } }));
  const older = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object, now });
  assert.equal(newer.status, 'accepted');
  assert.equal(older.status, 'ignored');
  assert.equal(older.reason, 'stale_inspection');
  const manifest = (await env.ref.get()).data();
  assert.equal(privateBinaryIsVerified(manifest), true);
  for (const variant of manifest.presentationDerivative.variants) assert.equal(digestOf(env.blobs.get(variant.storagePath).bytes), variant.sha256);
  assert.equal(env.journal.filter((entry) => entry.endsWith('presentation-v3-240.webp')).length, 1, 'la précondition génération refuse le save tardif');
});

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

test('un doublon pendant un bail actif reste différé, sans voler le worker ni écrire de dérivé', async () => {
  const env = await seedUpload();
  const started = deferred();
  const resume = deferred();
  hookFiles(env.bucket, (file) => ({ ...file, download: async (...args) => {
    started.resolve(); await resume.promise; return file.download(...args);
  } }));
  const first = processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object });
  await started.promise;
  const leased = (await env.ref.get()).data();
  const before = env.firestore.dump();
  const second = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object });
  assert.equal(second.status, 'deferred');
  assert.equal(second.reason, 'lease_active');
  assert.equal(second.retryAt, leased.verificationLeaseExpiresAt);
  assert.deepEqual(env.firestore.dump(), before);
  assert.equal(env.journal.length, 1);
  resume.resolve();
  assert.equal((await first).status, 'accepted');
});

test('interruption avant ou après les dérivés : le backlog reprend seulement après expiration du bail', async () => {
  for (const stage of ['before_derivatives', 'after_derivatives']) {
    const env = await seedUpload();
    let clock = Date.now();
    const now = () => clock;
    const realTransaction = env.firestore.runTransaction;
    env.firestore.runTransaction = (operation) => realTransaction((transaction) => operation({ ...transaction,
      update: (ref, patch) => {
        // Model process death: neither final acceptance nor failure bookkeeping can be committed.
        if (patch.verificationStatus === 'accepted' || patch.verificationReason === 'retryable_failure') throw new Error('worker terminated');
        transaction.update(ref, patch);
      },
    }));
    const restore = hookFiles(env.bucket, (file) => ({ ...file, download: async (...args) => {
      if (stage === 'before_derivatives') throw new Error('worker terminated');
      return file.download(...args);
    } }));
    await assert.rejects(processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object, now }), /worker terminated/);
    restore(); env.firestore.runTransaction = realTransaction;
    const interrupted = (await env.ref.get()).data();
    assert.equal(interrupted.verificationStatus, 'processing');
    assert.equal(interrupted.verificationIdentity, undefined);
    assert.equal(interrupted.verificationLeaseExpiresAt, clock + PRIVATE_UPLOAD_LEASE_MS);
    assert.equal(env.journal.length > 1, stage === 'after_derivatives');
    const active = await processPrivateDraftUploadBacklog({ firestore: env.firestore, storage: env.storage, now });
    assert.equal(active.inspected, 0);
    clock = interrupted.verificationLeaseExpiresAt + 1;
    const recovered = await processPrivateDraftUploadBacklog({ firestore: env.firestore, storage: env.storage, now });
    assert.equal(recovered.inspected, 1); assert.equal(recovered.accepted, 1);
    const manifest = (await env.ref.get()).data();
    assert.equal(privateBinaryIsVerified(manifest), true);
    assert.notEqual(manifest.verificationAttemptId, interrupted.verificationAttemptId);
    assert.equal(manifest.verificationLeaseExpiresAt, undefined);
    assert.equal(manifest.verificationRetryAfter, undefined);
    assert.deepEqual(env.blobs.get(manifest.storagePath).bytes, env.bytes);
  }
});

test('échec Storage transitoire : processing, backoff, retry idempotent puis acceptation réelle', async () => {
  const env = await seedUpload();
  let clock = Date.now();
  const now = () => clock;
  let failed = false;
  hookFiles(env.bucket, (file, path) => ({ ...file, save: async (...args) => {
    if (path.startsWith('private-derivatives/') && !failed) { failed = true; throw Object.assign(new Error('unavailable'), { code: 503 }); }
    return file.save(...args);
  } }));
  await assert.rejects(processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object, now }), { retryable: true, code: 'verification_retryable' });
  const retrying = (await env.ref.get()).data();
  assert.equal(retrying.verificationStatus, 'processing');
  assert.equal(retrying.uploadStatus, 'verifying');
  assert.equal(retrying.verificationReason, 'retryable_failure');
  assert.equal(retrying.verificationLeaseExpiresAt, undefined);
  assert.equal(retrying.verificationRetryCount, 1);
  assert.ok(retrying.verificationRetryAfter > clock);
  assert.equal(privateBinaryIsVerified(retrying), false);
  const deferredResult = await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object, now });
  assert.equal(deferredResult.reason, 'retry_backoff');
  clock = retrying.verificationRetryAfter;
  assert.equal((await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object, now })).status, 'accepted');
  const accepted = (await env.ref.get()).data();
  assert.equal(privateBinaryIsVerified(accepted), true);
  assert.equal(accepted.verificationRetryAfter, undefined);
  assert.equal(accepted.verificationLeaseExpiresAt, undefined);
  assert.equal(env.journal.filter((entry) => entry === `save:${env.manifest.storagePath}`).length, 1);
});

test('les erreurs techniques répétées plafonnent le délai sans inventer un succès ni un rejet', async () => {
  const env = await seedUpload();
  const clock = Date.now();
  await env.ref.update({ verificationStatus: 'processing', verificationRetryCount: 100 });
  hookFiles(env.bucket, (file) => ({ ...file, download: async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); } }));
  await assert.rejects(processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object, now: () => clock }), { retryable: true });
  const current = (await env.ref.get()).data();
  assert.equal(current.verificationRetryCount, 101);
  assert.equal(current.verificationRetryAfter, clock + PRIVATE_UPLOAD_RETRY_MAX_MS);
  assert.equal(current.verificationStatus, 'processing');
  assert.equal(current.publicationEligible, false);
  assert.equal(current.verificationIdentity, undefined);
});

test('un rejet de sécurité déterministe ne reçoit aucun bail/retry et n’est jamais réhabilité par rejeu', async () => {
  const env = await seedUpload(Buffer.from('not an allowed binary signature'));
  assert.equal((await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object })).status, 'rejected');
  const rejected = (await env.ref.get()).data();
  assert.equal(rejected.verificationReason, 'unsupported_signature');
  assert.equal(rejected.verificationLeaseExpiresAt, undefined);
  assert.equal(rejected.verificationRetryAfter, undefined);
  const before = env.firestore.dump();
  assert.equal((await processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object })).reason, 'already_rejected');
  assert.equal((await processPrivateDraftUploadBacklog({ firestore: env.firestore, storage: env.storage })).inspected, 0);
  assert.deepEqual(env.firestore.dump(), before);
});

test('le backlog garde les erreurs transitoires récupérables et ne compte pas de faux succès', async () => {
  const env = await seedUpload();
  hookFiles(env.bucket, (file) => ({ ...file, download: async () => { throw new Error('network interrupted'); } }));
  const result = await processPrivateDraftUploadBacklog({ firestore: env.firestore, storage: env.storage });
  assert.equal(result.inspected, 1); assert.equal(result.accepted, 0); assert.equal(result.rejected, 0);
  assert.equal(result.retryableFailures, 1);
  assert.equal((await env.ref.get()).data().verificationStatus, 'processing');
});

test('un worker dont le bail expire ne peut pas accepter, même si aucun successeur ne l’a encore remplacé', async () => {
  const env = await seedUpload();
  let clock = Date.now();
  const now = () => clock;
  hookFiles(env.bucket, (file) => ({ ...file, download: async (...args) => {
    const result = await file.download(...args);
    clock += PRIVATE_UPLOAD_LEASE_MS + 1;
    return result;
  } }));
  await assert.rejects(processPrivateDraftUpload({ firestore: env.firestore, storage: env.storage, object: env.object, now }), { retryable: true });
  const current = (await env.ref.get()).data();
  assert.equal(current.verificationStatus, 'processing');
  assert.equal(current.verificationIdentity, undefined);
  assert.equal(current.verificationRetryAfter > clock, true);
  assert.equal(current.verificationLeaseExpiresAt, undefined);
  assert.equal(env.journal.length, 1, 'aucun dérivé après expiration du bail');
});
