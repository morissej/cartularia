import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { MediaDownloadLink } from '../../src/components/MediaDownloadLink';
import { MediaVideo } from '../../src/components/MediaVideo';
import { MediaViewerModal } from '../../src/features/cartulary/modals/CartularyModals';
import type { Asset } from '../../src/types';

const resolve = vi.hoisted(() => vi.fn());
const resolvePresentation = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/privateMedia.ts', () => ({ acquirePrivateMediaObjectUrl: resolve, acquirePrivatePresentationObjectUrl: resolvePresentation }));
const asset: Asset = { id: 'asset_01', cartularyId: 'cart_other', binaryId: 'binary_01', name: 'Film de présentation', url: '', mimeType: 'video/mp4', type: 'video', hash: '', status: 'Archived', visibility: 'Secret', tags: [] };
beforeEach(() => { resolve.mockReset(); resolvePresentation.mockReset(); });

describe('médias cloud sans URL locale', () => {
  it('résout le téléchargement à la demande dans le bon Cartulaire et conserve un nom utile', async () => {
    resolve.mockResolvedValue({ url: 'blob:authorized-video', release: vi.fn() });
    const clicked: string[][] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push([this.href, this.download]); });
    render(<MediaDownloadLink media={asset} />);
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('link', { name: /Télécharger le média/ }));
    await waitFor(() => expect(clicked).toEqual([['blob:authorized-video', 'Film de présentation.mp4']]));
    expect(resolve).toHaveBeenCalledWith('binary_01', 'cart_other');
  });
  it('une vidéo privée ne se charge qu’à la demande, lit l’original après le clic et libère la copie locale après fermeture', async () => {
    const release = vi.fn(); resolve.mockResolvedValue({ url: 'blob:authorized-video', release });
    const { container, unmount } = render(<MediaVideo asset={asset} />);
    expect(resolve).not.toHaveBeenCalled();
    expect(container.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Charger la vidéo' }));
    await waitFor(() => expect(container.querySelector('video')?.src).toBe('blob:authorized-video'));
    expect(container.querySelector('video')?.controls).toBe(true);
    expect(resolvePresentation).not.toHaveBeenCalled();
    unmount(); expect(release).toHaveBeenCalledOnce();
  });
  it('sans contrôles (scène du carrousel) : aucun transfert, « Aucune vignette disponible » sans poster, jamais « Accès restreint »', () => {
    const { container } = render(<MediaVideo asset={asset} controls={false} muted />);
    expect(screen.getByRole('img', { name: 'Aucune vignette disponible' })).toBeTruthy();
    expect(container.querySelector('video')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(screen.queryByText(/Accès restreint/)).toBeNull();
    render(<MediaVideo asset={{ ...asset, id: 'with-poster', posterUrl: '/poster.webp' }} controls={false} muted />);
    expect(container.querySelector('video')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
  it('propose une nouvelle tentative après refus réseau ou de droits', async () => {
    resolve.mockRejectedValueOnce(new Error('denied')).mockResolvedValue({ url: 'blob:authorized-video', release: vi.fn() });
    const { container } = render(<MediaVideo asset={asset} />);
    fireEvent.click(screen.getByRole('button', { name: 'Charger la vidéo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(container.querySelector('video')?.src).toBe('blob:authorized-video'));
  });
  it('n’ouvre pas un PDF vide puis expose seulement l’URL résolue', async () => {
    resolve.mockResolvedValue({ url: 'blob:authorized-pdf', release: vi.fn() });
    render(<MediaViewerModal asset={{ ...asset, type: 'document', mimeType: 'application/pdf' }} assetCount={1} position={0} audience="Secret" language="FR" mediaTags={[]} dialogRef={createRef()} onClose={() => undefined} onMove={() => undefined} onToggleTag={() => undefined} onDelete={() => undefined} />);
    expect(screen.queryByRole('link', { name: 'Ouvrir le PDF' })).toBeNull();
    expect((await screen.findByRole('link', { name: 'Ouvrir le PDF' })).getAttribute('href')).toBe('blob:authorized-pdf');
  });
  it('la modale affiche une image privée depuis sa variante de scène, jamais l’original sans action explicite', async () => {
    resolvePresentation.mockResolvedValue({ url: 'blob:stage-variant', release: vi.fn() });
    render(<MediaViewerModal asset={{ ...asset, id: 'photo_01', name: 'Photo privée', type: 'image', mimeType: 'image/jpeg', binaryId: 'binary_photo' }} assetCount={1} position={0} audience="Secret" language="FR" mediaTags={[]} dialogRef={createRef()} onClose={() => undefined} onMove={() => undefined} onToggleTag={() => undefined} onDelete={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photo privée' }).getAttribute('src')).toBe('blob:stage-variant'));
    expect(resolvePresentation).toHaveBeenCalledWith(expect.objectContaining({ binaryId: 'binary_photo', cartularyId: 'cart_other', role: 'stage' }));
    expect(resolve).not.toHaveBeenCalled();
  });
});
