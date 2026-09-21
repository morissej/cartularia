import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import type { User } from 'firebase/auth';

/**
 * Pipeline de création (V5, P-B1) : deux fichiers en vol au plus (téléversement + attente de vérification),
 * hachage sérialisé, ordre des assets par index (couverture = index 0 = main-photo), octets comptés par fichier,
 * demande écrite après acceptation de tous les manifestes, abandon de la prise de nouveaux fichiers au premier
 * échec. Propriétaire et objets simulés aux valeurs différentes des fixtures du dépôt ; aucun montant.
 */
const api = vi.hoisted(() => ({
  log: [] as Array<{ kind: 'set'; path: string; data: Record<string, unknown> } | { kind: 'verified'; binaryId: string }>,
  verifications: [] as Array<{ binaryId: string; resolve: (result: Record<string, unknown>) => void; reject: (error: Error) => void }>,
  pendingVerifications: 0,
  maxPendingVerifications: 0,
  localSetItem: vi.fn(),
  localScope: vi.fn(),
}));
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (base: unknown, ...path: string[]) => [typeof base === 'string' ? base : '', ...path].filter(Boolean).join('/'),
  setDoc: async (path: string, data: Record<string, unknown>) => { api.log.push({ kind: 'set', path, data }); },
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
}));
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => path,
  uploadBytesResumable: (_reference: string, file: { size: number }) => ({
    on: (_event: string, next: (snapshot: { bytesTransferred: number }) => void, _error: (error: Error) => void, complete: () => void) => {
      next({ bytesTransferred: Math.floor(file.size / 2) });
      next({ bytesTransferred: file.size });
      complete();
    },
  }),
}));
vi.mock('../../src/services/privateUploadVerification.ts', () => ({
  waitForPrivateUploadVerification: ({ binaryId }: { binaryId: string }) => new Promise((resolve, reject) => {
    api.pendingVerifications += 1;
    api.maxPendingVerifications = Math.max(api.maxPendingVerifications, api.pendingVerifications);
    api.verifications.push({
      binaryId,
      resolve: (result) => { api.pendingVerifications -= 1; api.log.push({ kind: 'verified', binaryId }); resolve(result); },
      reject: (error) => { api.pendingVerifications -= 1; reject(error); },
    });
  }),
}));
vi.mock('../../src/security/fileValidation.ts', () => ({
  validateFileForUpload: async ({ fileName }: { fileName: string }) => fileName.endsWith('.pdf')
    ? { kind: 'document', format: 'pdf', canonicalMimeType: 'application/pdf', extension: 'pdf', maximumBytes: 1 }
    : fileName.endsWith('.mp4')
      ? { kind: 'video', format: 'mp4', canonicalMimeType: 'video/mp4', extension: 'mp4', maximumBytes: 1 }
      : { kind: 'image', format: 'jpeg', canonicalMimeType: 'image/jpeg', extension: 'jpg', maximumBytes: 1 },
}));
vi.mock('../../src/services/schemaCatalog.ts', () => ({ loadCreationSchemaVersion: async () => '1.6.0' }));
vi.mock('../../src/persistence/localVault.ts', () => ({ scopedStorageForIdentity: (_storage: unknown, uid: string, cartularyId: string) => { api.localScope(uid, cartularyId); return { setItem: api.localSetItem }; } }));

import { MAXIMUM_CONCURRENT_CREATION_UPLOADS, createCartulary, type CartularyCreationProgress } from '../../src/services/cartularyCreation.ts';

