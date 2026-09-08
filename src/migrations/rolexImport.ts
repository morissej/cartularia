import { CARTULARY_MODEL_VERSION, type CartularyImportBundle, type CartularySectionDocument } from '../domain/cartulary.ts';
import { ROLEX_CARTULARY_ID } from '../domain/cartularyIds.ts';
import type { WatchCartularyCreationProfile } from '../domain/cartularyCreation.ts';
import { importedProvenance } from './importHelpers.ts';

/**
 * Dossier Rolex GMT-Master 1675 « Long E » : données de démonstration du pilote.
 * Ce module est une fixture de seed (ADR-029). L'application ne l'importe jamais à l'exécution :
 * le Cartulaire Rolex est lu comme n'importe quel autre, depuis `cartularies/{id}` et le brouillon
 * privé écrit par `scripts/import-rolex-cartulary.mjs`.
 */
export { ROLEX_CARTULARY_ID };
export const ROLEX_IMPORT_REQUEST_ID = 'adr029-import-rolex-v1';
export const ROLEX_IMPORT_SOURCE_ID = 'source_owner_dossier_rolex';
export const ROLEX_IMPORT_ACTOR_ID = 'wave1-owner';
export const ROLEX_IMPORT_DATE = '2026-08-16T00:00:00.000Z';
export const ROLEX_PUBLIC_CODE = 'ROL-487D9CAD';
const ORGANIZATION_ID = 'org_demo';
const REGISTRY_ID = 'reg_collection_privee';
const COLLECTION_ID = 'col_pilots';
const SCHEMA_VERSION = 'watch@1.6.0';

export const ROLEX_CREATION_PROFILE: WatchCartularyCreationProfile = {
  profileVersion: '1.0.0',
  assetType: 'watch',
  schemaId: 'watch',
  schemaVersion: '1.6.0',
  collectionId: COLLECTION_ID,
  brand: 'Rolex',
  model: 'GMT-Master Mark I Long E',
  reference: '1675',
  manufactureYear: 1969,
  serialNumber: '1 982 530',
  caliber: 'Rolex 1575',
  description: 'Rolex GMT-Master réf. 1675 de 1969, cadran mat Mark I « Long E », insert Pepsi fuchsia et bracelet Jubilee.',
  conditionSummary: 'État déclaré par le propriétaire et le vendeur. L’authenticité, la configuration, le niveau de polissage et l’étanchéité restent à confirmer par une revue indépendante.',
  purchaseDate: '2026-07-23',
  purchasePrice: 21_900,
  currency: 'EUR',
  seller: 'L’Atelier du Temps',
  valuationDate: '2026-08-16',
  valuationLow: 21_000,
  valuationMid: 23_000,
  valuationHigh: 25_000,
  sourceLabel: 'Dossier Rolex transmis par le propriétaire · données à revoir',
  assertedAt: ROLEX_IMPORT_DATE,
};

const provenance = <T>(value: T) => importedProvenance({
  value,
  sourceId: ROLEX_IMPORT_SOURCE_ID,
  observedAt: ROLEX_IMPORT_DATE,
  assertedBy: ROLEX_IMPORT_ACTOR_ID,
});

const profile = ROLEX_CREATION_PROFILE;
const money = (amount: number) => ({ amount, currency: profile.currency });

const section = (id: string, schemaSectionId: string, title: string, fields: Record<string, unknown>, extensions?: Record<string, unknown>): CartularySectionDocument => ({
  id, schemaSectionId, schemaVersion: SCHEMA_VERSION, title, visibility: 'secret', status: 'imported_unreviewed', fields, ...(extensions ? { extensions } : {}), revision: 1,
});

