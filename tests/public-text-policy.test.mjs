import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePublicProjectionBlocks } from '../scripts/lib/projection-command.mjs';
import { findPrivatePublicTextToken } from '../scripts/lib/public-text-policy.mjs';

const block = (payload) => [{ id: 'condition-description', title: 'Description', payload }];
test('une description de matière ou de cadran original est acceptée par la politique commune et le serveur', () => {
  for (const text of ['Cadran original bleu, sans restauration.', 'Original blue dial, unrestored.', 'Finition d’origine, couronne intacte.']) {
    assert.equal(findPrivatePublicTextToken(text), null);
    assert.doesNotThrow(() => validatePublicProjectionBlocks(block({ paragraphs: [text] })));
  }
});
test('les références techniques aux originaux et les marqueurs privés restent interdits', () => {
  for (const text of ['originalUrl', 'original_path', 'https://example.org/original.jpg', '/images/original.webp', 'gs://bucket/Original.mov', 'blob:original', 'originals/123', 'prix acquisition', 'e-mail propriétaire', 'private storage']) {
    assert.notEqual(findPrivatePublicTextToken(text), null, text);
    assert.throws(() => validatePublicProjectionBlocks(block({ paragraphs: [text] })), { code: 'secret_field_detected' });
  }
  for (const key of ['originalUrl', 'originalHash', 'original', 'ownerName', 'downloadUrl', 'storagePath']) {
    assert.throws(() => validatePublicProjectionBlocks(block({ facts: [{ [key]: 'opaque-value' }] })), { code: 'secret_field_detected' });
  }
});
