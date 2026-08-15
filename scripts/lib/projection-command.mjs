import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CANONICALIZATION_VERSION, canonicalize, sha256Digest } from './canonical-json.mjs';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;

export const PUBLIC_BLOCK_ALLOWLIST = Object.freeze([
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
]);

export const REPORT_BLOCK_ALLOWLIST = Object.freeze([
  ...PUBLIC_BLOCK_ALLOWLIST,
  'cover-owner',
  'cover-transmission',
  'cover-storage',
  'condition-documentation',
  'value-market',
  'value-comparables-listings',
  'value-comparables-transactions',
  'value-comparables-analysis',
  'value-cost-basis',
  'value-performance',
  'value-sensitivity',
]);

const PUBLIC_FORBIDDEN_TOKENS = [
  'owner',
  'propriétaire',
  'transmission',
  'beneficiary',
  'bénéficiaire',
  'storage',
  'stockage',
  'serial',
  'série',
  'address',
  'adresse',
  'email',
  'phone',
  'téléphone',
  'acquisition',
  'purchaseprice',
  'costbasis',
  'original',
  '/private/',
  'media-vault',
  'documenturl',
  'downloadurl',
];

export class ProjectionCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProjectionCommandError';
    this.code = code;
  }
}

const validateIdentifier = (value, label) => {
  if (!/^[a-z0-9][a-z0-9_-]{5,127}$/.test(value || '')) {
    throw new ProjectionCommandError('invalid_identifier', `${label} doit être opaque et compatible Firestore.`);
  }
};

const assertExpectedRevision = (root, expectedRevision) => {
  if (!root.exists) throw new ProjectionCommandError('cartulary_not_found', 'Cartulaire introuvable.');
  if (root.data().revision !== expectedRevision) {
    throw new ProjectionCommandError(
      'revision_conflict',
      `Révision attendue ${expectedRevision}, révision courante ${root.data().revision}.`,
    );
  }
};

const assertPublisher = (membership, rootData, actorId) => {
  const data = membership.exists ? membership.data() : null;
  if (
    !data ||
    membership.id !== actorId ||
    data.uid !== actorId ||
    data.status !== 'active' ||
    !Array.isArray(data.roles) ||
    !data.roles.includes('legal_owner') ||
    !Array.isArray(data.permissions) ||
    !data.permissions.includes('publication.manage') ||
    !Array.isArray(data.scopes?.registryIds) ||
    !data.scopes.registryIds.includes(rootData.registryId)
  ) {
    throw new ProjectionCommandError(
      'permission_denied',
      'Seul un propriétaire légal actif disposant de publication.manage peut décider une projection.',
    );
  }
};

const normalizeBlocks = (blocks) => {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new ProjectionCommandError('invalid_blocks', 'La sélection doit contenir au moins un bloc.');
  }
  const normalized = blocks.map((block) => ({
    id: String(block?.id || ''),
    title: String(block?.title || ''),
    payload: block?.payload ?? {},
    assetRefs: Array.isArray(block?.assetRefs)
      ? block.assetRefs.map((assetRef) => ({
          assetId: String(assetRef?.assetId || ''),
          derivativeId: String(assetRef?.derivativeId || ''),
        }))
      : [],
  }));
  if (new Set(normalized.map((block) => block.id)).size !== normalized.length) {
    throw new ProjectionCommandError('duplicate_block', 'Un bloc ne peut apparaître qu’une fois.');
  }
  for (const block of normalized) {
    validateIdentifier(block.id, 'blockId');
    if (!block.title.trim()) throw new ProjectionCommandError('invalid_block_title', `Titre absent pour ${block.id}.`);
    for (const assetRef of block.assetRefs) {
      validateIdentifier(assetRef.assetId, 'assetId');
      validateIdentifier(assetRef.derivativeId, 'derivativeId');
    }
  }
  return normalized;
};

const findForbiddenPublicToken = (value, path = 'payload') => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const match = findForbiddenPublicToken(value[index], `${path}[${index}]`);
      if (match) return match;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const keyText = key.toLocaleLowerCase('fr-FR').replaceAll(/[^a-z0-9à-ÿ/]/g, '');
      const keyToken = PUBLIC_FORBIDDEN_TOKENS.find((token) => keyText.includes(token));
      if (keyToken) return { path: `${path}.${key}`, token: keyToken };
      const match = findForbiddenPublicToken(child, `${path}.${key}`);
      if (match) return match;
    }
    return null;
  }
  if (typeof value === 'string') {
    const text = value.toLocaleLowerCase('fr-FR').replaceAll(' ', '');
    const token = PUBLIC_FORBIDDEN_TOKENS.find((candidate) => text.includes(candidate.replaceAll(' ', '')));
    return token ? { path, token } : null;
  }
  return null;
};

