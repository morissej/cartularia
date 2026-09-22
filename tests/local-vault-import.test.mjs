import assert from 'node:assert/strict';
import test from 'node:test';
import { CartulariaLocalVault, LocalVaultAccessError, LocalVaultImportConflictError, MemoryVaultBackend, createVerifiedLocalVaultSession } from '../src/persistence/localVault.ts';

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const key = 'cartularia-imported-references';
const cartularyId = 'cart-import';
const binary = (binaryId) => ({ binaryId, kind: 'media', fileName: `${binaryId}.jpg`, mimeType: 'image/jpeg',
  sha256: 'a'.repeat(64), blob: new Blob([`original:${binaryId}`]) });
const append = (...ids) => (current) => JSON.stringify([...(JSON.parse(current ?? '[]')), ...ids]);
const batch = (...ids) => ({ key, binaries: ids.map(binary), update: append(...ids) });
const environment = (backend = new MemoryVaultBackend()) => {
  const storage = new MemoryStorage();
  const open = () => new CartulariaLocalVault(cartularyId, backend, storage, () => 100);
  return { backend, storage, open, first: open(), second: open() };
};
const gate = () => {
  let started; let release;
  return { started: new Promise((resolve) => { started = resolve; }), wait: new Promise((resolve) => { release = resolve; }), start: () => started(), release: () => release() };
};
class DeferredBackend extends MemoryVaultBackend {
  beforeState = null;
  afterImport = null;
  async mutateState(id, update) {
    const pending = this.beforeState;
    this.beforeState = null;
    if (pending) { pending.start(); await pending.wait; }
    return super.mutateState(id, update);
  }
  async commitImport(id, binaries, update) {
    const result = await super.commitImport(id, binaries, update);
    const pending = this.afterImport;
    this.afterImport = null;
    if (pending) { pending.start(); await pending.wait; }
    return result;
  }
}

test('un import crée les originaux et leurs références ensemble, dirty et versionnés', async () => {
  const { first, storage } = environment();
  const state = await first.commitImport(batch('one', 'two'));
  assert.deepEqual(JSON.parse(state.value), ['one', 'two']);
  assert.deepEqual([state.dirty, state.deleted, state.cloudRevision], [true, false, 0]);
  assert.ok(state.localVersion && state.localLineage);
  assert.ok(state.localImportVersion);
  assert.equal(first.getImportVersion(key), state.localImportVersion);
  assert.equal(storage.getItem(key), state.value);
  for (const record of await first.listBinaryRecords()) {
    assert.equal(await record.blob.text(), `original:${record.binaryId}`);
    assert.deepEqual([record.dirty, record.deleted, record.cloudRevision], [true, false, 0]);
    assert.ok(record.localVersion && record.localLineage);
    assert.equal(record.sha256, `sha256:${'a'.repeat(64)}`);
  }
  assert.equal((await first.listBinaryRecords()).length, 2);
  assert.equal([...storage.values.keys()].some((entry) => entry.startsWith('cartularia-vault-intent-')), false, 'aucune intention d’import préalable');
});

test('une condition texte sans fichiers utilise aussi le commit atomique', async () => {
  const { first } = environment();
  const state = await first.commitImport({ key, binaries: [], update: append('text-only') });
  assert.deepEqual(JSON.parse(state.value), ['text-only']);
  assert.deepEqual(await first.listBinaryRecords(), []);
});

test('une fusion refusée ne laisse aucun original et garde les données préexistantes', async () => {
  const { first, storage } = environment();
  await first.commitImport(batch('existing'));
  const before = [...storage.values];
  const [old] = await first.listStateRecords();
  await assert.rejects(first.commitImport({ ...batch('new-one', 'new-two'), update: () => { throw new Error('invalid references'); } }), /invalid references/);
  assert.deepEqual(await first.listStateRecords(), [old]);
  assert.deepEqual([...storage.values], before);
  assert.equal((await first.listBinaryRecords()).length, 1);
  assert.equal(await (await first.getBinary('existing')).blob.text(), 'original:existing');
});

test('une collision de la deuxième identité annule tout le lot sans remplacer l’original', async () => {
  const { first, storage } = environment();
  await first.commitImport(batch('existing'));
  const before = [...storage.values];
  const existing = await first.getBinary('existing');
  await assert.rejects(first.commitImport(batch('new-one', 'existing')), /identifiant existe déjà/);
  assert.equal(await first.getBinary('new-one'), null);
  assert.deepEqual(await first.getBinary('existing'), existing);
  assert.deepEqual([...storage.values], before);
});

