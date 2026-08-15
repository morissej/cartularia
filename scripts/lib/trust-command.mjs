import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { verifyAuditChain, ZERO_AUDIT_HASH } from './audit-verifier.mjs';
import { CANONICALIZATION_VERSION, canonicalize, sha256Bytes, sha256Digest } from './canonical-json.mjs';
import { buildMerkleBatch } from './merkle.mjs';

const EXPORT_COLLECTIONS = Object.freeze([
  'sections',
  'sources',
  'assets',
  'spinSets',
  'observations',
  'valuations',
  'comparables',
  'reports',
  'reminders',
  'ownerRelations',
  'events',
  'auditEvents',
  'publicationApprovals',
  'reportProjections',
]);

export class TrustCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TrustCommandError';
    this.code = code;
  }
}

const validateIdentifier = (value, label) => {
  if (!/^[a-z0-9][a-z0-9_-]{5,127}$/.test(value || '')) {
    throw new TrustCommandError('invalid_identifier', `${label} doit être opaque et compatible Firestore.`);
  }
};

const assertPermission = (membership, rootData, actorId, permission) => {
  const data = membership.exists ? membership.data() : null;
  if (
    !data ||
    membership.id !== actorId ||
    data.uid !== actorId ||
    data.status !== 'active' ||
    !Array.isArray(data.roles) ||
    !data.roles.includes('legal_owner') ||
    !Array.isArray(data.permissions) ||
    !data.permissions.includes(permission) ||
    !Array.isArray(data.scopes?.registryIds) ||
    !data.scopes.registryIds.includes(rootData.registryId)
  ) {
    throw new TrustCommandError('permission_denied', `Permission ${permission} absente ou hors périmètre.`);
  }
};

const loadVerifiedHead = async (firestore, cartularyId) => {
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const [root, auditEvents] = await Promise.all([
    rootRef.get(),
    rootRef.collection('auditEvents').orderBy('sequence').get(),
  ]);
  if (!root.exists) throw new TrustCommandError('cartulary_not_found', `Cartulaire ${cartularyId} introuvable.`);
  const rootData = root.data();
  const verification = verifyAuditChain({
    events: auditEvents.docs.map((document) => document.data()),
    integrityHead: rootData.integrityHead,
    integritySequence: rootData.integritySequence,
  });
  if (!verification.valid) {
    throw new TrustCommandError('audit_chain_invalid', `La chaîne d’audit ${cartularyId} est invalide.`);
  }
  return { cartularyId, rootRef, rootData, verification };
};

