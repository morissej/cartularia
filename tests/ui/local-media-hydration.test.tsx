import { useState } from 'react';
import type { SetStateAction } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartulariaLocalVault, LocalBinaryRecord } from '../../src/persistence/localVault';
import { PRIVATE_SESSION_LOCK_EVENT } from '../../src/security/privateSessionEvents';
import { useLocalMediaHydration } from '../../src/features/cartulary/media/useLocalMediaHydration';
import type { ConditionEntry } from '../../src/features/cartulary/state/cartularyStateTypes';
import type { Asset } from '../../src/types';

const placeholder = 'data:image/gif;base64,placeholder';
const asset = (id: string, url = ''): Asset => ({
  id, binaryId: `binary-${id}`, name: `Titre ${id}`, url, type: 'image', hash: '',
  status: 'Archived', visibility: 'Secret', tags: [],
});
const entry = (id: string, url?: string): ConditionEntry => ({
  id, date: '2026-09-18', title: `État ${id}`, note: '',
  attachments: [{ id: `attachment-${id}`, binaryId: `binary-${id}`, name: `${id}.pdf`, url }],
});
const binary = (binaryId: string): LocalBinaryRecord => ({
  id: binaryId, binaryId, cartularyId: 'hydration', kind: 'media', fileName: `${binaryId}.jpg`,
  mimeType: 'image/jpeg', blob: new Blob(['local original']), size: 14, sha256: `sha256:${'a'.repeat(64)}`,
  updatedAt: 1000, dirty: false, deleted: false, cloudRevision: 1, cloudStoragePath: null,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const createVault = () => ({
  isAccessible: true,
  getBinary: vi.fn(async (binaryId: string): Promise<LocalBinaryRecord | null> => binary(binaryId)),
});
const asVault = (vault: ReturnType<typeof createVault>) => vault as unknown as CartulariaLocalVault;
const renderHydration = (vault: ReturnType<typeof createVault>, assets: Asset[] = [asset('a')], entries: ConditionEntry[] = []) => renderHook(
  ({ target, version }) => {
    const [mediaAssets, setMediaAssets] = useState(assets);
    const [conditionEntries, setConditionEntries] = useState(entries);
    useLocalMediaHydration({ vault: target, mediaAssets, conditionEntries, setMediaAssets, setConditionEntries,
      refreshVersion: version, placeholderUrl: placeholder });
    return { mediaAssets, conditionEntries, setMediaAssets, setConditionEntries };
  },
  { initialProps: { target: asVault(vault) as CartulariaLocalVault | null, version: 0 } },
);
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
beforeEach(() => {
  let nextUrl = 0;
  createObjectURL.mockReset().mockImplementation(() => `blob:hydrated-${++nextUrl}`);
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
});

describe('propriété des aperçus locaux', () => {
  it('hydrate médias et pièces sans relancer les lectures à chaque adoption ou édition', async () => {
    const vault = createVault();
    const hook = renderHydration(vault, [asset('a', placeholder)], [entry('b')]);
    await waitFor(() => expect(hook.result.current.mediaAssets[0].url).toBe('blob:hydrated-1'));
    expect(hook.result.current.mediaAssets[0]).toMatchObject({
      hash: `sha256:${'a'.repeat(64)}`, mimeType: 'image/jpeg', fileSize: '1 ko', localAvailability: 'available',
    });
    expect(hook.result.current.conditionEntries[0].attachments[0].url).toBe('blob:hydrated-2');
    act(() => hook.result.current.setMediaAssets((items) => items.map((item) => ({ ...item, name: 'Titre édité' }))));
    expect(vault.getBinary).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    hook.unmount();
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(new Set(['blob:hydrated-1', 'blob:hydrated-2']));
  });

  it('un refresh conserve le même aperçu référencé, puis un remplacement libère seulement l’ancien', async () => {
    const vault = createVault();
    const hook = renderHydration(vault);
    await waitFor(() => expect(hook.result.current.mediaAssets[0].url).toBe('blob:hydrated-1'));
    hook.rerender({ target: asVault(vault), version: 1 });
    await act(async () => undefined);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(vault.getBinary).toHaveBeenCalledOnce();

    act(() => hook.result.current.setMediaAssets([asset('a')]));
    hook.rerender({ target: asVault(vault), version: 2 });
    await waitFor(() => expect(hook.result.current.mediaAssets[0].url).toBe('blob:hydrated-2'));
    expect(revokeObjectURL.mock.calls).toEqual([['blob:hydrated-1']]);
    act(() => hook.result.current.setMediaAssets([asset('a', 'blob:import-externe')]));
    expect(revokeObjectURL.mock.calls).toEqual([['blob:hydrated-1'], ['blob:hydrated-2']]);
    hook.unmount();
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:import-externe');
  });

  it('conserve un aperçu retiré pendant la fenêtre d’annulation, puis le libère à son expiration', async () => {
    const vault = createVault();
    const hook = renderHook(({ preserve }) => {
      const [mediaAssets, setMediaAssets] = useState([asset('a')]);
      useLocalMediaHydration({
        vault: asVault(vault), mediaAssets, conditionEntries: [], setMediaAssets,
        setConditionEntries: () => undefined, refreshVersion: 0, placeholderUrl: placeholder,
        preserveUnreferenced: preserve,
      });
      return { mediaAssets, setMediaAssets };
    }, { initialProps: { preserve: true } });
    await waitFor(() => expect(hook.result.current.mediaAssets[0].url).toBe('blob:hydrated-1'));
    act(() => hook.result.current.setMediaAssets([]));
    expect(revokeObjectURL).not.toHaveBeenCalled();
    hook.rerender({ preserve: false });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:hydrated-1');
    hook.unmount();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('attend tous les frères en échec puis libère les URLs allouées avant et après cet échec', async () => {
    const vault = createVault();
    const failed = deferred<LocalBinaryRecord>();
    const late = deferred<LocalBinaryRecord>();
    vault.getBinary.mockImplementation((id) => id === 'binary-a' ? Promise.resolve(binary(id)) : id === 'binary-b' ? failed.promise : late.promise);
    const hook = renderHydration(vault, [asset('a'), asset('b')], [entry('c')]);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    await act(async () => { failed.reject(new Error('Lecture locale interrompue')); });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(hook.result.current.mediaAssets[0].url).toBe('');
    await act(async () => { late.resolve(binary('binary-c')); });
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(new Set(['blob:hydrated-1', 'blob:hydrated-2']));
    expect(hook.result.current.conditionEntries[0].attachments[0].url).toBeUndefined();
    hook.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('préserve les imports, les titres et les notes arrivés pendant les lectures', async () => {
    const vault = createVault();
    const reads = deferred<LocalBinaryRecord>();
    vault.getBinary.mockImplementation(() => reads.promise);
    const hook = renderHydration(vault, [asset('a')], [entry('b')]);
    act(() => {
      hook.result.current.setMediaAssets((items) => [...items.map((item) => ({ ...item, name: 'Nouveau titre' })), asset('imported', 'blob:imported')]);
      hook.result.current.setConditionEntries((items) => [...items.map((item) => ({ ...item, title: 'État corrigé', note: 'Nouvelle note',
        attachments: item.attachments.map((attachment) => ({ ...attachment, name: 'Renommé.pdf' })) })), entry('imported', 'blob:piece-imported')]);
    });
    await act(async () => reads.resolve(binary('shared-test-record')));
    expect(hook.result.current.mediaAssets.map((item) => item.name)).toEqual(['Nouveau titre', 'Titre imported']);
    expect(hook.result.current.mediaAssets.map((item) => item.url)).toEqual(['blob:hydrated-1', 'blob:imported']);
    expect(hook.result.current.conditionEntries[0]).toMatchObject({ title: 'État corrigé', note: 'Nouvelle note', attachments: [{ name: 'Renommé.pdf', url: 'blob:hydrated-2' }] });
    expect(hook.result.current.conditionEntries[1].attachments[0].url).toBe('blob:piece-imported');
    hook.unmount();
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:imported');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:piece-imported');
  });

  it('n’attribue pas un résultat ancien après changement de binaryId ou suppression de référence', async () => {
    const vault = createVault();
    const reads = deferred<LocalBinaryRecord>();
    vault.getBinary.mockImplementation(() => reads.promise);
    const hook = renderHydration(vault, [asset('a')], [entry('b')]);
    act(() => {
      hook.result.current.setMediaAssets([{ ...asset('a'), binaryId: 'replacement-binary' }]);
      hook.result.current.setConditionEntries([]);
    });
    await act(async () => reads.resolve(binary('old-binary')));
    expect(hook.result.current.mediaAssets[0].url).toBe('');
    expect(hook.result.current.conditionEntries).toEqual([]);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('libère immédiatement les URLs en attente au démontage et n’en alloue aucune tardivement', async () => {
    const vault = createVault();
    const late = deferred<LocalBinaryRecord>();
    vault.getBinary.mockImplementation((id) => id === 'binary-a' ? Promise.resolve(binary(id)) : late.promise);
    const hook = renderHydration(vault, [asset('a'), asset('b')]);
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    hook.unmount();
    expect(revokeObjectURL.mock.calls).toEqual([['blob:hydrated-1']]);
    await act(async () => late.resolve(binary('binary-b')));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it('verrouiller la session révoque aperçus adoptés et en attente, sans mutation tardive', async () => {
    const vault = createVault();
    const hook = renderHydration(vault);
    await waitFor(() => expect(hook.result.current.mediaAssets[0].url).toBe('blob:hydrated-1'));
    const late = deferred<LocalBinaryRecord>();
    vault.getBinary.mockImplementation((id) => id === 'binary-c' ? late.promise : Promise.resolve(binary(id)));
    act(() => hook.result.current.setMediaAssets((items) => [...items, asset('b'), asset('c')]));
    hook.rerender({ target: asVault(vault), version: 1 });
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    act(() => window.dispatchEvent(new Event(PRIVATE_SESSION_LOCK_EVENT)));
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(new Set(['blob:hydrated-1', 'blob:hydrated-2']));
    await act(async () => late.resolve(binary('binary-c')));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(hook.result.current.mediaAssets[1].url).toBe('');
    hook.unmount();
  });

  it('un autre coffre invalide les anciennes lectures et adopte seulement sa propre réponse', async () => {
    const first = createVault();
    const oldRead = deferred<LocalBinaryRecord>();
    first.getBinary.mockReturnValue(oldRead.promise);
    const hook = renderHydration(first);
    const second = createVault();
    hook.rerender({ target: asVault(second), version: 0 });
    await waitFor(() => expect(hook.result.current.mediaAssets[0].url).toBe('blob:hydrated-1'));
    await act(async () => oldRead.resolve(binary('binary-a')));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(hook.result.current.mediaAssets[0].url).toBe('blob:hydrated-1');
    hook.unmount();
  });

  it('ne révoque jamais les URLs importées ou externes qu’il n’a pas créées', async () => {
    const vault = createVault();
    const hook = renderHydration(vault, [asset('a', 'blob:imported'), asset('b', 'https://example.test/image.jpg')], [entry('c', 'blob:attachment-imported')]);
    await act(async () => undefined);
    act(() => { hook.result.current.setMediaAssets([]); hook.result.current.setConditionEntries([]); });
    hook.unmount();
    expect(vault.getBinary).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('un updater retardé par un import n’adopte pas une URL après annulation de son refresh', async () => {
    const vault = createVault();
    const queued: SetStateAction<Asset[]>[] = [];
    const setConditions = vi.fn();
    const hook = renderHook(({ version }) => useLocalMediaHydration({
      vault: asVault(vault), mediaAssets: [asset('a')], conditionEntries: [], refreshVersion: version, placeholderUrl: placeholder,
      setMediaAssets: (update) => { queued.push(update); }, setConditionEntries: setConditions,
    }), { initialProps: { version: 0 } });
    await waitFor(() => expect(queued).toHaveLength(1));
    hook.rerender({ version: 1 });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:hydrated-1');
    const current = [asset('a')];
    expect((queued[0] as (items: Asset[]) => Asset[])(current)).toBe(current);
    hook.unmount();
  });
});
