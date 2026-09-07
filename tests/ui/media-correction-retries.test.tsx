import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Spin360 } from '../../src/components/Spin360';
import { SpinViewerModal } from '../../src/features/cartulary/modals/CartularyModals';
import { MediaDownloadLink } from '../../src/components/MediaDownloadLink';
import { MediaVideo } from '../../src/components/MediaVideo';
import type { Asset } from '../../src/types';
import type { ObjectUrlLease } from '../../src/utils/objectUrlLeaseCache';
import type { MediaTransferOptions } from '../../src/utils/mediaTransfer';

const api = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('../../src/services/publicMedia', () => ({ acquirePublicMediaObjectUrl: api.acquire }));
const image = (id: string, name = id): Asset => ({ id, name, type: 'image', url: `/assets/${id}.webp`, mimeType: 'image/webp', hash: '', status: 'Archived', visibility: 'Tous', tags: ['spin-3d'] });
const video: Asset = { ...image('film', 'Film'), type: 'video', url: '', publicStoragePath: 'public/OBJ-001/film/web_1', publicContentHash: 'sha256:abc', mimeType: 'video/mp4', tags: [] };
const pendingLease = () => { let resolve!: (value: ObjectUrlLease) => void; return { promise: new Promise<ObjectUrlLease>((done) => { resolve = done; }), resolve: (value: ObjectUrlLease) => resolve(value) }; };
beforeEach(() => {
  api.acquire.mockReset();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  class FailedPreload { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()); } }
  vi.stubGlobal('Image', FailedPreload);
});
afterEach(() => { vi.unstubAllGlobals(); });

