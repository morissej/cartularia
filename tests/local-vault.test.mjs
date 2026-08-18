import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CartulariaLocalVault,
  MemoryVaultBackend,
  ScopedStorage,
  migrateLocalVaultCartularyId,
} from '../src/persistence/localVault.ts';

class MemoryStorage {
  values = new Map();

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test('deux Cartulaires restent isolés dans le même localStorage', () => {
  const backing = new MemoryStorage();
  const iwc = new ScopedStorage(backing, 'cart_iwc_flieger_utc_2002');
  const rolex = new ScopedStorage(backing, 'cart_rolex_gmt_master_1675');
  iwc.setItem('cartularia-owner-fields', JSON.stringify([{ value: 'IWC' }]));
  rolex.setItem('cartularia-owner-fields', JSON.stringify([{ value: 'Rolex' }]));

  assert.deepEqual(JSON.parse(iwc.getItem('cartularia-owner-fields')), [{ value: 'IWC' }]);
  assert.deepEqual(JSON.parse(rolex.getItem('cartularia-owner-fields')), [{ value: 'Rolex' }]);
  assert.equal(iwc.length, 1);
  assert.equal(rolex.length, 1);
  iwc.removeItem('cartularia-owner-fields');
  assert.equal(iwc.getItem('cartularia-owner-fields'), null);
  assert.notEqual(rolex.getItem('cartularia-owner-fields'), null);
});

test('les valeurs localStorage migrées survivent à une perte du cache synchrone', async () => {
  const backend = new MemoryVaultBackend();
  const firstStorage = new MemoryStorage();
  firstStorage.setItem('cartularia-owner-fields', JSON.stringify([{ id: 'owner-name', value: 'Durable' }]));
  const firstVault = new CartulariaLocalVault('cart-local', backend, firstStorage, () => 100);
  await firstVault.mirrorLocalStorage();

  const restoredStorage = new MemoryStorage();
  const restoredVault = new CartulariaLocalVault('cart-local', backend, restoredStorage, () => 200);
  await restoredVault.restoreLocalStorage();
  assert.deepEqual(JSON.parse(restoredStorage.getItem('cartularia-owner-fields')), [{ id: 'owner-name', value: 'Durable' }]);
});

test('une suppression est persistée comme tombstone et ne ressuscite pas au rechargement', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const vault = new CartulariaLocalVault('cart-delete-key', backend, storage, () => 100);
  await vault.writeJson('cartularia-owner-fields', [{ id: 'owner-name', value: 'À supprimer' }]);
  await vault.removeKey('cartularia-owner-fields');

  const restoredStorage = new MemoryStorage();
  const restoredVault = new CartulariaLocalVault('cart-delete-key', backend, restoredStorage, () => 200);
  await restoredVault.restoreLocalStorage();
  assert.equal(restoredStorage.getItem('cartularia-owner-fields'), null);
  assert.equal((await restoredVault.listStateRecords())[0].deleted, true);
});

test('un original binaire est conservé avec son empreinte complète', async () => {
  const backend = new MemoryVaultBackend();
  const vault = new CartulariaLocalVault('cart-binary', backend, new MemoryStorage(), () => 100);
  const blob = new Blob(['original-media'], { type: 'video/mp4' });
  await vault.putBinary({
    binaryId: 'video-main',
    kind: 'media',
    fileName: 'main.mp4',
    mimeType: 'video/mp4',
    sha256: 'a'.repeat(64),
    blob,
  });
  const stored = await vault.getBinary('video-main');
  assert.equal(stored?.size, blob.size);
  assert.equal(stored?.mimeType, 'video/mp4');
  assert.equal(stored?.sha256, `sha256:${'a'.repeat(64)}`);
  assert.equal(await stored?.blob?.text(), 'original-media');
});

test('un manifeste cloud peut être conservé sans télécharger immédiatement son original', async () => {
  const backend = new MemoryVaultBackend();
  const vault = new CartulariaLocalVault('cart-progressive', backend, new MemoryStorage(), () => 100);
  await vault.applyCloudBinary({
    id: '', cartularyId: 'cart-progressive', binaryId: 'large-video', kind: 'media',
    fileName: 'large.mov', mimeType: 'video/quicktime', size: 132_000_000,
    sha256: `sha256:${'f'.repeat(64)}`, blob: null, updatedAt: 90, dirty: false,
    deleted: false, cloudRevision: 2, cloudStoragePath: 'private-drafts/owner/cart-progressive/large-video/hash/original',
  });
  const stored = await vault.getBinary('large-video');
  assert.equal(stored?.blob, null);
  assert.equal(stored?.dirty, false);
  assert.equal(stored?.cloudRevision, 2);
  assert.match(stored?.cloudStoragePath ?? '', /large-video/);
});

