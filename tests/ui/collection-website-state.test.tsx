import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CollectionWebsitePage } from '../../src/components/CollectionWebsitePage.tsx';

const fixture = vi.hoisted(() => ({
  user: null as null | { uid: string },
  collections: vi.fn(),
  items: vi.fn(),
}));
vi.mock('../../src/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { callback(fixture.user); return () => {}; },
}));
vi.mock('../../src/services/collections', () => ({
  loadCollectionWebsitePublication: vi.fn(async () => null),
  loadRegistryCollections: (...args: unknown[]) => fixture.collections(...args),
}));
vi.mock('../../src/services/projections', () => ({
  loadRegistryItems: (...args: unknown[]) => fixture.items(...args),
  loadPublicPublicationSummaries: vi.fn(async () => ({})),
}));

const DEMO_PREVIEW = '/collection-website?preview=local&registryId=reg_cartularia_demo&collectionIds=col_demo_montres';
const PRIVATE_PREVIEW = '/collection-website?preview=local&registryId=reg_prive&collectionIds=col_x';

const linkHrefs = () => screen.getAllByRole('link').map((link) => link.getAttribute('href') || '');

beforeEach(() => {
  fixture.user = null;
  fixture.collections.mockResolvedValue([]);
  fixture.items.mockResolvedValue([]);
});

describe('CollectionWebsitePage — écran d’état sans Registre accessible (V-A5)', () => {
  it('aperçu du Registre démo sans session : connexion avec retour, entrée démo, accueil, jamais /registry/…', async () => {
    window.history.replaceState(null, '', DEMO_PREVIEW);
    render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { name: 'Connexion requise' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Se connecter pour voir l’aperçu' }).getAttribute('href'))
      .toBe(`/account/sign-in?returnTo=${encodeURIComponent(DEMO_PREVIEW)}`);
    expect(screen.getByRole('link', { name: 'Ouvrir le Registre démo' }).getAttribute('href')).toBe('/account/sign-in?demo=1');
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('link', { name: 'Retour au Registre' })).toBeNull();
    expect(linkHrefs().some((href) => href.startsWith('/registry'))).toBe(false);
  });

  it('aperçu d’un Registre privé sans session : pas d’entrée démo', async () => {
    window.history.replaceState(null, '', PRIVATE_PREVIEW);
    render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { name: 'Connexion requise' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Se connecter pour voir l’aperçu' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Ouvrir le Registre démo' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('link', { name: 'Retour au Registre' })).toBeNull();
  });

  it('adresse incomplète : « Retour à l’accueil » vers /, plus de « Retour au Registre » vers /', async () => {
    window.history.replaceState(null, '', '/collection-website');
    render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { name: 'Adresse de Collection incomplète' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour à l’accueil' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('link', { name: 'Retour au Registre' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Retour à Cartularia' })).toBeNull();
  });

  it('lecteur connecté dont le chargement échoue : « Retour au Registre » vers la section Collections', async () => {
    window.history.replaceState(null, '', PRIVATE_PREVIEW);
    fixture.user = { uid: 'reader' };
    fixture.collections.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    render(<CollectionWebsitePage />);
    expect(await screen.findByRole('heading', { name: 'Accès aux Collections refusé' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Retour au Registre' }).getAttribute('href')).toBe('/registry/reg_prive/collections');
    expect(screen.queryByRole('link', { name: 'Ouvrir le Registre démo' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Se connecter pour voir l’aperçu' })).toBeNull();
  });
});
