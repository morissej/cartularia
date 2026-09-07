import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProjectedPublicBlock } from '../../src/components/ProjectedPublicBlock.tsx';
import type { PublicBlockProjection } from '../../src/domain/projections.ts';

describe('médias de la projection publique', () => {
  it('M03 : rend un nom WEBP pour la copie publique provenant d’une image JPG', () => {
    const block: PublicBlockProjection = { blockId: 'media-library', title: 'Bibliothèque', payload: { mediaLabels: ['cadran.jpg'] }, assets: [{ assetId: 'photo_01', derivativeId: 'web_01', mediaKind: 'image', mimeType: 'image/webp', storagePath: 'public/OBJ-001/photo_01/web_01', contentHash: '', downloadUrl: '/assets/cadran.webp' }], sourceRevision: 1, publicationStatus: 'published', contentHash: '' };
    render(<ProjectedPublicBlock block={block} />);
    const link = screen.getByRole('link', { name: 'Télécharger le média : cadran.jpg' });
    expect(link.getAttribute('download')).toBe('cadran.webp');
    expect(link.getAttribute('href')).toBe('/assets/cadran.webp');
  });
  it('ne rend téléchargeables que les dérivés effectivement résolus', () => {
    const block: PublicBlockProjection = {
      blockId: 'media-library',
      title: 'Bibliothèque média',
      payload: { heading: 'Médias publiés' },
      assets: [
        {
          assetId: 'asset-public-1',
          derivativeId: 'web-1',
          mediaKind: 'image',
          mimeType: 'image/webp',
          storagePath: 'public/asset-public-1/web-1',
          contentHash: 'sha256:1',
          downloadUrl: 'blob:public-1',
        },
        {
          assetId: 'asset-unavailable',
          derivativeId: 'web-2',
          mediaKind: 'image',
          mimeType: 'image/webp',
          storagePath: 'public/asset-unavailable/web-2',
          contentHash: 'sha256:2',
          downloadUrl: null,
        },
      ],
      sourceRevision: 4,
      publicationStatus: 'published',
      contentHash: 'sha256:block',
    };

    render(<ProjectedPublicBlock block={block} />);

    const links = screen.getAllByRole('link', { name: /Télécharger le média/ });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('blob:public-1');
    expect(links[0].getAttribute('download')).toBe('Bibliothèque média · 1.webp');
  });
});
