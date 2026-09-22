import { sha256Digest } from './canonical-json.mjs';

export const DOCUMENTATION_ASSESSMENT_SCHEMA_VERSION = 'documentation-assessment@1.0.0';
export const DOCUMENTATION_SUMMARY_SCHEMA_VERSION = 'registry-documentation-summary@1.0.0';
export const DOCUMENTATION_METHOD_VERSION = 'documentation-tier-watch@1.0.0';
export const DOCUMENTATION_TIERS = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4']);
export const DOCUMENTATION_FACT_STATUSES = Object.freeze(['proven', 'missing', 'unknown', 'unverified', 'unavailable']);

const TIER_NAMES = Object.freeze({
  P0: 'Dossier minimal viable',
  P1: 'Identité établie',
  P2: 'Dossier tenu',
  P3: 'Dossier daté',
  P4: 'Dossier certifié',
});

const COST_ORDER = Object.freeze({ free: 0, time: 1, service: 2 });

const WATCH_CRITERIA = Object.freeze([
  { id: 'piece_identity', tier: 'P0', label: 'Identité de la pièce', action: 'Établir l’identité de la pièce.', expectedProof: 'Identité renseignée et reliée à une preuve du Cartulaire.', cost: 'free', dependencies: [] },
  { id: 'reference_photo', tier: 'P0', label: 'Photographie de référence', action: 'Choisir une photographie de référence prouvée.', expectedProof: 'Photographie de référence horodatée et référencée.', cost: 'time', dependencies: [] },
  { id: 'acquisition_proof', tier: 'P0', label: 'Preuve d’acquisition', action: 'Rattacher une preuve d’acquisition.', expectedProof: 'Facture, acte ou justificatif d’acquisition référencé.', cost: 'free', dependencies: [] },
  { id: 'serials_concordant', tier: 'P1', label: 'Numéros lus et concordants', action: 'Lire les numéros et documenter leur concordance.', expectedProof: 'Relevé des numéros et contrôle de concordance référencés.', cost: 'time', dependencies: [] },
  { id: 'technical_sheet', tier: 'P1', label: 'Fiche technique', action: 'Compléter la fiche technique sourcée.', expectedProof: 'Fiche technique reliée à ses sources.', cost: 'time', dependencies: [] },
  { id: 'photo_series_level_1', tier: 'P1', label: 'Série photo de niveau 1', action: 'Réaliser la série photo de niveau 1.', expectedProof: 'Série photo qualifiée niveau 1 par le profil horloger.', cost: 'time', dependencies: [] },
  { id: 'photo_series_level_2', tier: 'P2', label: 'Série photo de niveau 2', action: 'Compléter la série photo de niveau 2.', expectedProof: 'Série photo qualifiée niveau 2 par le profil horloger.', cost: 'time', dependencies: [] },
  { id: 'associated_set_inventory', tier: 'P2', label: 'Ensemble associé inventorié', action: 'Inventorier l’ensemble associé et déclarer les manques.', expectedProof: 'Inventaire complet ou manques explicitement déclarés.', cost: 'time', dependencies: [] },
  { id: 'maintenance_history', tier: 'P2', label: 'Historique d’entretien', action: 'Documenter l’historique d’entretien disponible.', expectedProof: 'Interventions datées, décrites et reliées à leurs justificatifs.', cost: 'time', dependencies: [] },
  { id: 'documented_cost_basis', tier: 'P2', label: 'Prix de revient documenté', action: 'Documenter le prix de revient.', expectedProof: 'Acquisition et dépenses datées reliées à leurs justificatifs.', cost: 'time', dependencies: [] },
  { id: 'dated_condition_report_dev03', tier: 'P3', label: 'Constat d’état daté issu de DEV-03', action: 'Faire établir le constat d’état daté prévu par DEV-03.', expectedProof: 'Constat d’état daté, référencé et attribué à DEV-03.', cost: 'time', dependencies: ['DEV-03'] },
  { id: 'dated_sourced_valuation_dev04', tier: 'P3', label: 'Évaluation datée et sourcée issue de DEV-04', action: 'Faire établir l’évaluation datée et sourcée prévue par DEV-04.', expectedProof: 'Évaluation datée, sourcée et attribuée à DEV-04.', cost: 'time', dependencies: ['DEV-04'] },
  { id: 'issued_seal', tier: 'P3', label: 'Sceau émis', action: 'Émettre un Sceau sur le périmètre documenté.', expectedProof: 'Sceau émis, non révoqué et relié à la révision évaluée.', cost: 'free', dependencies: [] },
  { id: 'independent_physical_control', tier: 'P4', label: 'Contrôle physique par un tiers indépendant sous mandat', action: 'Mandater un tiers indépendant pour un contrôle physique.', expectedProof: 'Rapport de contrôle physique, mandat et identité du tiers indépendant.', cost: 'service', dependencies: ['tiers indépendant'] },
  { id: 'professional_valuation', tier: 'P4', label: 'Évaluation établie par un professionnel', action: 'Faire établir une évaluation par un professionnel.', expectedProof: 'Évaluation professionnelle datée, sourcée et attribuée.', cost: 'service', dependencies: ['professionnel'] },
]);

