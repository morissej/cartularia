import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectedPublicBlock } from '../../src/components/ProjectedPublicBlock';
import { buildDemoCartularyAssets, DEMO_CARTULARIES } from '../../src/data/demoCartularies';
import { buildWebsiteDraft, websiteDraftPreview } from '../../src/domain/websiteDraft';

describe('aperçu public des médias fictifs de démonstration', () => {
  it.each(DEMO_CARTULARIES)('$model : affiche une photo, une vidéo et leurs téléchargements', (cartulary) => {
    const assets = buildDemoCartularyAssets(cartulary);
    expect(assets.every((asset) => asset.visibility === 'Tous' && !asset.binaryId)).toBe(true);
    for (const asset of assets) {
      expect(asset.url.startsWith('/assets/demo-watches/')).toBe(true);
      expect(existsSync(resolve('public', asset.url.slice(1))), asset.url).toBe(true);
    }
    const blocks = websiteDraftPreview(buildWebsiteDraft({ ...cartulary, assets }, ['media-hero', 'media-motion']));
    const { container } = render(<>{blocks.map((block) => <ProjectedPublicBlock key={block.blockId} block={block} preview />)}</>);
    expect(container.querySelector('[data-public-block="media-hero"] img')?.getAttribute('src')).toMatch(/^\/assets\/demo-watches\/.+\.jpg$/);
    const video = container.querySelector('video');
    expect(video?.getAttribute('src')).toBe(`/assets/demo-watches/${cartulary.mediaSlug}/motion.webm`);
    expect(video?.hasAttribute('controls')).toBe(true);
    const downloads = within(container).getAllByRole('link', { name: /Télécharger le média/ });
    expect(downloads).toHaveLength(2);
    expect(downloads.some((link) => link.getAttribute('href') === video?.getAttribute('src') && link.getAttribute('download')?.endsWith('.webm'))).toBe(true);
    expect(within(container).getAllByText('Aperçu local · non publié')).toHaveLength(2);
  });

  it('ne rend pas publics les fichiers Secret réels, même sous une URL statique', () => {
    const cartulary = DEMO_CARTULARIES[0];
    const [fixture] = buildDemoCartularyAssets(cartulary);
    const draft = buildWebsiteDraft({ ...cartulary, assets: [{ ...fixture, id: 'private-real-asset', visibility: 'Secret' }] }, ['media-hero']);
    expect(draft[0].assets).toEqual([]);
  });

  it('ne donne pas l’autorisation fictive à une racine média substituée ou à un objet inconnu', () => {
    const cartulary = DEMO_CARTULARIES[0];
    for (const untrusted of [{ ...cartulary, mediaSlug: '../private' }, { ...cartulary, id: 'real-cartulary' }]) {
      expect(buildDemoCartularyAssets(untrusted).every((asset) => asset.visibility === 'Secret')).toBe(true);
    }
  });
});
