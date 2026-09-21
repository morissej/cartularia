import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CartulariaLocalVault,
  LocalVaultAccessError,
  MemoryVaultBackend,
  ScopedStorage,
  createVerifiedLocalVaultSession,
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

test('le cache privé sépare les comptes pour un même Cartulaire, puis les Cartulaires du même compte', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const open = (uid, cartularyId = 'cart-private') => createVerifiedLocalVaultSession({ uid, cartularyId, backend, storage });
  const first = open('account-a');
  await first.vault.writeJson('cartularia-owner-fields', { name: 'Privé A' });
  await first.vault.putBinary({
    binaryId: 'proof', kind: 'owner_document', fileName: 'a.pdf', mimeType: 'application/pdf',
    sha256: 'a'.repeat(64), blob: new Blob(['pièce A']),
  });
  first.lock();

  const second = open('account-b');
  await second.vault.restoreLocalStorage();
  assert.equal(second.storage.getItem('cartularia-owner-fields'), null);
  assert.deepEqual(await second.vault.listStateRecords(), []);
  assert.equal(await second.vault.getBinary('proof'), null);
  await second.vault.writeJson('cartularia-owner-fields', { name: 'Privé B' });

  const otherCartulary = open('account-a', 'cart-other');
  assert.equal(otherCartulary.storage.getItem('cartularia-owner-fields'), null);
  assert.deepEqual(await otherCartulary.vault.listStateRecords(), []);

  const firstAgain = open('account-a');
  await firstAgain.vault.restoreLocalStorage();
  assert.deepEqual(JSON.parse(firstAgain.storage.getItem('cartularia-owner-fields')), { name: 'Privé A' });
  const original = await firstAgain.vault.getBinary('proof');
  assert.equal(await original.blob.text(), 'pièce A');
  assert.equal(original.cartularyId, 'cart-private');
  assert.equal(first.storage.getItem('cartularia-owner-fields'), null);
  await assert.rejects(first.vault.getBinary('proof'), LocalVaultAccessError);
  await assert.rejects(first.vault.writeJson('cartularia-owner-fields', { name: 'Ancien callback' }), LocalVaultAccessError);
});

test('un verrouillage ferme aussi les handles synchrones conservés par un ancien composant', async () => {
  const session = createVerifiedLocalVaultSession({
    uid: 'account-a', cartularyId: 'cart-private', backend: new MemoryVaultBackend(), storage: new MemoryStorage(),
  });
  await session.vault.writeJson('cartularia-owner-fields', { name: 'Privé' });
  session.lock();
  assert.equal(session.storage.length, 0);
  assert.equal(session.storage.key(0), null);
  assert.equal(session.storage.getItem('cartularia-owner-fields'), null);
  assert.throws(() => session.storage.setItem('cartularia-owner-fields', 'callback'), LocalVaultAccessError);
  assert.throws(() => session.storage.removeItem('cartularia-owner-fields'), LocalVaultAccessError);
  await assert.rejects(session.vault.listStateRecords(), LocalVaultAccessError);
  await assert.rejects(session.vault.listBinaryRecords(), LocalVaultAccessError);
  await assert.rejects(session.vault.restoreLocalStorage(), LocalVaultAccessError);
  await assert.rejects(session.vault.deleteAllLocalData(), LocalVaultAccessError);
});

test('un brouillon accepté juste avant le verrouillage est préservé dans son compte et reste dirty', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const open = (uid) => createVerifiedLocalVaultSession({ uid, cartularyId: 'cart-private', backend, storage });
  const first = open('account-a');
  const saving = first.vault.writeJson('cartularia-owner-fields', { name: 'Dernière saisie non synchronisée' });
  // Le traitement IndexedDB n'a pas encore démarré dans la microtask.
  first.lock();
  const second = open('account-b');
  await saving;
  assert.deepEqual(await second.vault.listStateRecords(), []);
  const reopened = open('account-a');
  const [record] = await reopened.vault.listStateRecords();
  assert.deepEqual(JSON.parse(record.value), { name: 'Dernière saisie non synchronisée' });
  assert.equal(record.dirty, true);
  assert.equal(record.cloudRevision, 0);
});

test('un binaire déjà accepté reste sauvegardé sans livrer son résultat au callback révoqué', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const input = { uid: 'account-a', cartularyId: 'cart-private', backend, storage };
  const session = createVerifiedLocalVaultSession(input);
  const saving = session.vault.putBinary({
    binaryId: 'proof', kind: 'owner_document', fileName: 'proof.pdf', mimeType: 'application/pdf',
    sha256: 'a'.repeat(64), blob: new Blob(['preuve encore locale']),
  });
  session.lock();
  await assert.rejects(saving, LocalVaultAccessError);
  const reopened = createVerifiedLocalVaultSession(input);
  const record = await reopened.vault.getBinary('proof');
  assert.equal(await record.blob.text(), 'preuve encore locale');
  assert.equal(record.dirty, true);
});

