import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistryItems } from '../../src/features/registry/RegistryItems';
import type { RegistryDocument } from '../../src/domain/foundations';
import type { RegistryItemProjection } from '../../src/domain/projections';

/**
 * Catalogue (contrat V3, K5) : la carte lit `item.thumbnail` seulement — aucune lecture d'assets, aucun Storage ;
 * sans vignette, état honnête selon la nature de la couverture.
 */
const state = vi.hoisted(() => ({ items: [] as RegistryItemProjection[], assetReads: 0, storageReads: 0 }));
vi.mock('../../src/services/collections', () => ({
  observeRegistryCollections: vi.fn((_id: string, next: (value: unknown[]) => void) => { next([{ id: 'col_v3', name: 'Collection V3' }]); return () => {}; }),
}));
vi.mock('../../src/services/projections', () => ({
  observeRegistryItems: vi.fn((_id: string, next: (items: RegistryItemProjection[]) => void) => { next(state.items); return () => {}; }),
  loadRegistryItems: vi.fn(async () => state.items),
  loadScopedRegistryItems: vi.fn(async () => state.items),
  loadPublicPublicationStatuses: vi.fn(async () => ({})),
}));
vi.mock('firebase/firestore', () => ({
  getDocs: vi.fn(async () => { state.assetReads += 1; return { docs: [] }; }),
  getDoc: vi.fn(async () => { state.assetReads += 1; return { exists: () => false, data: () => undefined }; }),
  collection: vi.fn(), doc: vi.fn(), query: vi.fn(), orderBy: vi.fn(), where: vi.fn(), onSnapshot: vi.fn(() => () => {}),
}));
vi.mock('firebase/storage', () => ({
  getBlob: vi.fn(async () => { state.storageReads += 1; throw new Error('Storage interdit au Catalogue'); }),
  getDownloadURL: vi.fn(async () => { state.storageReads += 1; throw new Error('Storage interdit au Catalogue'); }),
  ref: vi.fn(),
}));
vi.mock('../../src/firebase.ts', () => ({ db: {}, storage: {}, auth: { authStateReady: async () => undefined, currentUser: { uid: 'owner_v3_catalog' } } }));

const registry = { id: 'reg_v3_catalog', organizationId: 'org_v3_catalog', name: 'Registre V3' } as RegistryDocument;
const DIGEST = `sha256:${'d'.repeat(64)}`;
const INLINE_DATA_URL = `data:image/webp;base64,${btoa('webp-inline-catalog-240')}`;
const baseItem = (overrides: Partial<RegistryItemProjection>): RegistryItemProjection => ({
  cartularyId: 'cart_v3_catalog_object', registryId: registry.id, organizationId: registry.organizationId, collectionId: 'col_v3', assetType: 'watch',
  displayTitle: 'Maison Modèle', makerName: 'Maison', modelName: 'Modèle', referenceCode: 'REF-V3', manufactureYear: 2001, lifecycleStatus: 'active',
  possessionStatus: 'in_possession', completenessLevel: 'imported_unreviewed', projectionStatus: 'active', sourceRevision: 3, contentHash: 'sha256:x',
  primaryAssetId: 'asset_cover', primaryMediaKind: 'image', ...overrides,
});

beforeEach(() => {
  window.history.replaceState(null, '', '/registry/reg_v3_catalog/items');
  state.assetReads = 0; state.storageReads = 0;
  state.items = [
    baseItem({ cartularyId: 'cart_v3_inline', displayTitle: 'Objet inline', thumbnail: { kind: 'inline', dataUrl: INLINE_DATA_URL, width: 240, height: 160, assetId: 'asset_cover', sha256: DIGEST } }),
    baseItem({ cartularyId: 'cart_v3_bundle', displayTitle: 'Objet bundle', assetType: 'car', thumbnail: { kind: 'bundle', path: '/assets/demo-watches/derivatives/rolex-submariner/main.240.webp', width: 240, height: 240, assetId: 'asset_cover', sha256: DIGEST } }),
    baseItem({ cartularyId: 'cart_v3_pending', displayTitle: 'Objet en préparation', thumbnail: null }),
    baseItem({ cartularyId: 'cart_v3_video', displayTitle: 'Objet vidéo', thumbnail: null, primaryMediaKind: 'video' }),
    baseItem({ cartularyId: 'cart_v3_legacy', displayTitle: 'Objet antérieur', thumbnail: undefined, primaryMediaKind: undefined }),
    baseItem({ cartularyId: 'cart_v3_none', displayTitle: 'Objet sans couverture', thumbnail: null, primaryAssetId: null, primaryMediaKind: null }),
    baseItem({ cartularyId: 'cart_v3_failed', displayTitle: 'Objet sans copie', thumbnail: null, thumbnailStatus: 'failed' }),
    baseItem({ cartularyId: 'cart_v3_status_none', displayTitle: 'Objet sans dérivé', thumbnail: null, thumbnailStatus: 'none' }),
  ];
});

