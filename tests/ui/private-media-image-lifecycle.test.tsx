import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaFailure } from '../../src/utils/mediaFailure';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/privateMedia.ts', () => ({
  acquirePrivateMediaObjectUrl: vi.fn(),
  acquirePrivatePresentationObjectUrl: vi.fn(),
}));

import { PrivateMediaImage } from '../../src/components/PrivateMediaImage.tsx';
import { MediaCarousel } from '../../src/components/MediaCarousel.tsx';
import { acquirePrivateMediaObjectUrl, acquirePrivatePresentationObjectUrl } from '../../src/services/privateMedia.ts';
import type { Asset } from '../../src/types/index.ts';

const privateAsset: Asset = {
  id: 'private-image',
  name: 'Original privé',
  url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  type: 'image',
  hash: 'hash',
  status: 'Archived',
  visibility: 'Secret',
  tags: [],
  binaryId: 'binary-private-image',
  cartularyId: 'cart_lifecycle_object',
};
const presentation: NonNullable<Asset['privatePresentation']> = {
  binaryId: 'binary-private-image', version: 'presentation-v3',
  variants: [{ width: 240, height: 160, storagePath: 'private-derivatives/owner_lifecycle/cart_lifecycle_object/binary-private-image/presentation-v3-240.webp', sha256: `sha256:${'a'.repeat(64)}`, size: 1000, mimeType: 'image/webp' }],
  thumbnail: null,
};

