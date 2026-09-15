import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectedPublicBlock } from '../../src/components/ProjectedPublicBlock.tsx';
import { SpinSequence } from '../../src/components/SpinSequence.tsx';
import type { PublicBlockProjection } from '../../src/domain/projections.ts';
import type { Asset } from '../../src/types/index.ts';

// Actifs de test hors fixtures : chemins non catalogués, identifiants neutres.
const view = (index: number): Asset => ({
  id: `sequence-view-${index}`,
  name: `Vue ${index}`,
  url: `/media/sequence/view-${index}.jpg`,
  thumbnailUrl: `/media/sequence/view-${index}.jpg`,
  type: 'image',
  hash: `sha256:view-${index}`,
  status: 'Archived',
  visibility: 'Tous',
  tags: ['spin-3d'],
});

const originalImage = globalThis.Image;
let started: string[] = [];
let active = 0;
let maximum = 0;

class TimedImage {
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  public set src(value: string) {
    if (!value) return;
    started.push(value);
    active += 1;
    maximum = Math.max(maximum, active);
    window.setTimeout(() => {
      active -= 1;
      this.onload?.();
    }, 5);
  }
}

describe('séquence 360° à l’ouverture du bloc', () => {
  beforeEach(() => {
    started = [];
    active = 0;
    maximum = 0;
    vi.stubGlobal('Image', TimedImage);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
  });

  afterEach(() => {
    vi.stubGlobal('Image', originalImage);
  });

  it('fermée : une seule image paresseuse (l’affiche), aucune vue préchargée, aucun visualiseur monté', () => {
    const images = [view(0), view(1), view(2)];
    const { container } = render(<SpinSequence images={images} language="FR" />);
    const rendered = container.querySelectorAll('img');
    expect(rendered).toHaveLength(1);
    expect(rendered[0].getAttribute('src')).toBe('/media/sequence/view-0.jpg');
    expect(rendered[0].getAttribute('loading')).toBe('lazy');
    expect(started).toEqual([]);
    expect(screen.queryByLabelText('Visualiseur 3D de l’objet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ouvrir la séquence 360° (3 vues)' })).toBeTruthy();
    expect(screen.getByText('3 vues ordonnées')).toBeTruthy();
  });

  it('ouverte : le visualiseur se monte, précharge les vues sans jamais dépasser deux images en vol', async () => {
    const images = Array.from({ length: 6 }, (_, index) => view(index));
    render(<SpinSequence images={images} language="FR" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la séquence 360° (6 vues)' }));
    expect(await screen.findByLabelText('Visualiseur 3D de l’objet')).toBeTruthy();
    await waitFor(() => expect(started).toHaveLength(6));
    expect(maximum).toBe(2);
    expect(new Set(started).size).toBe(6);
    expect(screen.queryByRole('button', { name: /Ouvrir la séquence 360°/ })).toBeNull();
  });

  it('rend le libellé anglais et ne rend rien sans vue', () => {
    const { container } = render(<SpinSequence images={[]} language="EN" />);
    expect(container.innerHTML).toBe('');
    render(<SpinSequence images={[view(0), view(1)]} language="EN" />);
    expect(screen.getByRole('button', { name: 'Open the 360° sequence (2 views)' })).toBeTruthy();
  });

  it('bloc public media-spin : aucune vue chargée avant le clic, visualiseur après', async () => {
    const block: PublicBlockProjection = {
      blockId: 'media-spin',
      title: 'Revue à 360°',
      payload: { heading: 'Séquence publiée' },
      assets: [0, 1, 2].map((index) => ({
        assetId: `sequence-view-${index}`, derivativeId: `web_${index}`, mediaKind: 'image', mimeType: 'image/webp',
        storagePath: `public/OBJ-TEST/sequence-view-${index}/web_${index}`, contentHash: `sha256:${index}`, downloadUrl: `/media/sequence/view-${index}.webp`,
      })),
      sourceRevision: 2,
      publicationStatus: 'published',
      contentHash: 'sha256:block',
    };
    const { container } = render(<ProjectedPublicBlock block={block} />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/media/sequence/view-0.webp');
    expect(started).toEqual([]);
    expect(screen.queryByLabelText('Visualiseur 3D de l’objet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la séquence 360° (3 vues)' }));
    expect(await screen.findByLabelText('Visualiseur 3D de l’objet')).toBeTruthy();
    await waitFor(() => expect(started).toHaveLength(3));
    expect(maximum).toBeLessThanOrEqual(2);
  });
});
