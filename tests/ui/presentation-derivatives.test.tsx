import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PresentationImage } from '../../src/components/PresentationImage.tsx';
import { PrivateMediaImage } from '../../src/components/PrivateMediaImage.tsx';
import {
  presentationBundleThumbnailFor,
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

describe('dérivés statiques de démonstration (catalogue généré, WebP seul)', () => {
  const demoAsset: Asset = {
    id: 'demo-cover',
    name: 'Couverture de démonstration',
    url: '/assets/demo-watches/rolex-submariner/spin-00.jpg',
    thumbnailUrl: '/assets/demo-watches/rolex-submariner/spin-00.jpg',
    type: 'image',
    hash: 'sha256:demo-cover',
    status: 'Archived',
    visibility: 'Tous',
    tags: ['main-photo'],
  };

  it('publie 240/480/768 pour une source carrée de 1024 pixels, sans AVIF ni agrandissement', () => {
    const picture = presentationImageSetFor(demoAsset.url)!;
    expect(picture.width).toBe(1024);
    expect(picture.height).toBe(1024);
    expect(picture.aspectRatio).toBe('1024 / 1024');
    expect(picture.avifSrcSet).toBe('');
    expect(picture.webpSrcSet).toBe([
      '/assets/demo-watches/derivatives/rolex-submariner/spin-00.240.webp 240w',
      '/assets/demo-watches/derivatives/rolex-submariner/spin-00.480.webp 480w',
      '/assets/demo-watches/derivatives/rolex-submariner/spin-00.768.webp 768w',
    ].join(', '));
    expect(presentationDerivativeUrl('/assets/demo-watches/audemars-piguet-royal-oak/main.jpg', 1200)).toBe('/assets/demo-watches/derivatives/audemars-piguet-royal-oak/main.1200.webp');
    expect(presentationDerivativeUrl('/assets/demo-watches/audemars-piguet-royal-oak/main.jpg', 1400)).toBe('/assets/demo-watches/derivatives/audemars-piguet-royal-oak/main.1200.webp');
    expect(presentationDerivativeUrl(demoAsset.url, 1200)).toBe('/assets/demo-watches/derivatives/rolex-submariner/spin-00.768.webp');
    expect(presentationDerivativeUrl(`${demoAsset.url}?v=2`, 240)).toBe('/assets/demo-watches/derivatives/rolex-submariner/spin-00.240.webp');
  });

  it('rend une image de démonstration avec srcset WebP, dimensions intrinsèques et repli JPEG', () => {
    render(<PrivateMediaImage asset={demoAsset} alt="Couverture" sizes="(max-width: 720px) 100vw, 55vw" eager />);
    const image = screen.getByRole('img', { name: 'Couverture' });
    const sources = [...document.querySelectorAll('picture source')];
    const webp = sources.find((source) => source.getAttribute('type') === 'image/webp')!;
    expect(webp.getAttribute('srcset')).toContain('rolex-submariner/spin-00.480.webp 480w');
    expect(sources.filter((source) => (source.getAttribute('srcset') || '').length > 0)).toHaveLength(1);
    expect(image.getAttribute('src')).toBe(demoAsset.url);
    expect(image.getAttribute('width')).toBe('1024');
    expect(image.getAttribute('height')).toBe('1024');
    expect(image.style.aspectRatio).toBe('1024 / 1024');
  });

  it('expose la vignette de bundle (plus petite variante WebP) pour les projections Registre', () => {
    const thumbnail = presentationBundleThumbnailFor('/assets/demo-watches/tudor-black-bay-chrono/main.jpg')!;
    expect(thumbnail.path).toBe('/assets/demo-watches/derivatives/tudor-black-bay-chrono/main.240.webp');
    expect(thumbnail.width).toBe(240);
    expect(thumbnail.height).toBe(240);
    expect(thumbnail.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(presentationBundleThumbnailFor('/assets/demo-watches/tudor-black-bay-chrono/motion.webm')).toBeNull();
    expect(presentationBundleThumbnailFor('blob:private')).toBeNull();
    expect(presentationBundleThumbnailFor('https://storage.example/private.jpg')).toBeNull();
  });
});
