import { FieldValue } from 'firebase-admin/firestore';
import { importCartularyBundle } from './import-cartulary-command.mjs';
import { projectRegistryItem } from './projection-command.mjs';
import { claimQueuedOperation } from './operation-rate-limit.mjs';
import { privateBinaryIsVerified } from './private-upload-command.mjs';
import { CREATION_PROFILE_DEFINITIONS, mappedSchemaSections, materializeCreationSections } from './creation-profile-map.mjs';

const CREATE_RATE_LIMIT_PER_DAY = 12;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

export class CreateCartularyCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CreateCartularyCommandError';
    this.code = code;
  }
}

const parseStateValue = (snapshot, key) => {
  if (!snapshot.exists || snapshot.data().deleted === true || typeof snapshot.data().value !== 'string') {
    throw new CreateCartularyCommandError('draft_not_ready', `État privé absent : ${key}.`);
  }
  try {
    return JSON.parse(snapshot.data().value);
  } catch {
    throw new CreateCartularyCommandError('invalid_draft_state', `État JSON invalide : ${key}.`);
  }
};

const text = (value, label, required = false) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && !normalized) throw new CreateCartularyCommandError('invalid_profile', `${label} est requis.`);
  return normalized;
};

const amount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

const year = (value) => Number.isInteger(value) && value >= 1500 && value <= 2200 ? value : null;

const provenance = ({ value, sourceId, observedAt, actorId }) => ({
  value,
  proofStatus: 'unverified',
  confidence: 'low',
  sourceRefs: [sourceId],
  observedAt,
  assertedBy: actorId,
  visibility: 'secret',
});

/**
 * Version de création d'une verticale, résolue dans le catalogue (ADR-030) : version active
 * désignée par `schemaCatalog/{schemaId}`, à défaut dernière version publiée, à défaut la
 * version demandée par le client si elle est publiée. La version retenue doit connaître toutes
 * les sections de la table de création.
 */
export const resolveCreationSchemaVersion = async ({ firestore, schemaId, requestedVersion }) => {
  const definition = CREATION_PROFILE_DEFINITIONS[schemaId];
  if (!definition) throw new CreateCartularyCommandError('unsupported_profile', 'Le profil de création demandé n’est pas pris en charge.');
  const pointer = await firestore.doc(`schemaCatalog/${schemaId}`).get();
  const pointerData = pointer.exists ? pointer.data() : null;
  const resolved = pointerData?.activeVersion || pointerData?.latestVersion || requestedVersion || null;
  if (!resolved) throw new CreateCartularyCommandError('schema_not_ready', `Le catalogue ne désigne aucune version pour ${schemaId}.`);
  const versionDocument = await firestore.doc(`schemaCatalog/${schemaId}/versions/${resolved}`).get();
  if (!versionDocument.exists) throw new CreateCartularyCommandError('schema_not_ready', `La version ${schemaId}@${resolved} n’est pas publiée dans le catalogue.`);
  const sectionIds = versionDocument.data()?.sectionIds;
  if (Array.isArray(sectionIds)) {
    const missing = mappedSchemaSections(definition).map(({ schemaSectionId }) => schemaSectionId).filter((id) => !sectionIds.includes(id));
    if (missing.length) throw new CreateCartularyCommandError('schema_not_ready', `La version ${schemaId}@${resolved} ne connaît pas les sections de création : ${missing.join(', ')}.`);
  }
  return { schemaVersion: resolved, source: pointerData?.activeVersion ? 'active' : pointerData?.latestVersion ? 'latest' : 'requested' };
};