export class DocumentationTierCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentationTierCommandError';
    this.code = code;
  }
}

const dateTimeIsValid = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const dateIsValid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
const uniqueText = (values) => [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];

const normalizeEvidenceReference = (value) => {
  if (!value || typeof value !== 'object') return null;
  const reference = typeof value.reference === 'string' ? value.reference.trim() : '';
  const kind = typeof value.kind === 'string' ? value.kind.trim() : '';
  if (!reference || !kind) return null;
  return {
    kind,
    reference,
    ...(Number.isInteger(value.revision) && value.revision >= 0 ? { revision: value.revision } : {}),
    ...(typeof value.observedAt === 'string' && value.observedAt ? { observedAt: value.observedAt } : {}),
    ...(typeof value.sourceLabel === 'string' && value.sourceLabel.trim() ? { sourceLabel: value.sourceLabel.trim() } : {}),
  };
};

const normalizeFact = (value) => {
  const status = DOCUMENTATION_FACT_STATUSES.includes(value?.status) ? value.status : 'unknown';
  const evidenceRefs = (Array.isArray(value?.evidenceRefs) ? value.evidenceRefs : []).map(normalizeEvidenceReference).filter(Boolean);
  return {
    status: status === 'proven' && evidenceRefs.length === 0 ? 'unverified' : status,
    evidenceRefs,
    ...(typeof value?.note === 'string' && value.note.trim() ? { note: value.note.trim() } : {}),
  };
};

const inactiveMeasurement = () => ({
  status: 'unmeasured',
  label: 'ordre de grandeur non mesuré',
  monetaryGain: null,
  measuredCoefficient: null,
  h3Model: {
    activationStatus: 'inactive',
    modelVersion: null,
    source: null,
    sourceRightToUse: null,
    studiedSegment: null,
    sampleSize: null,
    coefficient: null,
    confidenceInterval: null,
    measuredAt: null,
  },
});

const provenancedValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(provenancedValues);
  if (!value || typeof value !== 'object') return [];
  if ('value' in value && ['observed', 'documented'].includes(value.proofStatus)
    && Array.isArray(value.sourceRefs) && value.sourceRefs.length > 0) return [value];
  return [];
};

const fieldEvidence = (sections, fieldIds) => {
  const matches = [];
  for (const section of sections || []) {
    for (const fieldId of fieldIds) {
      for (const value of provenancedValues(section?.fields?.[fieldId])) {
        if (value.value === null || value.value === '' || (Array.isArray(value.value) && value.value.length === 0)) continue;
        matches.push({
          value: value.value,
          evidenceRefs: value.sourceRefs.map((sourceRef) => ({
            kind: 'cartulary_field',
            reference: `cartularies/${section.cartularyId || 'current'}/sections/${section.id || section.schemaSectionId}:${fieldId}:${sourceRef}`,
            revision: Number(section.revision || 0),
            observedAt: value.observedAt,
          })),
        });
      }
    }
  }
  return matches;
};

