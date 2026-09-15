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
    // V4 point 1 : la source privée d'aperçu ne porte que l'identité du binaire (jamais d'URL ni de chemin) et ne part jamais au serveur.
    expect(websiteDraftPreview(draft)[0].assets[0].localPreview).toEqual({ binaryId: 'binary_01', cartularyId: undefined, privatePresentation: undefined });
    expect(JSON.stringify(websiteDraftPreview(draft))).not.toContain('blob:private-original');
    expect(JSON.stringify(websiteDraftRequest(draft))).not.toContain('localPreview');
  });
  it('un média non enregistré dans le dossier n’a ni adresse ni source privée d’aperçu', () => {
    const draft = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: 'REF', assets: [{ ...media, visibility: 'Tous', binaryId: undefined, url: 'blob:x' }] }, ['media-hero']);
    const [asset] = websiteDraftPreview(draft)[0].assets;
    expect(asset.downloadUrl).toBeNull();
    expect('localPreview' in asset).toBe(false);
    expect(JSON.stringify(websiteDraftPreview(draft))).not.toContain('blob:x');
    expect(websiteDraftRequest(draft)[0].assets).toEqual([{ assetId: 'photo_01', binaryId: '' }]);
  });
  it('l’aperçu et la demande sont deux projections du même brouillon', () => {
    const bundle: Asset = { ...media, id: 'bundle_01', name: 'Vue du bundle', url: '/assets/x.jpg', binaryId: undefined, visibility: 'Tous', tags: ['main-photo', 'slideshow'] };
    const uploaded: Asset = { ...media, id: 'upload_01', name: 'Vue téléversée', url: '', visibility: 'Tous', cartularyId: 'cart_x', tags: ['main-photo', 'slideshow'] };
    const secret: Asset = { ...media, id: 'secret_01', name: 'Vue secrète', tags: ['main-photo', 'slideshow'] };
    const draft = buildWebsiteDraft({ brand: 'Atelier', model: 'Objet', reference: 'REF', assets: [bundle, uploaded, secret],
      heroSummary: 'Présentation publique.', history: ['Histoire publiable', 'Propriétaire : personne privée'],
    }, ['media-hero', 'media-slideshow', 'reference-history', 'cover-owner']);
    const preview = websiteDraftPreview(draft);
    const request = websiteDraftRequest(draft);
    expect(preview.map((block) => block.blockId)).toEqual(['media-hero', 'media-slideshow', 'reference-history']);
    expect(preview.map((block) => [block.blockId, block.title, block.payload, block.assets.map((asset) => asset.assetId)]))
      .toEqual(request.map((block) => [block.id, block.title, block.payload, block.assets.map((asset) => asset.assetId)]));
    expect(preview[0].assets.map((asset) => [asset.assetId, asset.downloadUrl, asset.localPreview?.binaryId ?? null]))
      .toEqual([['bundle_01', '/assets/x.jpg', null], ['upload_01', null, 'binary_01']]);
    expect(JSON.stringify(preview)).not.toContain('personne privée');
    expect(JSON.stringify(preview)).not.toContain('secret_01');
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
