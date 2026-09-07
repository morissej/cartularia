import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaCarousel } from '../../src/components/MediaCarousel.tsx';
import { Spin360 } from '../../src/components/Spin360.tsx';
import { alternatingFrameOrder, runBoundedPreloadQueue } from '../../src/utils/boundedPreloadQueue.ts';
import type { Asset } from '../../src/types/index.ts';

const asset = (id: string, type: Asset['type'], overrides: Partial<Asset> = {}): Asset => ({
  id,
  name: id,
  url: `/${id}.${type === 'video' ? 'mov' : 'jpg'}`,
  type,
  hash: `hash-${id}`,
  status: 'Archived',
  visibility: 'Secret',
  tags: [],
  ...overrides,
});

describe('préchargement média PF1', () => {
  it('conserve la sélection par identité après réordonnancement et borne immédiatement une liste réduite', () => {
    const images = [asset('first', 'image'), asset('second', 'image'), asset('third', 'image')];
    const { rerender } = render(<MediaCarousel assets={images} language="FR" onOpen={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '3. third' }));
    rerender(<MediaCarousel assets={[images[2], images[0]]} language="FR" onOpen={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Ouvrir third' })).toBeTruthy();
    rerender(<MediaCarousel assets={[images[0]]} language="FR" onOpen={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Ouvrir first' })).toBeTruthy();
    rerender(<MediaCarousel assets={[]} language="FR" onOpen={() => undefined} />);
    expect(screen.queryByRole('region', { name: 'Diaporama média' })).toBeNull();
  });
  it('utilise les posters dans les miniatures sans instancier de vidéo', () => {
    render(<MediaCarousel
      assets={[
        asset('photo', 'image'),
        asset('video-poster', 'video', { posterUrl: '/poster.webp' }),
        asset('video-sans-poster', 'video'),
      ]}
      language="FR"
      onOpen={() => undefined}
    />);

    expect(document.querySelectorAll('video')).toHaveLength(0);
    const posterThumbnail = screen.getByRole('button', { name: '2. video-poster' });
    expect(posterThumbnail.querySelector('img')?.getAttribute('src')).toBe('/poster.webp');
    const posterlessThumbnail = screen.getByRole('button', { name: '3. video-sans-poster' });
    expect(posterlessThumbnail.querySelector('img')).toBeNull();
    expect(posterlessThumbnail.querySelector('.media-carousel__thumb-placeholder')).toBeTruthy();

    fireEvent.click(posterThumbnail);
    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(document.querySelector('video')?.getAttribute('preload')).toBe('metadata');
    const download = screen.getByRole('link', { name: 'Télécharger le média : video-poster' });
    expect(download.getAttribute('href')).toBe('/video-poster.mov');
    expect(download.getAttribute('download')).toBe('video-poster.mov');
  });

  it('borne la file générique à deux tâches concurrentes', async () => {
    let active = 0;
    let maximum = 0;
    const settled: number[] = [];
    await runBoundedPreloadQueue({
      items: [0, 1, 2, 3, 4],
      concurrency: 2,
      load: async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => window.setTimeout(resolve, 5));
        active -= 1;
      },
      onSettled: (item) => settled.push(item),
    });

    expect(maximum).toBe(2);
    expect(settled).toHaveLength(5);
    expect(alternatingFrameOrder(5)).toEqual([0, 1, 4, 2, 3]);
  });
});

describe('lecteur 360° PF1', () => {
  const originalImage = globalThis.Image;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  afterEach(() => {
    vi.stubGlobal('Image', originalImage);
  });

  it('ne dépasse jamais deux images 360° en vol', async () => {
    let active = 0;
    let maximum = 0;
    let started = 0;
    class TimedImage {
      public onload: (() => void) | null = null;
      public onerror: (() => void) | null = null;

      public set src(value: string) {
        if (!value) return;
        started += 1;
        active += 1;
        maximum = Math.max(maximum, active);
        window.setTimeout(() => {
          active -= 1;
          this.onload?.();
        }, 5);
      }
    }
    vi.stubGlobal('Image', TimedImage);

    render(<Spin360
      images={Array.from({ length: 6 }, (_, index) => asset(`angle-${index}`, 'image'))}
      posterImageUrl="/poster.jpg"
      language="FR"
    />);

    await waitFor(() => expect(started).toBe(6));
    expect(maximum).toBe(2);
    expect(screen.getByLabelText('Visualiseur 3D de l’objet')).toBeTruthy();
  });

  it('fait tourner le lecteur au clavier sans déclencher la lecture automatique', () => {
    render(<Spin360
      images={Array.from({ length: 6 }, (_, index) => asset(`angle-${index}`, 'image'))}
      posterImageUrl="/poster.jpg"
      language="FR"
    />);

    const viewer = screen.getByLabelText('Visualiseur 3D de l’objet');
    expect(screen.getByAltText('Vue 1/6 · angle-0')).toBeTruthy();
    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(screen.getByAltText('Vue 2/6 · angle-1')).toBeTruthy();
    fireEvent.keyDown(viewer, { key: 'ArrowLeft' });
    expect(screen.getByAltText('Vue 1/6 · angle-0')).toBeTruthy();
  });

  it('retire la rotation automatique lorsque le mouvement réduit est demandé', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });

    render(<Spin360
      images={Array.from({ length: 3 }, (_, index) => asset(`angle-${index}`, 'image'))}
      posterImageUrl="/poster.jpg"
      language="FR"
    />);

    expect(screen.queryByRole('button', { name: 'Lancer rotation automatique' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Angle précédent' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Angle suivant' })).toBeTruthy();
  });
});
