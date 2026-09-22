import assert from 'node:assert/strict';
import test from 'node:test';
import { applyGenericMediaChanges } from '../scripts/lib/generic-media-command.mjs';
import { createPrivateOriginalStorage, verifiedPrivateBinary } from './helpers/private-original-fixture.mjs';

const root = { id: 'cart_car', accountHolderId: 'owner_test', revision: 4, publicationStatus: 'none' };
const source = { displayName: 'Ancienne photo', binaryId: 'binary_one', mediaKind: 'image', requestedVisibility: 'secret', visibility: 'secret', tags: ['main-photo'], projectionStatus: 'active' };
const binary = verifiedPrivateBinary({ ownerUid: 'owner_test', cartularyId: 'cart_car', binaryId: 'binary_one', kind: 'media', deleted: false, uploadStatus: 'ready', verificationStatus: 'accepted', mimeType: 'image/jpeg', fileName: 'photo.jpg', sha256: `sha256:${'a'.repeat(64)}`, size: 321, storagePath: `private-drafts/owner_test/cart_car/binary_one/${'a'.repeat(64)}/original` });
const existingAssets = new Map([['asset_one', source], ['asset_imported', { ...source, binaryId: null, tags: [], displayName: 'Import conservé' }]]);
const binaries = new Map([['binary_one', binary], ['binary_new', verifiedPrivateBinary({ ...binary, binaryId: 'binary_new', storagePath: binary.storagePath.replace('binary_one', 'binary_new') })]]);
const storage = createPrivateOriginalStorage([...binaries.values()]);
const apply = (draft, override = {}) => applyGenericMediaChanges({ draft: { version: 1, baseRevision: 4, changes: [], removeIds: [], ...draft }, root: { ...root, ...override }, existingAssets, binaries, storage });
test('la sélection publique requiert une confirmation persistée sans publier un original', async () => {
  await assert.rejects(apply({ changes: [{ id: 'asset_one', visibility: 'Tous' }] }), /explicitement/);
  const media = await apply({ changes: [{ id: 'asset_one', visibility: 'Tous' }], confirmedPublicIds: ['asset_one'] });
  assert.equal(media.find((asset) => asset.id === 'asset_one').visibility, 'Tous');
  assert.equal(source.visibility, 'secret'); assert.equal(media.some((asset) => asset.storagePath || asset.url), false);
  await assert.rejects(apply({ changes: [{ id: 'asset_imported', visibility: 'Tous' }], confirmedPublicIds: ['asset_imported'] }), /vérifié/);
});
test('ajout et classement préservent les autres médias y compris les imports', async () => {
  const result = await apply({ changes: [{ id: 'asset_new', binaryId: 'binary_new', name: 'Nouvelle couverture', tags: ['main-photo'] }] });
  assert.equal(result.length, 3); assert.equal(result.find((asset) => asset.id === 'asset_new').visibility, 'Secret');
  assert.equal(result.find((asset) => asset.id === 'asset_one').tags.includes('main-photo'), false);
  assert.equal(result.find((asset) => asset.id === 'asset_imported').name, 'Import conservé');
  await assert.rejects(apply({ changes: [{ id: 'asset_new', binaryId: 'binary_unknown', name: 'Invalide' }] }), /vérifié/);
  await assert.rejects(apply({ changes: [{ id: 'asset_one', storagePath: '/hack' }] }), /non autorisée/);
});
test('retrait et remplacement sont confirmés, jamais implicites, et bloqués pendant publication', async () => {
  await assert.rejects(apply({ removeIds: ['asset_one'] }), /Confirmez/);
  assert.equal((await apply({ removeIds: ['asset_one'], confirmedRemoval: true })).length, 1);
  assert.equal(existingAssets.size, 2); assert.equal(binaries.size, 2);
  await assert.rejects(apply({ removeIds: ['asset_one'], confirmedRemoval: true }, { publicationStatus: 'published' }), /Retirez d’abord/);
  await assert.rejects(apply({ changes: [{ id: 'asset_one', binaryId: 'binary_new' }] }), /nouveau média/);
  await assert.rejects(apply({ changes: [{ id: 'asset_one', name: 'Obsolète' }], baseRevision: 3 }), /changé/);
});

for (const scenario of ['legacy timestamp', 'stale identity', 'foreign path', 'missing original', 'changed generation']) {
  test(`un nouveau média refuse ${scenario} sans toucher aux médias existants`, async () => {
    const manifest = structuredClone(binaries.get('binary_new'));
    const actualStorage = createPrivateOriginalStorage([manifest]);
    if (scenario === 'legacy timestamp') { delete manifest.verificationIdentity; delete manifest.verificationStatus; manifest.clientUpdatedAt = 1; }
    if (scenario === 'stale identity') manifest.sha256 = `sha256:${'b'.repeat(64)}`;
    if (scenario === 'foreign path') manifest.storagePath = manifest.storagePath.replace('owner_test', 'other_owner');
    if (scenario === 'missing original') actualStorage.objects.clear();
    if (scenario === 'changed generation') actualStorage.objects.get(manifest.storagePath).generation = '1002';
    await assert.rejects(applyGenericMediaChanges({
      storage: actualStorage, root, existingAssets, binaries: new Map([['binary_new', manifest]]),
      draft: { version: 1, baseRevision: 4, changes: [{ id: 'asset_new', binaryId: 'binary_new' }], removeIds: [] },
    }), { code: scenario === 'missing original' ? 'original_missing' : scenario === 'changed generation' ? 'generation_mismatch' : 'invalid_generic_media' });
    assert.equal(existingAssets.size, 2);
    assert.equal(existingAssets.has('asset_new'), false);
  });
}

test('autoriser un média existant en public exige encore son original attesté', async () => {
  await assert.rejects(applyGenericMediaChanges({
    storage: createPrivateOriginalStorage(), root, existingAssets, binaries,
    draft: { version: 1, baseRevision: 4, changes: [{ id: 'asset_one', visibility: 'Tous' }], confirmedPublicIds: ['asset_one'], removeIds: [] },
  }), { code: 'original_missing' });
});
