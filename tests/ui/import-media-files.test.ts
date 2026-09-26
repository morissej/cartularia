import { File as NodeFile } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assetTypeFromMimeType, prepareConditionAttachments, prepareImportedAssets } from '../../src/features/cartulary/media/importMediaFiles.ts';
import { digestFile } from '../../src/utils/fileDigest.ts';
import { newId } from '../../src/utils/identifiers.ts';
import { createLocalVideoPoster } from '../../src/media/videoPoster.ts';
vi.mock('../../src/media/videoPoster.ts', () => ({ createLocalVideoPoster: vi.fn(async () => 'data:image/jpeg;base64,local-poster') }));

// Actual signatures, passed through the canonical validator (never mocked).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4j8AAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(4), Buffer.from('isommp42')]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const HEX_64 = /^[0-9a-f]{64}$/;
const sha256Of = (content: Uint8Array | string) => createHash('sha256').update(content).digest('hex');
const fileOf = (content: Uint8Array | string, name: string, type: string, lastModified = Date.UTC(2026, 8, 1, 10, 0, 0)): File => new NodeFile([content], name, { type, lastModified }) as File;
const photo = (name = 'photo.jpg') => fileOf(JPEG, name, 'image/jpeg');
const createObjectURL = vi.fn((blob: Blob) => `blob:${(blob as File).name}`);
const revokeObjectURL = vi.fn();
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  createObjectURL.mockReset().mockImplementation((blob: Blob) => `blob:${(blob as File).name}`);
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('préparation sans persistence', () => {
  it('décrit une vidéo et son binaire sans dépôt au coffre', async () => {
    const file = fileOf(MP4, 'objet-mouvement.mp4', 'video/mp4');
    const prepared = await prepareImportedAssets({ files: [file], tags: ['main-video'] });
    const [asset] = prepared.items;

    expect(prepared.items).toHaveLength(1);
    expect(asset).toMatchObject({
      type: 'video', ratio: '16:9', derivativeStatus: 'pending', tags: ['main-video'],
      name: 'objet-mouvement', originalFileName: file.name, mimeType: 'video/mp4',
      status: 'Archived', visibility: 'Secret', localAvailability: 'available',
      timestampSource: 'file.lastModified', metadataTimestamp: '2026-09-01T10:00:00.000Z',
      capturedAt: '2026-09-01', fileSize: '1 ko', url: 'blob:objet-mouvement.mp4',
    });
    expect(asset.hash).toBe(sha256Of(MP4));
    expect(createLocalVideoPoster).toHaveBeenCalledWith('blob:objet-mouvement.mp4');
    expect(asset.posterUrl).toBe('data:image/jpeg;base64,local-poster');
    expect(asset.hash).toMatch(HEX_64);
    expect(asset.id).toMatch(/^asset-/);
    expect(asset.binaryId).toMatch(/^media-binary-/);
    expect(prepared.binaries).toEqual([{
      binaryId: asset.binaryId, kind: 'media', fileName: file.name,
      mimeType: 'video/mp4', sha256: asset.hash, blob: file,
    }]);
    expect(prepared.binaries[0]).not.toHaveProperty('url');
    prepared.dispose();
  });

  it('normalise image/jpg et reconnaît le MIME absent avec la signature PNG', async () => {
    const prepared = await prepareImportedAssets({
      files: [fileOf(JPEG, 'vue.jpg', 'image/jpg'), fileOf(PNG, 'vue.png', '')], tags: ['spin-3d'],
    });
    expect(prepared.items.map((item) => item.mimeType)).toEqual(['image/jpeg', 'image/png']);
    expect(prepared.binaries.map((item) => item.mimeType)).toEqual(['image/jpeg', 'image/png']);
    expect(prepared.items.every((item) => item.type === 'image' && item.ratio === '4:5' && item.derivativeStatus === 'not-required')).toBe(true);
    prepared.dispose();
  });

  it('conserve ordre et identifiants distincts, et capture les tags à l’appel', async () => {
    const tags: Array<'spin-3d' | 'main-video'> = ['spin-3d'];
    const files = [photo('a.jpg'), fileOf(PNG, 'b.png', 'image/png'), photo('c.jpg')];
    const promise = prepareImportedAssets({ files, tags });
    tags.push('main-video');
    const prepared = await promise;
    expect(prepared.items.map((item) => item.originalFileName)).toEqual(files.map((file) => file.name));
    expect(new Set(prepared.items.map((item) => item.id)).size).toBe(3);
    expect(new Set(prepared.binaries.map((item) => item.binaryId)).size).toBe(3);
    expect(prepared.items.map((item) => item.hash)).toEqual([JPEG, PNG, JPEG].map(sha256Of));
    expect(prepared.items.map((item) => item.tags)).toEqual([['spin-3d'], ['spin-3d'], ['spin-3d']]);
    prepared.dispose();
  });

  it('prépare les rapports avec leurs champs documentaires et leur propre préfixe', async () => {
    const prepared = await prepareImportedAssets({ files: [fileOf(PDF, 'rapport.pdf', 'application/pdf')], tags: [], referenceReport: true });
    expect(prepared.items[0]).toMatchObject({
      type: 'document', ratio: '4:5', sourceSection: 'reference-report', category: 'documentation',
      tags: ['documentation'], derivativeStatus: 'not-required', mimeType: 'application/pdf', hash: sha256Of(PDF),
    });
    expect(prepared.items[0].id).toMatch(/^reference-report-/);
    expect(prepared.binaries[0].binaryId).toMatch(/^reference-report-binary-/);
    expect(prepared.binaries[0].kind).toBe('media');
    prepared.dispose();
  });

  it('prépare les pièces d’état image et document avec un MIME canonique', async () => {
    const files = [fileOf(JPEG, 'vue.jpg', 'image/jpg'), fileOf(PDF, 'facture.pdf', 'application/pdf')];
    const prepared = await prepareConditionAttachments({ files });
    expect(prepared.items.map((item) => item.type)).toEqual(['image/jpeg', 'application/pdf']);
    expect(prepared.items[0]).toMatchObject({ name: 'vue.jpg', size: JPEG.length, sha256: sha256Of(JPEG), url: 'blob:vue.jpg' });
    expect(prepared.items.every((item) => item.id?.startsWith('attachment-'))).toBe(true);
    expect(prepared.binaries.every((item) => item.kind === 'condition_attachment' && item.binaryId.startsWith('condition-binary-'))).toBe(true);
    prepared.dispose();
  });

  it('dispose révoque tous les aperçus une seule fois et un lot vide reste vide', async () => {
    const prepared = await prepareImportedAssets({ files: [photo('a.jpg'), photo('b.jpg')], tags: [] });
    prepared.dispose();
    prepared.dispose();
    expect(revokeObjectURL.mock.calls).toEqual([['blob:a.jpg'], ['blob:b.jpg']]);
    const empty = await prepareConditionAttachments({ files: [] });
    expect(empty.items).toEqual([]);
    expect(empty.binaries).toEqual([]);
    empty.dispose();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

const entryPoints = [
  { name: 'médias', prepare: (files: File[]) => prepareImportedAssets({ files, tags: [] }) },
  { name: 'pièces d’état', prepare: (files: File[]) => prepareConditionAttachments({ files }) },
  { name: 'rapports', prepare: (files: File[]) => prepareImportedAssets({ files, tags: [], referenceReport: true }) },
];

describe('validation de tout le lot avant hachage', () => {
  for (const entry of entryPoints) {
    it(`${entry.name} : un lot mixte valide/invalide échoue sans lecture intégrale ni aperçu`, async () => {
      const valid = fileOf(PDF, 'valide.pdf', 'application/pdf');
      const invalid = fileOf('<html>renommé</html>', 'invalide.jpg', 'image/jpeg');
      const wholeReads = [valid, invalid].map((file) => vi.spyOn(file, 'arrayBuffer'));
      await expect(entry.prepare([valid, invalid])).rejects.toMatchObject({ code: 'unsupported_signature' });
      wholeReads.forEach((read) => expect(read).not.toHaveBeenCalled());
      expect(createObjectURL).not.toHaveBeenCalled();
    });

    it(`${entry.name} : un vrai fichier vide n’est jamais ignoré`, async () => {
      await expect(entry.prepare([fileOf(PDF, 'valide.pdf', 'application/pdf'), fileOf('', 'vide.pdf', 'application/pdf')]))
        .rejects.toMatchObject({ code: 'empty_file' });
      expect(createObjectURL).not.toHaveBeenCalled();
    });
  }

  it('refuse un grand fichier avant sa lecture intégrale et celle des autres fichiers', async () => {
    const files = [photo(), fileOf(MP4, 'trop-grand.mp4', 'video/mp4')];
    Object.defineProperty(files[1], 'size', { value: 500 * 1024 * 1024 + 1 });
    const reads = files.map((file) => vi.spyOn(file, 'arrayBuffer'));
    const prefixRead = vi.spyOn(files[1], 'slice');
    await expect(prepareImportedAssets({ files, tags: [] })).rejects.toMatchObject({ code: 'file_too_large' });
    reads.forEach((read) => expect(read).not.toHaveBeenCalled());
    expect(prefixRead).toHaveBeenCalledWith(0, 4096);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('attend la dernière inspection du lot avant de hacher le premier fichier', async () => {
    const files = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')];
    const inspected = deferred<ArrayBuffer>();
    const prefix = files[2].slice(0, 4096);
    const bytes = await prefix.arrayBuffer();
    vi.spyOn(prefix, 'arrayBuffer').mockReturnValue(inspected.promise);
    vi.spyOn(files[2], 'slice').mockReturnValue(prefix);
    const wholeReads = files.map((file) => vi.spyOn(file, 'arrayBuffer'));
    const pending = prepareImportedAssets({ files, tags: [] });
    await vi.waitFor(() => expect(prefix.arrayBuffer).toHaveBeenCalledOnce());
    wholeReads.forEach((read) => expect(read).not.toHaveBeenCalled());
    inspected.resolve(bytes);
    const prepared = await pending;
    wholeReads.forEach((read) => expect(read).toHaveBeenCalledOnce());
    prepared.dispose();
  });

  it('les rapports refusent une image pourtant valide avant tout hachage', async () => {
    const file = photo();
    const wholeRead = vi.spyOn(file, 'arrayBuffer');
    await expect(prepareImportedAssets({ files: [file], tags: [], referenceReport: true })).rejects.toMatchObject({ code: 'unexpected_kind' });
    expect(wholeRead).not.toHaveBeenCalled();
  });

  it('les pièces d’état refusent une vidéo valide et ne hachent aucun fichier du lot', async () => {
    const files = [photo(), fileOf(MP4, 'video.mp4', 'video/mp4')];
    const wholeReads = files.map((file) => vi.spyOn(file, 'arrayBuffer'));
    await expect(prepareConditionAttachments({ files })).rejects.toMatchObject({ code: 'unexpected_kind' });
    wholeReads.forEach((read) => expect(read).not.toHaveBeenCalled());
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('concurrence et nettoyage des erreurs', () => {
  const assertTwoAtMost = async (simultaneous: boolean) => {
    const files = Array.from({ length: 6 }, (_, index) => fileOf(PDF, `rapport-${index}.pdf`, 'application/pdf'));
    const wholeReads = files.map((file) => vi.spyOn(file, 'arrayBuffer'));
    const release = deferred<void>();
    let active = 0;
    let maximum = 0;
    const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
    const hash = vi.spyOn(webcrypto.subtle, 'digest').mockImplementation(async (...args) => {
      active += 1;
      maximum = Math.max(maximum, active);
      try {
        await release.promise;
        return await digest(...args);
      } finally { active -= 1; }
    });
    const pending = simultaneous
      ? Promise.all(entryPoints.map((entry, index) => entry.prepare(files.slice(index * 2, index * 2 + 2))))
      : Promise.all([prepareImportedAssets({ files, tags: [] })]);
    await vi.waitFor(() => expect(hash).toHaveBeenCalledTimes(2));
    expect(wholeReads.reduce((count, read) => count + read.mock.calls.length, 0)).toBe(2);
    expect(active).toBe(2);
    release.resolve();
    const prepared = await pending;
    expect(maximum).toBe(2);
    expect(hash).toHaveBeenCalledTimes(6);
    prepared.forEach((batch) => batch.dispose());
  };

  it('ne prépare et ne hache que deux fichiers simultanément dans un lot', () => assertTwoAtMost(false));
  it('partage le plafond de deux entre trois imports simultanés', () => assertTwoAtMost(true));

  it('attend les tâches démarrées puis nettoie les URLs créées avant et après un échec', async () => {
    const files = ['a', 'b', 'c', 'd'].map((name) => photo(`${name}.jpg`));
    const failingRead = deferred<ArrayBuffer>();
    const lateRead = deferred<ArrayBuffer>();
    const lateBytes = await files[2].arrayBuffer();
    vi.spyOn(files[1], 'arrayBuffer').mockReturnValue(failingRead.promise);
    const late = vi.spyOn(files[2], 'arrayBuffer').mockReturnValue(lateRead.promise);
    const skipped = vi.spyOn(files[3], 'arrayBuffer');
    let settled = false;
    const pending = prepareImportedAssets({ files, tags: [] }).catch((error: unknown) => { settled = true; return error; });
    await vi.waitFor(() => expect(late).toHaveBeenCalledOnce());
    expect(createObjectURL).toHaveBeenCalledOnce();
    const failure = new Error('lecture interrompue');
    failingRead.reject(failure);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    lateRead.resolve(lateBytes);
    expect(await pending).toBe(failure);
    expect(skipped).not.toHaveBeenCalled();
    expect(new Set(revokeObjectURL.mock.calls.map(([url]) => url))).toEqual(new Set(['blob:a.jpg', 'blob:c.jpg']));
  });

  it('nettoie les aperçus si leur allocation échoue', async () => {
    createObjectURL.mockImplementationOnce(() => 'blob:premier').mockImplementation(() => { throw new Error('allocation impossible'); });
    await expect(prepareConditionAttachments({ files: [photo('a.jpg'), photo('b.jpg')] })).rejects.toThrow('allocation impossible');
    expect(revokeObjectURL.mock.calls).toEqual([['blob:premier']]);
  });

  it('nettoie même si la description d’un actif échoue après création de son aperçu', async () => {
    const invalidDate = photo();
    Object.defineProperty(invalidDate, 'lastModified', { value: Infinity });
    await expect(prepareImportedAssets({ files: [invalidDate], tags: [] })).rejects.toBeInstanceOf(RangeError);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo.jpg');
  });

  it('un échec de hachage ne bloque pas le limiteur des imports suivants', async () => {
    vi.spyOn(webcrypto.subtle, 'digest').mockRejectedValueOnce(new Error('hachage indisponible'));
    await expect(prepareImportedAssets({ files: [photo()], tags: [] })).rejects.toThrow('hachage indisponible');
    const prepared = await prepareConditionAttachments({ files: [photo()] });
    expect(prepared.items).toHaveLength(1);
    prepared.dispose();
  });
});

describe('briques partagées', () => {
  it('assetTypeFromMimeType : image, vidéo, sinon document', () => {
    expect(assetTypeFromMimeType('image/webp')).toBe('image');
    expect(assetTypeFromMimeType('video/quicktime')).toBe('video');
    expect(assetTypeFromMimeType('application/pdf')).toBe('document');
    expect(assetTypeFromMimeType('')).toBe('document');
  });
  it('digestFile : SHA-256 hexadécimal sans préfixe', async () => {
    expect(await digestFile(fileOf('contenu à hacher', 'note.txt', 'text/plain'))).toBe(sha256Of('contenu à hacher'));
  });
  it('newId : préfixe conservé, identifiants distincts', () => {
    const first = newId('asset');
    expect(first).toMatch(/^asset-\d+-[0-9a-f]+$/);
    expect(first).not.toBe(newId('asset'));
  });
});
