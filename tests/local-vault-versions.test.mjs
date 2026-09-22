import assert from 'node:assert/strict';
import test from 'node:test';
import { CartulariaLocalVault, LocalVaultAccessError, MemoryVaultBackend, createVerifiedLocalVaultSession } from '../src/persistence/localVault.ts';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class DeferredBackend extends MemoryVaultBackend {
  gate = null;
  deferNext(store, phase = 'before') {
    let start; let release;
    const gate = { store, phase, started: new Promise((resolve) => { start = resolve; }), wait: new Promise((resolve) => { release = resolve; }), start, release };
    this.gate = gate;
    return gate;
  }
  async mutate(store, id, update) {
    const gate = this.gate?.store === store ? this.gate : null;
    if (gate) this.gate = null;
    if (gate?.phase === 'before') { gate.start(); await gate.wait; }
    const result = await (store === 'state' ? super.mutateState(id, update) : super.mutateBinary(id, update));
    if (gate?.phase === 'after') { gate.start(); await gate.wait; }
    return result;
  }
  mutateState(id, update) { return this.mutate('state', id, update); }
  mutateBinary(id, update) { return this.mutate('binary', id, update); }
}

const key = 'cartularia-versioned-note';
const cartularyId = 'cart-versions';
const binaryInput = (text) => ({
  binaryId: 'binary-proof', kind: 'media', fileName: `${text}.jpg`, mimeType: 'image/jpeg',
  sha256: (text === 'A' ? 'a' : 'b').repeat(64), blob: new Blob([text]),
});
const cloudState = (value = 'cloud', cloudRevision = 1) => ({
  id: '', cartularyId, key, value, updatedAt: 50, dirty: false, deleted: false, cloudRevision,
});
function environment() {
  const backend = new DeferredBackend();
  const storage = new MemoryStorage();
  const open = () => new CartulariaLocalVault(cartularyId, backend, storage, () => 100);
  return { backend, storage, first: open(), second: open(), open };
}

test('un acquittement state retardé rebase mais ne nettoie pas une saisie plus récente, même à horloge identique', async () => {
  const { first, second, backend, storage } = environment();
  await first.writeRaw(key, 'A');
  const [sent] = await first.listStateRecords();
  const gate = backend.deferNext('state');
  const ack = first.markStateCloudSynced(key, 1, sent);
  await gate.started;
  await second.writeRaw(key, 'B');
  gate.release();
  assert.equal(await ack, false);
  const [current] = await second.listStateRecords();
  assert.notEqual(current.localVersion, sent.localVersion);
  assert.equal(current.updatedAt, sent.updatedAt);
  assert.deepEqual([current.value, current.dirty, current.cloudRevision, storage.getItem(key)], ['B', true, 1, 'B']);
  assert.equal(await second.markStateCloudSynced(key, 2, current), true);
  assert.equal((await second.listStateRecords())[0].dirty, false);
});

test('un acquittement binaire obsolète conserve les nouveaux octets dirty et ne colle pas l’ancien chemin', async () => {
  const { first, second, backend } = environment();
  const sent = await first.putBinary(binaryInput('A'));
  const gate = backend.deferNext('binary');
  const ack = first.markBinaryCloudSynced(sent.binaryId, 1, 'cloud/original-A', sent);
  await gate.started;
  await second.putBinary(binaryInput('B'));
  gate.release();
  assert.equal(await ack, false);
  const current = await second.getBinary(sent.binaryId);
  assert.equal(await current.blob.text(), 'B');
  assert.deepEqual([current.dirty, current.cloudRevision, current.cloudStoragePath], [true, 1, null]);
  assert.notEqual(current.localVersion, sent.localVersion);
});

for (const operation of ['put', 'delete']) {
  test(`une ancienne mutation binaire ${operation} acceptée avant verrouillage ne remplace pas les nouveaux octets`, async () => {
    const { first, second, backend, storage } = environment();
    await first.putBinary(binaryInput('A'));
    const gate = backend.deferNext('binary');
    const delayed = operation === 'put' ? first.putBinary(binaryInput('A')) : first.deleteBinary('binary-proof');
    const rejected = assert.rejects(delayed, LocalVaultAccessError);
    await gate.started;
    first.revokeAccess();
    const newer = await second.putBinary(binaryInput('B'));
    gate.release();
    await rejected;
    const current = await second.getBinary('binary-proof');
    assert.equal(current.localVersion, newer.localVersion);
    assert.deepEqual([await current.blob.text(), current.deleted, current.dirty], ['B', false, true]);
    const journal = [...storage.values].filter(([name]) => name.startsWith('cartularia-vault-binary-intent-v1::'));
    assert.equal(journal.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(journal[0][1])).sort(), ['committed', 'key', 'sequence', 'updatedAt', 'version']);
    assert.equal(JSON.parse(journal[0][1]).committed, true, 'aucun Blob ni payload du fichier dans localStorage');
  });
}

