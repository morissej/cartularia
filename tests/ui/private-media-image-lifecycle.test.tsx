import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaFailure } from '../../src/utils/mediaFailure';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/privateMedia.ts', () => ({
  acquirePrivateMediaObjectUrl: vi.fn(),
}));

import { PrivateMediaImage } from '../../src/components/PrivateMediaImage.tsx';
import { acquirePrivateMediaObjectUrl } from '../../src/services/privateMedia.ts';
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
};

describe('cycle de vie de PrivateMediaImage', () => {
  beforeEach(() => { vi.mocked(acquirePrivateMediaObjectUrl).mockReset(); });

  it('libère le bail de l’Object URL au démontage', async () => {
    const release = vi.fn();
    vi.mocked(acquirePrivateMediaObjectUrl).mockResolvedValue({ url: 'blob:private-image', release });
    const { unmount } = render(<PrivateMediaImage asset={privateAsset} alt="Original privé" eager />);

    await waitFor(() => expect(screen.getByRole('img', { name: 'Original privé' }).getAttribute('src')).toBe('blob:private-image'));
    unmount();
    expect(release).toHaveBeenCalledOnce();
  });

  it('utilise une source d’aperçu séparée sans charger le binaire', () => {
    render(<PrivateMediaImage asset={privateAsset} sourceOverride="/preview.webp" alt="Aperçu" />);
    expect(screen.getByRole('img', { name: 'Aperçu' }).getAttribute('src')).toBe('/preview.webp');
    expect(acquirePrivateMediaObjectUrl).not.toHaveBeenCalled();
  });

  it('une coupure réseau conserve un bouton de reprise qui recharge réellement la photo', async () => {
    vi.mocked(acquirePrivateMediaObjectUrl).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ url: 'blob:recovered', release: vi.fn() });
    render(<PrivateMediaImage asset={privateAsset} alt="Photo après coupure" eager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer le média' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photo après coupure' }).getAttribute('src')).toBe('blob:recovered'));
    expect(acquirePrivateMediaObjectUrl).toHaveBeenCalledTimes(2);
  });

  it('annonce un retrait au lieu de le confondre avec une panne réseau', async () => {
    vi.mocked(acquirePrivateMediaObjectUrl).mockRejectedValue(new MediaFailure('missing'));
    render(<PrivateMediaImage asset={privateAsset} alt="Photo retirée" eager />);
    expect(await screen.findByText(/Ce fichier est absent ou a été retiré/)).toBeTruthy();
  });

  it('ne crée pas de bouton imbriqué dans une vignette déjà ouvrable', async () => {
    vi.mocked(acquirePrivateMediaObjectUrl).mockRejectedValue(new Error('network'));
    render(<button type="button"><PrivateMediaImage asset={privateAsset} alt="Vignette" eager /></button>);
    await screen.findByText('Ouvrez le média pour réessayer.');
    expect(document.querySelector('button button')).toBeNull();
  });

});
