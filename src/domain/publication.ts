export const PUBLICATION_POLICY_VERSION = 'publication-policy-v2' as const;

export const PUBLISHED_BLOCK_IDS = [
  'cover-watch',
  'cover-owner',
  'cover-ownership-history',
  'cover-transmission',
  'cover-storage',
  'media-hero',
  'media-motion',
  'media-spin',
  'media-slideshow',
  'media-library',
  'reference-history',
  'reference-specs',
  'reference-checks',
  'reference-popularity',
  'condition-description',
  'condition-summary',
  'condition-documentation',
  'condition-reference-report',
  'condition-prior-reviews',
  'value-market',
  'value-comparables-listings',
  'value-comparables-transactions',
  'value-comparables-analysis',
  'value-cost-basis',
  'value-performance',
  'value-sensitivity',
] as const;

export type PublishedBlockId = typeof PUBLISHED_BLOCK_IDS[number];
export type PublicationDestination = 'website' | 'collection' | 'report' | 'community';
export type PublicationAction = 'activate' | 'validate' | 'revoke';
export type PublicationPrerequisiteId = 'brand' | 'model' | 'main-photo';

export interface PublicationBlockDefinition {
  id: PublishedBlockId;
  pageNumber: '00' | '01' | '02' | '03' | '04';
  pageLabel: string;
  title: string;
}

export const PUBLICATION_BLOCK_CATALOG: readonly PublicationBlockDefinition[] = [
  { id: 'cover-watch', pageNumber: '00', pageLabel: 'Accueil', title: "Accueil de l’objet" },
  { id: 'cover-owner', pageNumber: '00', pageLabel: 'Accueil', title: 'Propriétaire' },
  { id: 'cover-ownership-history', pageNumber: '00', pageLabel: 'Accueil', title: "Histoire de l’objet" },
  { id: 'cover-transmission', pageNumber: '00', pageLabel: 'Accueil', title: 'Transmission' },
  { id: 'cover-storage', pageNumber: '00', pageLabel: 'Accueil', title: 'Stockage' },
  { id: 'media-hero', pageNumber: '01', pageLabel: 'Médias', title: 'Présentation principale' },
  { id: 'media-motion', pageNumber: '01', pageLabel: 'Médias', title: "L’objet en mouvement" },
  { id: 'media-spin', pageNumber: '01', pageLabel: 'Médias', title: 'Revue à 360°' },
  { id: 'media-slideshow', pageNumber: '01', pageLabel: 'Médias', title: 'Diaporama' },
  { id: 'media-library', pageNumber: '01', pageLabel: 'Médias', title: 'Bibliothèque média' },
  { id: 'reference-history', pageNumber: '02', pageLabel: 'La référence', title: 'Origines' },
  { id: 'reference-specs', pageNumber: '02', pageLabel: 'La référence', title: 'Spécifications de la référence' },
  { id: 'reference-checks', pageNumber: '02', pageLabel: 'La référence', title: 'Points à contrôler' },
  { id: 'reference-popularity', pageNumber: '02', pageLabel: 'La référence', title: 'Popularité du modèle' },
  { id: 'condition-description', pageNumber: '03', pageLabel: "L’objet", title: "Description de l’objet" },
  { id: 'condition-summary', pageNumber: '03', pageLabel: "L’objet", title: 'État actuel' },
  { id: 'condition-documentation', pageNumber: '03', pageLabel: "L’objet", title: 'Papiers, documentation et accessoires' },
  { id: 'condition-reference-report', pageNumber: '03', pageLabel: "L’objet", title: "Rapport sur l’état de l’objet" },
  { id: 'condition-prior-reviews', pageNumber: '03', pageLabel: "L’objet", title: 'Revues antérieures' },
  { id: 'value-market', pageNumber: '04', pageLabel: 'Valorisation', title: 'Données de marché' },
  { id: 'value-comparables-listings', pageNumber: '04', pageLabel: 'Valorisation', title: 'Annonces en cours' },
  { id: 'value-comparables-transactions', pageNumber: '04', pageLabel: 'Valorisation', title: 'Transactions réalisées' },
  { id: 'value-comparables-analysis', pageNumber: '04', pageLabel: 'Valorisation', title: "Synthèse de l’analyse" },
  { id: 'value-cost-basis', pageNumber: '04', pageLabel: 'Valorisation', title: 'Prix de revient' },
  { id: 'value-performance', pageNumber: '04', pageLabel: 'Valorisation', title: 'Plus-value, moins-value et TRI' },
  { id: 'value-sensitivity', pageNumber: '04', pageLabel: 'Valorisation', title: 'Prix de vente et coût de cession' },
];