const factFromEvidence = (matches, note) => matches.length > 0
  ? { status: 'proven', evidenceRefs: matches.flatMap((match) => match.evidenceRefs), note }
  : { status: 'missing', evidenceRefs: [], note };

/**
 * Dérivation volontairement conservatrice depuis les seules sources autoritaires déjà vérifiables.
 * Les déclarations, données non vérifiées et références sans empreinte ne satisfont jamais un critère.
 * Les niveaux de séries photo restent des faits de profil explicites : aucun nombre de photos n'est inventé ici.
 */
export const deriveWatchDocumentationFacts = ({ cartularyId, sections = [], assets = [], retainedValue = null, seal = null }) => {
  const scopedSections = sections.map((section) => ({ ...section, cartularyId }));
  const identityEvidence = [
    fieldEvidence(scopedSections, ['cover.watch.brand']),
    fieldEvidence(scopedSections, ['cover.watch.model']),
    fieldEvidence(scopedSections, ['cover.watch.reference']),
  ];
  const primaryPhotos = assets.filter((asset) => asset?.projectionStatus !== 'withdrawn'
    && asset.mediaKind === 'image' && Array.isArray(asset.tags) && asset.tags.includes('main-photo')
    && /^sha256:[a-f0-9]{64}$/.test(asset.sha256 || '') && typeof asset.storagePath === 'string' && asset.storagePath);
  const primaryPhotoEvidence = primaryPhotos.map((asset) => ({ evidenceRefs: [{ kind: 'asset', reference: `cartularies/${cartularyId}/assets/${asset.id}`, observedAt: asset.capturedAt || undefined }] }));
  const purchaseDate = fieldEvidence(scopedSections, ['value.purchase.date']);
  const purchasePrice = fieldEvidence(scopedSections, ['value.purchase.price']);
  const technicalSheet = fieldEvidence(scopedSections, ['reference.specifications[].label', 'reference.specifications[].value']);
  const associatedSet = fieldEvidence(scopedSections, ['condition.documentation[].state']);
  const maintenance = fieldEvidence(scopedSections, ['condition.maintenance[].date', 'condition.maintenance[].description', 'condition.interventions[].date', 'condition.interventions[].description']);
  const costBasis = [...purchaseDate, ...purchasePrice, ...fieldEvidence(scopedSections, ['value.expenses[].amount'])];
  const valuationEvidence = retainedValue && ['ai_proposed', 'professional', 'transaction'].includes(retainedValue.level)
    && dateIsValid(retainedValue.observedAt) && typeof retainedValue.sourceLabel === 'string' && retainedValue.sourceLabel.trim()
    ? [{ evidenceRefs: [{ kind: 'valuation', reference: `cartularies/${cartularyId}/value/retained`, observedAt: retainedValue.observedAt, sourceLabel: retainedValue.sourceLabel }] }]
    : [];
  const dev03Evidence = fieldEvidence(scopedSections, ['condition.dev03.datedReport']);
  const dev04Evidence = retainedValue?.developmentId === 'DEV-04' ? valuationEvidence : [];
  const sealEvidence = seal?.status === 'issued' && typeof seal.contentHash === 'string'
    ? [{ evidenceRefs: [{ kind: 'seal', reference: `seals/${seal.id || seal.publicCode || cartularyId}`, observedAt: seal.issuedAtIso || seal.issuedAt }] }]
    : [];
  const facts = {
    piece_identity: identityEvidence.every((entries) => entries.length > 0)
      ? { status: 'proven', evidenceRefs: identityEvidence.flatMap((entries) => entries.flatMap((entry) => entry.evidenceRefs)) }
      : { status: 'missing', evidenceRefs: [] },
    reference_photo: factFromEvidence(primaryPhotoEvidence),
    acquisition_proof: purchaseDate.length > 0 && purchasePrice.length > 0
      ? { status: 'proven', evidenceRefs: [...purchaseDate, ...purchasePrice].flatMap((entry) => entry.evidenceRefs) }
      : { status: 'missing', evidenceRefs: [] },
    serials_concordant: factFromEvidence(fieldEvidence(scopedSections, ['identity.serialConcordance', 'reference.serialConcordance'])),
    technical_sheet: factFromEvidence(technicalSheet),
    photo_series_level_1: factFromEvidence(fieldEvidence(scopedSections, ['media.capture.level1'])),
    photo_series_level_2: factFromEvidence(fieldEvidence(scopedSections, ['media.capture.level2'])),
    associated_set_inventory: factFromEvidence(associatedSet),
    maintenance_history: factFromEvidence(maintenance),
    documented_cost_basis: purchaseDate.length > 0 && purchasePrice.length > 0 ? factFromEvidence(costBasis) : { status: 'missing', evidenceRefs: [] },
    dated_condition_report_dev03: dev03Evidence.length > 0 ? factFromEvidence(dev03Evidence) : { status: 'unavailable', evidenceRefs: [], note: 'DEV-03 absent ou aucune sortie DEV-03 prouvée.' },
    dated_sourced_valuation_dev04: dev04Evidence.length > 0 ? factFromEvidence(dev04Evidence) : { status: 'unavailable', evidenceRefs: [], note: 'DEV-04 absent ou aucune sortie DEV-04 prouvée.' },
    issued_seal: factFromEvidence(sealEvidence),
    independent_physical_control: factFromEvidence(fieldEvidence(scopedSections, ['condition.certification.independentPhysicalControl'])),
    professional_valuation: retainedValue?.level === 'professional' ? factFromEvidence(valuationEvidence) : { status: 'missing', evidenceRefs: [] },
  };
  return facts;
};

