import type { RegistryAccessProjection } from '../domain/access.ts';
import { CARTULARY_MODEL_VERSION, type CartularyEnvelope, type CartularySectionDocument, type ProvenancedValue } from '../domain/cartulary.ts';
import type { CartularyFollowUpTodo, CartularyReminderDocument, FollowUpCategory, FollowUpSourceStatus } from '../domain/followUp.ts';
import type { RegistryItemProjection, RegistryValuationItemProjection } from '../domain/projections.ts';
import { presentationBundleThumbnailFor } from '../media/presentationDerivatives.ts';
import { DEMO_ACCOUNT, buildDemoCartularyAssets, demoCartularyContentById, type DemoCartularyDefinition } from './demoCartularies.ts';

export const DEMO_ASSERTED_AT = '2026-08-22T08:00:00.000Z';
/** Date fictive de la revue des cinq dossiers (enrichissement démo v2) : « Complet » dans le Registre. */
export const DEMO_REVIEWED_AT = '2026-09-01T09:00:00.000Z';

export const buildDemoAssetDocuments = (cartulary: DemoCartularyDefinition) => buildDemoCartularyAssets(cartulary).map((asset) => ({
  id: asset.id, cartularyId: cartulary.id, organizationId: DEMO_ACCOUNT.organizationId,
  mediaKind: asset.type, displayName: asset.name, tags: asset.tags || [],
  componentCode: asset.category || 'ensemble', capturedAt: asset.capturedAt || DEMO_ASSERTED_AT,
  visibility: 'secret', requestedVisibility: 'secret', projectionStatus: 'active',
  presentationDerivative: { url: asset.url, thumbnailUrl: asset.thumbnailUrl || asset.url },
  mimeDeclared: asset.mimeType || null, sourceRefs: [`source_${cartulary.id}`],
}));

export const demoValuationAmounts = (cartulary: DemoCartularyDefinition) => {
  const expenses = demoCartularyContentById(cartulary.id)?.expenses || [];
  const saleCostAmount = Math.round(cartulary.valuationMid * 0.1);
  return {
    purchasePrice: cartulary.purchasePrice,
    costBasis: cartulary.purchasePrice + expenses.reduce((sum, expense) => sum + expense.amount, 0),
    grossValuation: cartulary.valuationMid,
    saleCostAmount, taxAmount: 0,
    netValuation: Math.max(0, cartulary.valuationMid - saleCostAmount),
    netAfterTaxValuation: Math.max(0, cartulary.valuationMid - saleCostAmount),
  };
};

const sourceId = (cartulary: DemoCartularyDefinition) => `source_${cartulary.id}`;

const demoProvenance = <T,>(cartulary: DemoCartularyDefinition, value: T): ProvenancedValue<T> => ({
  value,
  proofStatus: 'declared',
  confidence: 'low',
  sourceRefs: [sourceId(cartulary)],
  observedAt: DEMO_ASSERTED_AT,
  assertedBy: 'demo:cartularia',
  visibility: 'secret',
});