const validateApprovalBlocks = (audience, blocks) => {
  const allowlist = audience === 'public' ? PUBLIC_BLOCK_ALLOWLIST : REPORT_BLOCK_ALLOWLIST;
  if (!['public', 'report'].includes(audience)) {
    throw new ProjectionCommandError('invalid_audience', 'Audience de projection inconnue.');
  }
  if (audience === 'public' && blocks.length !== 4) {
    throw new ProjectionCommandError('public_block_count', 'Le premier incrément public exige exactement quatre blocs W.');
  }
  for (const block of blocks) {
    if (!allowlist.includes(block.id)) {
      throw new ProjectionCommandError('block_not_allowlisted', `Le bloc ${block.id} est interdit pour ${audience}.`);
    }
    if (audience === 'public') {
      const forbidden = findForbiddenPublicToken(block.payload);
      if (forbidden) {
        throw new ProjectionCommandError(
          'secret_field_detected',
          `Le contenu public contient le marqueur interdit ${forbidden.token} à ${forbidden.path}.`,
        );
      }
    }
  }
};

const createAuditEvent = ({ rootData, requestId, actorId, occurredAt, action, resource, afterDigest }) => {
  const previousEventHash = rootData.integrityHead || ZERO_HASH;
  const sequence = Number(rootData.integritySequence || 0) + 1;
  const eventId = `evt_${sha256Digest(`${action}:${requestId}`).slice(7, 31)}`;
  const eventWithoutHash = {
    eventId,
    cartularyId: rootData.id,
    sequence,
    occurredAt,
    actor: { uid: actorId, role: 'legal_owner' },
    action,
    resource,
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

const writeAuditAndRoot = ({
  transaction,
  rootRef,
  rootData,
  requestId,
  actorId,
  occurredAt,
  action,
  resource,
  afterDigest,
  rootPatch = {},
}) => {
  const auditEvent = createAuditEvent({
    rootData,
    requestId,
    actorId,
    occurredAt,
    action,
    resource,
    afterDigest,
  });
  const nextRevision = rootData.revision + 1;
  transaction.update(rootRef, {
    ...rootPatch,
    revision: nextRevision,
    integrityHead: auditEvent.hash,
    integritySequence: auditEvent.sequence,
    updatedAt: FieldValue.serverTimestamp(),
  });
  transaction.create(rootRef.collection('auditEvents').doc(auditEvent.eventId), {
    ...auditEvent,
    occurredAt: Timestamp.fromDate(new Date(occurredAt)),
    occurredAtIso: occurredAt,
  });
  return { auditEvent, nextRevision };
};

const createReceipt = ({ transaction, receiptRef, requestId, command, actorId, inputDigest, result }) => {
  transaction.create(receiptRef, {
    requestId,
    command,
    actorId,
    inputDigest,
    canonicalPayload: canonicalize(result),
    result,
    createdAt: FieldValue.serverTimestamp(),
  });
};

const replayOrThrow = (receipt, inputDigest) => {
  if (!receipt.exists) return null;
  if (receipt.data().inputDigest !== inputDigest) {
    throw new ProjectionCommandError('idempotency_conflict', 'requestId déjà utilisé avec une entrée différente.');
  }
  return { ...receipt.data().result, replayed: true };
};

export const projectRegistryItem = async ({
  firestore,
  cartularyId,
  actorId,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(cartularyId, 'cartularyId');
  validateIdentifier(requestId, 'requestId');
  const inputDigest = sha256Digest({ command: 'projectRegistryItem', cartularyId, expectedRevision });
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, root] = await Promise.all([transaction.get(receiptRef), transaction.get(rootRef)]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertExpectedRevision(root, expectedRevision);
    const rootData = root.data();
    const registryRef = firestore.doc(`registries/${rootData.registryId}`);
    const membershipRef = firestore.doc(
      `organizations/${rootData.organizationId}/memberships/${actorId}`,
    );
    const itemRef = registryRef.collection('items').doc(cartularyId);
    const [registry, membership, item] = await Promise.all([
      transaction.get(registryRef),
      transaction.get(membershipRef),
      transaction.get(itemRef),
    ]);
    assertPublisher(membership, rootData, actorId);
    if (!registry.exists || registry.data().organizationId !== rootData.organizationId) {
      throw new ProjectionCommandError('registry_not_ready', 'Registre absent ou hors tenant.');
    }

    const projection = {
      cartularyId,
      organizationId: rootData.organizationId,
      registryId: rootData.registryId,
      collectionId: rootData.collectionId,
      assetType: rootData.assetType,
      displayTitle: rootData.displayTitle,
      makerName: rootData.makerName,
      modelName: rootData.modelName,
      referenceCode: rootData.referenceCode,
      manufactureYear: rootData.manufactureYear,
      lifecycleStatus: rootData.lifecycleStatus,
      possessionStatus: rootData.possessionStatus,
      completenessLevel: rootData.completenessLevel,
      primaryAssetId: rootData.primaryAssetId,
      sourceRevision: rootData.revision,
      projectionStatus: 'active',
    };
    const afterDigest = sha256Digest(projection);
    const { auditEvent, nextRevision } = writeAuditAndRoot({
      transaction,
      rootRef,
      rootData,
      requestId,
      actorId,
      occurredAt,
      action: 'registry.projected',
      resource: { type: 'registryItem', id: cartularyId },
      afterDigest,
    });
    transaction.set(itemRef, {
      ...projection,
      sourceRevision: nextRevision,
      contentHash: afterDigest,
      generatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (!item.exists) {
      transaction.update(registryRef, {
        itemCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const result = {
      cartularyId,
      registryId: rootData.registryId,
      revision: nextRevision,
      sourceRevision: nextRevision,
      auditEventId: auditEvent.eventId,
      contentHash: afterDigest,
    };
    createReceipt({ transaction, receiptRef, requestId, command: 'projectRegistryItem', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const recordProjectionApproval = async ({
  firestore,
  cartularyId,
  approvalId,
  audience,
  blocks,
  actorId,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(cartularyId, 'cartularyId');
  validateIdentifier(approvalId, 'approvalId');
  validateIdentifier(requestId, 'requestId');
  const normalizedBlocks = normalizeBlocks(blocks);
  validateApprovalBlocks(audience, normalizedBlocks);
  const inputDigest = sha256Digest({
    command: 'recordProjectionApproval',
    cartularyId,
    approvalId,
    audience,
    blocks: normalizedBlocks,
    expectedRevision,
  });
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const approvalRef = rootRef.collection('publicationApprovals').doc(approvalId);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, root, approval] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(rootRef),
      transaction.get(approvalRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertExpectedRevision(root, expectedRevision);
    if (approval.exists) throw new ProjectionCommandError('approval_exists', 'Cette approbation existe déjà.');
    const rootData = root.data();
    const membershipRef = firestore.doc(
      `organizations/${rootData.organizationId}/memberships/${actorId}`,
    );
    const membership = await transaction.get(membershipRef);
    assertPublisher(membership, rootData, actorId);

    const approvalDigest = sha256Digest({ audience, blocks: normalizedBlocks });
    const { auditEvent, nextRevision } = writeAuditAndRoot({
      transaction,
      rootRef,
      rootData,
      requestId,
      actorId,
      occurredAt,
      action: 'projection.approved',
      resource: { type: 'projectionApproval', id: approvalId },
      afterDigest: approvalDigest,
    });
    transaction.create(approvalRef, {
      approvalId,
      cartularyId,
      organizationId: rootData.organizationId,
      audience,
      status: 'approved',
      decisionSource: 'human_confirmed',
      approvedBy: actorId,
      approvedAt: Timestamp.fromDate(new Date(occurredAt)),
      approvedAtIso: occurredAt,
      sourceRevision: nextRevision,
      schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`,
      blockIds: normalizedBlocks.map((block) => block.id),
      blocks: normalizedBlocks,
      contentHash: approvalDigest,
      consumedAt: null,
    });
    const result = {
      cartularyId,
      approvalId,
      audience,
      revision: nextRevision,
      sourceRevision: nextRevision,
      auditEventId: auditEvent.eventId,
      contentHash: approvalDigest,
    };
    createReceipt({
      transaction,
      receiptRef,
      requestId,
      command: 'recordProjectionApproval',
      actorId,
      inputDigest,
      result,
    });
    return { ...result, replayed: false };
  });
};

const validateDerivative = ({ derivative, publicCode, assetRef }) => {
  if (!derivative.exists) {
    throw new ProjectionCommandError(
      'derivative_not_found',
      `Dérivé ${assetRef.assetId}/${assetRef.derivativeId} introuvable.`,
    );
  }
  const data = derivative.data();
  const expectedPrefix = `public/${publicCode}/${assetRef.assetId}/`;
  if (
    data.assetId !== assetRef.assetId ||
    data.derivativeId !== assetRef.derivativeId ||
    data.visibility !== 'public' ||
    data.processingState !== 'ready' ||
    data.publicCode !== publicCode ||
    typeof data.storagePath !== 'string' ||
    !data.storagePath.startsWith(expectedPrefix) ||
    !data.sha256 ||
    'originalUrl' in data ||
    'privatePath' in data ||
    'downloadUrl' in data
  ) {
    throw new ProjectionCommandError('unsafe_derivative', 'Le dérivé public ne respecte pas le contrat de séparation.');
  }
  return {
    assetId: data.assetId,
    derivativeId: data.derivativeId,
    mediaKind: data.mediaKind,
    mimeType: data.mimeDetected,
    storagePath: data.storagePath,
    contentHash: data.sha256,
  };
};

export const publishPublicBlocks = async ({
  firestore,
  cartularyId,
  approvalId,
  actorId,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(cartularyId, 'cartularyId');
  validateIdentifier(approvalId, 'approvalId');
  validateIdentifier(requestId, 'requestId');
  const inputDigest = sha256Digest({
    command: 'publishPublicBlocks',
    cartularyId,
    approvalId,
    expectedRevision,
  });
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const approvalRef = rootRef.collection('publicationApprovals').doc(approvalId);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, root, approval] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(rootRef),
      transaction.get(approvalRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertExpectedRevision(root, expectedRevision);
    const rootData = root.data();
    const membershipRef = firestore.doc(
      `organizations/${rootData.organizationId}/memberships/${actorId}`,
    );
    const publicationRef = firestore.doc(`publications/${rootData.publicCode}`);
    const sealRef = firestore.doc(`seals/${rootData.publicCode}`);
    const [membership, publication, seal] = await Promise.all([
      transaction.get(membershipRef),
      transaction.get(publicationRef),
      transaction.get(sealRef),
    ]);
    assertPublisher(membership, rootData, actorId);
    if (!approval.exists || approval.data().status !== 'approved' || approval.data().audience !== 'public') {
      throw new ProjectionCommandError('approval_not_ready', 'Approbation publique humaine absente ou déjà consommée.');
    }
    if (approval.data().approvedBy !== actorId || approval.data().sourceRevision !== rootData.revision) {
      throw new ProjectionCommandError('stale_approval', 'L’approbation ne correspond plus à la révision courante.');
    }
    if (publication.exists && publication.data().status !== 'revoked') {
      throw new ProjectionCommandError('publication_exists', 'Une publication active existe déjà pour ce code.');
    }
    const blocks = normalizeBlocks(approval.data().blocks);
    validateApprovalBlocks('public', blocks);

    const uniqueAssetRefs = [...new Map(
      blocks.flatMap((block) => block.assetRefs).map((assetRef) => [
        `${assetRef.assetId}:${assetRef.derivativeId}`,
        assetRef,
      ]),
    ).values()];
    const derivativeRefs = uniqueAssetRefs.map((assetRef) =>
      rootRef.collection('assets').doc(assetRef.assetId).collection('derivatives').doc(assetRef.derivativeId));
    const derivativeSnapshots = await Promise.all(derivativeRefs.map((ref) => transaction.get(ref)));
    const derivativesByKey = new Map(uniqueAssetRefs.map((assetRef, index) => [
      `${assetRef.assetId}:${assetRef.derivativeId}`,
      validateDerivative({ derivative: derivativeSnapshots[index], publicCode: rootData.publicCode, assetRef }),
    ]));
    const projectedBlocks = blocks.map((block) => ({
      blockId: block.id,
      title: block.title,
      payload: block.payload,
      assets: block.assetRefs.map((assetRef) => derivativesByKey.get(`${assetRef.assetId}:${assetRef.derivativeId}`)),
    }));
    const publicationRevision = publication.exists ? Number(publication.data().publicationRevision || 0) + 1 : 1;
    const projectionForHash = {
      publicCode: rootData.publicCode,
      cartularyId,
      assetType: rootData.assetType,
      schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`,
      sourceRevision: rootData.revision,
      publicationRevision,
      blocks: projectedBlocks,
    };
    const contentHash = sha256Digest(projectionForHash);
    const { auditEvent, nextRevision } = writeAuditAndRoot({
      transaction,
      rootRef,
      rootData,
      requestId,
      actorId,
      occurredAt,
      action: 'publication.published',
      resource: { type: 'publication', id: rootData.publicCode },
      afterDigest: contentHash,
      rootPatch: { publicationStatus: 'published' },
    });
    transaction.set(publicationRef, {
      publicCode: rootData.publicCode,
      cartularyId,
      audience: 'public',
      assetType: rootData.assetType,
      schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`,
      displayTitle: rootData.displayTitle,
      makerName: rootData.makerName,
      modelName: rootData.modelName,
      referenceCode: rootData.referenceCode,
      status: 'published',
      publicationStatus: 'published',
      publicationRevision,
      sourceRevision: nextRevision,
      blockIds: projectedBlocks.map((block) => block.blockId),
      assetCount: uniqueAssetRefs.length,
      contentHash,
      generatedAt: FieldValue.serverTimestamp(),
      publishedAt: Timestamp.fromDate(new Date(occurredAt)),
      publishedAtIso: occurredAt,
      revokedAt: null,
    });
    for (const block of projectedBlocks) {
      transaction.set(publicationRef.collection('blocks').doc(block.blockId), {
        ...block,
        sourceRevision: nextRevision,
        publicationStatus: 'published',
        contentHash: sha256Digest(block),
        generatedAt: FieldValue.serverTimestamp(),
      });
    }
    const sealData = {
      publicCode: rootData.publicCode,
      cartularyId,
      publicationPath: publicationRef.path,
      status: 'issued',
      contentHash,
      supportCode: `S-${sha256Digest(rootData.publicCode).slice(7, 15).toUpperCase()}`,
      issuedAt: Timestamp.fromDate(new Date(occurredAt)),
      issuedAtIso: occurredAt,
      schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`,
      publicationRevision,
      revokedAt: null,
    };
    if (seal.exists) transaction.update(sealRef, sealData);
    else transaction.create(sealRef, sealData);
    transaction.update(approvalRef, {
      status: 'consumed',
      consumedAt: Timestamp.fromDate(new Date(occurredAt)),
      consumedBy: publicationRef.path,
    });
    const result = {
      cartularyId,
      publicCode: rootData.publicCode,
      publicationRevision,
      revision: nextRevision,
      sourceRevision: nextRevision,
      auditEventId: auditEvent.eventId,
      contentHash,
      blockIds: projectedBlocks.map((block) => block.blockId),
      assetCount: uniqueAssetRefs.length,
    };
    createReceipt({ transaction, receiptRef, requestId, command: 'publishPublicBlocks', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const createReportProjection = async ({
  firestore,
  cartularyId,
  approvalId,
  reportId,
  actorId,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  for (const [value, label] of [[cartularyId, 'cartularyId'], [approvalId, 'approvalId'], [reportId, 'reportId'], [requestId, 'requestId']]) {
    validateIdentifier(value, label);
  }
  const inputDigest = sha256Digest({
    command: 'createReportProjection',
    cartularyId,
    approvalId,
    reportId,
    expectedRevision,
  });
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const approvalRef = rootRef.collection('publicationApprovals').doc(approvalId);
  const reportRef = rootRef.collection('reportProjections').doc(reportId);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, root, approval, report] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(rootRef),
      transaction.get(approvalRef),
      transaction.get(reportRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertExpectedRevision(root, expectedRevision);
    if (report.exists) throw new ProjectionCommandError('report_exists', 'Ce rapport existe déjà.');
    const rootData = root.data();
    const membershipRef = firestore.doc(
      `organizations/${rootData.organizationId}/memberships/${actorId}`,
    );
    const membership = await transaction.get(membershipRef);
    assertPublisher(membership, rootData, actorId);
    if (!approval.exists || approval.data().status !== 'approved' || approval.data().audience !== 'report') {
      throw new ProjectionCommandError('approval_not_ready', 'Approbation R humaine absente ou déjà consommée.');
    }
    if (approval.data().approvedBy !== actorId || approval.data().sourceRevision !== rootData.revision) {
      throw new ProjectionCommandError('stale_approval', 'L’approbation R ne correspond plus à la révision courante.');
    }
    const blocks = normalizeBlocks(approval.data().blocks);
    validateApprovalBlocks('report', blocks);
    const projection = {
      reportId,
      cartularyId,
      organizationId: rootData.organizationId,
      registryId: rootData.registryId,
      audience: 'owner_report',
      schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`,
      publicationStatus: 'generated',
      blockIds: blocks.map((block) => block.id),
      blocks: blocks.map((block) => ({ blockId: block.id, title: block.title, payload: block.payload })),
      sourceRevision: rootData.revision,
    };
    const contentHash = sha256Digest(projection);
    const { auditEvent, nextRevision } = writeAuditAndRoot({
      transaction,
      rootRef,
      rootData,
      requestId,
      actorId,
      occurredAt,
      action: 'report.projected',
      resource: { type: 'reportProjection', id: reportId },
      afterDigest: contentHash,
    });
    transaction.create(reportRef, {
      ...projection,
      sourceRevision: nextRevision,
      contentHash,
      generatedAt: FieldValue.serverTimestamp(),
      generatedAtIso: occurredAt,
    });
    for (const block of projection.blocks) {
      transaction.create(reportRef.collection('blocks').doc(block.blockId), {
        ...block,
        sourceRevision: nextRevision,
        contentHash: sha256Digest(block),
        generatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(approvalRef, {
      status: 'consumed',
      consumedAt: Timestamp.fromDate(new Date(occurredAt)),
      consumedBy: reportRef.path,
    });
    const result = {
      cartularyId,
      reportId,
      revision: nextRevision,
      sourceRevision: nextRevision,
      auditEventId: auditEvent.eventId,
      contentHash,
      blockIds: projection.blockIds,
    };
    createReceipt({ transaction, receiptRef, requestId, command: 'createReportProjection', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const revokePublicPublication = async ({
  firestore,
  cartularyId,
  actorId,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(cartularyId, 'cartularyId');
  validateIdentifier(requestId, 'requestId');
  const rootSnapshot = await firestore.doc(`cartularies/${cartularyId}`).get();
  if (!rootSnapshot.exists) throw new ProjectionCommandError('cartulary_not_found', 'Cartulaire introuvable.');
  const publicationRef = firestore.doc(`publications/${rootSnapshot.data().publicCode}`);
  const existingBlocks = await publicationRef.collection('blocks').get();
  const inputDigest = sha256Digest({ command: 'revokePublicPublication', cartularyId, expectedRevision });
  const rootRef = rootSnapshot.ref;
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, root, publication] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(rootRef),
      transaction.get(publicationRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertExpectedRevision(root, expectedRevision);
    const rootData = root.data();
    const membershipRef = firestore.doc(
      `organizations/${rootData.organizationId}/memberships/${actorId}`,
    );
    const sealRef = firestore.doc(`seals/${rootData.publicCode}`);
    const [membership, seal] = await Promise.all([
      transaction.get(membershipRef),
      transaction.get(sealRef),
    ]);
    assertPublisher(membership, rootData, actorId);
    if (!publication.exists || publication.data().status !== 'published') {
      throw new ProjectionCommandError('publication_not_active', 'Aucune publication active à révoquer.');
    }
    const revokedDigest = sha256Digest({
      publicCode: rootData.publicCode,
      previousContentHash: publication.data().contentHash,
      status: 'revoked',
      occurredAt,
    });
    const { auditEvent, nextRevision } = writeAuditAndRoot({
      transaction,
      rootRef,
      rootData,
      requestId,
      actorId,
      occurredAt,
      action: 'publication.revoked',
      resource: { type: 'publication', id: rootData.publicCode },
      afterDigest: revokedDigest,
      rootPatch: { publicationStatus: 'revoked' },
    });
    for (const block of existingBlocks.docs) transaction.delete(block.ref);
    transaction.update(publicationRef, {
      status: 'revoked',
      publicationStatus: 'revoked',
      publicationRevision: Number(publication.data().publicationRevision || 0) + 1,
      sourceRevision: nextRevision,
      blockIds: [],
      assetCount: 0,
      revokedAt: Timestamp.fromDate(new Date(occurredAt)),
      revokedAtIso: occurredAt,
      contentHash: revokedDigest,
    });
    if (seal.exists) {
      transaction.update(sealRef, {
        status: 'revoked',
        revokedAt: Timestamp.fromDate(new Date(occurredAt)),
        revokedAtIso: occurredAt,
      });
    }
    const result = {
      cartularyId,
      publicCode: rootData.publicCode,
      revision: nextRevision,
      sourceRevision: nextRevision,
      auditEventId: auditEvent.eventId,
      contentHash: revokedDigest,
      revokedBlockCount: existingBlocks.size,
    };
    createReceipt({
      transaction,
      receiptRef,
      requestId,
      command: 'revokePublicPublication',
      actorId,
      inputDigest,
      result,
    });
    return { ...result, replayed: false };
  });
};