/** Mêmes sections et identifiants de champs que la création depuis le Registre (`buildCreationBundle`). */
export const buildRolexImportBundle = (): CartularyImportBundle => ({
  envelope: {
    id: ROLEX_CARTULARY_ID,
    organizationId: ORGANIZATION_ID,
    registryId: REGISTRY_ID,
    collectionId: COLLECTION_ID,
    assetType: 'watch',
    schemaId: 'watch',
    schemaVersion: '1.6.0',
    publicCode: ROLEX_PUBLIC_CODE,
    displayTitle: `${profile.brand} ${profile.model}`,
    makerName: profile.brand,
    modelName: profile.model,
    referenceCode: profile.reference,
    manufactureYear: profile.manufactureYear,
    accountHolderId: ROLEX_IMPORT_ACTOR_ID,
    legalOwnerRelationId: 'owner_relation_rolex_current',
    lifecycleStatus: 'review',
    possessionStatus: 'in_possession',
    defaultVisibility: 'secret',
    publicationStatus: 'none',
    primaryAssetId: null,
    completenessLevel: 'imported_unreviewed',
    lastVerifiedAt: null,
    revision: 1,
    integrityHead: '',
    integritySequence: 0,
    modelVersion: CARTULARY_MODEL_VERSION,
    deletedAt: null,
  },
  sections: [
    section('identity.summary', 'cover.watch', 'Identité de l’objet', {
      'cover.asset.type': provenance('Montre'),
      'cover.watch.brand': provenance(profile.brand),
      'cover.watch.model': provenance(profile.model),
      'cover.watch.reference': provenance(profile.reference),
      'cover.watch.status': provenance('Patrimonial'),
    }),
    section('ownership.history', 'cover.ownership_history', "Historique de l'objet - Propriétaires précédents", {}),
    section('watch.reference', 'reference.specifications', 'Spécifications de référence', {
      'reference.specifications[].label': [provenance('Année de fabrication'), provenance('Calibre')],
      'reference.specifications[].value': [provenance(String(profile.manufactureYear)), provenance(profile.caliber)],
    }),
    { ...section('watch.instance.private', 'watch.instance.private', 'Identité confidentielle de l’exemplaire', {}, { 'watch.serialNumber': provenance(profile.serialNumber) }), status: 'imported_unmapped' },
    section('condition.description', 'condition.description', 'Description de l’objet', { 'condition.description.paragraphs[]': [provenance(profile.description)] }),
    section('condition.summary', 'condition.summary', 'État déclaré', {
      'condition.summary.paragraphs[]': [provenance(profile.conditionSummary)],
      'condition.summary.conclusion': provenance('État déclaré lors de la création ; revue humaine requise.'),
      'condition.summary.openPoint': provenance('Authenticité, configuration et état à confirmer à partir des pièces versées.'),
    }),
    section('value.purchase', 'value.cost_basis', 'Acquisition', {
      'value.purchase.date': provenance(profile.purchaseDate),
      'value.purchase.price': provenance(money(profile.purchasePrice!)),
    }, { 'value.purchase.seller': provenance(profile.seller) }),
    section('value.market-depth', 'value.market_depth', 'Fourchette de marché déclarée', {
      'value.market.analysisDate': provenance(profile.valuationDate),
      'value.market.lowValue': provenance(money(profile.valuationLow!)),
      'value.market.midValue': provenance(money(profile.valuationMid!)),
      'value.market.highValue': provenance(money(profile.valuationHigh!)),
    }),
    section('value.retained', 'value.retained_value', 'Valeur de travail', {
      'value.retained.amount': provenance(money(profile.valuationMid!)),
      'value.retained.explanation': provenance('Valeur déclarée lors de la création ; sources et méthode à revalider.'),
    }),
  ],
  sources: [{
    id: ROLEX_IMPORT_SOURCE_ID,
    kind: 'project_document',
    label: profile.sourceLabel,
    locator: `privateDrafts/${ROLEX_IMPORT_ACTOR_ID}/cartularies/${ROLEX_CARTULARY_ID}`,
    proofStatus: 'unverified',
    visibility: 'secret',
  }],
  assets: [],
  spinSets: [],
  observations: [],
  valuations: [{
    id: 'valuation_initial',
    cartularyId: ROLEX_CARTULARY_ID,
    observedAt: ROLEX_IMPORT_DATE,
    lowValue: profile.valuationLow!,
    midValue: profile.valuationMid!,
    highValue: profile.valuationHigh!,
    currency: profile.currency,
    sourceLabel: profile.sourceLabel,
    sourceRefs: [ROLEX_IMPORT_SOURCE_ID],
    proofStatus: 'unverified',
    confidence: 'low',
    visibility: 'secret',
    reviewStatus: 'pending_human_review',
  }],
  comparables: ROLEX_COMPARABLES.map((comparable) => ({
    id: comparable.id,
    cartularyId: ROLEX_CARTULARY_ID,
    observedAt: `${comparable.date}T00:00:00.000Z`,
    channel: comparable.channel,
    description: comparable.description,
    amount: comparable.amount,
    currency: comparable.currency,
    condition: comparable.condition,
    sourceType: comparable.sourceType,
    saleChannel: comparable.saleChannel,
    sourceLabel: comparable.source,
    sourceRefs: [ROLEX_IMPORT_SOURCE_ID],
    proofStatus: 'unverified',
    confidence: 'low',
    visibility: 'secret',
    reviewStatus: 'pending_human_review',
  })),
  reports: [],
  reminders: [],
  ownerRelations: [{
    id: 'owner_relation_rolex_current',
    cartularyId: ROLEX_CARTULARY_ID,
    organizationId: ORGANIZATION_ID,
    userId: ROLEX_IMPORT_ACTOR_ID,
    relationType: 'legal_owner',
    status: 'pending_evidence',
    validFrom: ROLEX_IMPORT_DATE,
    validUntil: null,
    proofStatus: 'unverified',
    sourceRefs: [ROLEX_IMPORT_SOURCE_ID],
    visibility: 'secret',
  }],
  events: [{
    id: 'event_rolex_imported',
    cartularyId: ROLEX_CARTULARY_ID,
    organizationId: ORGANIZATION_ID,
    eventType: 'migration.imported',
    occurredAt: ROLEX_IMPORT_DATE,
    actorId: ROLEX_IMPORT_ACTOR_ID,
    summary: 'Import technique du dossier Rolex du pilote, auparavant codé dans l’application (ADR-029).',
    sourceRefs: [ROLEX_IMPORT_SOURCE_ID],
    proofStatus: 'unverified',
    visibility: 'secret',
  }],
});