export const buildDemoCartularySections = (cartulary: DemoCartularyDefinition): CartularySectionDocument[] => {
  const content = demoCartularyContentById(cartulary.id);
  if (!content) throw new Error(`Contenu de démonstration absent pour ${cartulary.id}.`);
  return [
  {
    id: 'identity.summary',
    schemaSectionId: 'cover.watch',
    schemaVersion: 'watch@1.6.0',
    title: 'Identité de la montre',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'cover.asset.type': demoProvenance(cartulary, 'Montre'),
      'cover.watch.brand': demoProvenance(cartulary, cartulary.brand),
      'cover.watch.model': demoProvenance(cartulary, cartulary.model),
      'cover.watch.reference': demoProvenance(cartulary, cartulary.reference),
      'cover.watch.status': demoProvenance(cartulary, 'Patrimonial'),
      'cover.privacy.userAlias': demoProvenance(cartulary, 'COLLECTIONNEUR-DEMO'),
    },
    revision: 1,
  },
  {
    id: 'ownership.history',
    schemaSectionId: 'cover.ownership_history',
    schemaVersion: 'watch@1.6.0',
    title: 'Historique de propriété fictif',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'cover.ownershipHistory.summary': demoProvenance(
        cartulary,
        content.ownershipHistory[0].description,
      ),
    },
    revision: 1,
  },
  {
    id: 'media.hero',
    schemaSectionId: 'media.hero',
    schemaVersion: 'watch@1.6.0',
    title: 'Présentation',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'media.hero.summary': demoProvenance(cartulary, cartulary.description),
    },
    revision: 1,
  },
  {
    id: 'watch.reference',
    schemaSectionId: 'reference.specifications',
    schemaVersion: 'watch@1.6.0',
    title: 'Spécifications de référence',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'reference.specifications[].label': cartulary.technicalSpecs.map((specification) => demoProvenance(cartulary, specification.label)),
      'reference.specifications[].value': cartulary.technicalSpecs.map((specification) => demoProvenance(cartulary, specification.value)),
    },
    extensions: {
      'demo.serialNumber': demoProvenance(cartulary, cartulary.serialNumber),
      'demo.caliber': demoProvenance(cartulary, cartulary.caliber),
      'demo.manufactureYear': demoProvenance(cartulary, cartulary.manufactureYear),
    },
    revision: 1,
  },
  {
    id: 'condition.description',
    schemaSectionId: 'condition.description',
    schemaVersion: 'watch@1.6.0',
    title: 'Description de l’état',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'condition.description.paragraphs[]': content.editableCopy.watchDescription.map((paragraph) => demoProvenance(cartulary, paragraph)),
    },
    revision: 1,
  },
  {
    id: 'condition.summary',
    schemaSectionId: 'condition.summary',
    schemaVersion: 'watch@1.6.0',
    title: 'Synthèse de condition',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'condition.summary.paragraphs[]': content.editableCopy.conditionSummary.map((paragraph) => demoProvenance(cartulary, paragraph)),
      'condition.summary.lastCondition': demoProvenance(cartulary, content.editableCopy.conditionFacts.lastCondition),
      'condition.summary.conclusion': demoProvenance(cartulary, content.editableCopy.conditionFacts.conclusion),
      'condition.summary.openPoint': demoProvenance(cartulary, content.editableCopy.conditionFacts.openPoint),
    },
    revision: 1,
  },
  {
    id: 'condition.documentation',
    schemaSectionId: 'condition.documentation',
    schemaVersion: 'watch@1.6.0',
    title: 'Documents fictifs inventoriés',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'condition.documentation[].category': content.documentation.map((document) => demoProvenance(cartulary, document.category)),
      'condition.documentation[].description': content.documentation.map((document) => demoProvenance(cartulary, document.description)),
      'condition.documentation[].state': content.documentation.map((document) => demoProvenance(cartulary, document.state)),
    },
    revision: 1,
  },
  {
    id: 'value.purchase',
    schemaSectionId: 'value.cost_basis',
    schemaVersion: 'watch@1.6.0',
    title: 'Acquisition fictive',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'value.purchase.date': demoProvenance(cartulary, cartulary.purchaseDate),
      'value.purchase.price': demoProvenance(cartulary, { amount: cartulary.purchasePrice, currency: cartulary.currency }),
      'value.expenses[].label': content.expenses.map((expense) => demoProvenance(cartulary, expense.label)),
      'value.expenses[].amount': content.expenses.map((expense) => demoProvenance(cartulary, { amount: expense.amount, currency: cartulary.currency })),
    },
    revision: 1,
  },
  {
    id: 'value.market',
    schemaSectionId: 'value.market_depth',
    schemaVersion: 'watch@1.6.0',
    title: 'Fourchette de démonstration',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'value.market.analysisDate': demoProvenance(cartulary, cartulary.valuationDate),
      'value.market.lowValue': demoProvenance(cartulary, { amount: cartulary.valuationLow, currency: cartulary.currency }),
      'value.market.midValue': demoProvenance(cartulary, { amount: cartulary.valuationMid, currency: cartulary.currency }),
      'value.market.highValue': demoProvenance(cartulary, { amount: cartulary.valuationHigh, currency: cartulary.currency }),
      'value.market.activeListings': demoProvenance(cartulary, content.marketDepth.activeListings),
      'value.market.transactions12m': demoProvenance(cartulary, content.marketDepth.transactions12m),
      'value.market.medianDaysOnMarket': demoProvenance(cartulary, content.marketDepth.medianDaysOnMarket),
      'value.market.valuations[].date': content.valuationHistory.map((entry) => demoProvenance(cartulary, entry.date)),
      'value.market.valuations[].midValue': content.valuationHistory.map((entry) => demoProvenance(cartulary, { amount: entry.midValue, currency: entry.currency })),
    },
    revision: 1,
  },
  {
    id: 'value.retained',
    schemaSectionId: 'value.retained_value',
    schemaVersion: 'watch@1.6.0',
    title: 'Valeur de travail fictive',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'value.retained.amount': demoProvenance(cartulary, { amount: cartulary.valuationMid, currency: cartulary.currency }),
      'value.retained.explanation': demoProvenance(cartulary, `${cartulary.sourceLabel}. Cette valeur n’est ni une expertise ni une offre.`),
    },
    revision: 1,
  },
  {
    id: 'publication.selection',
    schemaSectionId: 'publication.selection',
    schemaVersion: 'watch@1.6.0',
    title: 'Sélection de publication',
    visibility: 'secret',
    status: 'imported_unreviewed',
    fields: {
      'publication.status': demoProvenance(cartulary, 'Non publié · consentement requis'),
      'publication.collection': demoProvenance(cartulary, DEMO_ACCOUNT.collectionId),
      'publication.availableBlocks': demoProvenance(cartulary, 'Couverture, médias, référence, état, valorisation et rapport'),
    },
    revision: 1,
  },
  ];
};

