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
  privateBinaryIsVerified,
} from '../scripts/lib/private-upload-command.mjs';

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

test('seuls les anciens fichiers de transition ou les fichiers acceptés sont utilisables', () => {
  assert.equal(privateBinaryIsVerified({
    deleted: false,
    uploadStatus: 'ready',
    verificationStatus: 'accepted',
  }), true);
  assert.equal(privateBinaryIsVerified({
    deleted: false,
    uploadStatus: 'ready',
    clientUpdatedAt: 10,
  }), true);
  assert.equal(privateBinaryIsVerified({
    deleted: false,
    uploadStatus: 'ready',
    clientUpdatedAt: Date.now(),
  }), false);
  assert.equal(privateBinaryIsVerified({
    deleted: false,
    uploadStatus: 'pending_upload',
  }), false);
});