it('M02 : expose l’erreur de décodage, remonte une image à la reprise, puis attend son chargement', async () => {
  const { container } = render(<Spin360 images={[image('first'), image('second')]} posterImageUrl="" language="FR" />);
  const failedImage = screen.getByRole('img');
  fireEvent.error(failedImage);
  expect(screen.getByText(/Cette image ne peut pas être affichée/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer cette vue' }));
  const retriedImage = screen.getByRole('img');
  expect(retriedImage).not.toBe(failedImage);
  expect(screen.getByText('Chargement de cette vue…')).toBeTruthy();
  fireEvent.load(retriedImage);
  expect(screen.queryByText('Chargement de cette vue…')).toBeNull();
  expect(container.querySelector('.media-load-error')).toBeNull();
  fireEvent.error(retriedImage);
  fireEvent.click(screen.getByRole('button', { name: 'Angle suivant' }));
  expect(container.querySelector('.media-load-error')).toBeNull();
  expect(screen.getByRole('img').getAttribute('alt')).toBe('Vue 2/2 · second');
});

it('U02 : indique une position, jamais un angle calculé pour un jeu irrégulier', () => {
  const views = Array.from({ length: 14 }, (_, index) => image(`vue-${index}`, index === 1 ? 'Rolex 30°' : `Vue catalogue ${index}`));
  render(<Spin360 images={views} posterImageUrl="" language="FR" />);
  fireEvent.click(screen.getByRole('button', { name: 'Angle suivant' }));
  expect(screen.getByText('Vue 2/14')).toBeTruthy();
  expect(screen.queryByText('26°')).toBeNull();
  expect(screen.queryByText(/incrément/)).toBeNull();
  expect(screen.getByRole('img').getAttribute('alt')).toBe('Vue 2/14 · Rolex 30°');
});

it('une séquence vide reste saine après clavier/glisser puis réception des vues', () => {
  const { rerender } = render(<Spin360 images={[]} posterImageUrl="" language="FR" />);
  const viewer = screen.getByLabelText('Visualiseur 3D de l’objet');
  fireEvent.keyDown(viewer, { key: 'ArrowRight' });
  fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
  const stage = screen.getByRole('img').parentElement!;
  fireEvent.mouseDown(stage, { clientX: 100 }); fireEvent.mouseMove(stage, { clientX: 150 }); fireEvent.mouseUp(stage);
  fireEvent.touchStart(stage, { touches: [{ clientX: 100 }] }); fireEvent.touchMove(stage, { touches: [{ clientX: 160 }] }); fireEvent.touchEnd(stage);
  expect((screen.getByRole('button', { name: 'Angle suivant' }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<Spin360 images={[image('first'), image('second')]} posterImageUrl="" language="FR" />);
  expect(screen.getByRole('img').getAttribute('alt')).toBe('Vue 1/2 · first');
  fireEvent.keyDown(viewer, { key: 'ArrowRight' });
  expect(screen.getByRole('img').getAttribute('alt')).toBe('Vue 2/2 · second');
  expect(viewer.textContent).not.toContain('NaN');
});

it('U01 : chaque lien compact de la fenêtre 360 affiche le nom de sa vue', async () => {
  render(<SpinViewerModal assets={[image('front', 'Vue de face'), image('side', 'Profil gauche')]} dialogRef={createRef()} language="FR" onClose={() => undefined} />);
  const links = await screen.findAllByRole('link', { name: /Télécharger le média/ });
  expect(links.map((link) => link.textContent)).toEqual(['Télécharger · Vue de face', 'Télécharger · Profil gauche']);
  expect(screen.getByText('Vue 1/2')).toBeTruthy();
});

it('M05 : affiche taille/étape, annule sans téléchargement tardif et permet une nouvelle demande', async () => {
  const request = pendingLease(); const release = vi.fn();
  api.acquire.mockReturnValueOnce(request.promise).mockResolvedValue({ url: 'blob:retry', release: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<MediaDownloadLink media={video} />);
  fireEvent.click(screen.getByRole('link', { name: /Télécharger le média/ }));
  await waitFor(() => expect(api.acquire).toHaveBeenCalledOnce());
  const options = api.acquire.mock.calls[0][2] as MediaTransferOptions;
  act(() => options.onProgress?.({ stage: 'downloading', byteSize: 25 * 1024 * 1024 }));
  expect(screen.getByText(/Transfert du fichier… · 25 Mio/)).toBeTruthy();
  expect(screen.getByText(/ne fournit pas de pourcentage/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler l’attente' }));
  expect(options.signal?.aborted).toBe(true);
  await act(async () => request.resolve({ url: 'blob:cancelled', release }));
  expect(release).toHaveBeenCalledOnce(); expect(click).not.toHaveBeenCalled();
  expect(screen.getByText(/Aucun téléchargement ne sera déclenché/)).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: /Télécharger le média/ }));
  await waitFor(() => expect(click).toHaveBeenCalledOnce());
});

it('M05 : fermer ou changer le média empêche la fin tardive du téléchargement précédent', async () => {
  const request = pendingLease(), release = vi.fn(); api.acquire.mockReturnValue(request.promise);
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const { rerender, unmount } = render(<MediaDownloadLink media={video} />);
  fireEvent.click(screen.getByRole('link', { name: /Télécharger le média/ }));
  await waitFor(() => expect(api.acquire).toHaveBeenCalledOnce());
  rerender(<MediaDownloadLink media={{ ...video, id: 'second', name: 'Second', publicStoragePath: 'public/OBJ-001/second/web_1' }} />);
  unmount();
  await act(async () => request.resolve({ url: 'blob:late', release }));
  expect(release).toHaveBeenCalledOnce(); expect(click).not.toHaveBeenCalled();
});

it('M05 : annuler une vidéo n’ouvre pas le lecteur à la résolution tardive ; reprise explicite', async () => {
  const request = pendingLease(), release = vi.fn();
  api.acquire.mockReturnValueOnce(request.promise).mockResolvedValue({ url: 'blob:resumed', release: vi.fn() });
  const { container } = render(<MediaVideo asset={video} />);
  fireEvent.click(screen.getByRole('button', { name: 'Charger la vidéo' }));
  await waitFor(() => expect(api.acquire).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Annuler l’attente' }));
  await act(async () => request.resolve({ url: 'blob:cancelled', release }));
  expect(container.querySelector('video')).toBeNull(); expect(release).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Reprendre le chargement' }));
  await waitFor(() => expect(container.querySelector('video')?.src).toBe('blob:resumed'));
});

it('M05 : un ancien média résolu après une nouvelle sélection ne remplace jamais cette sélection', async () => {
  const first = pendingLease(), second = pendingLease(), releaseFirst = vi.fn();
  api.acquire.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { container, rerender } = render(<MediaVideo asset={video} />);
  fireEvent.click(screen.getByRole('button', { name: 'Charger la vidéo' }));
  await waitFor(() => expect(api.acquire).toHaveBeenCalledOnce());
  rerender(<MediaVideo asset={{ ...video, id: 'new', name: 'Nouvelle vidéo', publicStoragePath: 'public/OBJ-001/new/web' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Charger la vidéo' }));
  await waitFor(() => expect(api.acquire).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve({ url: 'blob:current', release: vi.fn() }));
  await act(async () => first.resolve({ url: 'blob:stale', release: releaseFirst }));
  expect(container.querySelector('video')?.src).toBe('blob:current'); expect(releaseFirst).toHaveBeenCalledOnce();
});