describe('vignettes du Catalogue', () => {
  it('affiche les vignettes inline et bundle depuis l’item, sans lecture d’assets ni Storage', async () => {
    const { container } = render(<RegistryItems registry={registry} />);
    await screen.findByText('Objet inline');
    const images = [...container.querySelectorAll('img.registry-item__thumbnail')] as HTMLImageElement[];
    expect(images.map((image) => image.getAttribute('src')).sort()).toEqual([INLINE_DATA_URL, '/assets/demo-watches/derivatives/rolex-submariner/main.240.webp'].sort());
    expect(images.every((image) => image.getAttribute('loading') === 'lazy' && image.getAttribute('decoding') === 'async' && image.getAttribute('alt') === '')).toBe(true);
    const inline = images.find((image) => image.getAttribute('src') === INLINE_DATA_URL)!;
    expect(inline.getAttribute('width')).toBe('240'); expect(inline.getAttribute('height')).toBe('160');
    const visuals = [...container.querySelectorAll('.registry-item__visual--with-thumbnail')];
    expect(visuals).toHaveLength(2);
    expect(visuals.every((visual) => visual.querySelector('.registry-item__badge svg'))).toBe(true);
    expect(visuals.map((visual) => visual.textContent).sort()).toEqual(['Montre', 'Véhicule']);
    expect(state.assetReads).toBe(0);
    expect(state.storageReads).toBe(0);
  });

  it('déclare honnêtement l’absence de vignette selon la nature de la couverture', async () => {
    const { container } = render(<RegistryItems registry={registry} />);
    await screen.findByText('Objet inline');
    const stateOf = (title: string) => screen.getByText(title).closest('article')!.querySelector('.registry-item__visual')!;
    expect(stateOf('Objet en préparation').getAttribute('data-thumbnail-state')).toBe('pending');
    expect(stateOf('Objet en préparation').textContent).toContain('Vignette en préparation');
    expect(stateOf('Objet vidéo').getAttribute('data-thumbnail-state')).toBe('unavailable');
    expect(stateOf('Objet vidéo').textContent).toContain('Aucune vignette disponible');
    expect(stateOf('Objet antérieur').getAttribute('data-thumbnail-state')).toBe('unavailable');
    expect(stateOf('Objet antérieur').textContent).not.toContain('Vignette en préparation');
    expect(stateOf('Objet sans couverture').getAttribute('data-thumbnail-state')).toBe('none');
    expect(stateOf('Objet sans couverture').querySelector('.registry-item__thumbnail-state')).toBeNull();
    expect(stateOf('Objet sans couverture').querySelector('svg')).not.toBeNull();
    // K3 étendu (tour 4, point 2) : le statut serveur prime sur la nature de la couverture, jamais « en préparation » perpétuel.
    expect(stateOf('Objet sans copie').getAttribute('data-thumbnail-state')).toBe('failed');
    expect(stateOf('Objet sans copie').textContent).toContain('Copie de présentation non produite');
    expect(stateOf('Objet sans dérivé').getAttribute('data-thumbnail-state')).toBe('unavailable');
    expect(stateOf('Objet sans dérivé').textContent).toContain('Aucune vignette disponible');
    expect(container.textContent).not.toContain('Accès restreint');
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  it('refuse une vignette hors contrat et conserve l’image en vue liste', async () => {
    state.items = [
      baseItem({ cartularyId: 'cart_v3_forged', displayTitle: 'Objet forgé', thumbnail: { kind: 'inline', dataUrl: 'javascript:alert(1)', width: 240, height: 160, assetId: 'asset_cover', sha256: DIGEST } }),
      baseItem({ cartularyId: 'cart_v3_remote', displayTitle: 'Objet distant', thumbnail: { kind: 'bundle', path: 'https://evil.example/x.240.webp', width: 240, height: 160, assetId: 'asset_cover', sha256: DIGEST } }),
      baseItem({ cartularyId: 'cart_v3_inline', displayTitle: 'Objet inline', thumbnail: { kind: 'inline', dataUrl: INLINE_DATA_URL, width: 240, height: 160, assetId: 'asset_cover', sha256: DIGEST } }),
    ];
    window.history.replaceState(null, '', '/registry/reg_v3_catalog/items?view=list');
    const { container } = render(<RegistryItems registry={registry} />);
    await screen.findByText('Objet forgé');
    expect(container.querySelector('.registry-item-grid--list')).not.toBeNull();
    const images = [...container.querySelectorAll('img')];
    expect(images).toHaveLength(1);
    expect(images[0].getAttribute('src')).toBe(INLINE_DATA_URL);
    expect(screen.getByText('Objet forgé').closest('article')!.querySelector('.registry-item__visual')!.getAttribute('data-thumbnail-state')).toBe('pending');
  });
});