describe('cycle de vie de PrivateMediaImage', () => {
  beforeEach(() => { vi.mocked(acquirePrivateMediaObjectUrl).mockReset(); vi.mocked(acquirePrivatePresentationObjectUrl).mockReset(); });

  it('libère le bail de l’Object URL au démontage (scène par défaut = variante, jamais l’original)', async () => {
    const release = vi.fn();
    vi.mocked(acquirePrivatePresentationObjectUrl).mockResolvedValue({ url: 'blob:private-image', release });
    const { unmount } = render(<PrivateMediaImage asset={privateAsset} alt="Original privé" eager />);

    await waitFor(() => expect(screen.getByRole('img', { name: 'Original privé' }).getAttribute('src')).toBe('blob:private-image'));
    expect(acquirePrivatePresentationObjectUrl).toHaveBeenCalledWith({ binaryId: 'binary-private-image', cartularyId: 'cart_lifecycle_object', asset: { privatePresentation: undefined }, role: 'stage' });
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
    unmount();
    expect(release).toHaveBeenCalledOnce();
  });

  it('une vignette demande la variante « thumbnail » avec le miroir de l’asset', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockResolvedValue({ url: 'blob:thumbnail', release: vi.fn() });
    render(<PrivateMediaImage asset={{ ...privateAsset, privatePresentation: presentation }} alt="Vignette" sizes="70px" role="thumbnail" eager />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Vignette' }).getAttribute('src')).toBe('blob:thumbnail'));
    expect(acquirePrivatePresentationObjectUrl).toHaveBeenCalledWith({ binaryId: 'binary-private-image', cartularyId: 'cart_lifecycle_object', asset: { privatePresentation: presentation }, role: 'thumbnail' });
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('l’original n’est chargé que sur le rôle explicite « original »', async () => {
    vi.mocked(acquirePrivateMediaObjectUrl).mockResolvedValue({ url: 'blob:original', release: vi.fn() });
    render(<PrivateMediaImage asset={privateAsset} alt="Original demandé" role="original" eager />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Original demandé' }).getAttribute('src')).toBe('blob:original'));
    expect(acquirePrivateMediaObjectUrl).toHaveBeenCalledWith('binary-private-image', 'cart_lifecycle_object');
    expect(acquirePrivatePresentationObjectUrl).not.toHaveBeenCalled();
  });

  it('sans variante : « Aperçu en préparation », aucun repli automatique sur l’original', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockRejectedValue(new MediaFailure('derivative-pending'));
    render(<PrivateMediaImage asset={privateAsset} alt="Photo en attente" eager />);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Aperçu en préparation');
    expect(status.getAttribute('data-media-state')).toBe('pending');
    expect(status.getAttribute('data-media-failure')).toBe('derivative-pending');
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
    expect(screen.queryByText(/Accès restreint/)).toBeNull();
  });

  it('échec définitif : « Copie de présentation non produite », état « unavailable », sans reprise ni repli sur l’original (tour 2, point 1)', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockRejectedValue(new MediaFailure('derivative-failed'));
    render(<PrivateMediaImage asset={privateAsset} alt="Photo sans copie" eager />);
    const status = await screen.findByRole('status');
    expect(status.textContent).toBe('Copie de présentation non produite');
    expect(status.getAttribute('data-media-state')).toBe('unavailable');
    expect(status.getAttribute('data-media-failure')).toBe('derivative-failed');
    expect(screen.queryByRole('button', { name: 'Réessayer le média' })).toBeNull();
    expect(screen.queryByText(/Aperçu en préparation/)).toBeNull();
    expect(screen.queryByText(/Accès restreint/)).toBeNull();
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('copie privée d’un autre propriétaire : état « unavailable » sans bouton de reprise (tour 4, point 7)', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockRejectedValue(new MediaFailure('shared-unavailable'));
    render(<PrivateMediaImage asset={privateAsset} alt="Photo d’un autre propriétaire" eager />);
    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('Les originaux du propriétaire restent privés');
    expect(status.getAttribute('data-media-state')).toBe('unavailable');
    expect(status.getAttribute('data-media-failure')).toBe('shared-unavailable');
    expect(screen.queryByRole('button', { name: 'Réessayer le média' })).toBeNull();
    expect(screen.queryByText('Ouvrez le média pour réessayer.')).toBeNull();
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('onDerivativeUnavailable : le parent décide ; sans réponse « true », l’état d’échec est rendu et aucun original n’est chargé', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockRejectedValue(new MediaFailure('derivative-pending'));
    const informed = vi.fn(() => undefined);
    render(<PrivateMediaImage asset={privateAsset} alt="Photo en attente" eager onDerivativeUnavailable={informed} />);
    const status = await screen.findByRole('status');
    expect(informed).toHaveBeenCalledWith('derivative-pending');
    expect(status.getAttribute('data-media-state')).toBe('pending');
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('utilise une source d’aperçu séparée sans charger le binaire', () => {
    render(<PrivateMediaImage asset={privateAsset} sourceOverride="/preview.webp" alt="Aperçu" />);
    expect(screen.getByRole('img', { name: 'Aperçu' }).getAttribute('src')).toBe('/preview.webp');
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
    expect(acquirePrivatePresentationObjectUrl).not.toHaveBeenCalled();
  });

  it('une coupure réseau conserve un bouton de reprise qui recharge réellement la photo', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ url: 'blob:recovered', release: vi.fn() });
    render(<PrivateMediaImage asset={privateAsset} alt="Photo après coupure" eager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer le média' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photo après coupure' }).getAttribute('src')).toBe('blob:recovered'));
    expect(acquirePrivatePresentationObjectUrl).toHaveBeenCalledTimes(2);
  });

  it('annonce un retrait au lieu de le confondre avec une panne réseau', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockRejectedValue(new MediaFailure('missing'));
    render(<PrivateMediaImage asset={privateAsset} alt="Photo retirée" eager />);
    expect(await screen.findByText(/Ce fichier est absent ou a été retiré/)).toBeTruthy();
  });

  it('ne crée pas de bouton imbriqué dans une vignette déjà ouvrable', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockRejectedValue(new Error('network'));
    render(<button type="button"><PrivateMediaImage asset={privateAsset} alt="Vignette" eager /></button>);
    await screen.findByText('Ouvrez le média pour réessayer.');
    expect(document.querySelector('button button')).toBeNull();
  });

  it('le carrousel demande la scène en « stage » et les miniatures en « thumbnail » ; une vidéo sans dérivé annonce « Aucune vignette disponible »', async () => {
    vi.mocked(acquirePrivatePresentationObjectUrl).mockResolvedValue({ url: 'blob:variant', release: vi.fn() });
    const video: Asset = { ...privateAsset, id: 'private-video', name: 'Film privé', type: 'video', url: '', binaryId: 'binary-private-video', mimeType: 'video/mp4' };
    render(<MediaCarousel assets={[privateAsset, { ...privateAsset, id: 'second', name: 'Seconde photo' }, video]} language="FR" onOpen={() => undefined} />);
    await waitFor(() => expect(acquirePrivatePresentationObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ role: 'stage' })));
    fireEvent.click(screen.getByRole('button', { name: '3. Film privé' }));
    expect(screen.getAllByRole('img', { name: 'Aucune vignette disponible' }).length).toBeGreaterThan(0);
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
    expect(screen.queryByText(/Accès restreint/)).toBeNull();
  });
});