test('un pull state commencé avant une saisie encore en queue ne remplace pas sa valeur visible', async () => {
  const { first, backend, storage } = environment();
  await first.applyCloudState(cloudState('A'), null);
  const [expected] = await first.listStateRecords();
  const gate = backend.deferNext('state');
  const pull = first.applyCloudState(cloudState('remote-B', 2), expected);
  await gate.started;
  const write = first.writeRaw(key, 'local-C');
  assert.equal(storage.getItem(key), 'local-C');
  gate.release();
  assert.equal(await pull, false);
  await write;
  const [current] = await first.listStateRecords();
  assert.deepEqual([current.value, current.dirty, storage.getItem(key)], ['local-C', true, 'local-C']);
});

test('un pull binaire et un arbitrage explicite périmés ne remplacent pas une autre modification', async () => {
  const { first, second, backend } = environment();
  const original = await first.putBinary(binaryInput('A'));
  await first.markBinaryCloudSynced(original.binaryId, 1, 'cloud/A', original);
  const expected = await first.getBinary(original.binaryId);
  const gate = backend.deferNext('binary');
  const pull = first.applyCloudBinary({ ...expected, blob: new Blob(['cloud']), cloudRevision: 2 }, expected);
  await gate.started;
  await second.putBinary(binaryInput('B'));
  gate.release();
  assert.equal(await pull, false);
  assert.equal(await first.prepareBinaryConflictResolution(original.binaryId, 3, expected), false);
  assert.equal(await first.applyCloudBinary({ ...expected, cloudRevision: 3 }, expected, { allowDirty: true }), false);
  assert.equal(await (await second.getBinary(original.binaryId)).blob.text(), 'B');
});

test('les pulls refusent dirty par défaut et un choix explicite ne vaut que pour la version montrée', async () => {
  const { first, second } = environment();
  await first.writeRaw(key, 'local');
  const [expected] = await first.listStateRecords();
  assert.equal(await first.applyCloudState(cloudState(), expected), false);
  assert.equal(await first.applyCloudState(cloudState(), expected, { allowDirty: true }), true);
  const [accepted] = await first.listStateRecords();
  assert.notEqual(accepted.localVersion, expected.localVersion);
  await second.writeRaw(key, 'newer');
  assert.equal(await first.prepareStateConflictResolution(key, 2, accepted), false);
  assert.equal(await first.applyCloudState(cloudState('discard', 2), accepted, { allowDirty: true }), false);
  assert.equal((await first.listStateRecords())[0].value, 'newer');
});

test('insert-if-absent ne remplace jamais un état ou un binaire créé entre-temps', async () => {
  const { first } = environment();
  await first.writeRaw(key, 'local');
  const binary = await first.putBinary(binaryInput('A'));
  assert.equal(await first.applyCloudState(cloudState(), null), false);
  assert.equal(await first.applyCloudBinary({ ...binary, blob: null, dirty: false }, null), false);
  assert.equal((await first.listStateRecords())[0].dirty, true);
  assert.equal(await (await first.getBinary(binary.binaryId)).blob.text(), 'A');
});

test('une suppression locale produit sa propre version et résiste à l’acquittement de l’objet antérieur', async () => {
  const { first } = environment();
  await first.writeRaw(key, 'A');
  const [sent] = await first.listStateRecords();
  const binary = await first.putBinary(binaryInput('A'));
  await first.removeKey(key);
  await first.deleteBinary(binary.binaryId);
  assert.equal(await first.markStateCloudSynced(key, 1, sent), false);
  assert.equal(await first.markBinaryCloudSynced(binary.binaryId, 1, 'cloud/A', binary), false);
  const [state] = await first.listStateRecords();
  const current = await first.getBinary(binary.binaryId);
  assert.deepEqual([state.deleted, state.dirty, state.cloudRevision], [true, true, 1]);
  assert.deepEqual([current.deleted, current.dirty, current.cloudRevision], [true, true, 1]);
});