export const buildCreationBundle = ({ requestData, profile, media, schemaVersion: resolvedSchemaVersion }) => {
  const definition = CREATION_PROFILE_DEFINITIONS[profile?.assetType];
  const schemaVersionValue = resolvedSchemaVersion || profile?.schemaVersion;
  if (
    profile?.profileVersion !== '1.0.0'
    || !definition
    || profile.schemaId !== definition.schemaId
    || !/^\d+\.\d+\.\d+$/.test(String(schemaVersionValue))
  ) {
    throw new CreateCartularyCommandError('unsupported_profile', 'Le profil de création demandé n’est pas pris en charge.');
  }
  const brand = text(profile.brand, 'La marque', true);
  const model = text(profile.model, 'Le modèle', true);
  const reference = text(profile.reference, 'La référence', true);
  const observedAt = text(profile.assertedAt, 'La date de saisie', true);
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new CreateCartularyCommandError('invalid_profile', 'La date de saisie est invalide.');
  }
  const collectionId = text(profile.collectionId, 'La collection', true);
  if (!/^[a-z0-9][a-z0-9_-]{5,127}$/.test(collectionId)) {
    throw new CreateCartularyCommandError('invalid_profile', 'L’identifiant de collection est invalide.');
  }
  const sourceId = 'source_owner_creation';
  const value = (fieldValue) => provenance({
    value: fieldValue,
    sourceId,
    observedAt,
    actorId: requestData.ownerUid,
  });
  const serialNumber = text(profile.serialNumber, 'Le numéro de série');
  const caliber = text(profile.caliber, 'Le calibre');
  const description = text(profile.description, 'La description');
  const conditionSummary = text(profile.conditionSummary, 'La synthèse d’état');
  const purchaseDate = text(profile.purchaseDate, 'La date d’achat');
  const purchasePrice = amount(profile.purchasePrice);
  const currency = text(profile.currency, 'La devise') || 'EUR';
  const seller = text(profile.seller, 'Le vendeur');
  const valuationDate = text(profile.valuationDate, 'La date de valorisation');
  const valuationLow = amount(profile.valuationLow);
  const valuationMid = amount(profile.valuationMid);
  const valuationHigh = amount(profile.valuationHigh);
  const sourceLabel = text(profile.sourceLabel, 'La source') || 'Saisie du propriétaire';
  const mediaAssets = Array.isArray(media)
    ? media.filter((asset) => asset && typeof asset.id === 'string' && typeof asset.binaryId === 'string')
    : [];
  if (mediaAssets.length === 0) {
    throw new CreateCartularyCommandError('draft_not_ready', 'Aucun média ou document prêt n’est rattaché au brouillon.');
  }
  const primaryAssetId = mediaAssets.find((asset) => Array.isArray(asset.tags) && asset.tags.includes('main-photo'))?.id || null;
  const manufactureYear = year(profile.manufactureYear);
  const currentYear = new Date().getFullYear();
  const missingRequirement = definition.requires.some((key) => key === 'serialNumber'
    ? !serialNumber
    : key === 'manufactureYear'
      ? !manufactureYear || manufactureYear < definition.minYear || manufactureYear > currentYear + 1
      : false);
  if (missingRequirement) {
    throw new CreateCartularyCommandError('invalid_profile', 'Le numéro de châssis et une année automobile valide sont requis.');
  }

  // Sections et champs : table de création partagée, validée contre le catalogue par les tests.
  const adaptedSections = materializeCreationSections({
    definition,
    normalized: { brand, model, reference, manufactureYear, serialNumber, caliber, description, conditionSummary, purchaseDate, purchasePrice, currency, seller, valuationDate, valuationLow, valuationMid, valuationHigh },
    provenance: value,
    schemaVersion: schemaVersionValue,
  });

  return {
    envelope: {
      id: requestData.cartularyId,
      organizationId: requestData.organizationId,
      registryId: requestData.registryId,
      collectionId,
      assetType: profile.assetType,
      schemaId: profile.schemaId,
      schemaVersion: schemaVersionValue,
      publicCode: requestData.publicCode,
      displayTitle: `${brand} ${model}`.trim(),
      makerName: brand,
      modelName: model,
      referenceCode: reference,
      manufactureYear,
      accountHolderId: requestData.ownerUid,
      userAlias: null,
      objectCode: requestData.publicCode,
      storageCodeNames: [],
      legalOwnerRelationId: 'owner_relation_current',
      lifecycleStatus: 'review',
      patrimonialStatus: 'Patrimonial',
      possessionStatus: 'in_possession',
      purchasePrice,
      costBasis: purchasePrice,
      grossValuation: valuationMid,
      netValuation: null,
      netAfterTaxValuation: null,
      valuationCurrency: currency,
      defaultVisibility: 'secret',
      publicationStatus: 'none',
      primaryAssetId,
      completenessLevel: 'imported_unreviewed',
      lastVerifiedAt: null,
      revision: 1,
      integrityHead: '',
      integritySequence: 0,
      modelVersion: '1.0.0',
      deletedAt: null,
    },
    sections: adaptedSections,
    sources: [{
      id: sourceId,
      kind: 'project_document',
      label: sourceLabel,
      locator: `privateDrafts/${requestData.ownerUid}/cartularies/${requestData.cartularyId}`,
      proofStatus: 'unverified',
      visibility: 'secret',
    }],
    assets: mediaAssets.map((asset) => ({
      id: asset.id,
      cartularyId: requestData.cartularyId,
      organizationId: requestData.organizationId,
      originalVersionId: null,
      mediaKind: ['image', 'video'].includes(asset.type) ? asset.type : 'document',
      displayName: text(asset.name, 'Le nom du fichier') || asset.id,
      mimeDeclared: text(asset.mimeType, 'Le type MIME') || null,
      mimeDetected: null,
      sizeBytes: null,
      sha256: null,
      storagePath: asset.storagePath,
      binaryId: asset.binaryId,
      capturedAt: typeof asset.capturedAt === 'string' ? asset.capturedAt : null,
      timestampSource: typeof asset.timestampSource === 'string' ? asset.timestampSource : null,
      tags: Array.isArray(asset.tags) ? asset.tags.filter((tag) => typeof tag === 'string') : [],
      componentCode: typeof asset.category === 'string' ? asset.category : null,
      evidencePurpose: 'prototype_migration',
      processingState: 'pending_binary_reingest',
      visibility: 'secret',
      requestedVisibility: 'secret',
      sourceRefs: [sourceId],
      accessPolicyVersion: 'wave2-deny-all',
    })),
    spinSets: [],
    observations: [],
    valuations: valuationMid !== null ? [{
      id: 'valuation_initial',
      cartularyId: requestData.cartularyId,
      observedAt: valuationDate ? `${valuationDate}T00:00:00.000Z` : observedAt,
      lowValue: valuationLow ?? valuationMid,
      midValue: valuationMid,
      highValue: valuationHigh ?? valuationMid,
      currency,
      sourceLabel,
      sourceRefs: [sourceId],
      proofStatus: 'unverified',
      confidence: 'low',
      visibility: 'secret',
      reviewStatus: 'pending_human_review',
    }] : [],
    comparables: [],
    reports: [],
    reminders: [],
    ownerRelations: [{
      id: 'owner_relation_current',
      cartularyId: requestData.cartularyId,
      organizationId: requestData.organizationId,
      userId: requestData.ownerUid,
      relationType: 'legal_owner',
      status: 'pending_evidence',
      validFrom: observedAt,
      validUntil: null,
      proofStatus: 'unverified',
      sourceRefs: [sourceId],
      visibility: 'secret',
    }],
    events: [{
      id: 'event_created_from_private_draft',
      cartularyId: requestData.cartularyId,
      organizationId: requestData.organizationId,
      eventType: 'cartulary.created_from_private_draft',
      occurredAt: observedAt,
      actorId: requestData.ownerUid,
      summary: 'Création privée demandée par le propriétaire depuis le Registre.',
      sourceRefs: [sourceId],
      proofStatus: 'unverified',
      visibility: 'secret',
    }],
  };
};

