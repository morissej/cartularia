import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaVideo } from '../../src/components/MediaVideo';
import { MediaDownloadLink } from '../../src/components/MediaDownloadLink';
import { ProjectedPublicBlock } from '../../src/components/ProjectedPublicBlock';
import type { Asset } from '../../src/types';
import type { PublicBlockProjection } from '../../src/domain/projections';
const api = vi.hoisted(() => ({ acquire: vi.fn() }));
vi.mock('../../src/services/publicMedia', () => ({ acquirePublicMediaObjectUrl: api.acquire }));
const video: Asset = { id: 'video_public', name: 'Film', type: 'video', url: '', publicStoragePath: 'public/OBJ-001/asset_video/web_01', publicContentHash: 'sha256:abc', mimeType: 'video/mp4', hash: '', status: 'Archived', visibility: 'Tous', tags: [] };
beforeEach(() => { api.acquire.mockReset(); });

it('ne télécharge aucune vidéo publique avant la demande explicite du visiteur', async () => {
  api.acquire.mockResolvedValue({ url: 'blob:public-video', release: vi.fn() });
  const { container } = render(<MediaVideo asset={video} />);
  expect(api.acquire).not.toHaveBeenCalled();
  expect(container.querySelector('video')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Charger la vidéo' }));
  await waitFor(() => expect(container.querySelector('video')?.src).toBe('blob:public-video'));
  expect(api.acquire).toHaveBeenCalledWith(video.publicStoragePath, video.publicContentHash, expect.objectContaining({ signal: expect.any(AbortSignal), onProgress: expect.any(Function) }));
});

it('le téléchargement public est demandé à Storage seulement au clic et possède un nom', async () => {
  const release = vi.fn();
  api.acquire.mockResolvedValue({ url: 'blob:public-download', release });
  const clicked: string[][] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push([this.href, this.download]); });
  render(<MediaDownloadLink media={video} />);
  expect(api.acquire).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: 'Télécharger le média : Film' }));
  await waitFor(() => expect(clicked).toEqual([['blob:public-download', 'Film.mp4']]));
});

it('distingue un refus de droits d’une copie inexistante et permet de recommencer', async () => {
  api.acquire.mockRejectedValueOnce({ code: 'storage/unauthorized' }).mockResolvedValue({ url: 'blob:retry', release: vi.fn() });
  render(<MediaVideo asset={video} />);
  fireEvent.click(screen.getByRole('button', { name: 'Charger la vidéo' }));
  expect(await screen.findByText(/L’accès à ce média n’est plus autorisé/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(document.querySelector('video')?.src).toBe('blob:retry'));
});

it('la bibliothèque conserve le contenu et la commande des fichiers non encore téléchargés, sans doublon', () => {
  const asset = { assetId: 'video_public', derivativeId: 'web_01', mediaKind: 'video', mimeType: 'video/mp4', storagePath: video.publicStoragePath!, contentHash: video.publicContentHash!, downloadUrl: null };
  const block: PublicBlockProjection = { blockId: 'media-library', title: 'Bibliothèque', payload: { paragraphs: ['Texte déjà disponible'], mediaLabels: ['Film', 'Film répété'] }, assets: [asset, asset], sourceRevision: 1, publicationStatus: 'published', contentHash: '' };
  render(<ProjectedPublicBlock block={block} />);
  expect(screen.getByText('Texte déjà disponible')).toBeTruthy();
  expect(screen.getAllByRole('link', { name: /Télécharger le média/ })).toHaveLength(1);
  expect(api.acquire).not.toHaveBeenCalled();
  expect(screen.queryByText(/copie publique.*absente/)).toBeNull();
});