test('une révision rebasée reste dirty et aucune réponse ancienne ne fait régresser la révision', async () => {
  const { first } = environment();
  await first.writeRaw(key, 'A');
  const [state] = await first.listStateRecords();
  const binary = await first.putBinary(binaryInput('A'));
  assert.equal(await first.rebaseStateCloudRevision(key, 5, state), true);
  assert.equal(await first.rebaseBinaryCloudRevision(binary.binaryId, 5, binary), true);
  assert.equal(await first.markStateCloudSynced(key, 4, state), false);
  assert.equal(await first.markBinaryCloudSynced(binary.binaryId, 4, 'old', binary), false);
  assert.deepEqual([(await first.listStateRecords())[0].dirty, (await first.listStateRecords())[0].cloudRevision], [true, 5]);
  assert.deepEqual([(await first.getBinary(binary.binaryId)).dirty, (await first.getBinary(binary.binaryId)).cloudRevision], [true, 5]);
});

for (const operation of ['restore', 'prepare']) {
  test(`la projection localStorage ${operation} retardée après commit ne remplace pas l’édition d’une seconde instance`, async () => {
    const { first, second, backend, storage } = environment();
    await first.writeRaw(key, 'A');
    const [expected] = await first.listStateRecords();
    const gate = backend.deferNext('state', 'after');
    const pending = operation === 'restore' ? first.restoreLocalStorage() : first.prepareStateConflictResolution(key, 2, expected);
    await gate.started;
    await second.writeRaw(key, 'B');
    gate.release();
    await pending;
    assert.equal(storage.getItem(key), 'B');
    assert.equal((await second.listStateRecords())[0].value, 'B');
  });
}

test('les anciennes lignes reçoivent une version durable unique avant exposition, même via deux sessions', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  await backend.putState({ ...cloudState('legacy'), id: `${cartularyId}::${key}` });
  const first = new CartulariaLocalVault(cartularyId, backend, storage);
  const second = new CartulariaLocalVault(cartularyId, backend, storage);
  const [[a], [b]] = await Promise.all([first.listStateRecords(), second.listStateRecords()]);
  assert.equal(typeof a.localVersion, 'string');
  assert.equal(a.localVersion, b.localVersion);
  const reopened = new CartulariaLocalVault(cartularyId, backend, new MemoryStorage());
  assert.equal((await reopened.listStateRecords())[0].localVersion, a.localVersion);
  assert.equal(await first.markStateCloudSynced(key, 2), false, 'aucun acquittement sans snapshot capturé');
});

test('les opérations conditionnelles gardent l’isolation P1 entre deux comptes', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const a = createVerifiedLocalVaultSession({ uid: 'a', cartularyId, backend, storage }).vault;
  const b = createVerifiedLocalVaultSession({ uid: 'b', cartularyId, backend, storage }).vault;
  await a.writeRaw(key, 'private-A');
  await b.writeRaw(key, 'private-B');
  const [expectedA] = await a.listStateRecords();
  assert.equal(await b.markStateCloudSynced(key, 1, expectedA), false);
  assert.equal((await b.listStateRecords())[0].dirty, true);
  assert.equal((await b.listStateRecords())[0].cloudRevision, 0);
  assert.equal((await a.listStateRecords())[0].value, 'private-A');
});

test('un ancien acquittement ne rebase pas une entrée recréée après effacement volontaire du cache', async () => {
  const { first } = environment();
  await first.writeRaw(key, 'ancien');
  const [sent] = await first.listStateRecords();
  await first.deleteAllLocalData();
  await first.writeRaw(key, 'nouveau');
  assert.equal(await first.markStateCloudSynced(key, 5, sent), false);
  const [current] = await first.listStateRecords();
  assert.notEqual(current.localLineage, sent.localLineage);
  assert.deepEqual([current.value, current.cloudRevision, current.dirty], ['nouveau', 0, true]);
});

