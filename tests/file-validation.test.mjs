import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFileForUpload } from '../src/security/fileValidation.ts';

const blob = (bytes, type) => new Blob([Uint8Array.from(bytes)], { type });

test('un JPEG cohérent est reconnu sans lire son extension comme autorité', async () => {
  const result = await validateFileForUpload({
    blob: blob([0xff, 0xd8, 0xff, 0xe0, 0, 1], 'image/jpeg'),
    fileName: 'montre.jpg',
    declaredMimeType: 'image/jpeg',
    expectedKind: 'image',
  });
  assert.equal(result.format, 'jpeg');
  assert.equal(result.canonicalMimeType, 'image/jpeg');
});

test('un contenu HTML renommé en JPG est refusé avec un motif précis', async () => {
  await assert.rejects(
    validateFileForUpload({
      blob: new Blob(['<html><script>alert(1)</script>'], { type: 'image/jpeg' }),
      fileName: 'fausse-photo.jpg',
      declaredMimeType: 'image/jpeg',
    }),
    (error) => error?.code === 'unsupported_signature' && /signature inconnue/.test(error.message),
  );
});

test('une signature PDF sous extension JPG est refusée', async () => {
  await assert.rejects(
    validateFileForUpload({
      blob: new Blob(['%PDF-1.7\n'], { type: 'image/jpeg' }),
      fileName: 'piece.jpg',
      declaredMimeType: 'image/jpeg',
    }),
    (error) => error?.code === 'extension_mismatch',
  );
});

test('les conteneurs ISO distinguent HEIC, MP4 et MOV', async () => {
  const box = (brand, type) => new Blob([Uint8Array.from([0, 0, 0, 24]), 'ftyp', brand, '00000000'], { type });
  assert.equal((await validateFileForUpload({ blob: box('heic', 'image/heic'), fileName: 'photo.heic', declaredMimeType: 'image/heic' })).format, 'heic');
  assert.equal((await validateFileForUpload({ blob: box('isom', 'video/mp4'), fileName: 'video.mp4', declaredMimeType: 'video/mp4' })).format, 'mp4');
  assert.equal((await validateFileForUpload({ blob: box('qt  ', 'video/quicktime'), fileName: 'video.mov', declaredMimeType: 'video/quicktime' })).format, 'quicktime');
});

test('une vidéo reste refusée dans une rubrique documentaire', async () => {
  const video = new Blob([Uint8Array.from([0, 0, 0, 24]), 'ftyp', 'isom', '00000000'], { type: 'video/mp4' });
  await assert.rejects(validateFileForUpload({
    blob: video,
    fileName: 'preuve.mp4',
    declaredMimeType: 'video/mp4',
    allowedKinds: ['image', 'document'],
  }), { code: 'unexpected_kind' });
});
