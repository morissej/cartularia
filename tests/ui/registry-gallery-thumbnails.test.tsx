import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryGallery } from '../../src/features/registry/RegistryGallery.tsx';
import type { RegistryDocument } from '../../src/domain/foundations';
import type { RegistryItemProjection } from '../../src/domain/projections';

/**
 * Galerie (contrat V3, K5) : cartes depuis `item.thumbnail` (0 lecture d'assets, 0 Storage, 0 original) ;
 * visionneuse : assets lus à l'ouverture seulement, variantes (rôle stage/thumbnail) pour le propriétaire,
 * message honnête pour un membre non propriétaire (G9), jamais l'original.
 */
const OWNER = 'owner_v3_gallery';
const CARTULARY = 'cart_v3_gallery_object';
const state = vi.hoisted(() => ({
  items: [] as RegistryItemProjection[],
  assets: [] as Array<{ id: string; data: Record<string, unknown> }>,
  viewerUid: 'owner_v3_gallery' as string | null,
  images: [] as Array<{ role: string; binaryId?: string; cartularyId?: string; presentationBinaryId?: string; eager: boolean }>,
  getDocs: vi.fn(), presentation: vi.fn(), original: vi.fn(), blob: vi.fn(), downloadUrl: vi.fn(), fetch: vi.fn(),
}));
// PrivateMediaImage est doublé : son contrat (variantes, jamais l'original) est couvert par private-media-image-lifecycle ;
// ici on vérifie ce que la Galerie lui demande (rôle, binaire, miroir) et qu'aucun original n'est sollicité.
vi.mock('../../src/components/PrivateMediaImage.tsx', () => ({
  PrivateMediaImage: ({ asset, role = 'stage', eager = false, alt = '' }: { asset: { binaryId?: string; cartularyId?: string; privatePresentation?: { binaryId: string } | null }; role?: string; eager?: boolean; alt?: string }) => {
    state.images.push({ role, binaryId: asset.binaryId, cartularyId: asset.cartularyId, presentationBinaryId: asset.privatePresentation?.binaryId, eager });
    return <img src={`blob:variant-${role}-${asset.binaryId}`} alt={alt} data-role={role} data-binary={asset.binaryId} />;
  },
}));
vi.mock('../../src/services/collections', () => ({
  observeRegistryCollections: vi.fn((_id: string, next: (value: unknown[]) => void) => { next([{ id: 'col_v3', name: 'Collection V3' }]); return () => {}; }),
}));
vi.mock('../../src/services/projections.ts', () => ({
  observeRegistryItems: vi.fn((_id: string, next: (items: RegistryItemProjection[]) => void) => { next(state.items); return () => {}; }),
  loadRegistryItems: vi.fn(async () => state.items),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => path.join('/')),
  getDocs: (...args: unknown[]) => state.getDocs(...args),
  doc: vi.fn(), getDoc: vi.fn(async () => ({ exists: () => false, data: () => undefined })), query: vi.fn(), orderBy: vi.fn(), where: vi.fn(), onSnapshot: vi.fn(() => () => {}),
}));
vi.mock('firebase/storage', () => ({ getBlob: (...args: unknown[]) => state.blob(...args), getDownloadURL: (...args: unknown[]) => state.downloadUrl(...args), ref: vi.fn() }));
vi.mock('../../src/firebase.ts', () => ({
  db: {}, storage: {},
  auth: { authStateReady: async () => undefined, get currentUser() { return state.viewerUid ? { uid: state.viewerUid } : null; } },
}));
vi.mock('../../src/services/privateMedia.ts', () => ({
  acquirePrivatePresentationObjectUrl: (...args: unknown[]) => state.presentation(...args),
  acquirePrivateMediaObjectUrl: (...args: unknown[]) => state.original(...args),
  releasePrivateMediaObjectUrl: vi.fn(),
}));

const registry = { id: 'reg_v3_gallery', organizationId: 'org_v3_gallery', name: 'Registre V3' } as RegistryDocument;
const DIGEST = `sha256:${'e'.repeat(64)}`;
const INLINE_DATA_URL = `data:image/webp;base64,${btoa('webp-inline-gallery-240')}`;
const variantPath = (binaryId: string, width: number, uid = OWNER) => `private-derivatives/${uid}/${CARTULARY}/${binaryId}/presentation-v3-${width}.webp`;
const presentationOf = (binaryId: string) => ({
  binaryId, version: 'presentation-v3',
  variants: [240, 480, 768, 1200].map((width) => ({ width, height: Math.round(width * 2 / 3), storagePath: variantPath(binaryId, width), sha256: DIGEST, size: 1000 + width, mimeType: 'image/webp' })),
  thumbnail: { dataUrl: INLINE_DATA_URL, width: 240, height: 160, sha256: DIGEST },
});
const item = (overrides: Partial<RegistryItemProjection>): RegistryItemProjection => ({
  cartularyId: CARTULARY, registryId: registry.id, organizationId: registry.organizationId, collectionId: 'col_v3', assetType: 'watch',
  displayTitle: 'Maison Modèle', makerName: 'Maison', modelName: 'Modèle', referenceCode: 'REF-V3', manufactureYear: 2001, lifecycleStatus: 'active',
  possessionStatus: 'in_possession', completenessLevel: 'imported_unreviewed', projectionStatus: 'active', sourceRevision: 3, contentHash: 'sha256:x',
  primaryAssetId: 'asset_cover', primaryMediaKind: 'image', ...overrides,
});
const asset = (id: string, data: Record<string, unknown>) => ({ id, data: { id, mediaKind: 'image', displayName: `Vue ${id}`, tags: ['slideshow'], projectionStatus: 'active', componentCode: 'ensemble', ...data } });

