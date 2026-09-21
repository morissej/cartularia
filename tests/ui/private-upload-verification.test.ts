import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Vérification du téléversement privé (création, V3 K2/K4) : le résultat porte la référence figée des
 * variantes presentation-v3 du manifeste accepté, restreinte à l'identité du propriétaire, sans vignette
 * inline, sans presentation-v2 ni chemin d'original ; null quand le serveur n'a rien produit (vidéo).
 * Propriétaire et objets simulés aux valeurs différentes des fixtures du dépôt.
 */
const api = vi.hoisted(() => ({ onSnapshot: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../../src/firebase.ts', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, ...path: string[]) => path.join('/'), onSnapshot: api.onSnapshot }));

import { presentationReferenceFromManifest, waitForPrivateUploadVerification } from '../../src/services/privateUploadVerification.ts';

const UID = 'owner_creation_v3';
const CARTULARY = 'cart_creation_v3_object';
const BINARY = 'bin_creation_v3';
const digest = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const variantPath = (width: number, { uid = UID, cartularyId = CARTULARY, binaryId = BINARY } = {}) => `private-derivatives/${uid}/${cartularyId}/${binaryId}/presentation-v3-${width}.webp`;
const variant = (width: number, overrides: Record<string, unknown> = {}) => ({ width, height: Math.round(width * 3 / 4), storagePath: variantPath(width), sha256: digest(String(width % 10)), size: width * 10, mimeType: 'image/webp', ...overrides });
const acceptedManifest = (overrides: Record<string, unknown> = {}) => ({
  ownerUid: UID, cartularyId: CARTULARY, binaryId: BINARY, deleted: false,
  uploadStatus: 'ready', verificationStatus: 'accepted', verificationVersion: 'private-upload@1.1.0',
  detectedMimeType: 'image/jpeg', detectedFormat: 'jpeg', derivativeStatus: 'ready',
  capturedAtExtracted: '2026-09-01T10:00:00.000Z', capturedAtSource: 'exif.DateTimeOriginal',
  storagePath: `private-drafts/${UID}/${CARTULARY}/${BINARY}/${'b'.repeat(64)}/original`,
  presentationDerivative: {
    storagePath: `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`, mimeType: 'image/webp', width: 2400, height: 1800,
    variantsVersion: 'presentation-v3', variantsGeneratedAt: '2026-09-14T10:00:00.000Z', variantsFailure: null,
    variants: [variant(1200), variant(240), variant(768), variant(480)],
    thumbnail: { dataUrl: 'data:image/webp;base64,UklGRg==', width: 240, height: 180, sha256: digest('0') },
  },
  ...overrides,
});

type Listener = (snapshot: { exists: () => boolean; data: () => Record<string, unknown> }) => void;
let listeners: Listener[] = [];
const emit = (data: Record<string, unknown> | null) => { for (const listener of listeners) listener({ exists: () => data !== null, data: () => data ?? {} }); };

beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  api.unsubscribe.mockReset();
  api.onSnapshot.mockReset().mockImplementation((_reference: string, next: Listener) => { listeners.push(next); return api.unsubscribe; });
});
afterEach(() => { vi.useRealTimers(); });

describe('référence des variantes de présentation à la création', () => {
  it('le résultat porte les variantes v3 triées, restreintes à l’identité, sans vignette inline ni presentation-v2', async () => {
    const pending = waitForPrivateUploadVerification({ uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
    expect(api.onSnapshot).toHaveBeenCalledWith(`privateDrafts/${UID}/cartularies/${CARTULARY}/binaries/${BINARY}`, expect.any(Function), expect.any(Function));
    emit(acceptedManifest({ uploadStatus: 'pending_upload', verificationStatus: 'processing' }));
    emit(acceptedManifest({
      presentationDerivative: {
        ...acceptedManifest().presentationDerivative,
        variants: [
          ...acceptedManifest().presentationDerivative.variants,
          variant(480, { storagePath: variantPath(480, { uid: 'owner_intrus' }) }),
          variant(768, { storagePath: variantPath(768, { binaryId: 'bin_autre' }) }),
          variant(240, { storagePath: `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp` }),
        ],
      },
    }));
    const result = await pending;
    expect(result.derivativeStatus).toBe('ready');
    expect(result.verificationVersion).toBe('private-upload@1.1.0');
    expect(result.detectedMimeType).toBe('image/jpeg');
    expect(result.capturedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(result.timestampSource).toBe('exif.DateTimeOriginal');
    expect(result.privatePresentation).toEqual({
      binaryId: BINARY,
      version: 'presentation-v3',
      variants: [variant(240), variant(480), variant(768), variant(1200)],
      thumbnail: null,
    });
    const serialized = JSON.stringify(result.privatePresentation);
    expect(serialized).not.toContain('presentation-v2');
    expect(serialized).not.toContain('/original');
    expect(serialized).not.toContain('owner_intrus');
    expect(serialized).not.toContain('bin_autre');
    expect(serialized).not.toContain('data:image');
    expect(serialized.length).toBeLessThan(1_200);
    expect(api.unsubscribe).toHaveBeenCalledOnce();
  });

  it('une vidéo acceptée sans variante donne privatePresentation null et derivativeStatus « pending » (aucun faux état)', async () => {
    const pending = waitForPrivateUploadVerification({ uid: UID, cartularyId: CARTULARY, binaryId: 'bin_video_v3' });
    emit(acceptedManifest({
      binaryId: 'bin_video_v3', detectedMimeType: 'video/mp4', detectedFormat: 'mp4', derivativeStatus: 'pending_transcode',
      capturedAtExtracted: null, capturedAtSource: null, presentationDerivative: null,
    }));
    const result = await pending;
    expect(result.privatePresentation).toBeNull();
    expect(result.derivativeStatus).toBe('pending');
    expect(result.capturedAt).toBeNull();
    expect(result.timestampSource).toBeNull();
  });

  it('un manifeste presentation-v2 seul (parc antérieur à V3) ne donne aucune référence : l’aperçu reste « en préparation »', () => {
    const legacy = acceptedManifest({ presentationDerivative: { storagePath: `private-derivatives/${UID}/${CARTULARY}/${BINARY}/presentation-v2.webp`, mimeType: 'image/webp', width: 2400, height: 1800, sha256: digest('9'), size: 120_000 } });
    expect(presentationReferenceFromManifest(legacy, { uid: UID, cartularyId: CARTULARY, binaryId: BINARY })).toBeNull();
    expect(presentationReferenceFromManifest(acceptedManifest({ deleted: true }), { uid: UID, cartularyId: CARTULARY, binaryId: BINARY })).toBeNull();
    expect(presentationReferenceFromManifest(acceptedManifest(), { uid: 'owner_autre', cartularyId: CARTULARY, binaryId: BINARY })).toBeNull();
  });

  it('un refus serveur rejette avec le message du manifeste et se désabonne', async () => {
    const pending = waitForPrivateUploadVerification({ uid: UID, cartularyId: CARTULARY, binaryId: BINARY });
    emit(acceptedManifest({ verificationStatus: 'rejected', uploadStatus: 'failed', verificationMessage: 'Format non reconnu.' }));
    await expect(pending).rejects.toThrow('Format non reconnu.');
    expect(api.unsubscribe).toHaveBeenCalledOnce();
  });

  it('sans réponse serveur, le délai rejette en conservant le brouillon', async () => {
    const pending = waitForPrivateUploadVerification({ uid: UID, cartularyId: CARTULARY, binaryId: BINARY, timeoutMs: 5_000 });
    emit(null);
    vi.advanceTimersByTime(5_000);
    await expect(pending).rejects.toThrow(/tarde à se terminer/);
    expect(api.unsubscribe).toHaveBeenCalledOnce();
  });
});

it('une attente liée à un original ne peut accepter une attestation d’une autre génération', async () => {
  const expectedOriginal = { storagePath: acceptedManifest().storagePath, sha256: digest('b'), size: 100, generation: '5' };
  const pending = waitForPrivateUploadVerification({ uid: UID, cartularyId: CARTULARY, binaryId: BINARY, expectedOriginal });
  const rejected = expect(pending).rejects.toThrow('attestation');
  emit(acceptedManifest({ sha256: digest('b'), size: 100, verificationIdentity: {
    schemaVersion: 'private-binary-identity@1.0.0', ownerUid: UID, cartularyId: CARTULARY, binaryId: BINARY,
    ...expectedOriginal, generation: '6',
  } }));
  await rejected;
  expect(api.unsubscribe).toHaveBeenCalledOnce();
});

it('une attente abandonne le résultat si le manifeste a été remplacé', async () => {
  const expectedOriginal = { storagePath: acceptedManifest().storagePath, sha256: digest('b'), size: 100, generation: '5' };
  const pending = waitForPrivateUploadVerification({ uid: UID, cartularyId: CARTULARY, binaryId: BINARY, expectedOriginal });
  const rejected = expect(pending).rejects.toThrow('changé');
  emit(acceptedManifest({ sha256: digest('c'), size: 100 }));
  await rejected;
});