export const ROLEX_COMPARABLES = [
  { id: 'rolex-comparable-17000', date: '2026-08-16', channel: 'Chrono24', description: 'Rolex GMT-Master 1675 Long E · annonce observée dans le dossier', amount: 17_000, currency: 'EUR', condition: 'À vérifier', sourceType: 'Annonce', source: 'Chrono24 · prix affiché documenté dans le dossier', saleChannel: 'Annonce' },
  { id: 'rolex-comparable-16958', date: '2026-08-16', channel: 'Chrono24', description: 'Rolex GMT-Master 1675 Long E · annonce observée dans le dossier', amount: 16_958, currency: 'EUR', condition: 'À vérifier', sourceType: 'Annonce', source: 'Chrono24 · prix affiché documenté dans le dossier', saleChannel: 'Annonce' },
  { id: 'rolex-comparable-21774', date: '2026-08-16', channel: 'Chrono24', description: 'Rolex GMT-Master 1675 Long E · exemplaire annoncé full set', amount: 21_774, currency: 'EUR', condition: 'Full set déclaré', sourceType: 'Annonce', source: 'Chrono24 · prix affiché documenté dans le dossier', saleChannel: 'Annonce' },
] as const;

const specificationValues: Record<string, string> = {
  'ad-code': `Non applicable · dossier ${ROLEX_PUBLIC_CODE}`,
  brand: profile.brand, collection: 'GMT-Master', model: profile.model, reference: profile.reference,
  movement: 'Remontage automatique', case: 'Acier inoxydable', bracelet: 'Acier', year: String(profile.manufactureYear),
  condition: 'Voir 03 · L’objet', delivered: 'Montre et bracelet Jubilee · accessoires à documenter', gender: 'Montre homme / Unisexe',
  location: 'Accès restreint', price: 'Voir 04 · Valorisation', availability: 'Collection privée · non proposée à la vente',
  'cal-movement': 'Remontage automatique', caliber: profile.caliber, 'base-caliber': 'Rolex 1570 · pont pouvant être marqué 1570', 'power-reserve': 'À documenter', jewels: '26',
  'case-material': 'Acier inoxydable', diameter: 'À documenter', height: 'À documenter', water: 'À documenter',
  bezel: 'Insert aluminium Pepsi fuchsia déclaré', crystal: 'Plexiglas', dial: 'Voir la fiche de référence', numerals: 'Index appliqués au tritium',
  'strap-material': 'Acier', 'strap-color': 'Acier', clasp: 'Boucle déployante Rolex · référence à documenter', 'clasp-material': 'Acier',
  date: 'Guichet à 3 heures · réglage non rapide', gmt: 'Aiguille GMT 24 heures', timezone: 'Lunette bidirectionnelle 24 heures',
  seconds: 'Selon la configuration de référence', crown: 'Couronne Rolex déclarée d’origine', caseback: 'Selon la configuration de référence',
};

