import { beforeEach, describe, expect, it, vi } from 'vitest';

// V4 P-C6 : `loadCollectionWebsitePublication` ne rend une Collection que si sa projection existe en statut
// `published` ; identifiant refusé, document absent ou révoqué valent `null` sans lire les objets.
const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn() }));
vi.mock('../../src/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => path.join('/'),
  collection: (parent: unknown, ...path: string[]) => [typeof parent === 'string' ? parent : '', ...path].filter(Boolean).join('/'),
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  onSnapshot: () => () => undefined,
}));
vi.mock('../../src/services/projections', () => ({ loadRegistryItems: vi.fn(async () => []) }));

import { loadCollectionWebsitePublication } from '../../src/services/collections';

const snapshot = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data });
const publication = {
  publicationId: 'reg_test--col_test', organizationId: 'org_test', registryId: 'reg_test', collectionId: 'col_test',
  websiteTitle: 'Collection de test', websiteSlug: 'collection-de-test', description: '', itemCount: 3,
};
const item = (cartularyId: string, displayTitle: string) => ({
  cartularyId, collectionId: 'col_test', assetType: 'watch', displayTitle, makerName: 'Fabricant', modelName: 'Modèle',
  referenceCode: null, manufactureYear: null, publicCode: null,
});

beforeEach(() => {
  mocks.getDoc.mockReset();
  mocks.getDocs.mockReset();
});

describe('loadCollectionWebsitePublication — seule une projection publiée est servie', () => {
  it('refuse un identifiant hors format sans lire Firestore', async () => {
    await expect(loadCollectionWebsitePublication('../x')).resolves.toBeNull();
    expect(mocks.getDoc).not.toHaveBeenCalled();
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('rend null pour une projection absente, sans lire les objets', async () => {
    mocks.getDoc.mockResolvedValueOnce(snapshot(null));
    await expect(loadCollectionWebsitePublication('reg_test--col_test')).resolves.toBeNull();
    expect(mocks.getDoc).toHaveBeenCalledWith('collectionPublications/reg_test--col_test');
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('rend null pour une projection révoquée, sans lire les objets', async () => {
    mocks.getDoc.mockResolvedValueOnce(snapshot({ ...publication, status: 'revoked' }));
    await expect(loadCollectionWebsitePublication('reg_test--col_test')).resolves.toBeNull();
    expect(mocks.getDocs).not.toHaveBeenCalled();
  });

  it('rend la projection publiée telle quelle et ses objets triés par titre (fr, sans casse ni accents)', async () => {
    const published = { ...publication, status: 'published' };
    mocks.getDoc.mockResolvedValueOnce(snapshot(published));
    mocks.getDocs.mockResolvedValueOnce({ docs: [item('cart_z', 'Zénith'), item('cart_a', 'alpha'), item('cart_e', 'Éa')].map((data) => ({ data: () => data })) });
    const result = await loadCollectionWebsitePublication('reg_test--col_test');
    expect(mocks.getDoc).toHaveBeenCalledWith('collectionPublications/reg_test--col_test');
    expect(mocks.getDocs).toHaveBeenCalledWith('collectionPublications/reg_test--col_test/items');
    expect(result?.publication).toEqual(published);
    expect(result?.items.map((entry) => entry.displayTitle)).toEqual(['alpha', 'Éa', 'Zénith']);
  });
});
