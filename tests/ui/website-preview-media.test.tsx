import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Modèle : tests/ui/private-media-image-lifecycle.test.tsx — les services distants sont remplacés ; jsdom n'a pas
// d'IntersectionObserver, PrivateMediaImage résout donc immédiatement.
vi.mock('../../src/services/privateMedia.ts', () => ({
  acquirePrivateMediaObjectUrl: vi.fn(),
  acquirePrivatePresentationObjectUrl: vi.fn(),
}));
vi.mock('../../src/services/publicMedia', () => ({ acquirePublicMediaObjectUrl: vi.fn() }));

import { ProjectedPublicBlock } from '../../src/components/ProjectedPublicBlock.tsx';
import { buildWebsiteDraft, websiteDraftPreview, websiteDraftRequest } from '../../src/domain/websiteDraft';
import { acquirePrivateMediaObjectUrl, acquirePrivatePresentationObjectUrl } from '../../src/services/privateMedia.ts';
import { acquirePublicMediaObjectUrl } from '../../src/services/publicMedia';
import type { Asset } from '../../src/types';

const uploaded: Asset = { id: 'photo_01', name: 'Vue', url: '', binaryId: 'binary_01', cartularyId: 'cart_x', type: 'image', status: 'Archived', visibility: 'Tous', tags: ['main-photo', 'slideshow'], hash: '', mimeType: 'image/jpeg' };
const uploadedVideo: Asset = { id: 'video_01', name: 'Film', url: '', binaryId: 'binary_02', cartularyId: 'cart_x', type: 'video', status: 'Archived', visibility: 'Tous', tags: ['main-video'], hash: '', mimeType: 'video/mp4' };
const unsaved: Asset = { id: 'photo_02', name: 'Vue non enregistrée', url: 'blob:x', type: 'image', status: 'Archived', visibility: 'Tous', tags: ['main-photo'], hash: '', mimeType: 'image/jpeg' };
const presentation: NonNullable<Asset['privatePresentation']> = {
  binaryId: 'binary_01', version: 'presentation-v3',
  variants: [{ width: 240, height: 160, storagePath: 'private-derivatives/owner_x/cart_x/binary_01/presentation-v3-240.webp', sha256: `sha256:${'a'.repeat(64)}`, size: 1000, mimeType: 'image/webp' }],
  thumbnail: null,
};
const content = { brand: 'Atelier', model: 'Objet', reference: 'REF' };
const previewBlocks = (assets: Asset[], selection: string[]) => websiteDraftPreview(buildWebsiteDraft({ ...content, assets }, selection));

