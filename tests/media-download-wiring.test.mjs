import assert from 'node:assert/strict';
import test from 'node:test';
import { validPublicMediaPath } from '../src/utils/publicMediaReference.ts';
import { mediaDownloadFileName } from '../src/utils/mediaDownload.ts';

test('les noms des originaux restent reconnaissables sans séparateur de chemin', () => {
  assert.equal(mediaDownloadFileName({ name: 'Photo principale', originalFileName: '../originaux/cadran.JPG', mimeType: 'image/jpeg', binaryId: 'private_1' }), 'originaux-cadran.JPG');
  assert.equal(mediaDownloadFileName({ name: 'Film', originalFileName: 'film.MOV', mimeType: 'video/quicktime', binaryId: 'private_2' }), 'film.MOV');
});

test('chaque famille de copies publiques porte une extension compatible avec son MIME', () => {
  for (const [name, mimeType, expected] of [['Photo.jpg', 'image/webp', 'Photo.webp'], ['Film.mov', 'video/mp4', 'Film.mp4'], ['Document', 'application/pdf', 'Document.pdf']]) {
    assert.equal(mediaDownloadFileName({ name, mimeType, publicStoragePath: 'public/OBJ-001/media/web' }), expected);
  }
});

test('les références publiques et noms de copies fonctionnent sans URL préchargée', () => {
  const publicStoragePath = 'public/OBJ-001/photo/web_001';
  assert.equal(validPublicMediaPath(publicStoragePath), true);
  for (const path of ['private-drafts/owner/cart/file/hash/original', 'https://example.com/original', 'public/OBJ-001/../original', `${publicStoragePath}?token=secret`]) assert.equal(validPublicMediaPath(path), false);
  assert.equal(mediaDownloadFileName({ name: 'cadran.jpg', mimeType: 'image/webp', publicStoragePath }), 'cadran.webp');
});