const assessmentBase = ({ cartulary, evaluatedAt, dataRevision, status, methodVersion, verticalProfile }) => ({
  schemaVersion: DOCUMENTATION_ASSESSMENT_SCHEMA_VERSION,
  cartularyId: cartulary.id,
  organizationId: cartulary.organizationId,
  registryId: cartulary.registryId,
  collectionId: cartulary.collectionId,
  collectionIds: uniqueText([...(cartulary.collectionIds || []), cartulary.collectionId]),
  assetType: cartulary.assetType,
  displayTitle: cartulary.displayTitle,
  assessmentStatus: status,
  methodVersion,
  verticalProfile,
  evaluatedAt,
  dataRevision,
  visibility: 'secret',
  measurement: inactiveMeasurement(),
});

export const buildDocumentationAssessment = ({ cartulary, facts = null, evaluatedAt, dataRevision }) => {
  if (!cartulary?.id || !cartulary?.organizationId || !cartulary?.registryId || !cartulary?.assetType) {
    throw new DocumentationTierCommandError('invalid_argument', 'Le Cartulaire à évaluer est incomplet.');
  }
  if (!dateTimeIsValid(evaluatedAt) || !Number.isInteger(dataRevision) || dataRevision < 0) {
    throw new DocumentationTierCommandError('invalid_argument', 'La date ou la révision de l’évaluation est invalide.');
  }
  if (cartulary.assetType !== 'watch') {
    const base = {
      ...assessmentBase({ cartulary, evaluatedAt, dataRevision, status: 'not_configured', methodVersion: null, verticalProfile: null }),
      documentationTier: null,
      documentationTierName: null,
      nextTier: null,
      nextTierName: null,
      criteria: [],
      satisfiedCriteria: [],
      missingCriteria: [],
      evidenceUsed: [],
      actions: [],
      warnings: [`vertical_profile_not_configured:${cartulary.assetType}`],
    };
    return { ...base, contentHash: sha256Digest(base) };
  }
  if (facts === null) {
    const base = {
      ...assessmentBase({ cartulary, evaluatedAt, dataRevision, status: 'not_evaluated', methodVersion: DOCUMENTATION_METHOD_VERSION, verticalProfile: 'watch' }),
      documentationTier: null,
      documentationTierName: null,
      nextTier: 'P0',
      nextTierName: TIER_NAMES.P0,
      criteria: [],
      satisfiedCriteria: [],
      missingCriteria: [],
      evidenceUsed: [],
      actions: [],
      warnings: ['documentation_evidence_not_evaluated'],
    };
    return { ...base, contentHash: sha256Digest(base) };
  }

  const normalizedFacts = Object.fromEntries(WATCH_CRITERIA.map((criterion) => [criterion.id, normalizeFact(facts[criterion.id])]));
  const criteria = WATCH_CRITERIA.map((criterion, criterionOrder) => {
    const fact = normalizedFacts[criterion.id];
    return {
      criterionId: criterion.id,
      tier: criterion.tier,
      label: criterion.label,
      status: fact.status,
      satisfied: fact.status === 'proven',
      evidenceRefs: fact.evidenceRefs,
      expectedProof: criterion.expectedProof,
      dependencies: criterion.dependencies,
      criterionOrder,
      ...(fact.note ? { note: fact.note } : {}),
    };
  });
  let documentationTier = null;
  for (const tier of DOCUMENTATION_TIERS) {
    const tierCriteria = criteria.filter((criterion) => criterion.tier === tier);
    if (tierCriteria.every((criterion) => criterion.satisfied)) documentationTier = tier;
    else break;
  }
  const tierIndex = documentationTier ? DOCUMENTATION_TIERS.indexOf(documentationTier) : -1;
  const nextTier = DOCUMENTATION_TIERS[tierIndex + 1] || null;
  const nextCriteria = nextTier ? criteria.filter((criterion) => criterion.tier === nextTier && !criterion.satisfied) : [];
  const actions = nextCriteria.map((criterion) => {
    const definition = WATCH_CRITERIA.find((candidate) => candidate.id === criterion.criterionId);
    return {
      cartularyId: cartulary.id,
      displayTitle: cartulary.displayTitle,
      collectionId: cartulary.collectionId,
      collectionIds: uniqueText([...(cartulary.collectionIds || []), cartulary.collectionId]),
      targetTier: nextTier,
      targetTierName: TIER_NAMES[nextTier],
      criterionId: criterion.criterionId,
      missingCriterion: criterion.label,
      action: definition.action,
      expectedProof: definition.expectedProof,
      costCategory: definition.cost,
      dependencies: definition.dependencies,
      priorityReason: `${definition.cost === 'free' ? 'Gratuit' : definition.cost === 'time' ? 'Temps' : 'Prestation'} et décisif pour atteindre ${nextTier} ${TIER_NAMES[nextTier]}.`,
      gainMeasurementStatus: 'unmeasured',
      gainMeasurementLabel: 'gain non mesuré',
      priorityOrder: [COST_ORDER[definition.cost], 0, DOCUMENTATION_TIERS.indexOf(nextTier), criterion.criterionOrder],
    };
  }).sort(comparePriority);
  const warnings = criteria.filter((criterion) => criterion.status === 'unavailable').map((criterion) => `dependency_unavailable:${criterion.criterionId}`);
  const base = {
    ...assessmentBase({ cartulary, evaluatedAt, dataRevision, status: 'evaluated', methodVersion: DOCUMENTATION_METHOD_VERSION, verticalProfile: 'watch' }),
    documentationTier,
    documentationTierName: documentationTier ? TIER_NAMES[documentationTier] : null,
    nextTier,
    nextTierName: nextTier ? TIER_NAMES[nextTier] : null,
    criteria,
    satisfiedCriteria: criteria.filter((criterion) => criterion.satisfied),
    missingCriteria: criteria.filter((criterion) => !criterion.satisfied),
    evidenceUsed: criteria.flatMap((criterion) => criterion.evidenceRefs.map((reference) => ({ criterionId: criterion.criterionId, ...reference }))),
    actions,
    warnings,
  };
  return { ...base, contentHash: sha256Digest(base) };
};