export const createIntegrityBatch = async ({
  firestore,
  batchId,
  cartularyIds,
  actorId,
  requestId,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(batchId, 'batchId');
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  if (!Array.isArray(cartularyIds) || cartularyIds.length === 0) {
    throw new TrustCommandError('empty_batch', 'Le lot doit contenir au moins un Cartulaire.');
  }
  cartularyIds.forEach((cartularyId) => validateIdentifier(cartularyId, 'cartularyId'));
  const uniqueIds = [...new Set(cartularyIds)].sort();
  if (uniqueIds.length !== cartularyIds.length) throw new TrustCommandError('duplicate_cartulary', 'Doublon dans le lot.');

  const verifiedHeads = await Promise.all(uniqueIds.map((cartularyId) => loadVerifiedHead(firestore, cartularyId)));
  const merkle = buildMerkleBatch(verifiedHeads.map(({ cartularyId, rootData }) => ({
    cartularyId,
    revision: rootData.revision,
    integrityHead: rootData.integrityHead,
  })));
  const inputDigest = sha256Digest({
    command: 'createIntegrityBatch',
    batchId,
    heads: merkle.leaves.map(({ cartularyId, revision, integrityHead }) => ({ cartularyId, revision, integrityHead })),
  });
  const batchRef = firestore.doc(`integrityBatches/${batchId}`);

  return firestore.runTransaction(async (transaction) => {
    const membershipRefs = new Map();
    for (const head of verifiedHeads) {
      const path = `organizations/${head.rootData.organizationId}/memberships/${actorId}`;
      if (!membershipRefs.has(path)) membershipRefs.set(path, firestore.doc(path));
    }
    const [existingBatch, ...snapshots] = await Promise.all([
      transaction.get(batchRef),
      ...verifiedHeads.map((head) => transaction.get(head.rootRef)),
      ...[...membershipRefs.values()].map((reference) => transaction.get(reference)),
    ]);
    if (existingBatch.exists) {
      const data = existingBatch.data();
      if (data.requestId !== requestId || data.inputDigest !== inputDigest) {
        throw new TrustCommandError('idempotency_conflict', 'Le batchId existe avec une autre entrée.');
      }
      return { batchId, merkleRoot: data.merkleRoot, leafCount: data.leafCount, status: data.status, replayed: true };
    }
    const rootSnapshots = snapshots.slice(0, verifiedHeads.length);
    const membershipSnapshots = snapshots.slice(verifiedHeads.length);
    const membershipByPath = new Map(membershipSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]));
    verifiedHeads.forEach((head, index) => {
      const current = rootSnapshots[index];
      if (
        !current.exists ||
        current.data().revision !== head.rootData.revision ||
        current.data().integrityHead !== head.rootData.integrityHead
      ) {
        throw new TrustCommandError('revision_conflict', `Le Cartulaire ${head.cartularyId} a évolué pendant le lot.`);
      }
      assertPermission(
        membershipByPath.get(`organizations/${head.rootData.organizationId}/memberships/${actorId}`),
        head.rootData,
        actorId,
        'integrity.batch',
      );
    });

    transaction.create(batchRef, {
      batchId,
      algorithm: merkle.algorithm,
      canonicalizationVersion: merkle.canonicalizationVersion,
      merkleRoot: merkle.merkleRoot,
      leafCount: merkle.leafCount,
      status: 'pending_timestamp',
      timestampStatus: 'not_requested',
      publicAnchoringStatus: 'deferred',
      readerUids: [actorId],
      requestId,
      inputDigest,
      createdAt: Timestamp.fromDate(new Date(occurredAt)),
      createdAtIso: occurredAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const leaf of merkle.leaves) {
      transaction.create(batchRef.collection('receipts').doc(`leaf_${String(leaf.index).padStart(4, '0')}`), {
        batchId,
        ownerUid: actorId,
        cartularyId: leaf.cartularyId,
        sourceRevision: leaf.revision,
        integrityHead: leaf.integrityHead,
        leafHash: leaf.leafHash,
        leafIndex: leaf.index,
        proof: leaf.proof,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return {
      batchId,
      merkleRoot: merkle.merkleRoot,
      leafCount: merkle.leafCount,
      status: 'pending_timestamp',
      replayed: false,
    };
  });
};

export const attachTimestampReceipt = async ({ firestore, batchId, actorId, requestId, receipt }) => {
  validateIdentifier(batchId, 'batchId');
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  validateIdentifier(receipt?.receiptId, 'receiptId');
  if (!receipt?.tokenBase64 || !receipt?.tokenSha256 || !receipt?.digest) {
    throw new TrustCommandError('invalid_timestamp_receipt', 'Reçu d’horodatage incomplet.');
  }
  let token;
  try {
    token = Buffer.from(receipt.tokenBase64, 'base64');
  } catch {
    throw new TrustCommandError('invalid_timestamp_receipt', 'Jeton d’horodatage illisible.');
  }
  if (token.length === 0 || sha256Bytes(token) !== receipt.tokenSha256) {
    throw new TrustCommandError('invalid_timestamp_token', 'L’empreinte du jeton d’horodatage est invalide.');
  }
  const inputDigest = sha256Digest({ command: 'attachTimestampReceipt', batchId, receipt });
  const batchRef = firestore.doc(`integrityBatches/${batchId}`);
  const receiptRef = batchRef.collection('timestampReceipts').doc(receipt.receiptId);
  const commandReceiptRef = batchRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [batch, timestampReceipt, commandReceipt] = await Promise.all([
      transaction.get(batchRef),
      transaction.get(receiptRef),
      transaction.get(commandReceiptRef),
    ]);
    if (commandReceipt.exists) {
      if (commandReceipt.data().inputDigest !== inputDigest) {
        throw new TrustCommandError('idempotency_conflict', 'requestId déjà utilisé pour un autre reçu.');
      }
      return { ...commandReceipt.data().result, replayed: true };
    }
    if (!batch.exists) throw new TrustCommandError('batch_not_found', 'Lot d’intégrité introuvable.');
    const batchData = batch.data();
    if (!Array.isArray(batchData.readerUids) || !batchData.readerUids.includes(actorId)) {
      throw new TrustCommandError('permission_denied', 'Le compte ne peut pas horodater ce lot.');
    }
    if (receipt.digest !== batchData.merkleRoot) {
      throw new TrustCommandError('digest_mismatch', 'Le reçu ne cible pas la racine Merkle du lot.');
    }
    if (timestampReceipt.exists) {
      throw new TrustCommandError('receipt_exists', 'Ce reçu existe déjà sous une autre commande.');
    }
    const result = {
      batchId,
      receiptId: receipt.receiptId,
      status: 'timestamped',
      verificationStatus: receipt.verificationStatus,
      qualified: receipt.qualified === true,
      publicAnchoringStatus: 'deferred',
    };
    transaction.create(receiptRef, {
      ...receipt,
      batchId,
      ownerUid: actorId,
      createdAt: FieldValue.serverTimestamp(),
    });
    transaction.update(batchRef, {
      status: 'timestamped',
      timestampStatus: receipt.verificationStatus,
      timestampReceiptId: receipt.receiptId,
      timestampQualified: receipt.qualified === true,
      publicAnchoringStatus: 'deferred',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandReceiptRef, {
      requestId,
      command: 'attachTimestampReceipt',
      inputDigest,
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ...result, replayed: false };
  });
};

export const applyRevisionedIntegrityProjection = async ({
  firestore,
  cartularyId,
  sourceRevision,
  integrityHead,
  batchId,
}) => {
  validateIdentifier(cartularyId, 'cartularyId');
  validateIdentifier(batchId, 'batchId');
  if (!Number.isInteger(sourceRevision) || sourceRevision < 1 || !integrityHead?.startsWith('sha256:')) {
    throw new TrustCommandError('invalid_projection', 'Projection d’intégrité invalide.');
  }
  const projectionRef = firestore.doc(`integrityProjections/${cartularyId}`);
  return firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(projectionRef);
    if (current.exists && current.data().sourceRevision > sourceRevision) {
      return { cartularyId, sourceRevision: current.data().sourceRevision, applied: false, reason: 'older_revision' };
    }
    if (current.exists && current.data().sourceRevision === sourceRevision) {
      if (current.data().integrityHead !== integrityHead) {
        throw new TrustCommandError('projection_conflict', 'Même révision, empreinte différente.');
      }
      return { cartularyId, sourceRevision, applied: false, reason: 'replayed' };
    }
    transaction.set(projectionRef, {
      cartularyId,
      sourceRevision,
      integrityHead,
      batchId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { cartularyId, sourceRevision, applied: true, reason: 'newer_revision' };
  });
};

const toPortable = (value) => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Uint8Array) return { base64: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(toPortable);
  if (typeof value === 'object') {
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return { latitude: value.latitude, longitude: value.longitude };
    }
    if (typeof value.path === 'string' && value.firestore) return { referencePath: value.path };
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, toPortable(child)]));
  }
  throw new TrustCommandError('unsupported_export_value', 'Valeur non exportable détectée.');
};

