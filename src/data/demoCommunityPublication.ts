import type { LoadedCommunityPublication } from '../domain/community.ts';

export const DEMO_SUBMARINER_COMMUNITY_PUBLICATION_ID = 'community_demo_rolex_submariner_124060';

/** Projection locale fictive réservée au compte démo ; elle ne lit jamais le Cartulaire maître. */
export const DEMO_SUBMARINER_COMMUNITY_PUBLICATION: LoadedCommunityPublication = {
  publication: {
    publicationId: DEMO_SUBMARINER_COMMUNITY_PUBLICATION_ID,
    audience: 'community',
    assetType: 'watch',
    schemaVersion: 'watch@1.6.0',
    displayTitle: 'Rolex Submariner 124060 · démonstration fictive',
    makerName: 'Rolex',
    modelName: 'Submariner',
    referenceCode: '124060',
    status: 'published',
    publicationStatus: 'published',
    moderationStatus: 'approved',
    sourceRevision: 1,
    blockIds: ['cover-watch', 'reference-summary'],
    contentHash: `sha256:${'c'.repeat(64)}`,
    publishedAtIso: '2026-09-23T08:00:00.000Z',
  },
  blocks: [
    {
      publicationId: DEMO_SUBMARINER_COMMUNITY_PUBLICATION_ID,
      blockId: 'cover-watch',
      title: 'Identité partagée',
      order: 0,
      audience: 'community',
      fields: {
        'cover.asset.type': 'Montre',
        'cover.watch.brand': 'Rolex',
        'cover.watch.model': 'Submariner',
        'cover.watch.reference': '124060',
      },
      fieldIds: ['cover.asset.type', 'cover.watch.brand', 'cover.watch.model', 'cover.watch.reference'],
      sourceRevision: 1,
      contentHash: `sha256:${'a'.repeat(64)}`,
    },
    {
      publicationId: DEMO_SUBMARINER_COMMUNITY_PUBLICATION_ID,
      blockId: 'reference-summary',
      title: 'Référence',
      order: 1,
      audience: 'community',
      fields: {
        'reference.specifications[].label': ['Boîtier', 'Mouvement', 'Étanchéité'],
        'reference.specifications[].value': ['Oystersteel · 41 mm', 'Calibre 3230 automatique', '300 m'],
      },
      fieldIds: ['reference.specifications[].label', 'reference.specifications[].value'],
      sourceRevision: 1,
      contentHash: `sha256:${'b'.repeat(64)}`,
    },
  ],
};