const inAuthorizedScope = (item, scope) => {
  if (scope.registry === true) return true;
  const collections = uniqueText([...(item.collectionIds || []), item.collectionId]);
  return scope.cartularyIds.includes(item.cartularyId) || collections.some((id) => scope.collectionIds.includes(id));
};

const valuationExclusionReasons = (item, asOfDate, referenceCurrency) => {
  const reasons = [...(Array.isArray(item.exclusionReasons) ? item.exclusionReasons : [])];
  if (item.eligibility !== 'eligible') reasons.push('valuation_ineligible');
  if (item.marketValue?.currency && item.marketValue.currency !== referenceCurrency) reasons.push('currency_mismatch');
  if (item.marketValue?.observedAt && item.marketValue.observedAt > asOfDate) reasons.push('value_after_statement');
  if (item.projectionStatus !== 'active') reasons.push('inactive_projection');
  if (!(typeof item.marketValue?.amount === 'number' && Number.isFinite(item.marketValue.amount) && item.marketValue.amount > 0)) reasons.push('missing_amount');
  return uniqueText(reasons);
};

const comparePriority = (left, right) => {
  const leftOrder = Array.isArray(left.priorityOrder) ? left.priorityOrder : [9, 9, 9, 9];
  const rightOrder = Array.isArray(right.priorityOrder) ? right.priorityOrder : [9, 9, 9, 9];
  for (let index = 0; index < Math.max(leftOrder.length, rightOrder.length); index += 1) {
    if ((leftOrder[index] ?? 9) !== (rightOrder[index] ?? 9)) return (leftOrder[index] ?? 9) - (rightOrder[index] ?? 9);
  }
  return `${left.displayTitle}:${left.criterionId}`.localeCompare(`${right.displayTitle}:${right.criterionId}`);
};