const readReadyExport = async (jobRef) => {
  const [job, records] = await Promise.all([jobRef.get(), jobRef.collection('records').get()]);
  const orderedRecords = records.docs.map((document) => document.data()).sort((left, right) => left.recordKey.localeCompare(right.recordKey));
  return {
    exportId: job.id,
    cartularyId: job.data().cartularyId,
    revision: job.data().sourceRevision,
    status: job.data().status,
    manifest: job.data().manifest,
    portableBundle: { manifest: job.data().manifest, records: orderedRecords },
  };
};

export const createCartularyExport = async ({
  firestore,
  exportId,
  cartularyId,
  actorId,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(exportId, 'exportId');
  validateIdentifier(cartularyId, 'cartularyId');
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new TrustCommandError('invalid_revision', 'expectedRevision doit être un entier positif.');
  }
  const inputDigest = sha256Digest({ command: 'createCartularyExport', exportId, cartularyId, expectedRevision });
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const jobRef = firestore.doc(`cartularyExports/${exportId}`);
  const commandReceiptRef = rootRef.collection('commandReceipts').doc(requestId);

  const requestResult = await firestore.runTransaction(async (transaction) => {
    const root = await transaction.get(rootRef);
    if (!root.exists) throw new TrustCommandError('cartulary_not_found', 'Cartulaire introuvable.');
    const rootData = root.data();
    const membershipRef = firestore.doc(`organizations/${rootData.organizationId}/memberships/${actorId}`);
    const [commandReceipt, job, membership] = await Promise.all([
      transaction.get(commandReceiptRef),
      transaction.get(jobRef),
      transaction.get(membershipRef),
    ]);
    if (commandReceipt.exists) {
      if (commandReceipt.data().inputDigest !== inputDigest) {
        throw new TrustCommandError('idempotency_conflict', 'requestId déjà utilisé avec une autre entrée.');
      }
      return { ...commandReceipt.data().result, replayed: true };
    }
    if (job.exists) throw new TrustCommandError('export_exists', 'Cet export existe sous une autre commande.');
    if (rootData.revision !== expectedRevision) {
      throw new TrustCommandError('revision_conflict', `Révision attendue ${expectedRevision}, courante ${rootData.revision}.`);
    }
    assertPermission(membership, rootData, actorId, 'cartulary.export');

    const nextRevision = rootData.revision + 1;
    const previousEventHash = rootData.integrityHead || ZERO_AUDIT_HASH;
    const sequence = Number(rootData.integritySequence || 0) + 1;
    const eventId = `evt_${sha256Digest(`cartulary.export.requested:${requestId}`).slice(7, 31)}`;
    const eventWithoutHash = {
      eventId,
      cartularyId,
      sequence,
      occurredAt,
      actor: { uid: actorId, role: 'legal_owner' },
      action: 'cartulary.export.requested',
      resource: { type: 'cartularyExport', id: exportId },
      beforeDigest: previousEventHash,
      afterDigest: inputDigest,
      previousEventHash,
      canonicalizationVersion: CANONICALIZATION_VERSION,
      requestId,
    };
    const auditEvent = {
      ...eventWithoutHash,
      hash: sha256Digest({ previousEventHash, event: eventWithoutHash }),
    };
    const result = { exportId, cartularyId, revision: nextRevision, sourceRevision: nextRevision, status: 'preparing' };
    transaction.update(rootRef, {
      revision: nextRevision,
      integrityHead: auditEvent.hash,
      integritySequence: sequence,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(rootRef.collection('auditEvents').doc(eventId), {
      ...auditEvent,
      occurredAt: Timestamp.fromDate(new Date(occurredAt)),
      occurredAtIso: occurredAt,
    });
    transaction.create(jobRef, {
      exportId,
      cartularyId,
      ownerUid: actorId,
      organizationId: rootData.organizationId,
      registryId: rootData.registryId,
      sourceRevision: nextRevision,
      status: 'preparing',
      format: 'cartularia-portable-1',
      requestId,
      inputDigest,
      createdAt: Timestamp.fromDate(new Date(occurredAt)),
      createdAtIso: occurredAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(commandReceiptRef, {
      requestId,
      command: 'createCartularyExport',
      actorId,
      inputDigest,
      canonicalPayload: canonicalize(result),
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ...result, replayed: false };
  });

  const currentJob = await jobRef.get();
  if (currentJob.data()?.status === 'ready') return { ...(await readReadyExport(jobRef)), replayed: true };

  const [root, ...collectionSnapshots] = await Promise.all([
    rootRef.get(),
    ...EXPORT_COLLECTIONS.map((collectionName) => rootRef.collection(collectionName).get()),
  ]);
  if (!root.exists || root.data().revision !== requestResult.sourceRevision) {
    throw new TrustCommandError('revision_conflict', 'Le Cartulaire a évolué pendant la préparation de l’export.');
  }
  const portableRecords = [{
    collectionName: 'cartularies',
    documentId: cartularyId,
    data: toPortable(root.data()),
  }];
  collectionSnapshots.forEach((snapshot, index) => {
    const collectionName = EXPORT_COLLECTIONS[index];
    snapshot.docs.forEach((document) => portableRecords.push({
      collectionName,
      documentId: document.id,
      data: toPortable(document.data()),
    }));
  });
  const auditEvents = portableRecords.filter((record) => record.collectionName === 'auditEvents').map((record) => record.data);
  const chainVerification = verifyAuditChain({
    events: auditEvents,
    integrityHead: root.data().integrityHead,
    integritySequence: root.data().integritySequence,
  });
  if (!chainVerification.valid) throw new TrustCommandError('audit_chain_invalid', 'Export interrompu : chaîne d’audit invalide.');

  const records = portableRecords.map((record) => ({
    ...record,
    recordKey: `${record.collectionName}:${record.documentId}`,
    digest: sha256Digest(record.data),
  })).sort((left, right) => left.recordKey.localeCompare(right.recordKey));
  if (records.length > 430) throw new TrustCommandError('export_too_large', 'Export trop volumineux pour le lot transactionnel pilote.');
  const pendingAssets = records.filter((record) => record.collectionName === 'assets' && record.data.processingState !== 'ready').length;
  const recordCounts = Object.fromEntries(EXPORT_COLLECTIONS.concat('cartularies').map((collectionName) => [
    collectionName,
    records.filter((record) => record.collectionName === collectionName).length,
  ]).filter(([, count]) => count > 0));
  const manifestCore = {
    exportVersion: 'cartularia-portable-1',
    cartularyId,
    schemaVersion: `${root.data().schemaId}@${root.data().schemaVersion}`,
    sourceRevision: root.data().revision,
    integrityHead: root.data().integrityHead,
    integritySequence: root.data().integritySequence,
    auditChainValid: true,
    generatedAtIso: occurredAt,
    recordCounts,
    recordDigest: sha256Digest(records.map(({ recordKey, digest }) => ({ recordKey, digest }))),
    binaryPolicy: pendingAssets > 0 ? 'metadata_only_pending_reingest' : 'metadata_only',
    pendingAssetCount: pendingAssets,
    complete: pendingAssets === 0,
  };
  const manifest = { ...manifestCore, manifestDigest: sha256Digest(manifestCore) };

  await firestore.runTransaction(async (transaction) => {
    const [job, latestRoot] = await Promise.all([transaction.get(jobRef), transaction.get(rootRef)]);
    if (!job.exists) throw new TrustCommandError('export_not_found', 'Job d’export introuvable.');
    if (job.data().status === 'ready') return;
    if (job.data().inputDigest !== inputDigest || latestRoot.data().revision !== manifest.sourceRevision) {
      throw new TrustCommandError('revision_conflict', 'Le Cartulaire a évolué avant la finalisation de l’export.');
    }
    records.forEach((record) => {
      const recordId = `rec_${sha256Digest(record.recordKey).slice(7, 31)}`;
      transaction.set(jobRef.collection('records').doc(recordId), record);
    });
    transaction.update(jobRef, {
      status: 'ready',
      manifest,
      recordCount: records.length,
      readyAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    exportId,
    cartularyId,
    revision: manifest.sourceRevision,
    status: 'ready',
    manifest,
    portableBundle: { manifest, records },
    replayed: requestResult.replayed,
  };
};
