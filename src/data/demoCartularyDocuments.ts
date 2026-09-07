import { CARTULARY_MODEL_VERSION, type CartularyEnvelope, type CartularySectionDocument, type ProvenancedValue } from '../domain/cartulary.ts';
import type { RegistryItemProjection } from '../domain/projections.ts';
import { DEMO_ACCOUNT, buildDemoCartularyAssets, demoCartularyContentById, type DemoCartularyDefinition } from './demoCartularies.ts';

export const DEMO_ASSERTED_AT = '2026-08-22T08:00:00.000Z';

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
  completenessLevel: 'imported_unreviewed',
  lastVerifiedAt: null,
  revision: 1,
  integrityHead,
  integritySequence: 0,
  modelVersion: CARTULARY_MODEL_VERSION,
  deletedAt: null,
});

export const buildDemoRegistryItem = (
  cartulary: DemoCartularyDefinition,
  contentHash: string,
): RegistryItemProjection => ({
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
  purchasePrice: cartulary.purchasePrice,
  costBasis: demoValuationAmounts(cartulary).costBasis,
  grossValuation: demoValuationAmounts(cartulary).grossValuation,
  netValuation: demoValuationAmounts(cartulary).netValuation,
  netAfterTaxValuation: demoValuationAmounts(cartulary).netAfterTaxValuation,
  valuationCurrency: cartulary.currency,
  completenessLevel: 'imported_unreviewed',
  primaryAssetId: buildDemoCartularyAssets(cartulary).find((asset) => asset.tags?.includes('main-photo'))?.id || null,
  sourceRevision: 1,
  projectionStatus: 'active',
  contentHash,
});
