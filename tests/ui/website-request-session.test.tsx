import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicWebsitePublicationPanel } from '../../src/components/PublicWebsitePublicationPanel';
import { clearWebsiteRequestSession, readWebsiteRequestSession, websiteRequestSessionKey, writeWebsiteRequestSession } from '../../src/services/websiteRequestSession';

// V4 point 2, lot B : la demande en cours est conservée dans l'onglet (sessionStorage) le temps de la
// réponse serveur ; après rechargement elle est montrée « demandée · non confirmée » et rejouée à
// l'identique si le serveur est resté à la révision attendue, oubliée sans bruit sinon.
const api = vi.hoisted(() => ({ load: vi.fn(), publish: vi.fn(), revoke: vi.fn() }));
vi.mock('../../src/services/websitePublication', () => ({ loadWebsitePublicationState: api.load, publishWebsiteSelection: api.publish, revokeWebsiteSelection: api.revoke }));
const state = { cartularyId: 'cart_test', publicCode: 'OBJ-PUB', revision: 1, status: 'draft', blockIds: [] };
const publishedState = { ...state, revision: 3, status: 'published', blockIds: ['condition-summary'] };
const blocks = [{ id: 'condition-summary', title: 'État', payload: { paragraphs: ['Bon état'] }, assets: [] }];
const KEY = 'cartularia-website-request:cart_test';
const timeout = () => Object.assign(new Error('Délai dépassé'), { code: 'functions/deadline-exceeded' });

beforeEach(() => { sessionStorage.clear(); api.load.mockReset().mockResolvedValue(state); api.publish.mockReset(); api.revoke.mockReset(); });

/** Demande de publication interrompue par le réseau, conservée dans l'onglet ; rend le composant démonté. */
const requestThenReload = async () => {
  api.publish.mockRejectedValueOnce(timeout()).mockResolvedValue(publishedState);
  const view = render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
  await screen.findByText('Brouillon · aucun mini-site publié');
  fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Publier le mini-site' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/Demande conservée/);
  expect(sessionStorage.getItem(KEY)).not.toBeNull();
  view.unmount();
};