test('les identités dupliquées et les métadonnées invalides sont refusées avant la transaction', async () => {
  const { first, backend, storage } = environment();
  let called = false;
  backend.commitImport = async () => { called = true; throw new Error('unexpected transaction'); };
  await assert.rejects(first.commitImport(batch('duplicate', 'duplicate')), /identifiant existe déjà/);
  await assert.rejects(first.commitImport({ key, binaries: [{ ...binary('bad'), sha256: 'invalid' }], update: append('bad') }), /Original préparé invalide/);
  await assert.rejects(first.commitImport({ ...batch('bad-key'), key: 'outside-scope' }), /Référence locale/);
  assert.equal(called, false);
  assert.equal(storage.length, 0);
});

test('un refus de stockage quota ne crée ni état, ni original, ni intention d’import', async () => {
  const { first, backend, storage } = environment();
  backend.commitImport = async () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  await assert.rejects(first.commitImport(batch('one', 'two')), { name: 'QuotaExceededError' });
  assert.equal(backend.state.size, 0);
  assert.equal(backend.binaries.size, 0);
  assert.equal(storage.length, 0);
});

test('le backend mémoire prépare tous les clones avant son commit, même si le deuxième échoue', async () => {
  const { first, backend, storage } = environment();
  const inputs = batch('one', 'two');
  inputs.binaries[1].uncloneable = () => {};
  await assert.rejects(first.commitImport(inputs), { name: 'DataCloneError' });
  assert.equal(backend.state.size, 0);
  assert.equal(backend.binaries.size, 0);
  assert.equal(storage.length, 0);
});

test('le même lot peut être repris après échec, puis refuse une répétition déjà commise', async () => {
  const { first } = environment();
  await assert.rejects(first.commitImport({ ...batch('one', 'two'), update: () => { throw new Error('abort'); } }), /abort/);
  const saved = await first.commitImport(batch('one', 'two'));
  await assert.rejects(first.commitImport(batch('one', 'two')), /identifiant existe déjà/);
  assert.deepEqual(await first.listStateRecords(), [saved]);
  assert.equal((await first.listBinaryRecords()).length, 2);
});

test('deux imports concurrents fusionnent leurs références au lieu de réécrire un snapshot périmé', async () => {
  const { first, second } = environment();
  await Promise.all([first.commitImport(batch('one')), second.commitImport(batch('two'))]);
  assert.deepEqual(JSON.parse((await first.listStateRecords())[0].value), ['one', 'two']);
  assert.equal((await second.listBinaryRecords()).length, 2);
});

test('l’intention utilisateur antérieure est fusionnée et consommée sans rejouer par-dessus les références importées', async () => {
  const { first, second, backend } = environment(new DeferredBackend());
  await first.writeRaw(key, '["existing"]');
  backend.beforeState = gate();
  const paused = backend.beforeState;
  const edit = second.writeRaw(key, '["existing","pending-edit"]');
  await paused.started;
  const saved = await first.commitImport(batch('imported'));
  assert.deepEqual(JSON.parse(saved.value), ['existing', 'pending-edit', 'imported']);
  paused.release();
  await edit;
  await second.restoreLocalStorage();
  assert.deepEqual(await second.listStateRecords(), [saved]);
});

test('la projection localStorage refusée après commit reste un succès durable et la reprise respecte le receipt', async () => {
  const { first, second, backend, storage, open } = environment(new DeferredBackend());
  backend.beforeState = gate();
  const paused = backend.beforeState;
  const edit = second.writeRaw(key, '["pending-edit"]');
  await paused.started;
  const set = storage.setItem.bind(storage);
  storage.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  const saved = await first.commitImport(batch('imported'));
  assert.deepEqual(JSON.parse(saved.value), ['pending-edit', 'imported']);
  assert.equal((await first.listBinaryRecords()).length, 1);
  storage.setItem = set;
  paused.release();
  await edit;
  const reopened = open();
  await reopened.restoreLocalStorage();
  assert.equal(storage.getItem(key), saved.value);
  assert.equal((await reopened.listStateRecords())[0].localVersion, saved.localVersion);
});

test('une session fermée avant les écritures transactionnelles refuse tout le lot', async () => {
  const { first, backend, storage } = environment();
  await assert.rejects(first.commitImport({ ...batch('one'), update: () => { first.revokeAccess(); return '["one"]'; } }), LocalVaultAccessError);
  assert.equal(backend.state.size, 0);
  assert.equal(backend.binaries.size, 0);
  assert.equal(storage.length, 0);
});

test('le verrouillage après commit ne transforme pas la réussite durable en erreur', async () => {
  const { first, backend, storage, open } = environment(new DeferredBackend());
  backend.afterImport = gate();
  const paused = backend.afterImport;
  const importing = first.commitImport(batch('one'));
  await paused.started;
  first.revokeAccess();
  paused.release();
  const saved = await importing;
  assert.deepEqual(JSON.parse(saved.value), ['one']);
  assert.equal(storage.getItem(key), null, 'aucune projection sur le handle révoqué');
  const reopened = open();
  await reopened.restoreLocalStorage();
  assert.equal(storage.getItem(key), saved.value);
  assert.equal(await (await reopened.getBinary('one')).blob.text(), 'original:one');
});