export const buildRegistryDocumentationSummary = ({
  registry,
  documentationItems,
  valuationItems,
  authorizationScope = { registry: true, cartularyIds: [], collectionIds: [] },
  asOfDate,
  generatedAt,
}) => {
  if (!registry?.id || registry.referenceCurrency !== 'EUR' || !dateIsValid(asOfDate) || !dateTimeIsValid(generatedAt)) {
    throw new DocumentationTierCommandError('invalid_argument', 'Le contexte du Registre est invalide.');
  }
  const scope = {
    registry: authorizationScope.registry === true,
    cartularyIds: uniqueText(authorizationScope.cartularyIds),
    collectionIds: uniqueText(authorizationScope.collectionIds),
  };
  const assessments = new Map((documentationItems || []).filter((item) => inAuthorizedScope(item, scope)).map((item) => [item.cartularyId, item]));
  const scopedValuations = (valuationItems || []).filter((item) => inAuthorizedScope(item, scope));
  const excludedLines = [];
  const lines = [];
  for (const valuation of scopedValuations.sort((left, right) => String(left.cartularyId).localeCompare(String(right.cartularyId)))) {
    const valuationReasons = valuationExclusionReasons(valuation, asOfDate, registry.referenceCurrency);
    if (valuationReasons.length > 0) {
      excludedLines.push({ cartularyId: valuation.cartularyId, displayTitle: valuation.displayTitle, reasons: valuationReasons });
      continue;
    }
    const assessment = assessments.get(valuation.cartularyId);
    if (!assessment || assessment.assessmentStatus !== 'evaluated') {
      excludedLines.push({ cartularyId: valuation.cartularyId, displayTitle: valuation.displayTitle, reasons: [assessment?.assessmentStatus === 'not_configured' ? 'documentation_profile_not_configured' : 'documentation_not_evaluated'] });
      continue;
    }
    lines.push({
      cartularyId: valuation.cartularyId,
      displayTitle: valuation.displayTitle,
      assetType: valuation.assetType,
      collectionId: valuation.collectionId,
      collectionIds: uniqueText([...(valuation.collectionIds || []), valuation.collectionId]),
      marketValue: valuation.marketValue.amount,
      currency: registry.referenceCurrency,
      documentationTier: assessment.documentationTier,
      documentationTierName: assessment.documentationTierName,
      sourceRevision: Math.max(Number(valuation.sourceRevision || 0), Number(assessment.dataRevision || 0)),
      assessmentHash: assessment.contentHash,
      valuationHash: valuation.contentHash,
      actions: assessment.actions || [],
    });
  }
  const isSecured = (line) => ['P2', 'P3', 'P4'].includes(line.documentationTier);
  const securedValue = lines.filter(isSecured).reduce((sum, line) => sum + line.marketValue, 0);
  const exposedValue = lines.filter((line) => !isSecured(line)).reduce((sum, line) => sum + line.marketValue, 0);
  const distributionByTier = Object.fromEntries(DOCUMENTATION_TIERS.map((tier) => [tier, lines.filter((line) => line.documentationTier === tier).length]));
  const priorityActions = lines.flatMap((line) => line.actions.map((action) => ({ ...action, displayTitle: line.displayTitle, collectionId: line.collectionId, collectionIds: line.collectionIds }))).sort(comparePriority).slice(0, 10);
  const base = {
    schemaVersion: DOCUMENTATION_SUMMARY_SCHEMA_VERSION,
    registryId: registry.id,
    organizationId: registry.organizationId,
    referenceCurrency: registry.referenceCurrency,
    asOfDate,
    generatedAt,
    visibility: 'secret',
    authorizationScope: scope,
    securedValue,
    exposedValue,
    distributionByTier,
    belowP0Count: lines.filter((line) => line.documentationTier === null).length,
    eligibleLineCount: lines.length,
    lines,
    priorityActions,
    excludedLines,
    measurement: inactiveMeasurement(),
    tierHistory: { status: 'unavailable', reason: 'no_reliable_documentation_snapshot_history', points: [] },
    sourceProjectionHashes: [...new Set(lines.flatMap((line) => [line.assessmentHash, line.valuationHash]).filter(Boolean))].sort(),
  };
  return { ...base, contentHash: sha256Digest(base) };
};

