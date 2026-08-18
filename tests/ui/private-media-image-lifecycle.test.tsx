import { render, screen, waitFor } from '@testing-library/react';
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
  beforeEach(() => vi.mocked(acquirePrivateMediaObjectUrl).mockReset());

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
});