test('une réhydratation React identique ne retransforme pas un état cloud en écriture locale', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const vault = new CartulariaLocalVault('cart-reactive-pull', backend, storage, () => 200);
  const value = JSON.stringify([{ value: 'cloud' }]);
  await vault.applyCloudState({
    id: '', cartularyId: 'cart-reactive-pull', key: 'cartularia-owner-fields', value,
    updatedAt: 100, dirty: false, deleted: false, cloudRevision: 3,
  });
  await vault.writeRaw('cartularia-owner-fields', value);
  const [record] = await vault.listStateRecords();
  assert.equal(record.dirty, false);
  assert.equal(record.updatedAt, 100);
  assert.equal(record.cloudRevision, 3);
});

test('la suppression d’un binaire conserve une intention de suppression synchronisable', async () => {
  const backend = new MemoryVaultBackend();
  const vault = new CartulariaLocalVault('cart-binary-delete', backend, new MemoryStorage(), () => 100);
  await vault.putBinary({
    binaryId: 'identity-document',
    kind: 'owner_document',
    fileName: 'identite.pdf',
    mimeType: 'application/pdf',
    sha256: 'b'.repeat(64),
    blob: new Blob(['document']),
  });
  await vault.deleteBinary('identity-document');
  const stored = await vault.getBinary('identity-document');
  assert.equal(stored?.deleted, true);
  assert.equal(stored?.blob, null);
  assert.equal(stored?.dirty, true);
});

test('la suppression locale volontaire efface cache, états et binaires du Cartulaire', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const vault = new CartulariaLocalVault('cart-delete-all', backend, storage, () => 100);
  await vault.writeJson('cartularia-owner-fields', [{ id: 'owner-name', value: 'Secret' }]);
  await vault.putBinary({
    binaryId: 'secret-file',
    kind: 'owner_document',
    fileName: 'secret.pdf',
    mimeType: 'application/pdf',
    sha256: 'c'.repeat(64),
    blob: new Blob(['secret']),
  });
  await vault.deleteAllLocalData();
  assert.equal(storage.getItem('cartularia-owner-fields'), null);
  assert.deepEqual(await vault.listStateRecords(), []);
  assert.deepEqual(await vault.listBinaryRecords(), []);
});

test('un arbitrage explicite peut rebaser la version locale sur la révision cloud', async () => {
  const backend = new MemoryVaultBackend();
  const vault = new CartulariaLocalVault('cart-conflict-resolution', backend, new MemoryStorage(), () => 100);
  await vault.writeJson('cartularia-owner-fields', [{ value: 'ma version' }]);
  await vault.putBinary({
    binaryId: 'conflicted-file', kind: 'owner_document', fileName: 'preuve.pdf',
    mimeType: 'application/pdf', sha256: 'd'.repeat(64), blob: new Blob(['local']),
  });
  await vault.prepareStateConflictResolution('cartularia-owner-fields', 7);
  await vault.prepareBinaryConflictResolution('conflicted-file', 4);
  const state = (await vault.listStateRecords())[0];
  const binary = await vault.getBinary('conflicted-file');
  assert.equal(state.dirty, true);
  assert.equal(state.cloudRevision, 7);
  assert.equal(binary?.dirty, true);
  assert.equal(binary?.cloudRevision, 4);
});

test('la migration vers l’identifiant canonique conserve les données et ne remplace pas une cible existante', async () => {
  const backend = new MemoryVaultBackend();
  const legacyVault = new CartulariaLocalVault('cartulary-iwc-utc-01', backend, new MemoryStorage(), () => 100);
  const canonicalVault = new CartulariaLocalVault('cart_iwc_flieger_utc_2002', backend, new MemoryStorage(), () => 200);
  await legacyVault.writeJson('cartularia-owner-fields', [{ value: 'ancienne valeur' }]);
  await legacyVault.writeJson('cartularia-condition', { value: 'à migrer' });
  await legacyVault.putBinary({
    binaryId: 'legacy-photo', kind: 'media', fileName: 'photo.jpg',
    mimeType: 'image/jpeg', sha256: 'e'.repeat(64), blob: new Blob(['photo']),
  });
  await canonicalVault.writeJson('cartularia-owner-fields', [{ value: 'valeur canonique' }]);

  const result = await migrateLocalVaultCartularyId(backend, legacyVault.cartularyId, canonicalVault.cartularyId);
  assert.deepEqual(result, { state: 1, binaries: 1 });
  const state = await canonicalVault.listStateRecords();
  const owner = state.find((record) => record.key === 'cartularia-owner-fields');
  const condition = state.find((record) => record.key === 'cartularia-condition');
  const binary = await canonicalVault.getBinary('legacy-photo');
  assert.deepEqual(JSON.parse(owner?.value ?? 'null'), [{ value: 'valeur canonique' }]);
  assert.deepEqual(JSON.parse(condition?.value ?? 'null'), { value: 'à migrer' });
  assert.equal(condition?.dirty, true);
  assert.equal(binary?.cartularyId, canonicalVault.cartularyId);
  assert.equal(await binary?.blob?.text(), 'photo');
  assert.equal((await legacyVault.listStateRecords()).length, 2);
});