describe('demande de publication conservée dans l’onglet', () => {
  it('écrit la demande avant l’appel et l’efface après une réponse définitive', async () => {
    let resolvePublish: (value: unknown) => void = () => undefined;
    api.publish.mockImplementationOnce(() => new Promise((resolve) => { resolvePublish = resolve; }));
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText('Brouillon · aucun mini-site publié');
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Publier le mini-site' }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledOnce());
    const entry = readWebsiteRequestSession('cart_test');
    expect(entry).not.toBeNull();
    expect(entry!.action).toBe('publish');
    expect(entry!.request).toEqual(api.publish.mock.calls[0][0]);
    expect(Number.isNaN(Date.parse(entry!.requestedAtIso))).toBe(false);
    resolvePublish(publishedState);
    await screen.findByText('Mini-site publié');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('après rechargement, une demande non confirmée reste visible et se rejoue à l’identique', async () => {
    await requestThenReload();
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    const status = await screen.findByText(/^Publication demandée · non confirmée \(le .+ à \d{2}:\d{2}\)\. Revérifiez, reprenez ou abandonnez la demande\.$/);
    expect(status.getAttribute('role')).toBe('status');
    expect(screen.queryByText('Brouillon · aucun mini-site publié')).toBeNull();
    expect(screen.getByRole('button', { name: 'Revérifier' })).toBeTruthy();
    const resume = screen.getByRole('button', { name: 'Reprendre la demande' });
    expect(screen.getByRole('button', { name: 'Abandonner la demande' })).toBeTruthy();
    expect(resume.hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(resume);
    await screen.findByRole('link', { name: 'Ouvrir le mini-site public' });
    expect(api.publish).toHaveBeenCalledTimes(2);
    expect(api.publish.mock.calls[1][0]).toEqual(api.publish.mock.calls[0][0]);
    expect(api.publish.mock.calls[1][0].requestId).toBe(api.publish.mock.calls[0][0].requestId);
    expect(api.publish.mock.calls[1][0].expectedRevision).toBe(1);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByText(/non confirmée/)).toBeNull();
    expect(screen.getByText('Mini-site publié')).toBeTruthy();
  });

  it('« Revérifier » relit l’état serveur et garde la demande tant que la révision n’a pas bougé', async () => {
    await requestThenReload();
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText(/Publication demandée · non confirmée/);
    const loads = api.load.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Revérifier' }));
    await waitFor(() => expect(api.load.mock.calls.length).toBe(loads + 1));
    expect(await screen.findByText(/Publication demandée · non confirmée/)).toBeTruthy();
    expect(sessionStorage.getItem(KEY)).not.toBeNull();
    api.load.mockResolvedValue(publishedState);
    fireEvent.click(screen.getByRole('button', { name: 'Revérifier' }));
    await screen.findByText('Mini-site publié');
    expect(screen.queryByText(/non confirmée/)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(api.publish).toHaveBeenCalledOnce();
  });

  it('après « Revérifier », une demande dépassée n’est plus rejouée : le clic suivant prépare une demande neuve (V4 relecture F2)', async () => {
    await requestThenReload();
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText(/Publication demandée · non confirmée/);
    api.load.mockResolvedValue({ ...state, revision: 2, status: 'revoked' });
    fireEvent.click(screen.getByRole('button', { name: 'Revérifier' }));
    await screen.findByText('Mini-site retiré');
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprendre la demande' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Publier le mini-site' }));
    await screen.findByText('Mini-site publié');
    expect(api.publish).toHaveBeenCalledTimes(2);
    expect(api.publish.mock.calls[1][0].requestId).not.toBe(api.publish.mock.calls[0][0].requestId);
    expect(api.publish.mock.calls[1][0].expectedRevision).toBe(2);
  });

  it('une demande conservée dont le contenu diffère de la sélection affichée est annoncée avant tout clic (V4 relecture H5)', async () => {
    await requestThenReload();
    const otherBlocks = [{ id: 'reference-history', title: 'Origines', payload: { paragraphs: ['Achat neuf'] }, assets: [] }, ...blocks];
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={otherBlocks} />);
    await screen.findByText(/Publication demandée · non confirmée/);
    expect(screen.getByRole('note').textContent).toBe('La demande conservée (1 contenus) diffère de la sélection actuelle (2 contenus) : « Reprendre la demande » publiera la demande conservée telle quelle, « Publier le mini-site » la sélection actuelle.');
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Reprendre la demande' }));
    await screen.findByText('Mini-site publié');
    expect(api.publish.mock.calls[1][0]).toEqual(api.publish.mock.calls[0][0]);
    expect(api.publish.mock.calls[1][0].blocks.map((block: { id: string }) => block.id)).toEqual(['condition-summary']);
  });

  it('une même sélection retrouvée n’annonce aucun écart', async () => {
    await requestThenReload();
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText(/Publication demandée · non confirmée/);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('une reprise de nettoyage aboutie côté serveur est confirmée au rechargement, bien que la révision n’ait pas bougé (V4 relecture H7)', async () => {
    api.load.mockResolvedValue({ ...publishedState, cleanupPending: true, pendingCleanupCount: 1 });
    api.revoke.mockRejectedValueOnce(timeout());
    const view = render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    const resume = await screen.findByRole('button', { name: 'Reprendre la suppression des anciennes copies' });
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(resume);
    await screen.findByRole('alert');
    expect(readWebsiteRequestSession('cart_test')?.action).toBe('cleanup');
    view.unmount();
    // Le nettoyage a abouti entre-temps : même révision, plus rien en attente.
    api.load.mockResolvedValue({ ...publishedState, cleanupPending: false });
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText('Mini-site publié');
    expect(screen.queryByText(/non confirmée/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprendre la demande' })).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(api.revoke).toHaveBeenCalledOnce();
  });

  it('une reprise de nettoyage aboutie côté serveur est constatée dès la relecture du même onglet (V4 relecture H6/H7)', async () => {
    const changed = vi.fn();
    api.load.mockResolvedValueOnce({ ...publishedState, cleanupPending: true, pendingCleanupCount: 1 }).mockResolvedValueOnce({ ...publishedState, cleanupPending: true, pendingCleanupCount: 1 }).mockResolvedValue({ ...publishedState, cleanupPending: false });
    api.revoke.mockRejectedValueOnce(timeout());
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} onStateChanged={changed} />);
    const resume = await screen.findByRole('button', { name: 'Reprendre la suppression des anciennes copies' });
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(resume);
    const alert = await screen.findByText(/Le serveur a répondu entre-temps/);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).not.toMatch(/Demande conservée/);
    expect(screen.queryByText(/Suppression des anciennes copies incomplète/)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Reprendre la suppression des anciennes copies' })).toBeNull();
  });

  it('une demande dépassée par le serveur est oubliée sans bruit', async () => {
    await requestThenReload();
    api.load.mockResolvedValue(publishedState);
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText('Mini-site publié');
    expect(screen.queryByText(/non confirmée/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprendre la demande' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(api.publish).toHaveBeenCalledOnce();
  });

  it('« Abandonner la demande » efface l’entrée et rend l’état serveur', async () => {
    await requestThenReload();
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText(/Publication demandée · non confirmée/);
    fireEvent.click(screen.getByRole('button', { name: 'Abandonner la demande' }));
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(screen.getByText('Brouillon · aucun mini-site publié')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reprendre la demande' })).toBeNull();
    expect(api.publish).toHaveBeenCalledOnce();
    // Après abandon, un nouveau clic prépare une demande neuve (autre requestId), sans rejouer l'ancienne.
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Publier le mini-site' }));
    await screen.findByText('Mini-site publié');
    expect(api.publish).toHaveBeenCalledTimes(2);
    expect(api.publish.mock.calls[1][0].requestId).not.toBe(api.publish.mock.calls[0][0].requestId);
  });

  it('nomme un retrait non confirmé et le rejoue par la commande de retrait', async () => {
    api.load.mockResolvedValue(publishedState);
    api.revoke.mockRejectedValueOnce(timeout()).mockResolvedValue({ ...state, revision: 5, status: 'revoked', blockIds: [] });
    const view = render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText('Mini-site publié');
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Retirer le mini-site' }));
    await screen.findByRole('alert');
    view.unmount();
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText(/^Retrait demandé · non confirmé \(le .+ à .+\)\. Revérifiez, reprenez ou abandonnez la demande\.$/);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Reprendre la demande' }));
    await screen.findByText('Mini-site retiré');
    expect(api.revoke).toHaveBeenCalledTimes(2);
    expect(api.revoke.mock.calls[1][0]).toEqual(api.revoke.mock.calls[0][0]);
    expect(api.publish).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('un stockage indisponible n’empêche pas la publication', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    api.publish.mockResolvedValue(publishedState);
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} />);
    await screen.findByText('Brouillon · aucun mini-site publié');
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Publier le mini-site' }));
    await screen.findByText('Mini-site publié');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.publish).toHaveBeenCalledOnce();
  });

  it('traduit l’état non confirmé et ses actions en anglais', async () => {
    await requestThenReload();
    render(<PublicWebsitePublicationPanel cartularyId="cart_test" blocks={blocks} language="EN" />);
    await screen.findByText(/^Publication requested · unconfirmed \(on .+ at .+\)\. Check again, resume or abandon the request\.$/);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume the request' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abandon the request' })).toBeTruthy();
  });
});

