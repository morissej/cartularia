import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { RegistryInvitationPage } from '../../src/features/registry/RegistryInvitationPage';
import { CommunityPage } from '../../src/components/CommunityPage';

const fixture = vi.hoisted(() => ({ user: { uid: 'reader' } as any, validLink: true, type: 'car', catalog: vi.fn(), accept: vi.fn(), authCallback: null as null | ((user: unknown) => void) }));
vi.mock('../../src/firebase', () => ({ auth: {}, db: {} }));
vi.mock('firebase/auth', () => ({
  isSignInWithEmailLink: () => fixture.validLink,
  signInWithEmailLink: vi.fn(async () => ({})),
  onAuthStateChanged: (_auth: unknown, callback: (user: unknown) => void) => { fixture.authCallback = callback; callback(fixture.user); return () => {}; },
}));
vi.mock('../../src/services/access', () => ({ acceptRegistryAccess: (...args: unknown[]) => fixture.accept(...args) }));
vi.mock('../../src/services/projections', () => ({ loadScopedRegistryItems: vi.fn(async () => [{ cartularyId: 'cart_invited_object', assetType: fixture.type }]) }));
vi.mock('../../src/services/community', () => ({ loadCommunityCatalog: (...args: unknown[]) => fixture.catalog(...args) }));

beforeEach(() => {
  fixture.user = { uid: 'reader' }; fixture.validLink = true; fixture.type = 'car';
  fixture.accept.mockResolvedValue({ scopeType: 'cartulary', scopeId: 'cart_invited_object', registryId: 'reg_invited' });
  fixture.catalog.mockResolvedValue([]);
  window.history.replaceState(null, '', '/registry/invitation?invitationId=inv_test&token=opaque_token');
});

it.each([['car', '/cartulary-view?'], ['watch', '/cartulary?']])('l’invitation %s conduit au Cartulaire autorisé, jamais à l’accueil public', async (type, route) => {
  fixture.type = type; render(<RegistryInvitationPage />);
  fireEvent.change(screen.getByLabelText('Adresse électronique'), { target: { value: 'invite@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Accepter l’invitation' }));
  const href = (await screen.findByRole('link', { name: 'Ouvrir le contenu autorisé' })).getAttribute('href');
  expect(href?.startsWith(route)).toBe(true); expect(href).toContain('cartularyId=cart_invited_object');
  expect(href).toContain('returnTo=%2Fregistry%2Freg_invited%2Fitems');
});
it('un lien imbriqué invalide affiche une erreur récupérable sans casser la page', async () => {
  window.history.replaceState(null, '', '/registry/invitation?continueUrl=%not-a-url');
  render(<RegistryInvitationPage />);
  expect((await screen.findByRole('alert')).textContent).toContain('incomplet');
  expect((screen.getByRole('button', { name: 'Accepter l’invitation' }) as HTMLButtonElement).disabled).toBe(true);
});
it('un visiteur du Cercle peut rejoindre directement la connexion avec retour', async () => {
  fixture.user = null; render(<CommunityPage />);
  expect((await screen.findByRole('link', { name: 'Se connecter pour ouvrir Le Cercle' })).getAttribute('href')).toBe('/account/sign-in?returnTo=%2Fcommunity');
});
it('l’admission absente explique la démarche réelle', async () => {
  fixture.catalog.mockRejectedValue(Object.assign(new Error('Admission absente'), { code: 'community/admission-required' }));
  render(<CommunityPage />);
  expect(await screen.findByRole('heading', { name: 'Admission au Cercle requise' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Demander les modalités d’admission' }).getAttribute('href')).toBe('/#contact');
});
it('une erreur réseau ne se fait pas passer pour un refus d’admission et se relance', async () => {
  fixture.catalog.mockRejectedValueOnce(new Error('network offline')).mockResolvedValue([]);
  render(<CommunityPage />);
  expect(await screen.findByRole('heading', { name: 'Le Cercle est momentanément indisponible' })).toBeTruthy();
  expect(screen.queryByText('Admission au Cercle requise')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('heading', { name: 'Objets publiés dans Le Cercle' })).toBeTruthy();
});
it('le Cercle nomme les champs et empêche un ancien chargement de réafficher des données après déconnexion', async () => {
  fixture.catalog.mockResolvedValue([{ publication: { publicationId: 'publication_1', assetType: 'car', displayTitle: 'Voiture publiée' }, blocks: [{ blockId: 'specs', title: 'Caractéristiques', fields: { 'cover.car.maker': 'Constructeur' } }] }]);
  render(<CommunityPage />);
  expect(await screen.findByText('Constructeur', { selector: 'dt' })).toBeTruthy();
  expect(screen.getByText('Constructeur', { selector: 'dd' })).toBeTruthy();
  expect(screen.queryByText('cover.car.maker')).toBeNull();
  act(() => fixture.authCallback?.(null));
  await waitFor(() => expect(screen.queryByText('Voiture publiée')).toBeNull());
});