const UID = 'owner_pipeline_v5';
const fileOf = (name: string, size: number, type: string) => new NodeFile([Buffer.alloc(size, name.charCodeAt(0))], name, { type, lastModified: 1_757_000_000_000 }) as unknown as File;
const cover = () => fileOf('couverture.jpg', 1_200, 'image/jpeg');
const dossier = () => [fileOf('detail-1.jpg', 800, 'image/jpeg'), fileOf('detail-2.jpg', 1_500, 'image/jpeg'), fileOf('notice.pdf', 600, 'application/pdf'), fileOf('clip.mp4', 2_000, 'video/mp4')];
const NAMES = ['couverture.jpg', 'detail-1.jpg', 'detail-2.jpg', 'notice.pdf', 'clip.mp4'];
const TOTAL_BYTES = 1_200 + 800 + 1_500 + 600 + 2_000;
const verified = (mimeType = 'image/jpeg') => ({ detectedMimeType: mimeType, detectedFormat: 'jpeg', capturedAt: null, timestampSource: null, derivativeStatus: 'ready', verificationVersion: 'private-upload@1.1.0', privatePresentation: null });

const manifests = () => api.log.filter((entry): entry is Extract<typeof entry, { kind: 'set' }> => entry.kind === 'set' && entry.path.includes('/binaries/'));
const requestWrites = () => api.log.filter((entry): entry is Extract<typeof entry, { kind: 'set' }> => entry.kind === 'set' && entry.path.startsWith('cartularyCreateRequests/'));
const stateWrite = (key: string) => api.log.find((entry): entry is Extract<typeof entry, { kind: 'set' }> => entry.kind === 'set' && entry.path.endsWith(`/state/${key}`));
const binaryIdOf = (fileName: string) => {
  const manifest = manifests().find((entry) => entry.data.fileName === fileName);
  if (!manifest) throw new Error(`Aucun manifeste pour ${fileName}`);
  return manifest.data.binaryId as string;
};
const verificationOf = (fileName: string) => {
  const entry = api.verifications.find((candidate) => candidate.binaryId === binaryIdOf(fileName));
  if (!entry) throw new Error(`Aucune vérification en attente pour ${fileName}`);
  return entry;
};
const settle = (fileName: string) => verificationOf(fileName).resolve(verified(fileName.endsWith('.pdf') ? 'application/pdf' : fileName.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'));
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const startCreation = (onProgress?: (progress: CartularyCreationProgress) => void) => createCartulary({
  user: { uid: UID } as User,
  organizationId: 'org_pipeline_v5',
  registryId: 'reg_pipeline_v5',
  coverFile: cover(),
  files: dossier(),
  onProgress,
  profile: {
    collectionId: 'col_pipeline_v5', brand: 'Marque pipeline', model: 'Modèle pipeline', reference: 'REF-PIPE-5', manufactureYear: null,
    serialNumber: '', caliber: '', description: '', conditionSummary: '', purchaseDate: '', purchasePrice: null, currency: 'EUR', seller: '',
    valuationDate: '', valuationLow: null, valuationMid: null, valuationHigh: null, sourceLabel: 'Dossier de test',
  },
});

let digestInFlight = 0;
let maxDigestInFlight = 0;

beforeEach(() => {
  api.log.length = 0;
  api.verifications.length = 0;
  api.pendingVerifications = 0;
  api.maxPendingVerifications = 0;
  api.localSetItem.mockReset();
  digestInFlight = 0;
  maxDigestInFlight = 0;
  // Hachage ralenti pour rendre observable tout recouvrement de deux `digest` (hachage parallèle).
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => webcrypto.getRandomValues(array),
    subtle: {
      digest: async (algorithm: string, data: ArrayBuffer) => {
        digestInFlight += 1;
        maxDigestInFlight = Math.max(maxDigestInFlight, digestInFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        try { return await webcrypto.subtle.digest(algorithm, data); } finally { digestInFlight -= 1; }
      },
    },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('pipeline de création borné', () => {
  it('borne : deux manifestes et deux vérifications en vol, la troisième seulement après une résolution, jamais plus de deux en attente', async () => {
    expect(MAXIMUM_CONCURRENT_CREATION_UPLOADS).toBe(2);
    const creation = startCreation();
    await vi.waitFor(() => expect(manifests()).toHaveLength(2));
    await flush();
    expect(manifests().map((entry) => entry.data.fileName)).toEqual(['couverture.jpg', 'detail-1.jpg']);
    expect(api.pendingVerifications).toBe(2);
    expect(manifests().every((entry) => entry.data.uploadStatus === 'pending_upload' && entry.data.ownerUid === UID)).toBe(true);
    settle('detail-1.jpg');
    await vi.waitFor(() => expect(manifests()).toHaveLength(3));
    expect(manifests()[2].data.fileName).toBe('detail-2.jpg');
    expect(api.pendingVerifications).toBe(2);
    settle('couverture.jpg');
    await vi.waitFor(() => expect(manifests()).toHaveLength(4));
    settle('detail-2.jpg');
    await vi.waitFor(() => expect(manifests()).toHaveLength(5));
    settle('notice.pdf');
    settle('clip.mp4');
    const result = await creation;
    expect(api.maxPendingVerifications).toBe(2);
    expect(api.localScope).toHaveBeenCalledWith(UID, result.cartularyId);
    expect(result).toMatchObject({ uploadedFileCount: 5, uploadedBytes: TOTAL_BYTES, media: { total: 5, imagesPending: 3, videosOnDemand: 1, documents: 1 } });
    expect(result.cartularyId).toMatch(/^cart_marque_pipeline_modele_pipeline_ref_pipe_5_[0-9a-f]{12}$/);
  });

  it('ordre et étiquettes : cinq assets dans l’ordre d’entrée, couverture en main-photo même vérifiée en dernier', async () => {
    const creation = startCreation();
    await vi.waitFor(() => expect(manifests()).toHaveLength(2));
    settle('detail-1.jpg');
    await vi.waitFor(() => expect(manifests()).toHaveLength(3));
    settle('detail-2.jpg');
    await vi.waitFor(() => expect(manifests()).toHaveLength(4));
    settle('notice.pdf');
    await vi.waitFor(() => expect(manifests()).toHaveLength(5));
    settle('clip.mp4');
    await flush();
    expect(requestWrites()).toHaveLength(0);
    settle('couverture.jpg');
    await creation;
    const assets = JSON.parse(stateWrite('cartularia-media-assets-v3')!.data.value as string) as Array<{ name: string; tags: string[]; type: string; binaryId: string }>;
    expect(assets.map((asset) => asset.name)).toEqual(NAMES);
    expect(assets[0].tags).toEqual(['main-photo', 'slideshow']);
    expect(assets.slice(1).map((asset) => asset.tags)).toEqual([['slideshow'], ['slideshow'], ['documentation'], ['main-video']]);
    expect(assets.map((asset) => asset.binaryId)).toEqual(NAMES.map(binaryIdOf));
    expect(api.localSetItem).toHaveBeenCalledWith('cartularia-media-assets-v3', stateWrite('cartularia-media-assets-v3')!.data.value);
  });

  it('invariant serveur : la demande de création est écrite strictement après la cinquième vérification acceptée', async () => {
    const creation = startCreation();
    for (const name of NAMES) {
      await vi.waitFor(() => expect(api.verifications.some((entry) => entry.binaryId === binaryIdOf(name))).toBe(true));
      settle(name);
      await flush();
    }
    await creation;
    const verifiedIndexes = api.log.map((entry, index) => (entry.kind === 'verified' ? index : -1)).filter((index) => index >= 0);
    const requestIndex = api.log.findIndex((entry) => entry.kind === 'set' && entry.path.startsWith('cartularyCreateRequests/'));
    expect(verifiedIndexes).toHaveLength(5);
    expect(requestIndex).toBeGreaterThan(Math.max(...verifiedIndexes));
    expect(requestWrites()).toHaveLength(1);
    expect(requestWrites()[0].data).toMatchObject({ status: 'pending', ownerUid: UID, registryId: 'reg_pipeline_v5', requestedAt: 'SERVER_TIMESTAMP' });
    // Les quatre états du brouillon précèdent la demande.
    for (const key of ['cartularia-creation-profile', 'cartularia-specification-groups', 'cartularia-media-assets-v3', 'cartularia-public-code']) {
      expect(api.log.indexOf(stateWrite(key)!)).toBeLessThan(requestIndex);
    }
  });

  it('progression : octets monotones et bornés, au plus deux fichiers en vol sans doublon, 5/5 avant finalizing, dernière émission processing sans fichier', async () => {
    const emissions: CartularyCreationProgress[] = [];
    const creation = startCreation((progress) => emissions.push({ ...progress, activeFileNames: [...progress.activeFileNames] }));
    for (const name of NAMES) {
      await vi.waitFor(() => expect(api.verifications.some((entry) => entry.binaryId === binaryIdOf(name))).toBe(true));
      settle(name);
      await flush();
    }
    await creation;
    expect(emissions[0]).toMatchObject({ phase: 'preparing', activeFileNames: [], completedFiles: 0, totalFiles: 5, uploadedBytes: 0, totalBytes: TOTAL_BYTES });
    for (let index = 1; index < emissions.length; index += 1) {
      expect(emissions[index].uploadedBytes).toBeGreaterThanOrEqual(emissions[index - 1].uploadedBytes);
      expect(emissions[index].uploadedBytes).toBeLessThanOrEqual(TOTAL_BYTES);
      expect(emissions[index].activeFileNames.length).toBeLessThanOrEqual(2);
      expect(new Set(emissions[index].activeFileNames).size).toBe(emissions[index].activeFileNames.length);
    }
    expect(emissions.some((progress) => progress.activeFileNames.length === 2)).toBe(true);
    const finalizingIndex = emissions.findIndex((progress) => progress.phase === 'finalizing');
    expect(finalizingIndex).toBeGreaterThan(0);
    expect(emissions[finalizingIndex - 1].completedFiles).toBe(5);
    expect(emissions[finalizingIndex]).toMatchObject({ completedFiles: 5, uploadedBytes: TOTAL_BYTES, activeFileNames: [] });
    expect(emissions.slice(0, finalizingIndex).every((progress) => ['preparing', 'hashing', 'uploading', 'verifying'].includes(progress.phase))).toBe(true);
    expect(emissions.at(-1)).toMatchObject({ phase: 'processing', activeFileNames: [], completedFiles: 5, uploadedBytes: TOTAL_BYTES });
  });

  it('échec : le refus du deuxième fichier rejette la création, n’écrit ni demande ni manifeste supplémentaire, et la résolution tardive du premier ne produit rien', async () => {
    const creation = startCreation();
    const rejection = expect(creation).rejects.toThrow('Le fichier a été refusé par la vérification de sécurité.');
    await vi.waitFor(() => expect(manifests()).toHaveLength(2));
    verificationOf('detail-1.jpg').reject(new Error('Le fichier a été refusé par la vérification de sécurité.'));
    await rejection;
    expect(manifests()).toHaveLength(2);
    expect(requestWrites()).toHaveLength(0);
    expect(api.pendingVerifications).toBe(1);
    // Résolution tardive de la couverture : aucune prise de fichier suivant, aucune écriture, aucun rejet non géré.
    settle('couverture.jpg');
    await flush();
    await flush();
    expect(manifests()).toHaveLength(2);
    expect(requestWrites()).toHaveLength(0);
    expect(stateWrite('cartularia-media-assets-v3')).toBeUndefined();
    expect(api.localSetItem).not.toHaveBeenCalled();
  });

  it('hachage sérialisé : jamais deux digest imbriqués malgré deux fichiers en vol', async () => {
    const creation = startCreation();
    for (const name of NAMES) {
      await vi.waitFor(() => expect(api.verifications.some((entry) => entry.binaryId === binaryIdOf(name))).toBe(true));
      settle(name);
      await flush();
    }
    await creation;
    expect(maxDigestInFlight).toBe(1);
    expect(manifests().map((entry) => entry.data.sha256)).toHaveLength(5);
    expect(new Set(manifests().map((entry) => entry.data.sha256)).size).toBe(5);
    expect(manifests().every((entry) => /^sha256:[0-9a-f]{64}$/.test(entry.data.sha256 as string))).toBe(true);
  });
});