const assertSummaryReader = (membership, registryId, actorUid) => {
  const data = membership.exists ? membership.data() : null;
  if (!data || membership.id !== actorUid || data.uid !== actorUid || data.status !== 'active'
    || !Array.isArray(data.permissions) || !data.permissions.includes('registry.read') || !data.permissions.includes('valuation.read')
    || !Array.isArray(data.scopes?.registryIds) || !data.scopes.registryIds.includes(registryId)) {
    throw new DocumentationTierCommandError('permission_denied', 'La synthèse documentaire n’est pas autorisée.');
  }
  const grant = data.invitationManaged === true ? data.invitationGrants?.[registryId] : null;
  return grant ? {
    registry: grant.registry === true,
    cartularyIds: uniqueText(grant.cartularyIds),
    collectionIds: uniqueText(grant.collectionIds),
  } : { registry: true, cartularyIds: [], collectionIds: [] };
};

export const getRegistryDocumentationSummary = async ({ firestore, actorUid, registryId, asOfDate, occurredAt = new Date().toISOString() }) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(registryId || '') || !dateIsValid(asOfDate)) {
    throw new DocumentationTierCommandError('invalid_argument', 'Le Registre ou la date de synthèse est invalide.');
  }
  const registryRef = firestore.doc(`registries/${registryId}`);
  const registrySnapshot = await registryRef.get();
  if (!registrySnapshot.exists) throw new DocumentationTierCommandError('not_found', 'Registre introuvable.');
  const registry = registrySnapshot.data();
  const [membership, documentationSnapshot, valuationSnapshot] = await Promise.all([
    firestore.doc(`organizations/${registry.organizationId}/memberships/${actorUid}`).get(),
    registryRef.collection('documentationItems').where('projectionStatus', '==', 'active').get(),
    registryRef.collection('valuationItems').where('projectionStatus', '==', 'active').get(),
  ]);
  const authorizationScope = assertSummaryReader(membership, registryId, actorUid);
  return buildRegistryDocumentationSummary({
    registry,
    documentationItems: documentationSnapshot.docs.map((document) => document.data()),
    valuationItems: valuationSnapshot.docs.map((document) => document.data()),
    authorizationScope,
    asOfDate,
    generatedAt: occurredAt,
  });
};

export const documentationTierName = (tier) => tier ? TIER_NAMES[tier] || null : null;
