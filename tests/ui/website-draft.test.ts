import { describe, expect, it } from 'vitest';
import { buildWebsiteDraft, websiteDraftPreview, websiteDraftRequest } from '../../src/domain/websiteDraft';
import type { Asset } from '../../src/types';

const media: Asset = { id: 'photo_01', name: 'Vue de face', url: 'blob:private-original', binaryId: 'binary_01', mimeType: 'image/jpeg', type: 'image', status: 'Archived', visibility: 'Secret', hash: 'sha256:abc', tags: ['main-photo'] };
describe('contrat unique de projection publique', () => {
  it('exclut les rubriques privées et les fichiers non autorisés', () => {
    const draft = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: 'REF', assets: [media] }, ['cover-owner', 'media-hero', 'value-cost-basis']);
    expect(draft.map((block) => block.id)).toEqual(['media-hero']);
    expect(draft[0].assets).toEqual([]);
  });
  it('n’envoie jamais une URL privée au serveur ou dans l’aperçu public', () => {
    const draft = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: 'REF', assets: [{ ...media, visibility: 'Tous' }] }, ['media-hero']);
    expect(websiteDraftRequest(draft)[0].assets).toEqual([{ assetId: 'photo_01', binaryId: 'binary_01' }]);
    expect(websiteDraftPreview(draft)[0].assets[0].downloadUrl).toBeNull();
    expect(JSON.stringify(websiteDraftRequest(draft))).not.toContain('blob:private-original');
  });
  it('conserve les descriptions légitimes et compte les omissions sans exposer leur texte', () => {
    const draft = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: 'REF', assets: [],
      description: ['Cadran original bleu, sans restauration.', 'Propriétaire : personne privée', 'originalUrl=https://secret.example/test.jpg', ''],
    }, ['condition-description']);
    expect(draft[0].payload.paragraphs).toEqual(['Cadran original bleu, sans restauration.']);
    expect(draft[0].excludedTextCount).toBe(2);
    for (const projection of [websiteDraftRequest(draft), websiteDraftPreview(draft)]) {
      const serialized = JSON.stringify(projection);
      expect(serialized).not.toContain('personne privée');
      expect(serialized).not.toContain('secret.example');
      expect(serialized).not.toContain('excludedTextCount');
    }
  });
});
