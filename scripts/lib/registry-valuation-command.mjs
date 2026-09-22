import { FieldValue } from 'firebase-admin/firestore';
import { sha256Digest } from './canonical-json.mjs';

export const REGISTRY_VALUATION_LEVELS = Object.freeze([
  'owner_declared',
  'ai_proposed',
  'professional',
  'transaction',
]);
export const REGISTRY_VALUATION_CONFIDENCE = Object.freeze(['low', 'medium', 'high']);
export const REGISTRY_VALUATION_REFERENCE_CURRENCY = 'EUR';

export class RegistryValuationCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RegistryValuationCommandError';
    this.code = code;
  }
}

const dateIsValid = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const textOrNull = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
};

const moneyOrNull = (value) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
);

const currencyOrNull = (value) => {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
};

const normalizeInsuranceContracts = (value) => {
  if (!Array.isArray(value)) return { contracts: [], warnings: [] };
  const warnings = [];
  const contracts = value.flatMap((candidate, index) => {
    const contractId = textOrNull(candidate?.contractId);
    const carrierLabel = textOrNull(candidate?.carrierLabel);
    const contractReference = textOrNull(candidate?.contractReference);
    const insuredAmount = moneyOrNull(candidate?.insuredAmount);
    const currency = currencyOrNull(candidate?.currency);
    const effectiveFrom = dateIsValid(candidate?.effectiveFrom) ? candidate.effectiveFrom : null;
    const effectiveTo = candidate?.effectiveTo == null || candidate.effectiveTo === ''
      ? null
      : dateIsValid(candidate.effectiveTo) ? candidate.effectiveTo : undefined;
    const basisLabel = textOrNull(candidate?.basisLabel);
    const status = ['active', 'expired', 'pending'].includes(candidate?.status) ? candidate.status : null;
    if (!contractId || !carrierLabel || !contractReference || !insuredAmount || !currency || !effectiveFrom
      || effectiveTo === undefined || (effectiveTo && effectiveTo < effectiveFrom) || !basisLabel || !status) {
      warnings.push(`invalid_insurance_contract:${contractId || index + 1}`);
      return [];
    }
    return [{
      contractId,
      carrierLabel,
      contractReference,
      insuredAmount,
      currency,
      effectiveFrom,
      effectiveTo,
      basisLabel,
      status,
    }];
  });
  return { contracts, warnings };
};

const marketValueExclusionReasons = (marketValue) => {
  const reasons = [];
  if (marketValue.amount === null) reasons.push('missing_amount');
  if (!marketValue.currency) reasons.push('missing_currency');
  if (!marketValue.level) reasons.push('missing_level');
  if (!marketValue.observedAt) reasons.push('missing_date');
  if (!marketValue.sourceLabel) reasons.push('missing_source');
  if (!marketValue.confidence) reasons.push('missing_confidence');
  return reasons;
};

export const buildRegistryValuationProjection = ({ root, retainedValue, insuranceCoverages, sourceRevision }) => {
  const level = REGISTRY_VALUATION_LEVELS.includes(retainedValue?.level) ? retainedValue.level : null;
  const confidence = REGISTRY_VALUATION_CONFIDENCE.includes(retainedValue?.confidence) ? retainedValue.confidence : null;
  const marketValue = {
    amount: moneyOrNull(retainedValue?.amount),
    currency: currencyOrNull(retainedValue?.currency),
    level,
    observedAt: dateIsValid(retainedValue?.observedAt) ? retainedValue.observedAt : null,
    sourceLabel: textOrNull(retainedValue?.sourceLabel),
    confidence,
  };
  const insurance = normalizeInsuranceContracts(insuranceCoverages);
  const exclusionReasons = marketValueExclusionReasons(marketValue);
  const base = {
    schemaVersion: 'registry-valuation@1.0.0',
    cartularyId: root.id,
    organizationId: root.organizationId,
    registryId: root.registryId,
    collectionId: root.collectionId,
    collectionIds: [...new Set([...(Array.isArray(root.collectionIds) ? root.collectionIds : []), root.collectionId].filter(Boolean))],
    assetType: root.assetType,
    displayTitle: root.displayTitle,
    marketValue,
    insuranceContracts: insurance.contracts,
    insuranceWarnings: insurance.warnings,
    eligibility: exclusionReasons.length === 0 ? 'eligible' : 'excluded',
    exclusionReasons,
    visibility: 'secret',
    sourceRevision: Number(sourceRevision || root.revision || 0),
    projectionStatus: 'active',
  };
  return { ...base, contentHash: sha256Digest(base) };
};

