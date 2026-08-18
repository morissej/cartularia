import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CANONICALIZATION_VERSION, sha256Digest } from './canonical-json.mjs';
import { verifyAuditChain, ZERO_AUDIT_HASH } from './audit-verifier.mjs';
import { claimQueuedOperation } from './operation-rate-limit.mjs';

const SYNC_RATE_LIMIT_PER_HOUR = 120;
const ONE_HOUR_MS = 60 * 60 * 1_000;

export class LiveSyncCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LiveSyncCommandError';
    this.code = code;
  }
}

const parseStateValue = (record) => {
  if (record.deleted === true || typeof record.value !== 'string') return null;
  try {
    return JSON.parse(record.value);
  } catch {
    throw new LiveSyncCommandError('invalid_draft_state', `État JSON invalide : ${record.key}.`);
  }
};

const stateValue = (states, key) => parseStateValue(states.get(key) || { deleted: true });

const asText = (value, fallback) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
};

const asYear = (value, fallback) => {
  const match = String(value ?? '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : fallback;
};

const specificationValue = (groups, id, label) => {
  if (!Array.isArray(groups)) return null;
  for (const group of groups) {
    if (!Array.isArray(group?.items)) continue;
    const item = group.items.find((candidate) => candidate?.id === id || candidate?.label === label);
    if (typeof item?.value === 'string' && item.value.trim()) return item.value.trim();
  }
  return null;
};

const visibility = (value) => ({ Secret: 'secret', Communauté: 'community', Tous: 'public' }[value] || 'secret');

const createAuditEvent = ({ rootData, requestId, actorId, occurredAt, afterDigest }) => {
  const previousEventHash = rootData.integrityHead || ZERO_AUDIT_HASH;
  const sequence = Number(rootData.integritySequence || 0) + 1;
  const eventId = `evt_${sha256Digest(`cartulary.live_state.synced:${requestId}`).slice(7, 31)}`;
  const eventWithoutHash = {
    eventId,
    cartularyId: rootData.id,
    sequence,
    occurredAt,
    actor: { uid: actorId, role: 'legal_owner' },
    action: 'cartulary.live_state.synced',
    resource: { type: 'liveState', id: 'current' },
    beforeDigest: previousEventHash,
    afterDigest,
    previousEventHash,
    canonicalizationVersion: CANONICALIZATION_VERSION,
    requestId,
  };
  return {
    ...eventWithoutHash,
    hash: sha256Digest({ previousEventHash, event: eventWithoutHash }),
  };
};

const assertOwnerEditor = (membership, rootData, ownerUid) => {
  const data = membership.exists ? membership.data() : null;
  if (
    rootData.accountHolderId !== ownerUid
    || !data
    || membership.id !== ownerUid
    || data.uid !== ownerUid
    || data.status !== 'active'
    || !Array.isArray(data.roles)
    || !data.roles.includes('legal_owner')
    || !Array.isArray(data.permissions)
    || !data.permissions.includes('cartulary.edit')
    || !Array.isArray(data.scopes?.registryIds)
    || !data.scopes.registryIds.includes(rootData.registryId)
  ) {
    throw new LiveSyncCommandError('permission_denied', 'Le demandeur n’est pas propriétaire éditeur de ce Cartulaire.');
  }
};

const loadDraft = async (firestore, ownerUid, cartularyId) => {
  const draftRef = firestore.doc(`privateDrafts/${ownerUid}/cartularies/${cartularyId}`);
  const [draft, stateSnapshot, binarySnapshot] = await Promise.all([
    draftRef.get(),
    draftRef.collection('state').get(),
    draftRef.collection('binaries').get(),
  ]);
  if (!draft.exists || draft.data().status !== 'active') {
    throw new LiveSyncCommandError('draft_not_ready', 'Le brouillon privé actif est introuvable.');
  }
  const states = new Map(stateSnapshot.docs.map((document) => [document.id, { key: document.id, ...document.data() }]));
  const binaries = new Map(binarySnapshot.docs.map((document) => [document.id, { binaryId: document.id, ...document.data() }]));
  const digest = sha256Digest({
    state: [...states.values()].map((record) => ({
      key: record.key,
      value: record.deleted === true ? null : record.value,
      deleted: record.deleted === true,
      revision: Number(record.revision || 0),
      clientUpdatedAt: Number(record.clientUpdatedAt || 0),
    })).sort((left, right) => left.key.localeCompare(right.key)),
    binaries: [...binaries.values()].map((record) => ({
      binaryId: record.binaryId,
      deleted: record.deleted === true,
      revision: Number(record.revision || 0),
      sha256: record.sha256 || null,
      storagePath: record.storagePath || null,
      size: Number(record.size || 0),
    })).sort((left, right) => left.binaryId.localeCompare(right.binaryId)),
  });
  return { draftRef, states, binaries, digest };
};

const buildAssetPatch = ({ asset, existing, binary, digest, cartularyId, organizationId }) => {
  const storagePath = binary?.deleted === false && typeof binary.storagePath === 'string'
    ? binary.storagePath
    : existing?.storagePath || null;
  const sha256 = binary?.deleted === false && /^sha256:[a-f0-9]{64}$/.test(binary.sha256 || '')
    ? binary.sha256
    : existing?.sha256 || null;
  return {
    id: asset.id,
    cartularyId,
    organizationId,
    mediaKind: ['image', 'video', 'audio', 'document'].includes(asset.type) ? asset.type : 'document',
    displayName: asText(asset.name, asset.id),
    originalFileName: typeof asset.originalFileName === 'string' ? asset.originalFileName : null,
    mimeDeclared: binary?.mimeType || asset.mimeType || existing?.mimeDeclared || null,
    sizeBytes: Number.isInteger(binary?.size) ? binary.size : existing?.sizeBytes || null,
    sha256,
    storagePath,
    binaryId: typeof asset.binaryId === 'string' ? asset.binaryId : existing?.binaryId || null,
    capturedAt: typeof asset.capturedAt === 'string' ? asset.capturedAt : null,
    timestampSource: typeof asset.timestampSource === 'string' ? asset.timestampSource : null,
    tags: Array.isArray(asset.tags) ? asset.tags.filter((tag) => typeof tag === 'string') : [],
    componentCode: typeof asset.category === 'string' ? asset.category : null,
    description: typeof asset.description === 'string' ? asset.description : null,
    processingState: storagePath ? 'ready' : 'pending_binary_reingest',
    visibility: existing?.visibility || 'secret',
    requestedVisibility: visibility(asset.visibility),
    liveSyncManaged: true,
    liveStateDigest: digest,
    projectionStatus: 'active',
    updatedAt: FieldValue.serverTimestamp(),
  };
};

export const processCartularySyncRequest = async ({
  firestore,
  requestDocumentId,
  occurredAt = new Date().toISOString(),
  rateLimitPerHour = SYNC_RATE_LIMIT_PER_HOUR,
}) => {
  const requestRef = firestore.doc(`cartularySyncRequests/${requestDocumentId}`);
  const initialRequest = await requestRef.get();
  if (!initialRequest.exists || initialRequest.data().status !== 'pending') {
    return { requestDocumentId, status: 'ignored', reason: 'not_pending' };
  }
  const requestData = initialRequest.data();
  const { ownerUid, cartularyId, requestId } = requestData;
  if (requestDocumentId !== cartularyId || typeof ownerUid !== 'string' || typeof requestId !== 'string') {
    throw new LiveSyncCommandError('invalid_request', 'Demande de synchronisation incomplète.');
  }
  const claim = await claimQueuedOperation({
    firestore,
    requestRef,
    requestId,
    ownerUid,
    operation: 'cartulary_sync',
    limit: rateLimitPerHour,
    windowMs: ONE_HOUR_MS,
    occurredAt,
  });
  if (!claim.claimed) return { requestDocumentId, status: 'ignored', reason: claim.reason };

  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const [root, auditSnapshot, draft, existingAssetsSnapshot] = await Promise.all([
    rootRef.get(),
    rootRef.collection('auditEvents').orderBy('sequence').get(),
    loadDraft(firestore, ownerUid, cartularyId),
    rootRef.collection('assets').get(),
  ]);
  if (!root.exists) throw new LiveSyncCommandError('cartulary_not_found', `Cartulaire ${cartularyId} introuvable.`);
  const rootData = root.data();
  const chain = verifyAuditChain({
    events: auditSnapshot.docs.map((document) => document.data()),
    integrityHead: rootData.integrityHead,
    integritySequence: rootData.integritySequence,
  });
  if (!chain.valid) throw new LiveSyncCommandError('audit_chain_invalid', 'La chaîne d’intégrité doit être valide avant synchronisation.');

  const specifications = stateValue(draft.states, 'cartularia-specification-groups');
  const media = stateValue(draft.states, 'cartularia-media-assets-v3');
  const makerName = asText(specificationValue(specifications, 'brand', 'Marque'), rootData.makerName);
  const modelName = asText(specificationValue(specifications, 'model', 'Modèle'), rootData.modelName);
  const referenceCode = asText(specificationValue(specifications, 'reference', 'Numéro de référence'), rootData.referenceCode);
  const manufactureYear = asYear(specificationValue(specifications, 'year', 'Année de fabrication'), rootData.manufactureYear);
  const mediaAssets = Array.isArray(media) ? media.filter((asset) => asset && typeof asset.id === 'string') : [];
  const primaryAssetId = mediaAssets.find((asset) => Array.isArray(asset.tags) && asset.tags.includes('main-photo'))?.id
    || rootData.primaryAssetId
    || null;
  const existingAssets = new Map(existingAssetsSnapshot.docs.map((document) => [document.id, document.data()]));
  const assetPatches = mediaAssets.map((asset) => buildAssetPatch({
    asset,
    existing: existingAssets.get(asset.id),
    binary: typeof asset.binaryId === 'string' ? draft.binaries.get(asset.binaryId) : null,
    digest: draft.digest,
    cartularyId,
    organizationId: rootData.organizationId,
  }));

  const registryRef = firestore.doc(`registries/${rootData.registryId}`);
  const registryItemRef = registryRef.collection('items').doc(cartularyId);
  const membershipRef = firestore.doc(`organizations/${rootData.organizationId}/memberships/${ownerUid}`);

  return firestore.runTransaction(async (transaction) => {
    const [currentRequest, currentRoot, registry, membership, registryItem] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(rootRef),
      transaction.get(registryRef),
      transaction.get(membershipRef),
      transaction.get(registryItemRef),
    ]);
    if (!currentRequest.exists || currentRequest.data().status !== 'processing' || currentRequest.data().requestId !== requestId) {
      return { requestDocumentId, status: 'ignored', reason: 'superseded' };
    }
    if (!currentRoot.exists) throw new LiveSyncCommandError('cartulary_not_found', 'Cartulaire introuvable pendant la transaction.');
    const currentRootData = currentRoot.data();
    if (currentRootData.revision !== rootData.revision || currentRootData.integrityHead !== rootData.integrityHead) {
      throw new LiveSyncCommandError('revision_conflict', 'Le Cartulaire a évolué pendant la synchronisation.');
    }
    if (!registry.exists || registry.data().organizationId !== rootData.organizationId) {
      throw new LiveSyncCommandError('registry_not_ready', 'Registre absent ou hors tenant.');
    }
    assertOwnerEditor(membership, currentRootData, ownerUid);

    if (currentRootData.liveStateDigest === draft.digest) {
      transaction.update(requestRef, {
        status: 'processed',
        outcome: 'no_change',
        sourceRevision: currentRootData.revision,
        processedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(draft.draftRef, {
        lastProjectionStatus: 'no_change',
        lastProjectedRevision: currentRootData.revision,
        lastProjectedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { requestDocumentId, status: 'processed', outcome: 'no_change', revision: currentRootData.revision };
    }

    const nextRevision = Number(currentRootData.revision || 0) + 1;
    const projection = {
      cartularyId,
      organizationId: currentRootData.organizationId,
      registryId: currentRootData.registryId,
      collectionId: currentRootData.collectionId,
      assetType: currentRootData.assetType,
      displayTitle: `${makerName} ${modelName}`.trim(),
      makerName,
      modelName,
      referenceCode,
      manufactureYear,
      lifecycleStatus: currentRootData.lifecycleStatus,
      possessionStatus: currentRootData.possessionStatus,
      completenessLevel: currentRootData.completenessLevel,
      primaryAssetId,
      sourceRevision: nextRevision,
      projectionStatus: 'active',
    };
    const contentHash = sha256Digest(projection);
    const auditEvent = createAuditEvent({ rootData: currentRootData, requestId, actorId: ownerUid, occurredAt, afterDigest: draft.digest });

    transaction.update(rootRef, {
      displayTitle: projection.displayTitle,
      makerName,
      modelName,
      referenceCode,
      manufactureYear,
      primaryAssetId,
      revision: nextRevision,
      liveStateDigest: draft.digest,
      liveStateUpdatedAt: FieldValue.serverTimestamp(),
      integrityHead: auditEvent.hash,
      integritySequence: auditEvent.sequence,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(rootRef.collection('auditEvents').doc(auditEvent.eventId), {
      ...auditEvent,
      occurredAt: Timestamp.fromDate(new Date(occurredAt)),
      occurredAtIso: occurredAt,
    });
    for (const record of draft.states.values()) {
      transaction.set(rootRef.collection('liveState').doc(record.key), {
        key: record.key,
        value: record.deleted === true ? null : record.value,
        deleted: record.deleted === true,
        sourceRevision: Number(record.revision || 0),
        clientUpdatedAt: Number(record.clientUpdatedAt || 0),
        liveStateDigest: draft.digest,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    for (const patch of assetPatches) transaction.set(rootRef.collection('assets').doc(patch.id), patch, { merge: true });
    const activeAssetIds = new Set(assetPatches.map((asset) => asset.id));
    for (const [assetId, existing] of existingAssets) {
      if (existing.liveSyncManaged === true && !activeAssetIds.has(assetId)) {
        transaction.set(rootRef.collection('assets').doc(assetId), {
          projectionStatus: 'withdrawn',
          liveStateDigest: draft.digest,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }
    transaction.set(registryItemRef, {
      ...projection,
      contentHash,
      generatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (!registryItem.exists) {
      transaction.update(registryRef, { itemCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
    }
    transaction.update(requestRef, {
      status: 'processed',
      outcome: 'updated',
      sourceRevision: nextRevision,
      contentHash,
      auditEventId: auditEvent.eventId,
      processedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(draft.draftRef, {
      lastProjectionStatus: 'updated',
      lastProjectedRevision: nextRevision,
      lastProjectedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      requestDocumentId,
      status: 'processed',
      outcome: 'updated',
      revision: nextRevision,
      contentHash,
      auditEventId: auditEvent.eventId,
    };
  });
};

export const markCartularySyncRequestFailed = async ({ firestore, requestDocumentId, requestId, error }) => {
  const requestRef = firestore.doc(`cartularySyncRequests/${requestDocumentId}`);
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(requestRef);
    if (
      !current.exists
      || !['pending', 'processing'].includes(current.data().status)
      || current.data().requestId !== requestId
    ) return;
    transaction.update(requestRef, {
      status: 'failed',
      errorCode: error?.code || 'sync_failed',
      errorMessage: String(error?.message || error).slice(0, 500),
      processedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};
