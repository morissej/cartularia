import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGenericMediaChanges } from '../scripts/lib/generic-media-command.mjs';

const root = { id: 'cart_car', accountHolderId: 'owner_test', revision: 4, publicationStatus: 'none' };
const source = { displayName: 'Ancienne photo', binaryId: 'binary_one', mediaKind: 'image', requestedVisibility: 'secret', visibility: 'secret', tags: ['main-photo'], projectionStatus: 'active' };
const binary = { ownerUid: 'owner_test', cartularyId: 'cart_car', binaryId: 'binary_one', kind: 'media', deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', mimeType: 'image/jpeg', fileName: 'photo.jpg' };
const existingAssets = new Map([['asset_one', source], ['asset_imported', { ...source, binaryId: null, tags: [], displayName: 'Import conservé' }]]);
const binaries = new Map([['binary_one', binary], ['binary_new', { ...binary, binaryId: 'binary_new' }]]);
const apply = (draft, override = {}) => applyGenericMediaChanges({ draft: { version: 1, baseRevision: 4, changes: [], removeIds: [], ...draft }, root: { ...root, ...override }, existingAssets, binaries });
test('la sélection publique requiert une confirmation persistée sans publier un original', () => {
  assert.throws(() => apply({ changes: [{ id: 'asset_one', visibility: 'Tous' }] }), /explicitement/);
  const media = apply({ changes: [{ id: 'asset_one', visibility: 'Tous' }], confirmedPublicIds: ['asset_one'] });
  assert.equal(media.find((asset) => asset.id === 'asset_one').visibility, 'Tous');
  assert.equal(source.visibility, 'secret'); assert.equal(media.some((asset) => asset.storagePath || asset.url), false);
  assert.throws(() => apply({ changes: [{ id: 'asset_imported', visibility: 'Tous' }], confirmedPublicIds: ['asset_imported'] }), /vérifié/);
});
test('ajout et classement préservent les autres médias y compris les imports', () => {
  const result = apply({ changes: [{ id: 'asset_new', binaryId: 'binary_new', name: 'Nouvelle couverture', tags: ['main-photo'] }] });
  assert.equal(result.length, 3); assert.equal(result.find((asset) => asset.id === 'asset_new').visibility, 'Secret');
  assert.equal(result.find((asset) => asset.id === 'asset_one').tags.includes('main-photo'), false);
  assert.equal(result.find((asset) => asset.id === 'asset_imported').name, 'Import conservé');
  assert.throws(() => apply({ changes: [{ id: 'asset_new', binaryId: 'binary_unknown', name: 'Invalide' }] }), /vérifié/);
  assert.throws(() => apply({ changes: [{ id: 'asset_one', storagePath: '/hack' }] }), /non autorisée/);
});
test('retrait et remplacement sont confirmés, jamais implicites, et bloqués pendant publication', () => {
  assert.throws(() => apply({ removeIds: ['asset_one'] }), /Confirmez/);
  assert.equal(apply({ removeIds: ['asset_one'], confirmedRemoval: true }).length, 1);
  assert.equal(existingAssets.size, 2); assert.equal(binaries.size, 2);
  assert.throws(() => apply({ removeIds: ['asset_one'], confirmedRemoval: true }, { publicationStatus: 'published' }), /Retirez d’abord/);
  assert.throws(() => apply({ changes: [{ id: 'asset_one', binaryId: 'binary_new' }] }), /nouveau média/);
  assert.throws(() => apply({ changes: [{ id: 'asset_one', name: 'Obsolète' }], baseRevision: 3 }), /changé/);
});