const contractAppliesAt = (contract, asOfDate, referenceCurrency) => (
  contract.status === 'active'
  && contract.currency === referenceCurrency
  && contract.effectiveFrom <= asOfDate
  && (!contract.effectiveTo || contract.effectiveTo >= asOfDate)
);

const snapshotExclusionReasons = (projection, asOfDate, referenceCurrency) => {
  const reasons = [...(Array.isArray(projection.exclusionReasons) ? projection.exclusionReasons : [])];
  if (projection.marketValue?.currency && projection.marketValue.currency !== referenceCurrency) reasons.push('currency_mismatch');
  if (projection.marketValue?.observedAt && projection.marketValue.observedAt > asOfDate) reasons.push('value_after_statement');
  if (projection.projectionStatus !== 'active') reasons.push('inactive_projection');
  return [...new Set(reasons)];
};

export const buildRegistryValuationSnapshot = ({
  projections,
  registry,
  snapshotId,
  asOfDate,
  actorUid,
  occurredAt,
}) => {
  if (!dateIsValid(asOfDate)) throw new RegistryValuationCommandError('invalid_argument', "La date d’arrêté est invalide.");
  if (registry.referenceCurrency !== REGISTRY_VALUATION_REFERENCE_CURRENCY) {
    throw new RegistryValuationCommandError('failed_precondition', 'Le Registre doit déclarer EUR comme devise de référence H1.');
  }
  const ordered = [...projections].sort((left, right) => String(left.cartularyId).localeCompare(String(right.cartularyId)));
  const excludedLines = [];
  const lines = [];
  for (const projection of ordered) {
    const reasons = snapshotExclusionReasons(projection, asOfDate, registry.referenceCurrency);
    if (reasons.length > 0) {
      excludedLines.push({ cartularyId: projection.cartularyId, displayTitle: projection.displayTitle, reasons });
      continue;
    }
    const contracts = (projection.insuranceContracts || []).filter((contract) => contractAppliesAt(contract, asOfDate, registry.referenceCurrency));
    const insuredCapital = contracts.reduce((sum, contract) => sum + contract.insuredAmount, 0);
    const insuranceWarnings = [...(projection.insuranceWarnings || [])];
    for (const contract of projection.insuranceContracts || []) {
      if (contract.currency !== registry.referenceCurrency) insuranceWarnings.push(`insurance_currency_mismatch:${contract.contractId}`);
    }
    lines.push({
      cartularyId: projection.cartularyId,
      assetType: projection.assetType,
      displayTitle: projection.displayTitle,
      collectionId: projection.collectionId,
      marketValue: projection.marketValue.amount,
      insuredCapital,
      coverageGap: projection.marketValue.amount - insuredCapital,
      currency: registry.referenceCurrency,
      level: projection.marketValue.level,
      observedAt: projection.marketValue.observedAt,
      sourceLabel: projection.marketValue.sourceLabel,
      confidence: projection.marketValue.confidence,
      insuranceContractCount: contracts.length,
      insuranceWarnings: [...new Set(insuranceWarnings)],
      sourceRevision: projection.sourceRevision,
    });
  }
  const totalMarketValue = lines.reduce((sum, line) => sum + line.marketValue, 0);
  const totalInsuredCapital = lines.reduce((sum, line) => sum + line.insuredCapital, 0);
  const lowConfidenceValue = lines.filter((line) => line.confidence === 'low').reduce((sum, line) => sum + line.marketValue, 0);
  const totalsByLevel = Object.fromEntries(REGISTRY_VALUATION_LEVELS.map((level) => [
    level,
    lines.filter((line) => line.level === level).reduce((sum, line) => sum + line.marketValue, 0),
  ]));
  const base = {
    schemaVersion: 'registry-valuation-snapshot@1.0.0',
    snapshotId,
    organizationId: registry.organizationId,
    registryId: registry.id,
    scopeType: 'registry',
    scopeId: registry.id,
    asOfDate,
    referenceCurrency: registry.referenceCurrency,
    totalMarketValue,
    totalInsuredCapital,
    coverageGap: totalMarketValue - totalInsuredCapital,
    uninsuredLineCount: lines.filter((line) => line.insuranceContractCount === 0).length,
    lowConfidenceValue,
    lowConfidenceShare: totalMarketValue > 0 ? lowConfidenceValue / totalMarketValue : 0,
    totalsByLevel,
    lines,
    excludedLines,
    sourceProjectionCount: ordered.length,
    sourceProjectionHashes: ordered.map((projection) => projection.contentHash),
    immutable: true,
    visibility: 'secret',
    createdBy: actorUid,
    createdAtIso: occurredAt,
  };
  return { ...base, contentHash: sha256Digest(base) };
};