export const buildDemoCartularyEnvelope = (
  cartulary: DemoCartularyDefinition,
  accountUid = 'demo-account',
  integrityHead = `sha256:${'0'.repeat(64)}`,
): CartularyEnvelope & ReturnType<typeof demoValuationAmounts> & { objectCode: string; valuationCurrency: string } => ({
  id: cartulary.id,
  organizationId: DEMO_ACCOUNT.organizationId,
  registryId: DEMO_ACCOUNT.registryId,
  collectionId: DEMO_ACCOUNT.collectionId,
  assetType: 'watch',
  schemaId: 'watch',
  schemaVersion: '1.6.0',
  publicCode: cartulary.publicCode,
  objectCode: cartulary.publicCode,
  valuationCurrency: cartulary.currency,
  ...demoValuationAmounts(cartulary),
  displayTitle: `${cartulary.brand} ${cartulary.model}`,
  makerName: cartulary.brand,
  modelName: cartulary.model,
  referenceCode: cartulary.reference,
  manufactureYear: cartulary.manufactureYear,
  accountHolderId: accountUid,
  legalOwnerRelationId: `owner_${cartulary.id}`,
  lifecycleStatus: 'active',
  possessionStatus: 'in_possession',
  defaultVisibility: 'secret',
  publicationStatus: 'none',
  primaryAssetId: buildDemoCartularyAssets(cartulary).find((asset) => asset.tags?.includes('main-photo'))?.id || null,
  completenessLevel: 'complete',
  lastVerifiedAt: DEMO_REVIEWED_AT,
  revision: 1,
  integrityHead,
  integritySequence: 0,
  modelVersion: CARTULARY_MODEL_VERSION,
  deletedAt: null,
});

