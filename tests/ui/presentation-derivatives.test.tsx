import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PresentationImage } from '../../src/components/PresentationImage.tsx';
import { PrivateMediaImage } from '../../src/components/PrivateMediaImage.tsx';
import {
  presentationDerivativeUrl,
  presentationImageSetFor,
} from '../../src/media/presentationDerivatives.ts';
import type { Asset } from '../../src/types/index.ts';

const localAsset: Asset = {
  id: 'iwc-front',
  name: 'IWC face',
  url: '/assets/IWC/Focus Shift White Front.jpg',
  thumbnailUrl: '/assets/IWC/Focus Shift White Front.jpg',
  type: 'image',
  hash: 'sha256-original-intact',
  status: 'Archived',
  visibility: 'Tous',
  tags: ['main-photo'],
};

describe('dérivés de présentation PF4', () => {
  it('construit une chaîne AVIF, WebP puis JPEG avec dimensions intrinsèques', () => {
    render(<PresentationImage
      src="/assets/IWC/Focus Shift White Front.jpg"
      alt="IWC face"
      sizes="(max-width: 720px) 100vw, 900px"
    />);

    const image = screen.getByRole('img', { name: 'IWC face' });
    const sources = document.querySelectorAll('picture source');
    expect(sources).toHaveLength(2);
    expect(sources[0].getAttribute('type')).toBe('image/avif');
    expect(sources[0].getAttribute('srcset')).toContain('Focus%20Shift%20White%20Front.240.avif 240w');
    expect(sources[1].getAttribute('type')).toBe('image/webp');
    expect(image.getAttribute('src')).toBe('/assets/IWC/Focus Shift White Front.jpg');
    expect(image.getAttribute('width')).toBe('1200');
    expect(image.getAttribute('height')).toBe('800');
    expect(image.getAttribute('sizes')).toContain('900px');
    expect(image.style.aspectRatio).toBe('1200 / 800');
  });

  it('laisse les URL privées ou distantes hors du catalogue local', () => {
    const { container } = render(<PresentationImage src="blob:private-original" alt="Original privé" />);
    expect(container.querySelector('picture')).toBeNull();
    expect(screen.getByRole('img', { name: 'Original privé' }).getAttribute('src')).toBe('blob:private-original');
    expect(presentationImageSetFor('https://storage.example/private.jpg')).toBeNull();
  });

  it('raccorde aussi les images locales chargées par le coffre sans modifier leur URL source', () => {
    render(<PrivateMediaImage asset={localAsset} alt="Image du coffre" sizes="70px" />);
    expect(document.querySelectorAll('picture source')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Image du coffre' }).getAttribute('src')).toBe(localAsset.thumbnailUrl);
  });

  it('ne suréchantillonne jamais une image portrait de 800 pixels', () => {
    expect(presentationDerivativeUrl('/assets/IWC/_DSC0981-3.jpg', 1200, 'webp'))
      .toBe('/assets/IWC/derivatives/_DSC0981-3.800.webp');
  });
});