const assertIdentifier = (value, label) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(value || '')) {
    throw new RegistryValuationCommandError('invalid_argument', `${label} invalide.`);
  }
};

const assertSnapshotAuthor = (membership, registryId, actorUid) => {
  const data = membership.exists ? membership.data() : null;
  if (!data || membership.id !== actorUid || data.uid !== actorUid || data.status !== 'active'
    || !Array.isArray(data.roles) || !data.roles.includes('legal_owner')
    || !Array.isArray(data.permissions) || !data.permissions.includes('valuation.read') || !data.permissions.includes('cartulary.edit')
    || !Array.isArray(data.scopes?.registryIds) || !data.scopes.registryIds.includes(registryId)
    || data.invitationManaged === true) {
    throw new RegistryValuationCommandError('permission_denied', "Seul un propriétaire légal autorisé peut créer l’arrêté du Registre.");
  }
};

export const createRegistryValuationSnapshot = async ({ firestore, actorUid, registryId, snapshotId, asOfDate, occurredAt = new Date().toISOString() }) => {
  assertIdentifier(registryId, 'registryId');
  assertIdentifier(snapshotId, 'snapshotId');
  if (!dateIsValid(asOfDate) || asOfDate > occurredAt.slice(0, 10)) {
    throw new RegistryValuationCommandError('invalid_argument', "La date d’arrêté doit être valide et non future.");
  }
  const registryRef = firestore.doc(`registries/${registryId}`);
  const registryDocument = await registryRef.get();
  if (!registryDocument.exists) throw new RegistryValuationCommandError('not_found', 'Registre introuvable.');
  const registry = registryDocument.data();
  const membershipRef = firestore.doc(`organizations/${registry.organizationId}/memberships/${actorUid}`);
  const snapshotRef = registryRef.collection('valuationSnapshots').doc(snapshotId);
  const [membership, projectionSnapshot, existingSnapshot] = await Promise.all([
    membershipRef.get(),
    registryRef.collection('valuationItems').where('projectionStatus', '==', 'active').get(),
    snapshotRef.get(),
  ]);
  assertSnapshotAuthor(membership, registryId, actorUid);
  if (existingSnapshot.exists) {
    const data = existingSnapshot.data();
    if (data.registryId !== registryId || data.asOfDate !== asOfDate || data.createdBy !== actorUid) {
      throw new RegistryValuationCommandError('already_exists', 'Cet identifiant désigne déjà un autre arrêté.');
    }
    return { ...data, replayed: true };
  }
  const snapshot = buildRegistryValuationSnapshot({
    projections: projectionSnapshot.docs.map((document) => document.data()),
    registry,
    snapshotId,
    asOfDate,
    actorUid,
    occurredAt,
  });
  return firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(snapshotRef);
    if (existing.exists) {
      const data = existing.data();
      if (data.registryId !== registryId || data.asOfDate !== asOfDate || data.createdBy !== actorUid) {
        throw new RegistryValuationCommandError('already_exists', 'Cet identifiant désigne déjà un autre arrêté.');
      }
      return { ...data, replayed: true };
    }
    transaction.create(snapshotRef, { ...snapshot, createdAt: FieldValue.serverTimestamp() });
    return { ...snapshot, replayed: false };
  });
};