/**
 * Vignette de projection Registre (contrat unique K3, kind 'bundle') : la plus petite variante WebP
 * du catalogue statique pour la photo principale. Lue par la Galerie et le Catalogue sans aucune
 * lecture d'actif ni de Storage ; posée par le seed complet et par la migration v3 (--data-only).
 */
export interface DemoRegistryItemThumbnail {
  kind: 'bundle';
  path: string;
  width: number;
  height: number;
  assetId: string;
  sha256: string;
}

export const buildDemoRegistryThumbnail = (cartulary: DemoCartularyDefinition): DemoRegistryItemThumbnail => {
  const primary = buildDemoCartularyAssets(cartulary).find((asset) => asset.tags?.includes('main-photo'));
  if (!primary) throw new Error(`Photo principale absente pour ${cartulary.id}.`);
  const thumbnail = presentationBundleThumbnailFor(primary.url);
  if (!thumbnail) throw new Error(`Dérivé statique absent du catalogue pour ${primary.url} : lancez node scripts/generate-presentation-derivatives.mjs.`);
  // Contrat K3 : l’empreinte d’une vignette d’item est préfixée (`sha256:<64 hex>`), le catalogue généré la porte nue.
  return { kind: 'bundle', path: thumbnail.path, width: thumbnail.width, height: thumbnail.height, assetId: primary.id, sha256: `sha256:${thumbnail.sha256}` };
};

export type DemoRegistryItemDocument = RegistryItemProjection & { thumbnail: DemoRegistryItemThumbnail };

export const buildDemoRegistryItem = (
  cartulary: DemoCartularyDefinition,
  contentHash: string,
): DemoRegistryItemDocument => ({
  cartularyId: cartulary.id,
  organizationId: DEMO_ACCOUNT.organizationId,
  registryId: DEMO_ACCOUNT.registryId,
  collectionId: DEMO_ACCOUNT.collectionId,
  collectionIds: [DEMO_ACCOUNT.collectionId],
  assetType: 'watch',
  displayTitle: `${cartulary.brand} ${cartulary.model}`,
  makerName: cartulary.brand,
  modelName: cartulary.model,
  referenceCode: cartulary.reference,
  manufactureYear: cartulary.manufactureYear,
  lifecycleStatus: 'active',
  patrimonialStatus: 'Patrimonial',
  userAlias: 'Collection Démo',
  objectCode: cartulary.publicCode,
  possessionStatus: 'in_possession',
  completenessLevel: 'complete',
  primaryAssetId: buildDemoCartularyAssets(cartulary).find((asset) => asset.tags?.includes('main-photo'))?.id || null,
  sourceRevision: 1,
  projectionStatus: 'active',
  contentHash,
  thumbnail: buildDemoRegistryThumbnail(cartulary),
});

export const buildDemoRegistryValuation = (
  cartulary: DemoCartularyDefinition,
  contentHash: string,
): RegistryValuationItemProjection => {
  const content = demoCartularyContentById(cartulary.id);
  if (!content) throw new Error(`Contenu de démonstration absent pour ${cartulary.id}.`);
  return {
    schemaVersion: 'registry-valuation@1.0.0',
    cartularyId: cartulary.id,
    organizationId: DEMO_ACCOUNT.organizationId,
    registryId: DEMO_ACCOUNT.registryId,
    collectionId: DEMO_ACCOUNT.collectionId,
    collectionIds: [DEMO_ACCOUNT.collectionId],
    assetType: 'watch',
    displayTitle: `${cartulary.brand} ${cartulary.model}`,
    marketValue: {
      amount: cartulary.valuationMid,
      currency: cartulary.currency,
      level: 'owner_declared',
      observedAt: cartulary.valuationDate,
      sourceLabel: 'Décision fictive du propriétaire de démonstration',
      confidence: 'low',
    },
    insuranceContracts: [{
      contractId: `contract_${cartulary.id}`,
      carrierLabel: content.insurance.insurer,
      contractReference: `DEMO-${cartulary.publicCode}`,
      insuredAmount: content.insurance.insuredValue,
      currency: content.insurance.currency,
      effectiveFrom: cartulary.valuationDate,
      effectiveTo: content.insurance.renewalDate,
      basisLabel: 'Capital assuré fictif déclaré',
      status: 'active',
    }],
    insuranceWarnings: [],
    eligibility: 'eligible',
    exclusionReasons: [],
    visibility: 'secret',
    sourceRevision: 1,
    projectionStatus: 'active',
    contentHash,
  };
};