// Must remain aligned with scripts/lib/projection-command.mjs. The server still
// performs the authoritative recursive inspection of every projected payload.
export const WEBSITE_BLOCK_ALLOWLIST: readonly PublishedBlockId[] = [
  'cover-watch',
  'media-hero',
  'media-motion',
  'media-spin',
  'media-slideshow',
  'media-library',
  'reference-history',
  'reference-specs',
  'reference-checks',
  'reference-popularity',
  'condition-description',
  'condition-summary',
  'condition-reference-report',
  'condition-prior-reviews',
];

const COMMUNITY_FORBIDDEN_BLOCKS: readonly PublishedBlockId[] = [
  'cover-owner',
  'cover-ownership-history',
  'cover-transmission',
  'cover-storage',
  'value-cost-basis',
  'value-performance',
];

const NON_PROJECTABLE_PERSONAL_BLOCKS: readonly PublishedBlockId[] = [
  'cover-owner',
  'cover-transmission',
  'cover-storage',
];

export interface PublicationMainPhoto {
  id: string;
  type: string;
  status: string;
  visibility: 'Secret' | 'Communauté' | 'Tous';
  url?: string;
  binaryId?: string;
}

export interface PublicationPrerequisite {
  id: PublicationPrerequisiteId;
  label: string;
  satisfied: boolean;
  detail: string;
}

export interface PublicationEligibility {
  isEligible: boolean;
  prerequisites: PublicationPrerequisite[];
  missing: PublicationPrerequisiteId[];
}

export interface PublicationPolicyResult {
  allowed: boolean;
  reason: string;
}

export interface PublicationDecision {
  requestId: string;
  destination: PublicationDestination;
  blockId: PublishedBlockId;
  blockLabel: string;
  action: PublicationAction;
  status: 'confirmed';
  decisionSource: 'human_confirmed';
  decidedAt: string;
  sourceRevision: number;
  sourceDigest: string;
  policyVersion: typeof PUBLICATION_POLICY_VERSION;
  prerequisites: PublicationPrerequisite[];
}

export const destinationLabel = (destination: PublicationDestination) => (
  destination === 'website' ? 'publication extérieure du Cartulaire'
    : destination === 'collection' ? 'Collection'
    : destination === 'report' ? 'rapport PDF'
      : 'Cercle'
);

export const destinationMarker = (destination: PublicationDestination) => (
  destination === 'website' ? 'Cartulaire' : destination === 'collection' ? 'Collection' : destination === 'report' ? 'PDF' : 'Cercle'
);

export const evaluatePublicationEligibility = ({
  brand,
  model,
  mainPhoto,
  destination,
}: {
  brand: string;
  model: string;
  mainPhoto?: PublicationMainPhoto;
  destination: PublicationDestination;
}): PublicationEligibility => {
  const normalizedBrand = brand.trim();
  const normalizedModel = model.trim();
  const photoIsDurable = Boolean(
    mainPhoto
    && mainPhoto.type === 'image'
    && mainPhoto.status === 'Archived'
    && (mainPhoto.binaryId || mainPhoto.url),
  );
  const photoVisibilityAllowed = destination === 'website' || destination === 'collection'
    ? mainPhoto?.visibility === 'Tous'
    : destination === 'community'
      ? mainPhoto?.visibility !== 'Secret'
      : Boolean(mainPhoto);
  const photoSatisfied = photoIsDurable && photoVisibilityAllowed;
  const destinationVisibility = destination === 'website' || destination === 'collection'
    ? 'visible par Tous'
    : destination === 'community'
      ? 'visible par la Communauté ou Tous'
      : 'archivée dans le dossier privé';

  const prerequisites: PublicationPrerequisite[] = [
    {
      id: 'brand',
      label: 'Marque',
      satisfied: normalizedBrand.length > 0,
      detail: normalizedBrand || 'Non renseignée',
    },
    {
      id: 'model',
      label: 'Modèle',
      satisfied: normalizedModel.length > 0,
      detail: normalizedModel || 'Non renseigné',
    },
    {
      id: 'main-photo',
      label: 'Photo principale',
      satisfied: photoSatisfied,
      detail: photoSatisfied
        ? `${mainPhoto?.id ?? 'photo'} · ${destinationVisibility}`
        : `Image principale archivée requise, ${destinationVisibility}`,
    },
  ];

  return {
    isEligible: prerequisites.every((item) => item.satisfied),
    prerequisites,
    missing: prerequisites.filter((item) => !item.satisfied).map((item) => item.id),
  };
};