const loadCreationDraft = async (firestore, requestData) => {
  const draftRef = firestore.doc(`privateDrafts/${requestData.ownerUid}/cartularies/${requestData.cartularyId}`);
  const [draft, profileState, mediaState, binaries] = await Promise.all([
    draftRef.get(),
    draftRef.collection('state').doc('cartularia-creation-profile').get(),
    draftRef.collection('state').doc('cartularia-media-assets-v3').get(),
    draftRef.collection('binaries').get(),
  ]);
  if (!draft.exists || draft.data().status !== 'active' || draft.data().ownerUid !== requestData.ownerUid) {
    throw new CreateCartularyCommandError('draft_not_ready', 'Le brouillon privé actif est introuvable.');
  }
  const profile = parseStateValue(profileState, 'cartularia-creation-profile');
  const media = parseStateValue(mediaState, 'cartularia-media-assets-v3');
  const readyBinaries = new Map(binaries.docs
    .filter((snapshot) => privateBinaryIsVerified(snapshot.data()))
    .map((snapshot) => [snapshot.id, snapshot.data()]));
  if (!Array.isArray(media) || media.some((asset) => !readyBinaries.has(asset.binaryId))) {
    throw new CreateCartularyCommandError('draft_not_ready', 'Tous les fichiers du brouillon doivent être vérifiés avant la création.');
  }
  const mediaWithStoragePaths = media.map((asset) => {
    const binary = readyBinaries.get(asset.binaryId);
    const expectedPrefix = `private-drafts/${requestData.ownerUid}/${requestData.cartularyId}/${asset.binaryId}/`;
    if (
      typeof binary.storagePath !== 'string'
      || !binary.storagePath.startsWith(expectedPrefix)
      || !binary.storagePath.endsWith('/original')
    ) {
      throw new CreateCartularyCommandError('draft_not_ready', `Chemin Storage privé invalide pour ${asset.binaryId}.`);
    }
    return { ...asset, storagePath: binary.storagePath };
  });
  return { profile, media: mediaWithStoragePaths };
};