test('une mutation du tableau appelant après lancement ne substitue pas les originaux préparés', async () => {
  const { first } = environment();
  const input = batch('one');
  const saving = first.commitImport(input);
  input.binaries[0].binaryId = 'replaced';
  input.binaries[0].blob = new Blob(['replaced']);
  input.key = 'cartularia-other-key';
  await saving;
  assert.equal(await (await first.getBinary('one')).blob.text(), 'original:one');
  assert.equal(await first.getBinary('replaced'), null);
  assert.equal((await first.listStateRecords())[0].key, key);
});

test('un ancien acquittement ne nettoie pas l’état mis à jour par le lot', async () => {
  const { first } = environment();
  await first.writeRaw(key, '["old"]');
  const [sent] = await first.listStateRecords();
  const imported = await first.commitImport(batch('one'));
  assert.notEqual(imported.localVersion, sent.localVersion);
  assert.equal(await first.markStateCloudSynced(key, 1, sent), false);
  const [current] = await first.listStateRecords();
  assert.deepEqual([JSON.parse(current.value), current.dirty, current.cloudRevision], [['old', 'one'], true, 1]);
});

test('les références legacy encore présentes dans le cache sont incluses au premier import', async () => {
  const { first, storage } = environment();
  storage.setItem(key, '["legacy"]');
  const result = await first.commitImport(batch('one'));
  assert.deepEqual(JSON.parse(result.value), ['legacy', 'one']);
});

test('une saisie arrivée pendant update refuse le lot sans retirer la nouvelle saisie', async () => {
  const { first, second } = environment();
  let edit;
  await assert.rejects(first.commitImport({ ...batch('one'), update: (value) => {
    edit = second.writeRaw(key, '["new-edit"]');
    return append('one')(value);
  } }), /modification locale est survenue/);
  await edit;
  assert.deepEqual(JSON.parse((await second.listStateRecords())[0].value), ['new-edit']);
  assert.equal(await second.getBinary('one'), null);
});

test('la transaction conserve les namespaces entre comptes pour des identifiants identiques', async () => {
  const backend = new MemoryVaultBackend();
  const storage = new MemoryStorage();
  const a = createVerifiedLocalVaultSession({ uid: 'a', cartularyId, backend, storage });
  const b = createVerifiedLocalVaultSession({ uid: 'b', cartularyId, backend, storage });
  await a.vault.commitImport(batch('same-id'));
  await b.vault.commitImport({ ...batch('same-id'), update: append('private-b') });
  assert.deepEqual(JSON.parse((await a.vault.listStateRecords())[0].value), ['same-id']);
  assert.deepEqual(JSON.parse((await b.vault.listStateRecords())[0].value), ['private-b']);
  assert.equal(backend.state.size, 2);
  assert.equal(backend.binaries.size, 2);
});

test('une intention tardive préparée avant la projection du lot est refusée et conservée hors replay', async () => {
  const { first, second, backend, storage } = environment(new DeferredBackend());
  const displayedImportVersion = second.getImportVersion(key);
  backend.afterImport = gate();
  const paused = backend.afterImport;
  const importing = first.commitImport(batch('one'));
  await paused.started;
  await assert.rejects(second.writeRaw(key, '["my-edit"]', { expectedImportVersion: displayedImportVersion }), LocalVaultImportConflictError);
  paused.release();
  const imported = await importing;
  await second.restoreLocalStorage();
  assert.deepEqual(JSON.parse((await second.listStateRecords())[0].value), ['one']);
  assert.equal(await (await second.getBinary('one')).blob.text(), 'original:one');
  const conflicts = [...storage.values].filter(([name]) => name.startsWith('cartularia-vault-import-conflict-v1::'));
  assert.equal(conflicts.length, 1);
  assert.equal(JSON.parse(conflicts[0][1]).value, '["my-edit"]');
  assert.equal(JSON.parse(conflicts[0][1]).currentImportVersion, imported.localImportVersion);
  await second.writeJson(key, ['one', 'my-edit'], { expectedImportVersion: second.getImportVersion(key) });
  assert.deepEqual(JSON.parse((await second.listStateRecords())[0].value), ['one', 'my-edit']);
  assert.equal(storage.getItem(conflicts[0][0]), conflicts[0][1], 'la saisie refusée reste récupérable après une nouvelle sauvegarde');
});

