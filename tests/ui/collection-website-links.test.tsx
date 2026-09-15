import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionWebsitePage } from '../../src/components/CollectionWebsitePage.tsx';
import type {
  CollectionWebsiteItemProjection,
  CollectionWebsitePublication,
  RegistryCollectionDocument,
} from '../../src/domain/collections.ts';
import type { RegistryItemProjection } from '../../src/domain/projections.ts';

// V4 P-C6 : depuis une Collection, un objet n'est lié que si son mini-site est publié avec au moins un
// bloc admis pour le Web ; un échec de lecture des statuts ne met jamais la page en erreur ; une adresse
// publique ignore tout paramètre d'aperçu ; l'aperçu propriétaire montre le même état que le public (G1).
const fixture = vi.hoisted(() => ({
  user: null as null | { uid: string },
  publication: vi.fn(),
  summaries: vi.fn(),
  collections: vi.fn(),
  items: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { callback(fixture.user); return () => {}; },
}));
vi.mock('../../src/services/collections', () => ({
  loadCollectionWebsitePublication: (...args: unknown[]) => fixture.publication(...args),
  loadRegistryCollections: (...args: unknown[]) => fixture.collections(...args),
}));
vi.mock('../../src/services/projections', () => ({
  loadRegistryItems: (...args: unknown[]) => fixture.items(...args),
  loadPublicPublicationSummaries: (...args: unknown[]) => fixture.summaries(...args),
}));

const PUBLIC_ADDRESS = '/collection-website?publicationId=reg_test--col_test';
const FORGED_PUBLIC_ADDRESS = `${PUBLIC_ADDRESS}&preview=local&cartularyId=cart_b&cartularyUrl=/watch-website?preview=local`;
const OWNER_PREVIEW = '/collection-website?preview=local&registryId=reg_test&collectionIds=col_x&cartularyId=cart_b'
  + '&cartularyUrl=http://localhost:3000/watch-website?preview=local';

const publication: CollectionWebsitePublication = {
  publicationId: 'reg_test--col_test', organizationId: 'org_test', registryId: 'reg_test', collectionId: 'col_test',
  websiteTitle: 'Collection de test', websiteSlug: 'collection-de-test', description: 'Sélection de test.', status: 'published', itemCount: 5,
};
const projectedItem = (cartularyId: string, displayTitle: string, publicCode: string | null): CollectionWebsiteItemProjection => ({
  cartularyId, collectionId: 'col_test', assetType: 'watch', displayTitle, makerName: 'Fabricant', modelName: 'Modèle',
  referenceCode: null, manufactureYear: null, publicCode,
});
const PUBLIC_ITEMS = [
  projectedItem('cart_a', 'Objet A', 'OBJ-A'),
  projectedItem('cart_b', 'Objet B', 'OBJ-B'),
  projectedItem('cart_c', 'Objet C', 'OBJ-C'),
  projectedItem('cart_d', 'Objet D', 'OBJ-D'),
  projectedItem('cart_e', 'Objet E', null),
];
const SUMMARIES = {
  'OBJ-A': { published: true, blockIds: ['cover-watch'] },
  'OBJ-B': { published: false, blockIds: [] },
  'OBJ-C': { published: true, blockIds: [] },
  'OBJ-D': { published: true, blockIds: ['value-market'] },
};
const registryItem = (cartularyId: string, displayTitle: string, objectCode: string, collectionId: string): RegistryItemProjection => ({
  cartularyId, organizationId: 'org_test', registryId: 'reg_test', collectionId, assetType: 'watch', displayTitle,
  makerName: 'Fabricant', modelName: 'Modèle', referenceCode: null, manufactureYear: null, lifecycleStatus: 'active', objectCode,
  possessionStatus: 'in_possession', completenessLevel: 'complete', primaryAssetId: null, sourceRevision: 1, projectionStatus: 'active', contentHash: 'sha256:0',
});
const OWNER_COLLECTION: RegistryCollectionDocument = {
  id: 'col_x', organizationId: 'org_test', registryId: 'reg_test', name: 'Collection X', description: '', websiteTitle: 'Vitrine X',
  websiteSlug: 'vitrine-x', status: 'draft', visibility: 'secret', publicationConsent: false, publishedCartularyIds: [],
};
const OWNER_ITEMS = [
  registryItem('cart_a', 'Objet A', 'OBJ-A', 'col_x'),
  registryItem('cart_b', 'Objet B', 'OBJ-B', 'col_x'),
  registryItem('cart_z', 'Objet Z', 'OBJ-Z', 'col_autre'),
];
const unavailable = () => Object.assign(new Error('unavailable'), { code: 'unavailable' });
const linkHrefs = () => screen.getAllByRole('link').map((link) => link.getAttribute('href') || '');
const titleLink = (title: string) => within(screen.getByRole('heading', { level: 3, name: title })).queryByRole('link');
const websiteLinks = () => screen.queryAllByRole('link', { name: /Voir le mini-site/ });

beforeEach(() => {
  fixture.user = null;
  fixture.publication.mockResolvedValue({ publication, items: PUBLIC_ITEMS });
  fixture.summaries.mockResolvedValue(SUMMARIES);
  fixture.collections.mockResolvedValue([OWNER_COLLECTION]);
  fixture.items.mockResolvedValue(OWNER_ITEMS);
});