/**
 * Rappel de démonstration conforme au contrat de firestore.rules (`cartularies/{id}/reminders`) :
 * clés exactement id, cartularyId, organizationId, title, dueAt, category, reminderStatus,
 * visibility, source, createdBy ; `createdAt`/`updatedAt` sont posés par l'écrivain.
 */
export interface DemoReminderDocument extends Required<Pick<CartularyReminderDocument, 'id' | 'cartularyId' | 'organizationId' | 'title' | 'visibility'>> {
  dueAt: string;
  category: FollowUpCategory;
  reminderStatus: FollowUpSourceStatus;
  source: 'registry';
  createdBy: string;
}

interface DemoReminderSeed { suffix: string; title: string; category: FollowUpCategory; dueAt: string; reminderStatus: FollowUpSourceStatus }

const DEMO_REMINDER_SEEDS: Record<string, DemoReminderSeed[]> = {
  cart_demo_rolex_submariner_124060: [
    { suffix: 'insurance', title: 'Renouveler l’attestation d’assurance fictive', category: 'insurance', dueAt: '2026-12-15', reminderStatus: 'planned' },
    { suffix: 'photos', title: 'Refaire les vues 360° fictives', category: 'visual_evidence', dueAt: '2026-08-20', reminderStatus: 'completed' },
  ],
  cart_demo_ap_royal_oak_15510st: [
    { suffix: 'service', title: 'Révision d’entretien fictive', category: 'maintenance', dueAt: '2027-03-31', reminderStatus: 'planned' },
  ],
  cart_demo_tudor_black_bay_chrono_79360n: [
    // Volontairement en retard pour montrer l'alerte « Échéances en retard » du Registre.
    { suffix: 'waterproof', title: 'Contrôle d’étanchéité fictif', category: 'maintenance', dueAt: '2026-06-30', reminderStatus: 'active' },
  ],
  cart_demo_jlc_reverso_tribute_q397848j: [
    { suffix: 'strap', title: 'Remplacer le bracelet fictif', category: 'custom', dueAt: '2027-01-20', reminderStatus: 'planned' },
  ],
  cart_demo_breguet_classique_5157bb: [
    { suffix: 'valuation', title: 'Actualiser la fourchette de valeur fictive', category: 'custom', dueAt: '2026-10-01', reminderStatus: 'dismissed' },
  ],
};

export const buildDemoReminderDocuments = (
  cartulary: DemoCartularyDefinition,
  accountUid = 'demo-account',
): DemoReminderDocument[] => (DEMO_REMINDER_SEEDS[cartulary.id] || []).map((seed) => ({
  id: `rem_demo_${cartulary.mediaSlug}_${seed.suffix}`,
  cartularyId: cartulary.id,
  organizationId: DEMO_ACCOUNT.organizationId,
  title: seed.title,
  dueAt: seed.dueAt,
  category: seed.category,
  reminderStatus: seed.reminderStatus,
  visibility: 'secret',
  source: 'registry',
  createdBy: accountUid,
}));

/** Tâches affichées dans le Cartulaire anonyme, sans lecture ni écriture Firestore. */
const DEMO_SUBMARINER_EXTRA_FOLLOW_UP_TODOS = [
  { id: 'todo-demo-service-2030', text: 'Révision en 2030', dueAt: '2030-01-01', category: 'maintenance', status: 'planned' },
  { id: 'todo-demo-final-invoice', text: 'Seule la facture pro forma est disponible dans les archives : récupérer la facture finale auprès de Rolex', dueAt: '', category: 'custom', status: 'planned' },
] satisfies CartularyFollowUpTodo[];