const SPECIFICATION_GROUPS: Array<{ id: string; title: string; items: Array<[string, string]> }> = [
  { id: 'basic', title: 'Données de base', items: [['ad-code', 'Code annonce'], ['brand', 'Marque'], ['collection', 'Collection'], ['model', 'Modèle'], ['reference', 'Numéro de référence'], ['movement', 'Mouvement'], ['case', 'Boîtier'], ['bracelet', 'Matière du bracelet'], ['year', 'Année de fabrication'], ['condition', 'État'], ['delivered', 'Contenu livré'], ['gender', 'Sexe'], ['location', 'Emplacement'], ['price', 'Prix'], ['availability', 'Disponibilité']] },
  { id: 'caliber', title: 'Calibre', items: [['cal-movement', 'Mouvement'], ['caliber', 'Calibre'], ['base-caliber', 'Calibre de base'], ['power-reserve', 'Réserve de marche'], ['jewels', 'Nombre de pierres']] },
  { id: 'case', title: 'Boîtier', items: [['case-material', 'Boîtier'], ['diameter', 'Diamètre'], ['height', 'Hauteur'], ['water', 'Étanche'], ['bezel', 'Matériau de la lunette'], ['crystal', 'Verre'], ['dial', 'Cadran'], ['numerals', 'Chiffres du cadran']] },
  { id: 'bracelet', title: 'Bracelet', items: [['strap-material', 'Matière du bracelet'], ['strap-color', 'Couleur du bracelet'], ['clasp', 'Boucle'], ['clasp-material', 'Matière de la boucle']] },
  { id: 'functions', title: 'Fonctions', items: [['date', 'Date'], ['gmt', 'GMT'], ['timezone', 'Second fuseau horaire']] },
  { id: 'other', title: 'Autres', items: [['seconds', 'Seconde'], ['crown', 'Couronne'], ['caseback', 'Fond']] },
];

/**
 * État du brouillon privé lu par le Cartulaire complet. Ces valeurs étaient auparavant des branches
 * `isRolexCartulary` dans `src/App.tsx` et `src/data/activeCartulary.ts`.
 */