beforeEach(() => {
  window.history.replaceState(null, '', '/registry/reg_v3_gallery/gallery');
  state.viewerUid = OWNER;
  state.images = [];
  state.getDocs.mockReset(); state.presentation.mockReset(); state.original.mockReset(); state.blob.mockReset(); state.downloadUrl.mockReset(); state.fetch.mockReset();
  state.getDocs.mockImplementation(async () => ({ docs: state.assets.map((entry) => ({ id: entry.id, data: () => entry.data })) }));
  state.presentation.mockImplementation(async ({ role }: { role: string }) => ({ url: `blob:variant-${role}`, byteSize: 1, release: () => {} }));
  state.original.mockImplementation(async () => { throw new Error('Original interdit dans la Galerie'); });
  vi.stubGlobal('fetch', state.fetch);
  state.items = [
    item({ cartularyId: CARTULARY, displayTitle: 'Objet propriétaire', thumbnail: { kind: 'inline', dataUrl: INLINE_DATA_URL, width: 240, height: 160, assetId: 'asset_cover', sha256: DIGEST } }),
    item({ cartularyId: 'cart_v3_bundle', displayTitle: 'Objet bundle', assetType: 'car', thumbnail: { kind: 'bundle', path: '/assets/demo-watches/derivatives/rolex-submariner/main.240.webp', width: 240, height: 240, assetId: 'asset_cover', sha256: DIGEST } }),
    item({ cartularyId: 'cart_v3_pending', displayTitle: 'Objet en préparation', thumbnail: null, thumbnailStatus: 'pending' }),
    item({ cartularyId: 'cart_v3_video', displayTitle: 'Objet vidéo', thumbnail: null, primaryMediaKind: 'video', thumbnailStatus: 'none' }),
    item({ cartularyId: 'cart_v3_failed', displayTitle: 'Objet sans copie', thumbnail: null, thumbnailStatus: 'failed' }),
  ];
  state.assets = [
    asset('asset_cover', { binaryId: 'bin_cover', tags: ['main-photo'], storagePath: `private-drafts/${OWNER}/${CARTULARY}/bin_cover/${'a'.repeat(64)}/original`, privatePresentation: presentationOf('bin_cover') }),
    asset('asset_side', { binaryId: 'bin_side', storagePath: `private-drafts/${OWNER}/${CARTULARY}/bin_side/${'b'.repeat(64)}/original`, privatePresentation: presentationOf('bin_side') }),
    asset('asset_video', { mediaKind: 'video', binaryId: 'bin_video' }),
    asset('asset_withdrawn', { binaryId: 'bin_withdrawn', projectionStatus: 'withdrawn' }),
    asset('asset_untagged', { binaryId: 'bin_untagged', tags: [] }),
  ];
});

