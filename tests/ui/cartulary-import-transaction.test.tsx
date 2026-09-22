import { webcrypto } from 'node:crypto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/persistence/localVault.ts', async (actual) => ({
  ...await actual<typeof import('../../src/persistence/localVault.ts')>(),
  persistCartulariaJson: vi.fn(),
  readCartulariaImportVersion: vi.fn(),
}));
import { CartulariaLocalVault, MemoryVaultBackend, persistCartulariaJson, readCartulariaImportVersion, type StorageLike } from '../../src/persistence/localVault';
import { useCartularyMediaState } from '../../src/features/cartulary/state/useCartularyMediaState';
import { useCartularyConditionState } from '../../src/features/cartulary/state/useCartularyConditionState';
import { prepareImportedAssets, prepareConditionAttachments } from '../../src/features/cartulary/media/importMediaFiles';
import { useAtomicFileImport } from '../../src/features/cartulary/media/useAtomicFileImport';
import type { Asset } from '../../src/types';

const MEDIA_KEY = 'cartularia-media-assets-v3';
const CONDITION_KEY = 'cartularia-condition-entries';
const oldAsset: Asset = { id: 'old', name: 'Original conservé', type: 'image', url: 'https://example.test/original.jpg', hash: 'old', status: 'Archived', visibility: 'Secret', tags: [] };
const jpeg = (name = 'nouveau.jpg') => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], name, { type: 'image/jpeg' });
const pdf = () => new File(['%PDF-1.7\npreuve\n%%EOF'], 'rapport.pdf', { type: 'application/pdf' });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
class TestStorage implements StorageLike {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

let vault: CartulariaLocalVault;
let backend: MemoryVaultBackend;
let storage: TestStorage;
let nextUrl: number;
const onError = vi.fn();
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  backend = new MemoryVaultBackend();
  storage = new TestStorage();
  vault = new CartulariaLocalVault('cart-import', backend, storage);
  nextUrl = 0;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => `blob:import-${++nextUrl}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.mocked(persistCartulariaJson).mockImplementation((key, value, options) => vault.writeJson(key, value, options));
  vi.mocked(readCartulariaImportVersion).mockImplementation((key) => vault.getImportVersion(key));
  onError.mockClear();
});
afterEach(() => vi.unstubAllGlobals());
const mediaHook = () => renderHook(() => {
  const state = useCartularyMediaState({ loadAssets: () => [oldAsset] });
  const operation = useAtomicFileImport({ vault, enabled: true, onError });
  return { ...state, ...operation };
});
const readMedia = async () => JSON.parse((await vault.listStateRecords()).find((row) => row.key === MEDIA_KEY)!.value!);

describe('P5 transaction d’import et références React', () => {
  it('adopte le lot durable, conserve les anciens médias et retire les URL temporaires du stockage', async () => {
    const hook = mediaHook();
    await act(async () => expect(await hook.result.current.run(
      () => prepareImportedAssets({ files: [jpeg()], tags: ['spin-3d'] }),
      (target, prepared) => hook.result.current.commands.importAssets(target, prepared),
    )).toBe(true));
    expect(hook.result.current.mediaAssets).toHaveLength(2);
    expect(hook.result.current.mediaAssets[1].url).toBe('blob:import-1');
    expect(await readMedia()).toEqual([oldAsset, expect.objectContaining({ url: '', tags: ['spin-3d'] })]);
    expect(await vault.listBinaryRecords()).toHaveLength(1);
    expect(vi.mocked(persistCartulariaJson).mock.calls.filter(([key]) => key === MEDIA_KEY)).toHaveLength(1);
    hook.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:import-1');
  });

  it.each(['QuotaExceededError', 'NotAllowedError'])('annule le lot sur %s, libère ses URL et réussit la reprise sans doublon', async (name) => {
    const hook = mediaHook();
    await vault.flush();
    const rejected = vi.spyOn(backend, 'commitImport').mockRejectedValueOnce(new DOMException('Écriture refusée', name));
    const run = () => hook.result.current.run(
      () => prepareImportedAssets({ files: [jpeg('a.jpg'), jpeg('b.jpg')], tags: [] }),
      (target, prepared) => hook.result.current.commands.importAssets(target, prepared),
    );
    await act(async () => expect(await run()).toBe(false));
    expect(hook.result.current.mediaAssets).toEqual([oldAsset]);
    expect(await readMedia()).toEqual([oldAsset]);
    expect(await vault.listBinaryRecords()).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(expect.stringContaining('Aucun fichier du lot'));
    rejected.mockRestore();
    await act(async () => expect(await run()).toBe(true));
    expect(await readMedia()).toHaveLength(3);
    expect(await vault.listBinaryRecords()).toHaveLength(2);
    hook.unmount();
  });

  it('préserve une édition React arrivée pendant le commit et ne réécrit pas un ancien snapshot', async () => {
    const hook = mediaHook();
    await vault.flush();
    const gate = deferred<void>();
    const commit = vault.commitImport.bind(vault);
    vi.spyOn(vault, 'commitImport').mockImplementation(async (input) => { await gate.promise; return commit(input); });
    const prepared = await prepareImportedAssets({ files: [jpeg()], tags: [] });
    let importing!: Promise<void>;
    act(() => { importing = hook.result.current.commands.importAssets(vault, prepared); });
    act(() => hook.result.current.commands.updateAsset('old', { name: 'Titre modifié pendant import' }));
    await act(async () => { gate.resolve(); await importing; });
    await vault.flush();
    expect(hook.result.current.mediaAssets.map((asset) => asset.name)).toEqual(['Titre modifié pendant import', 'nouveau']);
    expect((await readMedia()).map((asset: Asset) => asset.name)).toEqual(['Titre modifié pendant import', 'nouveau']);
    prepared.dispose();
    hook.unmount();
  });

  it('fusionne les références présentes en stockage même si elles ne figurent pas encore dans le rendu', async () => {
    const hook = mediaHook();
    await vault.flush();
    const remote = { ...oldAsset, id: 'other-tab', name: 'Autre onglet' };
    await vault.writeJson(MEDIA_KEY, [oldAsset, remote]);
    const prepared = await prepareImportedAssets({ files: [jpeg()], tags: [] });
    await act(async () => hook.result.current.commands.importAssets(vault, prepared));
    expect(hook.result.current.mediaAssets.map((asset) => asset.id)).toEqual(['old', 'other-tab', prepared.items[0].id]);
    expect(await readMedia()).toHaveLength(3);
    prepared.dispose();
    hook.unmount();
  });

  it('enregistre une pièce d’état avec sa référence, et permet une note sans pièce', async () => {
    const hook = renderHook(() => useCartularyConditionState({ loadChecks: () => [], loadDocumentation: () => [], loadEntries: () => [] }));
    const prepared = await prepareConditionAttachments({ files: [pdf()] });
    await act(async () => hook.result.current.commands.importEntry(vault, prepared, {
      id: 'entry-file', title: 'Expertise', note: '', date: '2026-09-18', attachments: prepared.items,
    }));
    const empty = await prepareConditionAttachments({ files: [] });
    await act(async () => hook.result.current.commands.importEntry(vault, empty, {
      id: 'entry-note', title: 'Observation', note: 'Texte seul', date: '2026-09-19', attachments: [],
    }));
    const raw = (await vault.listStateRecords()).find((row) => row.key === CONDITION_KEY)!.value!;
    expect(raw).not.toContain('blob:');
    expect(JSON.parse(raw).map((entry: { id: string }) => entry.id)).toEqual(['entry-note', 'entry-file']);
    expect(hook.result.current.conditionEntries[1].attachments[0].url).toBe('blob:import-1');
    expect(await vault.listBinaryRecords()).toHaveLength(1);
    prepared.dispose();
    hook.unmount();
  });

  it('n’ajoute pas une référence de rapport si un autre fichier du lot est invalide', async () => {
    const hook = mediaHook();
    await act(async () => expect(await hook.result.current.run(
      () => prepareImportedAssets({ files: [pdf(), jpeg()], tags: ['documentation'], referenceReport: true }),
      (target, prepared) => hook.result.current.commands.importAssets(target, prepared),
    )).toBe(false));
    expect(await vault.listBinaryRecords()).toEqual([]);
    expect(hook.result.current.mediaAssets).toEqual([oldAsset]);
    hook.unmount();
  });

  it('verrouille la double soumission avant même le prochain rendu React', async () => {
    const hook = mediaHook();
    const gate = deferred<void>();
    const prepare = vi.fn(async () => { await gate.promise; return prepareImportedAssets({ files: [jpeg()], tags: [] }); });
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = hook.result.current.run(prepare, (target, batch) => hook.result.current.commands.importAssets(target, batch));
      second = hook.result.current.run(prepare, (target, batch) => hook.result.current.commands.importAssets(target, batch));
    });
    expect(await second).toBe(false);
    expect(prepare).toHaveBeenCalledOnce();
    await act(async () => { gate.resolve(); expect(await first).toBe(true); });
    expect(await readMedia()).toHaveLength(2);
    hook.unmount();
  });

  it.each(['unmount', 'lock'])('libère une préparation tardive après %s sans commencer le commit', async (reason) => {
    const hook = mediaHook();
    const gate = deferred<void>();
    const commit = vi.spyOn(vault, 'commitImport');
    let operation!: Promise<boolean>;
    act(() => { operation = hook.result.current.run(async () => {
      await gate.promise;
      return prepareImportedAssets({ files: [jpeg()], tags: [] });
    }, (target, prepared) => hook.result.current.commands.importAssets(target, prepared)); });
    if (reason === 'unmount') hook.unmount(); else vault.revokeAccess();
    await act(async () => { gate.resolve(); expect(await operation).toBe(false); });
    expect(commit).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:import-1');
    expect(await backend.listBinaries('cart-import')).toEqual([]);
    hook.unmount();
  });

  it('conserve un commit achevé juste avant la fermeture et libère uniquement les aperçus', async () => {
    const hook = mediaHook();
    const commit = vault.commitImport.bind(vault);
    vi.spyOn(vault, 'commitImport').mockImplementation(async (input) => {
      const record = await commit(input);
      hook.unmount();
      return record;
    });
    await act(async () => expect(await hook.result.current.run(
      () => prepareImportedAssets({ files: [jpeg()], tags: [] }),
      (target, prepared) => hook.result.current.commands.importAssets(target, prepared),
    )).toBe(false));
    expect(await readMedia()).toHaveLength(2);
    expect(await vault.listBinaryRecords()).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:import-1');
    expect(onError).toHaveBeenLastCalledWith(null);
  });
  it('affiche le conflit d’un ancien onglet sans effacer les références du nouvel import', async () => {
    const hook = mediaHook();
    await vault.flush();
    const prepared = await prepareImportedAssets({ files: [jpeg()], tags: [] });
    await vault.commitImport({ key: MEDIA_KEY, binaries: prepared.binaries, update: (raw) =>
      JSON.stringify([...JSON.parse(raw!), ...prepared.items.map((item) => ({ ...item, url: '' }))]) });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    act(() => hook.result.current.commands.updateAsset('old', { name: 'Saisie de l’ancien onglet' }));
    await waitFor(() => expect(hook.result.current.persistenceError).toContain('import'));
    expect(await readMedia()).toHaveLength(2);
    expect(hook.result.current.mediaAssets[0].name).toBe('Saisie de l’ancien onglet');
    expect([...storage.values.entries()].some(([key, value]) => key.includes('import-conflict') && value.includes('Saisie de l’ancien onglet'))).toBe(true);
    errors.mockRestore();
    prepared.dispose();
    hook.unmount();
  });

  it('garde les aperçus affichés si le droit d’éditer est retiré après le commit', async () => {
    const hook = renderHook(({ enabled }) => {
      const state = useCartularyMediaState({ loadAssets: () => [oldAsset] });
      return { ...state, ...useAtomicFileImport({ vault, enabled, onError }) };
    }, { initialProps: { enabled: true } });
    const commit = vault.commitImport.bind(vault);
    vi.spyOn(vault, 'commitImport').mockImplementation(async (input) => {
      const record = await commit(input);
      hook.rerender({ enabled: false });
      return record;
    });
    await act(async () => expect(await hook.result.current.run(
      () => prepareImportedAssets({ files: [jpeg()], tags: [] }),
      (target, prepared) => hook.result.current.commands.importAssets(target, prepared),
    )).toBe(true));
    expect(hook.result.current.mediaAssets[1].url).toBe('blob:import-1');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    hook.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('préserve les dérivés récents lus pendant le commit même si le rendu ne les connaissait pas', async () => {
    const existing = { ...oldAsset, binaryId: 'existing-binary', url: 'blob:existing' };
    const hook = renderHook(() => useCartularyMediaState({ loadAssets: () => [existing] }));
    await vault.flush();
    await vault.writeJson(MEDIA_KEY, [{ ...existing, url: '', thumbnailUrl: 'https://example.test/new-thumb.jpg', posterUrl: 'https://example.test/new-poster.jpg' }]);
    const prepared = await prepareImportedAssets({ files: [jpeg()], tags: [] });
    await act(async () => hook.result.current.commands.importAssets(vault, prepared));
    expect(hook.result.current.mediaAssets[0]).toMatchObject({ url: 'blob:existing', thumbnailUrl: 'https://example.test/new-thumb.jpg', posterUrl: 'https://example.test/new-poster.jpg' });
    act(() => hook.result.current.commands.updateAsset('old', { name: 'Titre' }));
    await vault.flush();
    expect((await readMedia())[0].thumbnailUrl).toBe('https://example.test/new-thumb.jpg');
    prepared.dispose();
    hook.unmount();
  });

});