export const buildRolexDossierState = (): Map<string, unknown> => new Map<string, unknown>([
  ['cartularia-creation-profile', profile],
  ['cartularia-public-code', ROLEX_PUBLIC_CODE],
  ['cartularia-watch-status', 'Patrimonial'],
  ['cartularia-specification-groups', SPECIFICATION_GROUPS.map((group) => ({ id: group.id, title: group.title, items: group.items.map(([id, label]) => ({ id, label, value: specificationValues[id] })) }))],
  ['cartularia-identification-checks', [
    { id: 'dial-long-e', title: 'Cadran mat Mark I « Long E »', note: 'Typographie du E de ROLEX, couronne fine et marquage SWISS – T < 25 à contrôler sur les vues macro.', checked: false },
    { id: 'serial-period', title: 'Série et millésime 1969', note: `Numéro ${profile.serialNumber} à rapprocher de la période de production de la référence 1675.`, checked: false },
    { id: 'case-geometry', title: 'Boîtier et protège-couronne', note: 'Géométrie du boîtier, épaisseur des cornes, arêtes et éventuelles reprises de polissage à examiner.', checked: false },
    { id: 'fuchsia-insert', title: 'Insert Pepsi fuchsia', note: 'Insert déclaré d’époque ; teinte, typographie, usure et cohérence avec le millésime doivent être revues.', checked: false },
    { id: 'caliber-1575', title: 'Calibre Rolex 1575', note: 'Mouvement, pont marqué 1570 le cas échéant, numéro et fonctionnement GMT à confirmer montre ouverte.', checked: false },
    { id: 'bracelet-jubilee', title: 'Bracelet Jubilee', note: 'Références de bracelet et d’end-links, date de fermoir, allongement et cohérence avec la montre à documenter.', checked: false },
  ]],
  ['cartularia-documentation-items', [
    { id: 'doc-purchase', category: 'Facture', description: `Acquisition du ${profile.purchaseDate} auprès de ${profile.seller}. Pièce à identifier dans les documents importés.`, state: 'À vérifier' },
    { id: 'doc-seller', category: 'Garantie', description: 'Garantie vendeur de cinq ans déclarée dans le dossier. Étendue et conditions à confirmer.', state: 'À vérifier' },
    { id: 'doc-box', category: 'Boîte', description: 'Boîte et accessoires non confirmés à ce stade.', state: 'À vérifier' },
    { id: 'doc-expertise', category: 'Certificat', description: 'Notes d’expertise et sources de marché importées ; revue humaine requise avant validation.', state: 'À vérifier' },
  ]],
  ['cartularia-comparable-analysis', [
    { id: 'analysis-listings', angle: 'Prix affichés', finding: '16 958 € à 21 774 €', reading: 'Trois annonces 1969 relevées dans le dossier. Ce sont des prix demandés, non des transactions réalisées.' },
    { id: 'analysis-pivot', angle: 'Niveau de travail', finding: '21 000 € à 25 000 €', reading: 'Fourchette de travail pour l’exemplaire déclaré, à revalider après contrôle du cadran, de l’insert, du boîtier et du bracelet.' },
    { id: 'analysis-liquidity', angle: 'Liquidité', finding: 'Marché international', reading: 'La profondeur observée facilite la comparaison, mais la dispersion des configurations vintage impose une sélection stricte.' },
    { id: 'analysis-premium', angle: 'Facteurs de prime', finding: 'Long E · fuchsia · patine', reading: 'Ces caractéristiques ne justifient une prime qu’après confirmation de leur authenticité et de leur cohérence.' },
  ]],
  ['cartularia-comparables', ROLEX_COMPARABLES.map((comparable) => ({ ...comparable }))],
  ['cartularia-editable-copy', {
    originTitle: 'La référence qui a défini la GMT vintage',
    heroSummary: profile.description,
    originParagraphs: [
      'La GMT-Master référence 1675 appartient à la génération vintage produite par Rolex de la fin des années 1950 au début des années 1980. Son aiguille 24 heures et sa lunette graduée permettent la lecture d’un second fuseau horaire.',
      'Le présent dossier décrit un exemplaire de 1969 avec cadran mat Mark I dit « Long E ». Cette qualification repose sur la typographie du mot ROLEX et doit être confirmée sur les vues macro versées au Cartulaire.',
      'L’insert Pepsi à décoloration fuchsia, le tritium à patine coquille d’œuf et le bracelet Jubilee sont déclarés dans les pièces sources. Leur période, leur authenticité et leur association à l’exemplaire restent soumises à revue.',
    ],
    originKnowledge: 'Sur une 1675 vintage, la valeur dépend fortement du cadran, de l’insert, de la géométrie du boîtier, du mouvement et de la cohérence du bracelet. Toute conclusion doit être rattachée à une preuve datée.',
    watchDescription: [
      profile.description,
      `L’exemplaire porte le numéro de série ${profile.serialNumber} et est présenté sur bracelet Jubilee déclaré d’origine. Le calibre indiqué au dossier est le ${profile.caliber}.`,
    ],
    conditionSummary: [
      profile.conditionSummary,
      'Points ouverts : authenticité et période du cadran et de l’insert, niveau de polissage du boîtier, références du bracelet, inspection du mouvement et contrôle d’étanchéité.',
    ],
    conditionFacts: { lastCondition: 'À revoir', conclusion: 'État déclaré · non validé', openPoint: 'Authenticité et configuration' },
  }],
  ['cartularia-market-depth', { analysisDate: profile.valuationDate, activeListings: 56, transactions12m: 0, medianDaysOnMarket: 0, lowValue: profile.valuationLow, midValue: profile.valuationMid, highValue: profile.valuationHigh }],
  ['cartularia-market-history', [{ id: 'valuation-imported', date: profile.valuationDate, lowValue: profile.valuationLow, midValue: profile.valuationMid, highValue: profile.valuationHigh, currency: 'EUR', confidence: 'Faible', source: `${profile.sourceLabel} · import non revu`, visibility: 'Secret' }]],
  ['cartularia-retained-valuation', { amount: profile.valuationMid, saleCostAmount: 0, taxAmount: 0, explanation: 'Valeur déclarée lors de la création ; sources et méthode à revalider.' }],
  ['cartularia-purchase', { date: profile.purchaseDate, purchasePrice: profile.purchasePrice }],
  ['cartularia-purchase-expenses', []],
]);