export const getPublicationPolicy = (
  destination: PublicationDestination,
  blockId: PublishedBlockId,
): PublicationPolicyResult => {
  if (NON_PROJECTABLE_PERSONAL_BLOCKS.includes(blockId)) {
    return { allowed: false, reason: 'Ce bloc reste limité au Cartulaire privé ou au Coffre personnel séparé.' };
  }
  if (destination === 'report') {
    return { allowed: true, reason: 'Le rapport PDF reste une projection privée du propriétaire.' };
  }
  if (destination === 'website' || destination === 'collection') {
    return WEBSITE_BLOCK_ALLOWLIST.includes(blockId)
      ? { allowed: true, reason: 'Bloc admis pour cette publication ; le contenu reste contrôlé côté serveur.' }
      : { allowed: false, reason: 'Ce bloc est exclu de cette publication.' };
  }
  return COMMUNITY_FORBIDDEN_BLOCKS.includes(blockId)
    ? { allowed: false, reason: 'Ce bloc contient des données privées incompatibles avec une projection Cercle.' }
    : { allowed: true, reason: 'Bloc admissible pour une projection Cercle filtrée côté serveur.' };
};

const latestDecision = (
  decisions: readonly PublicationDecision[],
  destination: PublicationDestination,
  blockId: PublishedBlockId,
): PublicationDecision | null => {
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index];
    if (decision.destination === destination && decision.blockId === blockId) return decision;
  }
  return null;
};

export const isSelectionValidated = ({
  selected,
  destination,
  blockId,
  decisions,
  sourceDigest,
  sourceRevision,
}: {
  selected: boolean;
  destination: PublicationDestination;
  blockId: PublishedBlockId;
  decisions: readonly PublicationDecision[];
  sourceDigest: string;
  sourceRevision: number;
}) => {
  if (!selected || !sourceDigest || !getPublicationPolicy(destination, blockId).allowed) return false;
  const decision = latestDecision(decisions, destination, blockId);
  return Boolean(
    decision
    && decision.action !== 'revoke'
    && decision.status === 'confirmed'
    && decision.decisionSource === 'human_confirmed'
    && decision.sourceDigest === sourceDigest
    && decision.sourceRevision === sourceRevision
    && decision.prerequisites.every((item) => item.satisfied),
  );
};

export const validatedBlockIds = (
  selectedBlocks: readonly PublishedBlockId[],
  destination: PublicationDestination,
  decisions: readonly PublicationDecision[],
  sourceDigest: string,
  sourceRevision: number,
): PublishedBlockId[] => PUBLISHED_BLOCK_IDS.filter((blockId) => isSelectionValidated({
  selected: selectedBlocks.includes(blockId),
  destination,
  blockId,
  decisions,
  sourceDigest,
  sourceRevision,
}));

export const publicationActionFor = ({ selected, validated }: { selected: boolean; validated: boolean }): PublicationAction => (
  selected ? (validated ? 'revoke' : 'validate') : 'activate'
);

export const applyPublicationDecision = (
  selectedBlocks: readonly PublishedBlockId[],
  decision: Pick<PublicationDecision, 'action' | 'blockId'>,
): PublishedBlockId[] => {
  if (decision.action === 'revoke') return selectedBlocks.filter((blockId) => blockId !== decision.blockId);
  return selectedBlocks.includes(decision.blockId) ? [...selectedBlocks] : [...selectedBlocks, decision.blockId];
};

export const filterRequestedWebsiteBlocks = (
  requestedBlocks: readonly PublishedBlockId[],
  validatedWebsiteBlocks: readonly PublishedBlockId[],
): PublishedBlockId[] => PUBLISHED_BLOCK_IDS.filter((blockId) => (
  requestedBlocks.includes(blockId)
  && validatedWebsiteBlocks.includes(blockId)
  && WEBSITE_BLOCK_ALLOWLIST.includes(blockId)
));