export const processCartularyCreateRequest = async ({
  firestore,
  requestDocumentId,
  occurredAt = new Date().toISOString(),
  rateLimitPerDay = CREATE_RATE_LIMIT_PER_DAY,
}) => {
  const requestRef = firestore.doc(`cartularyCreateRequests/${requestDocumentId}`);
  const requestSnapshot = await requestRef.get();
  if (!requestSnapshot.exists || requestSnapshot.data().status !== 'pending') {
    return { requestDocumentId, status: 'ignored', reason: 'not_pending' };
  }
  const requestData = requestSnapshot.data();
  if (
    requestData.requestDocumentId !== requestDocumentId
    || requestData.cartularyId !== requestDocumentId
    || typeof requestData.ownerUid !== 'string'
    || typeof requestData.requestId !== 'string'
    || typeof requestData.organizationId !== 'string'
    || typeof requestData.registryId !== 'string'
    || typeof requestData.publicCode !== 'string'
  ) {
    throw new CreateCartularyCommandError('invalid_request', 'La demande de création est incomplète.');
  }
  const claim = await claimQueuedOperation({
    firestore,
    requestRef,
    requestId: requestData.requestId,
    ownerUid: requestData.ownerUid,
    operation: 'cartulary_create',
    limit: rateLimitPerDay,
    windowMs: ONE_DAY_MS,
    occurredAt,
  });
  if (!claim.claimed) return { requestDocumentId, status: 'ignored', reason: claim.reason };

  const { profile, media } = await loadCreationDraft(firestore, requestData);
  const { schemaVersion } = await resolveCreationSchemaVersion({ firestore, schemaId: profile?.schemaId, requestedVersion: profile?.schemaVersion });
  const bundle = buildCreationBundle({ requestData, profile, media, schemaVersion });
  const imported = await importCartularyBundle({
    firestore,
    bundle,
    requestId: requestData.requestId,
    actorId: requestData.ownerUid,
    expectedRevision: 0,
    requireActiveCollection: true,
    occurredAt,
  });
  const projected = await projectRegistryItem({
    firestore,
    cartularyId: requestData.cartularyId,
    actorId: requestData.ownerUid,
    requestId: `project_${requestData.requestId.slice('create_'.length)}`,
    expectedRevision: imported.revision,
    occurredAt,
  });
  const syncRequestId = `sync_create_${requestData.requestId.slice('create_'.length)}`;
  const syncRequestRef = firestore.doc(`cartularySyncRequests/${requestData.cartularyId}`);
  const completion = await firestore.runTransaction(async (transaction) => {
    const [currentRequest, currentSyncRequest] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(syncRequestRef),
    ]);
    if (
      !currentRequest.exists
      || currentRequest.data().status !== 'processing'
      || currentRequest.data().requestId !== requestData.requestId
    ) return false;
    if (
      !currentSyncRequest.exists
      || ['processed', 'failed'].includes(currentSyncRequest.data().status)
    ) {
      transaction.set(syncRequestRef, {
        requestDocumentId: requestData.cartularyId,
        requestId: syncRequestId,
        ownerUid: requestData.ownerUid,
        cartularyId: requestData.cartularyId,
        reason: 'private_draft_synchronized',
        status: 'pending',
        requestedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(requestRef, {
      status: 'processed',
      revision: projected.revision,
      sourceRevision: projected.sourceRevision,
      processedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  if (!completion) return { requestDocumentId, status: 'ignored', reason: 'superseded' };
  return {
    requestDocumentId,
    status: 'processed',
    cartularyId: requestData.cartularyId,
    revision: projected.revision,
  };
};

export const markCartularyCreateRequestFailed = async ({ firestore, requestDocumentId, requestId, error }) => {
  const requestRef = firestore.doc(`cartularyCreateRequests/${requestDocumentId}`);
  await firestore.runTransaction(async (transaction) => {
    const request = await transaction.get(requestRef);
    if (
      !request.exists
      || !['pending', 'processing'].includes(request.data().status)
      || request.data().requestId !== requestId
    ) return;
    transaction.update(requestRef, {
      status: 'failed',
      errorCode: error?.code || 'create_failed',
      errorMessage: error?.message || String(error),
      failedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};