test('un résultat de lecture retardé ne ressort pas après révocation du handle', async () => {
  let finishRead;
  let readStarted;
  const started = new Promise((resolve) => { readStarted = resolve; });
  class DelayedBackend extends MemoryVaultBackend {
    async listState(cartularyId) {
      const records = await super.listState(cartularyId);
      readStarted();
      await new Promise((resolve) => { finishRead = resolve; });
      return records;
    }
  }
  const backend = new DelayedBackend();
  const session = createVerifiedLocalVaultSession({ uid: 'account-a', cartularyId: 'cart-private', backend, storage: new MemoryStorage() });
  await session.vault.writeJson('cartularia-owner-fields', { name: 'Privé' });
  const reading = session.vault.listStateRecords();
  await started;
  session.lock();
  finishRead();
  await assert.rejects(reading, LocalVaultAccessError);
});

test('un ancien résultat cloud ne peut réhydrater ni acquitter un brouillon après verrouillage', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const input = { uid: 'account-a', cartularyId: 'cart-private', backend, storage };
  const session = createVerifiedLocalVaultSession(input);
  await session.vault.writeRaw('cartularia-owner-fields', 'brouillon local');
  const latePull = session.vault.applyCloudState({
    id: '', cartularyId: 'cart-private', key: 'cartularia-owner-fields', value: 'ancien cloud',
    updatedAt: 100, dirty: false, deleted: false, cloudRevision: 3,
  });
  session.lock();
  await assert.rejects(latePull, LocalVaultAccessError);
  await assert.rejects(session.vault.markStateCloudSynced('cartularia-owner-fields', 4), LocalVaultAccessError);
  const [record] = await createVerifiedLocalVaultSession(input).vault.listStateRecords();
  assert.equal(record.value, 'brouillon local');
  assert.equal(record.dirty, true);
});

test('les anciens caches sans identité restent intacts sans être attribués au premier compte connecté', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const legacyStorage = new ScopedStorage(storage, 'cart-private');
  const legacy = new CartulariaLocalVault('cart-private', backend, legacyStorage);
  await legacy.writeRaw('cartularia-owner-fields', 'ancien brouillon sans auteur prouvé');
  await legacy.putBinary({
    binaryId: 'proof', kind: 'owner_document', fileName: 'proof.pdf', mimeType: 'application/pdf',
    sha256: 'a'.repeat(64), blob: new Blob(['ancien original']),
  });
  for (const uid of ['account-a', 'account-b']) {
    const session = createVerifiedLocalVaultSession({ uid, cartularyId: 'cart-private', backend, storage });
    await session.vault.restoreLocalStorage();
    assert.equal(session.storage.getItem('cartularia-owner-fields'), null);
    assert.deepEqual(await session.vault.listStateRecords(), []);
    assert.equal(await session.vault.getBinary('proof'), null);
    session.lock();
  }
  assert.equal(legacyStorage.getItem('cartularia-owner-fields'), 'ancien brouillon sans auteur prouvé');
  assert.equal((await legacy.listStateRecords())[0].dirty, true);
  assert.equal(await (await legacy.getBinary('proof')).blob.text(), 'ancien original');
});

test('la suppression volontaire du cache d’un compte conserve les brouillons des autres comptes', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const first = createVerifiedLocalVaultSession({ uid: 'account-a', cartularyId: 'cart-private', backend, storage });
  const second = createVerifiedLocalVaultSession({ uid: 'account-b', cartularyId: 'cart-private', backend, storage });
  await first.vault.writeRaw('cartularia-owner-fields', 'A');
  await second.vault.writeRaw('cartularia-owner-fields', 'B');
  await first.vault.deleteAllLocalData();
  assert.equal(first.storage.getItem('cartularia-owner-fields'), null);
  assert.deepEqual(await first.vault.listStateRecords(), []);
  assert.equal(second.storage.getItem('cartularia-owner-fields'), 'B');
  assert.equal((await second.vault.listStateRecords())[0].value, 'B');
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

test('un coffre IndexedDB vide ne crée aucune valeur métier par défaut pendant la restauration', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const vault = new CartulariaLocalVault('cart-empty-bootstrap', backend, storage, () => 100);

  await vault.restoreLocalStorage();

  assert.equal(storage.getItem('cartularia-owner-fields'), null);
  assert.equal(storage.getItem('cartularia-media-assets-v3'), null);
  assert.deepEqual(await vault.listStateRecords(), []);
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
  await vault.prepareStateConflictResolution('cartularia-owner-fields', 7, (await vault.listStateRecords())[0]);
  await vault.prepareBinaryConflictResolution('conflicted-file', 4, await vault.getBinary('conflicted-file'));
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
