import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assetTypeFromMimeType, buildImportedAssets, type MediaImportVault } from '../../src/features/cartulary/media/importMediaFiles.ts';
import { digestFile } from '../../src/utils/fileDigest.ts';
import { newId } from '../../src/utils/identifiers.ts';

/**
 * Pipeline unique d'import des médias (V5 P-D3), extrait de `addMediaAssets` : même validation par le coffre
 * (`putValidatedBinary`), même forme `Asset`, quelle que soit la porte d'entrée (Bibliothèque ou emplacement vide).
 * Fichiers fictifs, aucune donnée réelle.
 */

const HEX_64 = /^[0-9a-f]{64}$/;
const sha256Of = (content: string) => createHash('sha256').update(content).digest('hex');
const fileOf = (content: string, name: string, type: string, lastModified = Date.UTC(2026, 8, 1, 10, 0, 0)) => new File([content], name, { type, lastModified });
const createObjectURL = vi.fn((blob: Blob) => `blob:${(blob as File).name}`);

type StoredBinary = Awaited<ReturnType<MediaImportVault['putValidatedBinary']>>;
const vaultReturning = (mimeType: string | ((declared: string) => string)) => ({
  putValidatedBinary: vi.fn(async (input: Parameters<MediaImportVault['putValidatedBinary']>[0]) => ({
    mimeType: typeof mimeType === 'function' ? mimeType(input.mimeType) : mimeType,
  } as StoredBinary)),
});

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('buildImportedAssets', () => {
  it('décrit une vidéo : type video, 16:9, dérivé en attente, tag imposé, empreinte hexadécimale et binaire déposé au coffre', async () => {
    const vault = vaultReturning('video/mp4');
    const file = fileOf('contenu vidéo fictif', 'objet-mouvement.mp4', 'video/mp4');

    const [asset, ...rest] = await buildImportedAssets({ files: [file], tags: ['main-video'], vault });

    expect(rest).toHaveLength(0);
    expect(asset.type).toBe('video');
    expect(asset.ratio).toBe('16:9');
    expect(asset.derivativeStatus).toBe('pending');
    expect(asset.tags).toEqual(['main-video']);
    expect(asset.hash).toMatch(HEX_64);
    expect(asset.hash).toBe(sha256Of('contenu vidéo fictif'));
    expect(asset.name).toBe('objet-mouvement');
    expect(asset.originalFileName).toBe('objet-mouvement.mp4');
    expect(asset.mimeType).toBe('video/mp4');
    expect(asset.status).toBe('Archived');
    expect(asset.visibility).toBe('Secret');
    expect(asset.localAvailability).toBe('available');
    expect(asset.timestampSource).toBe('file.lastModified');
    expect(asset.metadataTimestamp).toBe('2026-09-01T10:00:00.000Z');
    expect(asset.capturedAt).toBe('2026-09-01');
    expect(asset.fileSize).toBe('1 ko');
    expect(asset.url).toBe('blob:objet-mouvement.mp4');
    expect(asset.id).toMatch(/^asset-/);
    expect(asset.binaryId).toMatch(/^media-binary-/);

    expect(vault.putValidatedBinary).toHaveBeenCalledOnce();
    expect(vault.putValidatedBinary).toHaveBeenCalledWith({
      binaryId: asset.binaryId,
      kind: 'media',
      fileName: 'objet-mouvement.mp4',
      mimeType: 'video/mp4',
      sha256: asset.hash,
      blob: file,
    });
  });

  it('décrit une image : type image, 4:5, aucun dérivé requis', async () => {
    const vault = vaultReturning('image/jpeg');

    const [asset] = await buildImportedAssets({ files: [fileOf('photo fictive', 'vue-01.jpg', 'image/jpeg')], tags: ['spin-3d'], vault });

    expect(asset.type).toBe('image');
    expect(asset.ratio).toBe('4:5');
    expect(asset.derivativeStatus).toBe('not-required');
    expect(asset.tags).toEqual(['spin-3d']);
  });

  it('retient le MIME canonique constaté par le coffre plutôt que celui déclaré par le navigateur', async () => {
    const vault = vaultReturning('image/png');

    const [asset] = await buildImportedAssets({ files: [fileOf('octets', 'sans-type.bin', '')], tags: [], vault });

    expect(asset.mimeType).toBe('image/png');
    expect(asset.type).toBe('image');
    expect(asset.ratio).toBe('4:5');
  });

  it('sans coffre (hors navigateur), se rabat sur le MIME déclaré et ne dépose rien', async () => {
    const [asset] = await buildImportedAssets({ files: [fileOf('document fictif', 'facture.pdf', 'application/pdf')], tags: ['documentation'], vault: null });

    expect(asset.type).toBe('document');
    expect(asset.mimeType).toBe('application/pdf');
    expect(asset.derivativeStatus).toBe('not-required');
    expect(asset.binaryId).toMatch(/^media-binary-/);
  });

  it('importe plusieurs fichiers avec des identifiants distincts, dans l’ordre choisi', async () => {
    const vault = vaultReturning((declared) => declared);
    const files = [fileOf('a', 'vue-01.jpg', 'image/jpeg'), fileOf('b', 'vue-02.jpg', 'image/jpeg'), fileOf('c', 'vue-03.jpg', 'image/jpeg')];

    const assets = await buildImportedAssets({ files, tags: ['spin-3d'], vault });

    expect(assets.map((asset) => asset.originalFileName)).toEqual(['vue-01.jpg', 'vue-02.jpg', 'vue-03.jpg']);
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(3);
    expect(new Set(assets.map((asset) => asset.binaryId)).size).toBe(3);
    expect(assets.map((asset) => asset.hash)).toEqual(['a', 'b', 'c'].map(sha256Of));
    expect(vault.putValidatedBinary).toHaveBeenCalledTimes(3);
  });

  it('propage le refus du coffre sans décrire d’actif', async () => {
    const vault = { putValidatedBinary: vi.fn(async () => { throw new Error('Fichier refusé : signature inconnue.'); }) };

    await expect(buildImportedAssets({ files: [fileOf('x', 'inconnu.mp4', 'video/mp4')], tags: ['main-video'], vault }))
      .rejects.toThrow('Fichier refusé : signature inconnue.');
  });

  it('ne fait rien sans fichier', async () => {
    const vault = vaultReturning('video/mp4');
    expect(await buildImportedAssets({ files: [], tags: ['main-video'], vault })).toEqual([]);
    expect(vault.putValidatedBinary).not.toHaveBeenCalled();
  });
});

describe('briques partagées', () => {
  it('assetTypeFromMimeType : image, vidéo, sinon document', () => {
    expect(assetTypeFromMimeType('image/webp')).toBe('image');
    expect(assetTypeFromMimeType('video/quicktime')).toBe('video');
    expect(assetTypeFromMimeType('application/pdf')).toBe('document');
    expect(assetTypeFromMimeType('')).toBe('document');
  });

  it('digestFile : SHA-256 hexadécimal de 64 caractères, sans préfixe', async () => {
    const hash = await digestFile(fileOf('contenu à hacher', 'note.txt', 'text/plain'));
    expect(hash).toMatch(HEX_64);
    expect(hash).toBe(sha256Of('contenu à hacher'));
  });

  it('newId : préfixe conservé, identifiants distincts', () => {
    const first = newId('asset');
    const second = newId('asset');
    expect(first).toMatch(/^asset-\d+-[0-9a-f]+$/);
    expect(first).not.toBe(second);
  });
});
