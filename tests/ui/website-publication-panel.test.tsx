import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicWebsitePublicationPanel } from '../../src/components/PublicWebsitePublicationPanel';
const api = vi.hoisted(() => ({ load: vi.fn(), publish: vi.fn(), revoke: vi.fn() }));
vi.mock('../../src/services/websitePublication', () => ({ loadWebsitePublicationState: api.load, publishWebsiteSelection: api.publish, revokeWebsiteSelection: api.revoke }));
const state = { cartularyId: 'cart_test', publicCode: 'OBJ-PUB', revision: 1, status: 'draft', blockIds: [] };
const blocks = [{ id: 'condition-summary', title: 'État', payload: { paragraphs: ['Bon état'] }, assets: [] }];
beforeEach(() => { api.load.mockReset().mockResolvedValue(state); api.publish.mockReset(); api.revoke.mockReset(); });
describe('publication confirmée uniquement après réponse serveur', () => {
  it('ne confond pas une erreur de lecture avec un brouillon', async () => {
    api.load.mockRejectedValue(new Error('unavailable'));
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    expect(await screen.findByText('État de publication inconnu')).toBeTruthy();
    expect(screen.queryByText('Brouillon · aucun mini-site publié')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ouvrir le mini-site public' })).toBeNull();
  });
  it('exige une confirmation et conserve la même demande lors d’une réponse réseau incertaine', async () => {
    const changed = vi.fn();
    api.publish.mockRejectedValueOnce(Object.assign(new Error('Connexion interrompue'), { code: 'functions/unavailable' })).mockResolvedValue({ ...state, revision: 3, status: 'published', blockIds: ['condition-summary'] });
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} onStateChanged={changed} />);
    await screen.findByText('Brouillon · aucun mini-site publié');
    const button = screen.getByRole('button', { name: 'Publier le mini-site' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(button);
    await screen.findByRole('alert');
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Ouvrir le mini-site public' })).toBeNull();
    fireEvent.click(button);
    await screen.findByRole('link', { name: 'Ouvrir le mini-site public' });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(api.publish.mock.calls[0][0]).toEqual(api.publish.mock.calls[1][0]);
    expect(api.publish.mock.calls[0][0].confirmedNonPersonalMedia).toBe(true);
    await waitFor(() => expect(screen.getByRole('checkbox').hasAttribute('checked')).toBe(false));
  });
  it('un accès en lecture seule ne déclenche aucune commande et ne se prétend pas démonstration', () => {
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} readOnly />);
    expect(screen.getByText(/Votre accès est en lecture seule/)).toBeTruthy();
    expect(api.load).not.toHaveBeenCalled(); expect(api.publish).not.toHaveBeenCalled();
  });
  it('après fermeture et réouverture, un retrait incomplet propose la reprise sans republier', async () => {
    api.load.mockResolvedValue({ ...state, status: 'revoked', revision: 4, cleanupPending: true, pendingCleanupCount: 1 });
    api.revoke.mockResolvedValue({ ...state, status: 'revoked', revision: 4, cleanupPending: false });
    const { unmount } = render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText('Mini-site retiré'); unmount();
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    const resume = await screen.findByRole('button', { name: 'Reprendre la suppression des anciennes copies' });
    expect(screen.getByRole('button', { name: 'Publier le mini-site' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(resume);
    await waitFor(() => expect(api.revoke).toHaveBeenCalledOnce());
    expect(api.revoke.mock.calls[0][0].cleanupOnly).toBe(true); expect(api.publish).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reprendre la suppression des anciennes copies' })).toBeNull());
  });
});