describe('vignettes de la Galerie', () => {
  it('rend les cartes depuis item.thumbnail sans lire les assets, Storage ni originaux', async () => {
    const { container } = render(<RegistryGallery registry={registry} canReadCartularies />);
    await screen.findByText('Objet propriétaire');
    const images = [...container.querySelectorAll('.registry-gallery-card img')] as HTMLImageElement[];
    expect(images.map((image) => image.getAttribute('src'))).toEqual([INLINE_DATA_URL, '/assets/demo-watches/derivatives/rolex-submariner/main.240.webp']);
    expect(images.every((image) => image.getAttribute('loading') === 'lazy')).toBe(true);
    expect(images[0].getAttribute('width')).toBe('240');
    const cardOf = (title: string) => screen.getByText(title).closest('article')!;
    expect(cardOf('Objet en préparation').getAttribute('data-thumbnail-state')).toBe('pending');
    expect(cardOf('Objet en préparation').textContent).toContain('Vignette en préparation');
    expect(cardOf('Objet vidéo').getAttribute('data-thumbnail-state')).toBe('unavailable');
    expect(cardOf('Objet vidéo').textContent).toContain('Aucune vignette disponible');
    // K3 étendu (tour 4, point 2) : l'échec définitif consigné par le serveur n'est jamais rendu « en préparation ».
    expect(cardOf('Objet sans copie').getAttribute('data-thumbnail-state')).toBe('failed');
    expect(cardOf('Objet sans copie').textContent).toContain('Copie de présentation non produite');
    expect(cardOf('Objet sans copie').textContent).not.toContain('Vignette en préparation');
    expect(container.textContent).not.toContain('Original privé lu depuis Firebase Storage');
    expect(container.textContent).not.toContain('Aperçu à charger');
    expect(container.textContent).not.toContain('Aperçu protégé');
    expect(container.textContent).not.toContain('Accès restreint');
    expect(screen.queryByText('Vue du diaporama')).toBeNull();
    expect(container.querySelector('.registry-gallery-card__count')).toBeNull();
    expect(state.getDocs).not.toHaveBeenCalled();
    expect(state.presentation).not.toHaveBeenCalled();
    expect(state.original).not.toHaveBeenCalled();
    expect(state.blob).not.toHaveBeenCalled();
    expect(state.downloadUrl).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('ouvre la visionneuse en lisant les assets une seule fois et sert le propriétaire par les variantes, jamais l’original', async () => {
    const user = userEvent.setup();
    render(<RegistryGallery registry={registry} canReadCartularies />);
    await user.click(await screen.findByRole('button', { name: 'Ouvrir les photos de Objet propriétaire' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.getAttribute('data-lightbox-status')).toBe('ready'));
    expect(state.getDocs).toHaveBeenCalledTimes(1);
    expect(state.getDocs.mock.calls[0][0]).toBe(`cartularies/${CARTULARY}/assets`);
    expect(screen.getByText('1 / 2')).not.toBeNull();
    const stage = dialog.querySelector('figure img')!;
    expect(stage.getAttribute('data-role')).toBe('stage');
    expect(stage.getAttribute('data-binary')).toBe('bin_cover');
    const stageRequest = state.images.find((image) => image.role === 'stage')!;
    expect(stageRequest.cartularyId).toBe(CARTULARY);
    expect(stageRequest.presentationBinaryId).toBe('bin_cover');
    expect(stageRequest.eager).toBe(true);
    const strip = [...dialog.querySelectorAll('.registry-lightbox__thumbnails img')];
    expect(strip.map((image) => `${image.getAttribute('data-role')}:${image.getAttribute('data-binary')}`)).toEqual(['thumbnail:bin_cover', 'thumbnail:bin_side']);
    expect(state.images.every((image) => image.role !== 'original')).toBe(true);
    expect(state.original).not.toHaveBeenCalled();
    expect(state.blob).not.toHaveBeenCalled();
    expect(state.downloadUrl).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain('Copie de présentation lue depuis le Cartulaire');
    await user.click(screen.getByRole('button', { name: 'Photo suivante' }));
    expect(screen.getByText('2 / 2')).not.toBeNull();
    expect(dialog.textContent).toContain('Vue asset_side');
    expect(dialog.querySelector('figure img')!.getAttribute('data-binary')).toBe('bin_side');
    expect(state.getDocs).toHaveBeenCalledTimes(1);
  });

  it('propose un état honnête à un membre non propriétaire, sans aucune requête Storage', async () => {
    state.viewerUid = 'member_v3_gallery';
    const user = userEvent.setup();
    render(<RegistryGallery registry={registry} canReadCartularies />);
    await user.click(await screen.findByRole('button', { name: 'Ouvrir les photos de Objet propriétaire' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.getAttribute('data-lightbox-status')).toBe('ready'));
    expect(dialog.textContent).toContain('Photos privées non accessibles avec ce compte');
    expect(dialog.querySelector('[data-slide-access="restricted"]')).not.toBeNull();
    expect(dialog.querySelector('figure img')).toBeNull();
    expect(state.images).toHaveLength(0);
    expect(state.presentation).not.toHaveBeenCalled();
    expect(state.original).not.toHaveBeenCalled();
    expect(state.blob).not.toHaveBeenCalled();
    expect(state.downloadUrl).not.toHaveBeenCalled();
    expect(dialog.textContent).not.toContain('Accès restreint');
  });

  it('sert les dérivés same-origin du bundle par le catalogue et signale une lecture refusée sans faux état', async () => {
    state.assets = [
      asset('asset_cover', { tags: ['main-photo'], presentationDerivative: { url: '/assets/demo-watches/rolex-submariner/main.jpg' } }),
    ];
    const user = userEvent.setup();
    render(<RegistryGallery registry={registry} canReadCartularies />);
    await user.click(await screen.findByRole('button', { name: 'Ouvrir les photos de Objet bundle' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.getAttribute('data-lightbox-status')).toBe('ready'));
    const stage = dialog.querySelector('figure img')!;
    expect(stage.getAttribute('src')).toMatch(/^\/assets\/demo-watches\/derivatives\/rolex-submariner\/main\.\d+\.webp$/);
    expect(stage.getAttribute('src')).not.toContain('main.jpg');
    expect(stage.getAttribute('data-role')).toBeNull();
    expect(state.images).toHaveLength(0);
    expect(state.presentation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Fermer la visionneuse' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    state.getDocs.mockImplementation(async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); });
    await user.click(screen.getByRole('button', { name: 'Ouvrir les photos de Objet en préparation' }));
    const denied = await screen.findByRole('dialog');
    await waitFor(() => expect(denied.getAttribute('data-lightbox-status')).toBe('error'));
    expect(denied.textContent).toContain('Photos non accessibles avec ce compte');
    expect(denied.querySelector('img')).toBeNull();
  });
});