describe('aperçu local des médias téléversés (V4 point 1, D1 (a))', () => {
  beforeEach(() => {
    vi.mocked(acquirePrivateMediaObjectUrl).mockReset();
    vi.mocked(acquirePrivatePresentationObjectUrl).mockReset();
    vi.mocked(acquirePublicMediaObjectUrl).mockReset();
  });

  it('affiche la variante de présentation d’un média téléversé, jamais l’original', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockResolvedValue({ url: 'blob:variant', release: vi.fn() });
    const [hero, library] = previewBlocks([{ ...uploaded, privatePresentation: presentation }], ['media-hero', 'media-library']);
    expect([hero.blockId, library.blockId]).toEqual(['media-hero', 'media-library']);
    // Bloc par bloc : deux import() concurrents d'un module doublé servent le module réel au second (vitest 4.1) ;
    // le comportement vérifié (une variante par PrivateMediaImage, jamais l'original) ne dépend pas de l'ordre.
    const heroView = render(<ProjectedPublicBlock block={hero} preview />);
    await waitFor(() => expect(heroView.container.querySelector('img')?.getAttribute('src')).toBe('blob:variant'));
    expect(acquirePrivatePresentationObjectUrl).toHaveBeenLastCalledWith({ binaryId: 'binary_01', cartularyId: 'cart_x', asset: { privatePresentation: presentation }, role: 'stage' });
    const libraryView = render(<ProjectedPublicBlock block={library} preview />);
    await waitFor(() => expect(libraryView.container.querySelector('img')?.getAttribute('src')).toBe('blob:variant'));
    expect(acquirePrivatePresentationObjectUrl).toHaveBeenLastCalledWith({ binaryId: 'binary_01', cartularyId: 'cart_x', asset: { privatePresentation: presentation }, role: 'thumbnail' });
    expect(acquirePrivatePresentationObjectUrl).toHaveBeenCalledTimes(2);
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
    expect(acquirePublicMediaObjectUrl).not.toHaveBeenCalled();
    expect(screen.queryByText(/copie publique est absente/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Télécharger le média/ })).toBeNull();
    const libraryButton = libraryView.container.querySelector('.public-media-library button')!;
    expect(libraryButton.hasAttribute('disabled')).toBe(true);
    expect(libraryButton.getAttribute('title')).toContain('disponibles sur la page publiée');
    fireEvent.click(libraryButton);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText('Aperçu local · non publié')).toHaveLength(2);
    expect(screen.getAllByText(/disponibles sur la page publiée, depuis la copie vérifiée par le serveur/)).toHaveLength(2);
    expect(screen.queryByText(/n’est pas encore enregistré/)).toBeNull();
  });

  it('le carrousel et la vidéo n’offrent pas l’original en aperçu (G1)', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockResolvedValue({ url: 'blob:variant', release: vi.fn() });
    const blocks = previewBlocks([uploaded, uploadedVideo], ['media-slideshow', 'media-motion']);
    expect(blocks.map((block) => block.blockId)).toEqual(['media-motion', 'media-slideshow']);
    const { container } = render(<>{blocks.map((block) => <ProjectedPublicBlock key={block.blockId} block={block} preview />)}</>);

    const slideshow = within(container.querySelector('[data-public-block="media-slideshow"]')!);
    await waitFor(() => expect(slideshow.getByRole('img', { name: 'Vue' }).getAttribute('src')).toBe('blob:variant'));
    expect(screen.queryByRole('link', { name: /Télécharger le média/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Télécharger/ })).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Charger la vidéo' })).toBeNull();
    // V4 relecture H1 : la vidéo téléversée ne reçoit pas la promesse des images ; l'aperçu annonce le refus serveur.
    expect(screen.getAllByText(/disponibles sur la page publiée/)).toHaveLength(1);
    expect(within(container.querySelector('[data-public-block="media-motion"]')!).getByText(/Cette vidéo n’a pas de copie publique vérifiée connue de cet aperçu : le serveur refusera la publication/)).toBeTruthy();
    expect(within(container.querySelector('[data-public-block="media-motion"]')!).queryByText(/disponibles sur la page publiée/)).toBeNull();
    fireEvent.click(slideshow.getByRole('button', { name: 'Ouvrir Vue' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
    expect(acquirePublicMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('la page publiée ignore une source d’aperçu', () => {
    const [block] = previewBlocks([uploaded], ['media-hero']);
    expect(block.assets[0].localPreview?.binaryId).toBe('binary_01');
    const { container } = render(<ProjectedPublicBlock block={block} />);
    expect(container.querySelector('img')).toBeNull();
    expect(acquirePrivatePresentationObjectUrl).not.toHaveBeenCalled();
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
    expect(screen.getByText(/copie publique est absente/)).toBeTruthy();
    expect(screen.queryByText(/disponibles sur la page publiée/)).toBeNull();
  });

  it('un média non enregistré est annoncé comme refusé par le serveur', () => {
    const [block] = previewBlocks([unsaved], ['media-hero']);
    expect(block.assets).toHaveLength(1);
    expect(block.assets[0].downloadUrl).toBeNull();
    const preview = render(<ProjectedPublicBlock block={block} preview />);
    expect(screen.getByText(/n’est pas encore enregistré dans le dossier/)).toBeTruthy();
    expect(screen.queryByText(/copie publique est absente/)).toBeNull();
    expect(preview.container.querySelector('img')).toBeNull();
    expect(JSON.stringify(block)).not.toContain('blob:x');
    preview.unmount();
    render(<ProjectedPublicBlock block={block} />);
    expect(screen.getByText(/copie publique est absente/)).toBeTruthy();
    expect(screen.queryByText(/n’est pas encore enregistré/)).toBeNull();
    expect(acquirePrivatePresentationObjectUrl).not.toHaveBeenCalled();
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('une vidéo téléversée en aperçu annonce le refus serveur au lieu de promettre la lecture (H1)', () => {
    // App.tsx pose derivativeStatus 'pending' à toute vidéo téléversée ; le serveur refuse derivative_not_ready sans copie transcodée.
    const pendingVideo: Asset = { ...uploadedVideo, tags: [], derivativeStatus: 'pending' };
    const [library] = previewBlocks([pendingVideo], ['media-library']);
    expect(library.blockId).toBe('media-library');
    expect(websiteDraftRequest(buildWebsiteDraft({ ...content, assets: [pendingVideo] }, ['media-library']))[0].assets).toEqual([{ assetId: 'video_01', binaryId: 'binary_02' }]);
    const { container } = render(<ProjectedPublicBlock block={library} preview />);
    const button = container.querySelector('.public-media-library button')!;
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('title')).toMatch(/Cette vidéo n’a pas de copie publique vérifiée connue de cet aperçu : le serveur refusera la publication s’il n’en a pas produit/);
    expect(screen.getByRole('status').textContent).toMatch(/le serveur refusera la publication/);
    expect(screen.queryByText(/disponibles sur la page publiée/)).toBeNull();
    expect(container.querySelector('video')).toBeNull();
    expect(screen.queryByRole('link', { name: /Télécharger/ })).toBeNull();
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('un bloc mixte n’ouvre la visionneuse que sur les médias du bundle : la navigation ne mène jamais à un binaire privé (F2 sécurité)', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockResolvedValue({ url: 'blob:variant', release: vi.fn() });
    const bundle: Asset = { ...uploaded, id: 'bundle_01', name: 'Vue du bundle', url: '/assets/demo-watches/x/front.jpg', binaryId: undefined, cartularyId: undefined, tags: [] };
    const [block] = previewBlocks([bundle, { ...uploaded, name: 'Vue téléversée', tags: [] }, { ...uploadedVideo, name: 'Film téléversé', tags: [] }], ['media-library']);
    expect(block.assets).toHaveLength(3);
    const { container } = render(<ProjectedPublicBlock block={block} preview />);
    const buttons = Array.from(container.querySelectorAll('.public-media-library button'));
    expect(buttons.map((button) => button.hasAttribute('disabled'))).toEqual([false, true, true]);
    fireEvent.click(buttons[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Vue du bundle' })).toBeTruthy();
    expect(within(dialog).getByText('1 / 1')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Média suivant' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Média précédent' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Charger la vidéo' })).toBeNull();
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('un média du bundle garde son adresse statique, ses téléchargements et sa visionneuse en aperçu', async () => {
    const bundle: Asset = { ...uploaded, id: 'bundle_01', name: 'Vue du bundle', url: '/assets/demo-watches/x/front.jpg', binaryId: undefined, cartularyId: undefined };
    const [block] = previewBlocks([bundle], ['media-library']);
    const { container } = render(<ProjectedPublicBlock block={block} preview />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/demo-watches/x/front.jpg');
    expect(screen.getByRole('link', { name: /Télécharger le média/ })).toBeTruthy();
    expect(screen.queryByText(/disponibles sur la page publiée/)).toBeNull();
    fireEvent.click(container.querySelector('.public-media-library button')!);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Afficher l’original/ })).toBeNull();
    expect(acquirePrivatePresentationObjectUrl).not.toHaveBeenCalled();
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });
});