test('un ancien snapshot UI reste refusé même quand le marqueur partagé a déjà avancé', async () => {
  const { first, second } = environment();
  const oldSnapshotImportVersion = second.getImportVersion(key);
  const imported = await first.commitImport(batch('one'));
  assert.equal(second.getImportVersion(key), imported.localImportVersion);
  await assert.rejects(second.writeJson(key, ['stale'], { expectedImportVersion: oldSnapshotImportVersion }), LocalVaultImportConflictError);
  assert.deepEqual(JSON.parse((await second.listStateRecords())[0].value), ['one']);
});

test('le fence d’import survit à un pull cloud et refuse encore une saisie de l’ancien snapshot', async () => {
  const { first, second } = environment();
  const oldSnapshotImportVersion = second.getImportVersion(key);
  const imported = await first.commitImport(batch('one'));
  assert.equal(await first.markStateCloudSynced(key, 1, imported), true);
  const [sent] = await first.listStateRecords();
  assert.equal(await first.applyCloudState({ ...sent, localImportVersion: undefined, cloudRevision: 2 }, sent), true);
  assert.equal((await first.listStateRecords())[0].localImportVersion, imported.localImportVersion);
  await assert.rejects(second.writeJson(key, ['stale'], { expectedImportVersion: oldSnapshotImportVersion }), LocalVaultImportConflictError);
  assert.deepEqual(JSON.parse((await second.listStateRecords())[0].value), ['one']);
});

test('si la quarantaine manque de quota, le payload reste dans le journal et ne peut pas écraser l’import', async () => {
  const { first, second, storage } = environment();
  const oldImportVersion = second.getImportVersion(key);
  await first.commitImport(batch('one'));
  const set = storage.setItem.bind(storage);
  storage.setItem = (name, value) => {
    if (name.startsWith('cartularia-vault-import-conflict-v1::')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    set(name, value);
  };
  await assert.rejects(second.writeRaw(key, '["recoverable"]', { expectedImportVersion: oldImportVersion }), LocalVaultImportConflictError);
  assert.deepEqual(JSON.parse((await first.listStateRecords())[0].value), ['one']);
  assert.ok([...storage.values].some(([name, value]) => name.startsWith('cartularia-vault-intent-v2::') && JSON.parse(value).value === '["recoverable"]'));
  storage.setItem = set;
  await assert.rejects(second.restoreLocalStorage(), LocalVaultImportConflictError);
  await second.restoreLocalStorage();
  assert.deepEqual(JSON.parse(storage.getItem(key)), ['one']);
  assert.ok([...storage.values].some(([name, value]) => name.startsWith('cartularia-vault-import-conflict-v1::') && JSON.parse(value).value === '["recoverable"]'));
});

for (const failSecondArchive of [false, true]) {
  test(`toutes les saisies rapides obsolètes sortent du replay en une reprise${failSecondArchive ? ', même après un quota partiel' : ''}`, async () => {
    const { first, second, backend, storage } = environment(new DeferredBackend());
    const expectedImportVersion = second.getImportVersion(key);
    const imported = await first.commitImport(batch('one'));
    backend.beforeState = gate();
    const paused = backend.beforeState;
    const payloads = ['["draft-1"]', '["draft-2"]', '["draft-3"]'];
    const edits = payloads.map((value) => second.writeRaw(key, value, { expectedImportVersion }).then(
      () => ({ saved: true }), (error) => ({ error }),
    ));
    await paused.started;
    const set = storage.setItem.bind(storage);
    if (failSecondArchive) {
      let archived = 0;
      storage.setItem = (name, value) => {
        if (name.startsWith('cartularia-vault-import-conflict-v1::') && ++archived > 1) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        set(name, value);
      };
      await assert.rejects(first.restoreLocalStorage(), LocalVaultImportConflictError);
      const preserved = [...storage.values].filter(([name]) => name.startsWith('cartularia-vault-import-conflict-v1::') || name.startsWith('cartularia-vault-intent-v2::'))
        .map(([, value]) => JSON.parse(value).value).filter(Boolean);
      assert.deepEqual(preserved.sort(), [...payloads].sort(), 'aucun payload perdu pendant le déplacement partiel');
      storage.setItem = set;
    }
    await assert.rejects(first.restoreLocalStorage(), LocalVaultImportConflictError);
    await first.restoreLocalStorage();
    assert.deepEqual(await first.listStateRecords(), [imported]);
    assert.deepEqual(JSON.parse(storage.getItem(key)), ['one']);
    const archived = [...storage.values].filter(([name]) => name.startsWith('cartularia-vault-import-conflict-v1::'));
    assert.deepEqual(archived.map(([, value]) => JSON.parse(value).value).sort(), [...payloads].sort());
    assert.equal([...storage.values.keys()].some((name) => name.startsWith('cartularia-vault-intent-v2::')), false);
    paused.release();
    for (const outcome of await Promise.all(edits)) assert.ok(outcome.error instanceof LocalVaultImportConflictError, 'un ancien callback ne doit pas annoncer une saisie sauvegardée');
  });
}