describe('CollectionWebsitePage — lien d’objet seulement si le mini-site est publié avec du contenu Web (P-C6)', () => {
  it('ne lie que les objets dont le mini-site est publié avec du contenu Web', async () => {
    window.history.replaceState(null, '', PUBLIC_ADDRESS);
    render(<CollectionWebsitePage />);
    const links = await screen.findAllByRole('link', { name: /Voir le mini-site/ });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/watch-website?publicCode=OBJ-A');
    expect(titleLink('Objet A')?.getAttribute('href')).toBe('/watch-website?publicCode=OBJ-A');
    for (const title of ['Objet B', 'Objet C', 'Objet D', 'Objet E']) expect(titleLink(title)).toBeNull();
    expect(screen.getAllByText('Mini-site de l’objet non publié')).toHaveLength(4);
    expect(screen.queryByText('État du mini-site indisponible')).toBeNull();
    expect(fixture.summaries).toHaveBeenCalledTimes(1);
    expect(fixture.summaries).toHaveBeenCalledWith(['OBJ-A', 'OBJ-B', 'OBJ-C', 'OBJ-D']);
    expect(linkHrefs().some((href) => href.includes('preview=local') || href.includes('cartularyId'))).toBe(false);
    expect(screen.queryByRole('link', { name: /Ouvrir le Cartulaire/ })).toBeNull();
    const sectionHeader = screen.getByRole('heading', { level: 2, name: 'Collection de test' }).closest('header');
    expect(sectionHeader?.querySelector('strong')?.textContent).toBe('5');
  });

  it('statuts indisponibles : page servie, aucun lien, mention explicite sur chaque carte', async () => {
    window.history.replaceState(null, '', PUBLIC_ADDRESS);
    fixture.summaries.mockRejectedValue(unavailable());
    render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Collection de test' })).toBeTruthy();
    expect(websiteLinks()).toHaveLength(0);
    expect(screen.getAllByText('État du mini-site indisponible')).toHaveLength(PUBLIC_ITEMS.length);
    expect(screen.queryByText('Mini-site de l’objet non publié')).toBeNull();
    for (const title of ['Objet A', 'Objet B', 'Objet C', 'Objet D', 'Objet E']) expect(titleLink(title)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Chargement temporairement indisponible' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });

  it('publication absente ou révoquée : « Mini-site non publié » sans lecture des statuts ; erreur : « Réessayer »', async () => {
    window.history.replaceState(null, '', PUBLIC_ADDRESS);
    fixture.publication.mockResolvedValue(null);
    const { unmount } = render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { name: 'Mini-site non publié' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(fixture.summaries).not.toHaveBeenCalled();
    unmount();

    fixture.publication.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const denied = render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { name: 'Mini-site non publié' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(fixture.summaries).not.toHaveBeenCalled();
    denied.unmount();

    fixture.publication.mockRejectedValue(unavailable());
    render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { name: 'Chargement temporairement indisponible' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
    expect(fixture.summaries).not.toHaveBeenCalled();
  });

  it('une adresse publique ignore preview=local, cartularyId et cartularyUrl', async () => {
    window.history.replaceState(null, '', FORGED_PUBLIC_ADDRESS);
    render(<CollectionWebsitePage />);
    const links = await screen.findAllByRole('link', { name: /Voir le mini-site/ });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/watch-website?publicCode=OBJ-A');
    expect(titleLink('Objet B')).toBeNull();
    expect(screen.queryByRole('link', { name: /Ouvrir le Cartulaire/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Accueil public Cartularia' }).getAttribute('href')).toBe('/');
    expect(linkHrefs().some((href) => href.includes('preview=local') || href.includes('cartularyId'))).toBe(false);
  });
});

describe('CollectionWebsitePage — l’aperçu propriétaire lit les statuts publics (G1)', () => {
  it('montre le même état que le public : objet publié lié vers sa page publique, objet non publié sans lien', async () => {
    window.history.replaceState(null, '', OWNER_PREVIEW);
    fixture.user = { uid: 'owner' };
    fixture.summaries.mockResolvedValue({ 'OBJ-A': SUMMARIES['OBJ-A'], 'OBJ-B': SUMMARIES['OBJ-B'] });
    render(<CollectionWebsitePage />);
    const links = await screen.findAllByRole('link', { name: /Voir le mini-site/ });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/watch-website?publicCode=OBJ-A');
    expect(titleLink('Objet A')?.getAttribute('href')).toBe('/watch-website?publicCode=OBJ-A');
    expect(titleLink('Objet B')).toBeNull();
    expect(screen.getAllByText('Mini-site de l’objet non publié')).toHaveLength(1);
    expect(screen.queryByText('Objet Z')).toBeNull();
    expect(fixture.summaries).toHaveBeenCalledTimes(1);
    expect(fixture.summaries).toHaveBeenCalledWith(['OBJ-A', 'OBJ-B']);
    expect(screen.getAllByRole('link', { name: /Ouvrir le Cartulaire/ })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Ouvrir le Registre Cartularia' }).getAttribute('href')).toBe('/registry/reg_test/collections');
    expect(linkHrefs().some((href) => href.includes('http://localhost:3000'))).toBe(false);
  });

  it('statuts indisponibles dans l’aperçu : page servie, mention explicite, jamais « Accès aux Collections refusé »', async () => {
    window.history.replaceState(null, '', OWNER_PREVIEW);
    fixture.user = { uid: 'owner' };
    fixture.summaries.mockRejectedValue(unavailable());
    render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Vitrine X' })).toBeTruthy();
    expect(websiteLinks()).toHaveLength(0);
    expect(screen.getAllByText('État du mini-site indisponible')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: 'Accès aux Collections refusé' })).toBeNull();
    expect(screen.getAllByRole('link', { name: /Ouvrir le Cartulaire/ })).toHaveLength(2);
  });
});
