import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WebsiteDraftWarnings } from '../../src/components/WebsiteDraftWarnings';
import { buildWebsiteDraft, websiteDraftVideosWithoutPublicCopy } from '../../src/domain/websiteDraft';
import type { Asset } from '../../src/types';

describe('explication des omissions publiques', () => {
  it('précise les rubriques affectées, sans reproduire les données écartées', () => {
    const blocks = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: '', assets: [], description: ['Adresse confidentielle : valeur privée'], history: ['Histoire publiable'] }, ['condition-description', 'reference-history']);
    const { container } = render(<WebsiteDraftWarnings blocks={blocks} />);
    expect(screen.getByRole('status').textContent).toContain('Certains textes ne seront pas publiés');
    expect(container.textContent).toContain(blocks.find((block) => block.excludedTextCount)!.title);
    expect(container.textContent).not.toContain('valeur privée');
    expect(container.querySelectorAll('li')).toHaveLength(1);
  });
  it('n’affiche pas d’alerte pour le mot original dans une description publique', () => {
    const blocks = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: '', assets: [], description: ['Cadran original bleu, sans restauration.'] }, ['condition-description']);
    const { container } = render(<WebsiteDraftWarnings blocks={blocks} />);
    expect(container.textContent).toBe('');
  });
  it('compte les vidéos « Tous » sans copie publique vérifiée connue et annonce le refus serveur (V4 relecture H1)', () => {
    const video: Asset = { id: 'video_01', name: 'Film', url: '', binaryId: 'binary_02', cartularyId: 'cart_x', type: 'video', status: 'Archived', visibility: 'Tous', tags: ['main-video'], hash: '', mimeType: 'video/mp4', derivativeStatus: 'pending' };
    const image: Asset = { ...video, id: 'photo_01', name: 'Vue', binaryId: 'binary_01', type: 'image', mimeType: 'image/jpeg', tags: ['main-photo'], derivativeStatus: 'not-required' };
    const blocks = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: '', assets: [video, image] }, ['media-motion', 'media-library', 'media-hero']);
    // Une seule vidéo, même retenue par deux blocs (media-motion et media-library).
    expect(websiteDraftVideosWithoutPublicCopy(blocks).map((asset) => asset.id)).toEqual(['video_01']);
    const { container } = render(<WebsiteDraftWarnings blocks={blocks} />);
    expect(screen.getByRole('status').textContent).toContain('1 vidéo(s) sans copie publique vérifiée connue — publication refusée par le serveur');
    expect(container.textContent).toContain('Repassez ces vidéos en Secret ou retirez-les de la sélection');
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.querySelector('li')?.textContent).toBe('Film');
  });
  it('ne compte ni une vidéo dont la copie est connue prête, ni une vidéo Secret, ni une vidéo non enregistrée', () => {
    const base: Asset = { id: 'video_01', name: 'Film', url: '', binaryId: 'binary_02', type: 'video', status: 'Archived', visibility: 'Tous', tags: ['main-video'], hash: '', mimeType: 'video/mp4', derivativeStatus: 'pending' };
    const ready = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: '', assets: [{ ...base, derivativeStatus: 'ready' }] }, ['media-motion']);
    const secret = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: '', assets: [{ ...base, visibility: 'Secret' }] }, ['media-motion']);
    const unsaved = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: '', assets: [{ ...base, binaryId: undefined, url: 'blob:x' }] }, ['media-motion']);
    for (const blocks of [ready, secret, unsaved]) {
      expect(websiteDraftVideosWithoutPublicCopy(blocks)).toEqual([]);
      expect(render(<WebsiteDraftWarnings blocks={blocks} />).container.textContent).toBe('');
    }
  });
});