export const demoFollowUpTodosFor = (cartularyId: string): CartularyFollowUpTodo[] => [
  ...(DEMO_REMINDER_SEEDS[cartularyId] || []).map((seed) => ({
    id: `rem_demo_${cartularyId}_${seed.suffix}`,
    text: seed.title,
    dueAt: seed.dueAt,
    category: seed.category,
    status: seed.reminderStatus,
  })),
  ...(cartularyId === 'cart_demo_rolex_submariner_124060' ? DEMO_SUBMARINER_EXTRA_FOLLOW_UP_TODOS : []),
];

export const DEMO_SUBMARINER_FOLLOW_UP_TODOS = demoFollowUpTodosFor('cart_demo_rolex_submariner_124060');

/**
 * Projection d'accès de démonstration (`registries/{reg}/accesses/{id}`), même forme que celle
 * écrite par invitation-command.mjs, sans registryInvitations ni mail. Dates en ISO : l'écrivain
 * les convertit en Timestamp, calcule `contentHash` et pose `generatedAt`/`updatedAt`.
 * Domaine `.invalid` (RFC 2606) : aucune adresse réelle.
 */
export type DemoAccessDocument = Omit<RegistryAccessProjection, 'contentHash' | 'generatedAt' | 'updatedAt' | 'issuedAt' | 'expiresAt' | 'revokedAt' | 'lastConsultedAt'> & {
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastConsultedAt: string | null;
};

export const buildDemoAccessDocuments = (): DemoAccessDocument[] => {
  const common = { organizationId: DEMO_ACCOUNT.organizationId, registryId: DEMO_ACCOUNT.registryId, permissions: ['read'] as Array<'read'>, sourceRevision: 1, projectionStatus: 'active' as const };
  return [
    {
      id: 'acc_demo_invitation_expert', ...common,
      cartularyId: 'cart_demo_rolex_submariner_124060', collectionId: null, scopeType: 'cartulary', scopeId: 'cart_demo_rolex_submariner_124060',
      displayTitle: 'Rolex Submariner — avis d’un expert fictif', recipientLabel: 'e***@cartularia.invalid', recipientKind: 'person', accessKind: 'invitation',
      sourceStatus: 'pending', issuedAt: '2026-09-01T09:00:00.000Z', expiresAt: '2027-12-31T23:59:59.000Z', revokedAt: null, lastConsultedAt: null, consultationCount: 0,
    },
    {
      id: 'acc_demo_mandate_assureur', ...common,
      cartularyId: null, collectionId: DEMO_ACCOUNT.collectionId, scopeType: 'collection', scopeId: DEMO_ACCOUNT.collectionId,
      displayTitle: 'Les cinq icônes — mandat d’assurance fictif', recipientLabel: 'Assureur fictif Cartularia', recipientKind: 'organization', accessKind: 'mandate',
      // Sans échéance : reste « actif » quelle que soit la date de consultation.
      sourceStatus: 'active', issuedAt: '2026-08-25T10:00:00.000Z', expiresAt: null, revokedAt: null, lastConsultedAt: '2026-09-05T16:30:00.000Z', consultationCount: 3,
    },
    {
      id: 'acc_demo_link_revoked', ...common,
      cartularyId: 'cart_demo_breguet_classique_5157bb', collectionId: null, scopeType: 'cartulary', scopeId: 'cart_demo_breguet_classique_5157bb',
      displayTitle: 'Breguet Classique — lien révoqué', recipientLabel: 'Lien de consultation fictif', recipientKind: 'link', accessKind: 'shared_link',
      sourceStatus: 'revoked', issuedAt: '2026-07-10T08:00:00.000Z', expiresAt: '2026-08-10T08:00:00.000Z', revokedAt: '2026-07-20T18:00:00.000Z', lastConsultedAt: '2026-07-12T09:15:00.000Z', consultationCount: 1,
    },
  ];
};