test('une projection synchrone ne détruit pas le payload saisi juste après son contrôle', async () => {
  const { first, second, storage } = environment();
  await first.applyCloudState(cloudState('A'), null);
  const [expected] = await first.listStateRecords();
  const project = first.projectState.bind(first);
  let writing;
  first.projectState = (record) => {
    if (record.value === 'cloud-late') writing = second.writeRaw(key, 'new local payload');
    project(record);
  };
  await first.applyCloudState(cloudState('cloud-late', 2), expected);
  await writing;
  assert.equal(storage.getItem(key), 'new local payload');
  const [record] = await second.listStateRecords();
  assert.deepEqual([record.value, record.dirty], ['new local payload', true]);
});

for (const deleted of [false, true]) {
  test(`reprise avant premier commit IDB : le journal retrouve ${deleted ? 'le tombstone' : 'la nouvelle valeur'} même sans ligne existante`, async () => {
    const { first, second, backend, storage } = environment();
    const gate = backend.deferNext('state');
    const writing = deleted ? first.removeKey(key) : first.writeRaw(key, 'durable pending payload');
    await gate.started;
    storage.setItem(key, 'projection écrasée avant fermeture');
    await second.restoreLocalStorage();
    const [record] = await second.listStateRecords();
    assert.deepEqual([record.value, record.deleted, record.dirty], [deleted ? null : 'durable pending payload', deleted, true]);
    assert.equal(storage.getItem(key), deleted ? null : 'durable pending payload');
    gate.release();
    await writing;
    assert.equal((await second.listStateRecords())[0].localVersion, record.localVersion);
  });
}

test('un crash après commit avant collecte ne rejoue pas A par-dessus B, même au même milliseconde', async () => {
  const { first, second, backend, storage } = environment();
  const gate = backend.deferNext('state', 'after');
  const writingA = first.writeRaw(key, 'A');
  await gate.started;
  await second.writeRaw(key, 'B');
  const [b] = await second.listStateRecords();
  gate.release();
  await writingA;
  await second.restoreLocalStorage();
  const [record] = await second.listStateRecords();
  assert.equal(record.localVersion, b.localVersion);
  assert.deepEqual([record.value, record.dirty, storage.getItem(key)], ['B', true, 'B']);
  await second.writeRaw(key, 'C');
  const journal = [...storage.values].filter(([name]) => name.startsWith('cartularia-vault-intent-v2::'));
  assert.equal(journal.length, 1, 'collecte bornée après réception durable');
  const checkpoint = JSON.parse(journal[0][1]);
  assert.equal(checkpoint.committed, true);
  assert.equal(checkpoint.value, undefined, 'checkpoint compact sans duplication du payload');
});

test('une ancienne écriture acceptée puis révoquée ne remplace pas l’édition suivante à horloge identique', async () => {
  const { first, second, backend } = environment();
  await first.writeRaw(key, 'initial');
  const gate = backend.deferNext('state');
  const delayed = first.writeRaw(key, 'obsolete queued');
  await gate.started;
  first.revokeAccess();
  await second.writeRaw(key, 'newer committed');
  gate.release();
  await delayed;
  assert.equal((await second.listStateRecords())[0].value, 'newer committed');
});

test('le miroir brut retardé ne transforme pas une projection ancienne en nouvelle édition', async () => {
  const { first, second, backend, storage } = environment();
  await first.applyCloudState(cloudState('A'), null);
  const [expected] = await first.listStateRecords();
  const gate = backend.deferNext('state', 'after');
  const pull = first.applyCloudState(cloudState('new remote', 2), expected);
  await gate.started;
  assert.equal(storage.getItem(key), 'A');
  await second.mirrorLocalStorage();
  gate.release();
  await pull;
  const [record] = await second.listStateRecords();
  assert.deepEqual([record.value, record.dirty, storage.getItem(key)], ['new remote', false, 'new remote']);
});

test('un dépassement de quota avant journalisation conserve la valeur et le checkpoint précédents', async () => {
  const { first, storage } = environment();
  await first.writeRaw(key, 'previous safe value');
  const before = [...storage.values];
  const set = storage.setItem.bind(storage);
  storage.setItem = (name, value) => {
    if (name.startsWith('cartularia-vault-intent-v2::')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    set(name, value);
  };
  assert.throws(() => first.writeRaw(key, 'unaccepted value'), { name: 'QuotaExceededError' });
  assert.deepEqual([...storage.values], before);
  assert.equal((await first.listStateRecords())[0].value, 'previous safe value');
});