describe('websiteRequestSession (module pur)', () => {
  const entry = { action: 'publish' as const, signature: '[]', request: { cartularyId: 'cart_test', requestId: 'website_1', expectedRevision: 1, confirmed: true as const }, requestedAtIso: '2026-09-15T10:00:00.000Z' };

  it('relit ce qu’il a écrit, sous une clé propre au Cartulaire', () => {
    writeWebsiteRequestSession('cart_test', entry);
    expect(websiteRequestSessionKey('cart_test')).toBe(KEY);
    expect(readWebsiteRequestSession('cart_test')).toEqual(entry);
    expect(readWebsiteRequestSession('cart_other')).toBeNull();
    clearWebsiteRequestSession('cart_test');
    expect(readWebsiteRequestSession('cart_test')).toBeNull();
  });

  it('ignore une entrée illisible, d’un autre Cartulaire ou de forme inattendue', () => {
    sessionStorage.setItem(KEY, '{');
    expect(readWebsiteRequestSession('cart_test')).toBeNull();
    for (const broken of [
      { ...entry, action: 'delete' },
      { ...entry, request: { ...entry.request, cartularyId: 'cart_other' } },
      { ...entry, request: { ...entry.request, requestId: 12 } },
      { ...entry, request: { ...entry.request, expectedRevision: '1' } },
      { ...entry, requestedAtIso: undefined },
      { ...entry, request: null },
      'texte',
    ]) {
      sessionStorage.setItem(KEY, JSON.stringify(broken));
      expect(readWebsiteRequestSession('cart_test')).toBeNull();
    }
  });

  it('reste silencieux quand le stockage est indisponible', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('indisponible'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('indisponible'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('indisponible'); });
    expect(() => writeWebsiteRequestSession('cart_test', entry)).not.toThrow();
    expect(readWebsiteRequestSession('cart_test')).toBeNull();
    expect(() => clearWebsiteRequestSession('cart_test')).not.toThrow();
  });
});
