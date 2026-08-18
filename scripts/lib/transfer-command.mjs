import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CANONICALIZATION_VERSION, canonicalize, sha256Digest } from './canonical-json.mjs';
import { issueRfc3161Timestamp } from './rfc3161-timestamp.mjs';
import { processIntegrityBatchPublicAnchor } from './public-anchor-command.mjs';
import { attachTimestampReceipt, createIntegrityBatch } from './trust-command.mjs';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{5,127}$/;
const TRANSFER_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

const WITHHELD_MARKERS = Object.freeze([
  'cover.owner',
  'cover.storage',
  'cover.insurance',
  'cover.transmission',
  'value.purchase',
  'value.cost_basis',
  'acquisitionprice',
  'purchaseprice',
  'costbasis',
  'insurance',
  'assurance',
  'storageaddress',
  'stockage',
  'address',
  'adresse',
  'email',
  'phone',
  'telephone',
  'téléphone',
]);

export class TransferCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TransferCommandError';
    this.code = code;
  }
}

const validateIdentifier = (value, label) => {
  if (!IDENTIFIER_PATTERN.test(value || '')) {
    throw new TransferCommandError('invalid_identifier', `${label} doit être opaque et compatible Firestore.`);
  }
};

const normalizeSearchText = (value) => String(value || '')
  .normalize('NFD')
  .replaceAll(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('fr-FR')
  .replaceAll(/[^a-z0-9.]/g, '');

export const findWithheldTransferMarker = (value, path = 'data') => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findWithheldTransferMarker(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeSearchText(key);
      const marker = WITHHELD_MARKERS.find((candidate) => normalizedKey.includes(normalizeSearchText(candidate)));
      if (marker) return { path: `${path}.${key}`, marker };
      const found = findWithheldTransferMarker(child, `${path}.${key}`);
      if (found) return found;
    }
  }
  if (typeof value === 'string') {
    const normalizedValue = normalizeSearchText(value);
    const marker = WITHHELD_MARKERS.find((candidate) => normalizedValue.includes(normalizeSearchText(candidate)));
    if (marker) return { path, marker };
  }
  return null;
};

const assertRevision = (root, expectedRevision) => {
  if (!root.exists) throw new TransferCommandError('cartulary_not_found', 'Cartulaire introuvable.');
  if (!Number.isInteger(expectedRevision) || root.data().revision !== expectedRevision) {
    throw new TransferCommandError('revision_conflict', `La révision courante est ${root.data().revision}.`);
  }
};

const assertMembership = (membership, rootData, actorId, {
  currentOwner = false,
  legalOwnerCapability = false,
} = {}) => {
  const data = membership.exists ? membership.data() : null;
  if (
    !data
    || membership.id !== actorId
    || data.uid !== actorId
    || data.organizationId !== rootData.organizationId
    || data.status !== 'active'
    || !Array.isArray(data.permissions)
    || !data.permissions.includes('cartulary.edit')
    || !Array.isArray(data.scopes?.registryIds)
    || !data.scopes.registryIds.includes(rootData.registryId)
    || (legalOwnerCapability && (
      !Array.isArray(data.roles)
      || !data.roles.includes('legal_owner')
    ))
    || (currentOwner && (
      rootData.accountHolderId !== actorId
      || !Array.isArray(data.roles)
      || !data.roles.includes('legal_owner')
    ))
  ) {
    throw new TransferCommandError('permission_denied', 'Le compte ne peut pas décider cette cession.');
  }
};

const createAuditEvent = ({ rootData, requestId, actorId, actorRole, occurredAt, action, resource, afterDigest }) => {
  const previousEventHash = rootData.integrityHead || ZERO_HASH;
  const sequence = Number(rootData.integritySequence || 0) + 1;
  const eventId = `evt_${sha256Digest(`${action}:${requestId}`).slice(7, 31)}`;
  const eventWithoutHash = {
    eventId,
    cartularyId: rootData.id,
    sequence,
    occurredAt,
    actor: { uid: actorId, role: actorRole },
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

const writeAudit = ({ transaction, rootRef, rootData, requestId, actorId, actorRole = 'legal_owner', occurredAt, action, resource, afterDigest, rootPatch = {} }) => {
  const auditEvent = createAuditEvent({ rootData, requestId, actorId, actorRole, occurredAt, action, resource, afterDigest });
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

const inputReceipt = ({ transaction, receiptRef, requestId, command, actorId, inputDigest, result }) => {
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
    throw new TransferCommandError('idempotency_conflict', 'requestId déjà utilisé avec une autre intention.');
  }
  return { ...receipt.data().result, replayed: true };
};

export const proposeCartularyTransfer = async ({
  firestore,
  transferId,
  cartularyId,
  sellerUid,
  buyerUid,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
  expiresAt = new Date(new Date(occurredAt).valueOf() + TRANSFER_DURATION_MS).toISOString(),
}) => {
  for (const [value, label] of [[transferId, 'transferId'], [cartularyId, 'cartularyId'], [sellerUid, 'sellerUid'], [buyerUid, 'buyerUid'], [requestId, 'requestId']]) {
    validateIdentifier(value, label);
  }
  if (sellerUid === buyerUid) throw new TransferCommandError('same_owner', 'Le cédant et l’acquéreur doivent être distincts.');
  const expiration = new Date(expiresAt);
  if (Number.isNaN(expiration.valueOf()) || expiration <= new Date(occurredAt)) {
    throw new TransferCommandError('invalid_expiration', 'La date d’expiration doit être future.');
  }
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const transferRef = firestore.doc(`cartularyTransfers/${transferId}`);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);
  const inputDigest = sha256Digest({ command: 'proposeCartularyTransfer', transferId, cartularyId, sellerUid, buyerUid, expectedRevision, expiresAt });

  return firestore.runTransaction(async (transaction) => {
    const [root, transfer, receipt] = await Promise.all([
      transaction.get(rootRef), transaction.get(transferRef), transaction.get(receiptRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertRevision(root, expectedRevision);
    if (transfer.exists) throw new TransferCommandError('transfer_exists', 'Cette cession existe déjà.');
    const rootData = root.data();
    if (rootData.currentTransferId) throw new TransferCommandError('transfer_in_progress', 'Une cession est déjà ouverte pour ce Cartulaire.');
    const sellerMembershipRef = firestore.doc(`organizations/${rootData.organizationId}/memberships/${sellerUid}`);
    const buyerMembershipRef = firestore.doc(`organizations/${rootData.organizationId}/memberships/${buyerUid}`);
    const [sellerMembership, buyerMembership] = await Promise.all([
      transaction.get(sellerMembershipRef), transaction.get(buyerMembershipRef),
    ]);
    assertMembership(sellerMembership, rootData, sellerUid, { currentOwner: true });
    assertMembership(buyerMembership, rootData, buyerUid, { legalOwnerCapability: true });
    const proposalDigest = sha256Digest({ transferId, cartularyId, sellerUid, buyerUid, expectedRevision, expiresAt, decisionSource: 'human_confirmed' });
    const { auditEvent, nextRevision } = writeAudit({
      transaction,
      rootRef,
      rootData,
      requestId,
      actorId: sellerUid,
      occurredAt,
      action: 'cartulary.transfer.proposed',
      resource: { type: 'cartularyTransfer', id: transferId },
      afterDigest: proposalDigest,
      rootPatch: { currentTransferId: transferId, transferStatus: 'proposed' },
    });
    transaction.create(transferRef, {
      transferId,
      cartularyId,
      organizationId: rootData.organizationId,
      registryId: rootData.registryId,
      participantUids: [sellerUid, buyerUid],
      sellerUid,
      buyerUid,
      status: 'proposed',
      sourceRevision: nextRevision,
      expectedRevision,
      proposalHead: auditEvent.hash,
      sellerDecision: {
        status: 'accepted',
        actorUid: sellerUid,
        decisionSource: 'human_confirmed',
        decidedAtIso: occurredAt,
        digest: proposalDigest,
      },
      buyerDecision: { status: 'pending', decisionSource: null },
      expiresAt: Timestamp.fromDate(expiration),
      expiresAtIso: expiresAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { transferId, cartularyId, status: 'proposed', revision: nextRevision, sourceRevision: nextRevision, auditEventId: auditEvent.eventId };
    inputReceipt({ transaction, receiptRef, requestId, command: 'proposeCartularyTransfer', actorId: sellerUid, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const acceptCartularyTransfer = async ({
  firestore,
  transferId,
  buyerUid,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  for (const [value, label] of [[transferId, 'transferId'], [buyerUid, 'buyerUid'], [requestId, 'requestId']]) validateIdentifier(value, label);
  const transferRef = firestore.doc(`cartularyTransfers/${transferId}`);
  const initialTransfer = await transferRef.get();
  if (!initialTransfer.exists) throw new TransferCommandError('transfer_not_found', 'Cession introuvable.');
  const cartularyId = initialTransfer.data().cartularyId;
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);
  const inputDigest = sha256Digest({ command: 'acceptCartularyTransfer', transferId, buyerUid, expectedRevision });

  return firestore.runTransaction(async (transaction) => {
    const [root, transfer, receipt] = await Promise.all([
      transaction.get(rootRef), transaction.get(transferRef), transaction.get(receiptRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    if (!transfer.exists) throw new TransferCommandError('transfer_not_found', 'Cession introuvable.');
    const transferData = transfer.data();
    if (transferData.status === 'accepted' || transferData.status === 'completed') {
      if (transferData.buyerUid !== buyerUid || transferData.buyerDecision?.decisionSource !== 'human_confirmed') {
        throw new TransferCommandError('permission_denied', 'Cette acceptation appartient à un autre compte.');
      }
      return { transferId, cartularyId, status: transferData.status, revision: transferData.acceptedRevision, acceptedHead: transferData.acceptedHead, replayed: true };
    }
    assertRevision(root, expectedRevision);
    const rootData = root.data();
    if (
      transferData.status !== 'proposed'
      || transferData.sourceRevision !== rootData.revision
      || transferData.buyerUid !== buyerUid
      || transferData.sellerUid !== rootData.accountHolderId
      || transferData.sellerDecision?.decisionSource !== 'human_confirmed'
      || transferData.sellerDecision?.status !== 'accepted'
    ) {
      throw new TransferCommandError('stale_transfer', 'La proposition n’est plus valable pour la révision courante.');
    }
    if (transferData.expiresAt.toMillis() <= new Date(occurredAt).valueOf()) {
      throw new TransferCommandError('transfer_expired', 'La proposition de cession a expiré.');
    }
    const buyerMembership = await transaction.get(firestore.doc(`organizations/${rootData.organizationId}/memberships/${buyerUid}`));
    assertMembership(buyerMembership, rootData, buyerUid, { legalOwnerCapability: true });
    const acceptanceDigest = sha256Digest({
      transferId,
      proposalHead: transferData.proposalHead,
      sellerDecisionDigest: transferData.sellerDecision.digest,
      buyerUid,
      decisionSource: 'human_confirmed',
    });
    const { auditEvent, nextRevision } = writeAudit({
      transaction,
      rootRef,
      rootData,
      requestId,
      actorId: buyerUid,
      actorRole: 'prospective_legal_owner',
      occurredAt,
      action: 'cartulary.transfer.accepted',
      resource: { type: 'cartularyTransfer', id: transferId, proposalHead: transferData.proposalHead },
      afterDigest: acceptanceDigest,
      rootPatch: { transferStatus: 'accepted_pending_seal' },
    });
    transaction.update(transferRef, {
      status: 'accepted',
      buyerDecision: {
        status: 'accepted',
        actorUid: buyerUid,
        decisionSource: 'human_confirmed',
        decidedAtIso: occurredAt,
        digest: acceptanceDigest,
      },
      acceptedRevision: nextRevision,
      acceptedHead: auditEvent.hash,
      acceptedSequence: auditEvent.sequence,
      acceptedAt: Timestamp.fromDate(new Date(occurredAt)),
      acceptedAtIso: occurredAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { transferId, cartularyId, status: 'accepted', revision: nextRevision, acceptedHead: auditEvent.hash, auditEventId: auditEvent.eventId };
    inputReceipt({ transaction, receiptRef, requestId, command: 'acceptCartularyTransfer', actorId: buyerUid, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const rejectCartularyTransfer = async ({
  firestore,
  transferId,
  buyerUid,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  for (const [value, label] of [[transferId, 'transferId'], [buyerUid, 'buyerUid'], [requestId, 'requestId']]) validateIdentifier(value, label);
  const transferRef = firestore.doc(`cartularyTransfers/${transferId}`);
  const initial = await transferRef.get();
  if (!initial.exists) throw new TransferCommandError('transfer_not_found', 'Cession introuvable.');
  const rootRef = firestore.doc(`cartularies/${initial.data().cartularyId}`);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);
  const inputDigest = sha256Digest({ command: 'rejectCartularyTransfer', transferId, buyerUid, expectedRevision });
  return firestore.runTransaction(async (transaction) => {
    const [root, transfer, receipt] = await Promise.all([transaction.get(rootRef), transaction.get(transferRef), transaction.get(receiptRef)]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertRevision(root, expectedRevision);
    const transferData = transfer.data();
    const rootData = root.data();
    if (transferData.status !== 'proposed' || transferData.sourceRevision !== rootData.revision || transferData.buyerUid !== buyerUid) {
      throw new TransferCommandError('stale_transfer', 'La proposition ne peut plus être refusée.');
    }
    const rejectionDigest = sha256Digest({ transferId, proposalHead: transferData.proposalHead, buyerUid, decisionSource: 'human_confirmed', status: 'rejected' });
    const { auditEvent, nextRevision } = writeAudit({
      transaction, rootRef, rootData, requestId, actorId: buyerUid, actorRole: 'prospective_legal_owner', occurredAt,
      action: 'cartulary.transfer.rejected', resource: { type: 'cartularyTransfer', id: transferId }, afterDigest: rejectionDigest,
      rootPatch: { currentTransferId: null, transferStatus: 'rejected' },
    });
    transaction.update(transferRef, {
      status: 'rejected',
      buyerDecision: { status: 'rejected', actorUid: buyerUid, decisionSource: 'human_confirmed', decidedAtIso: occurredAt, digest: rejectionDigest },
      closedRevision: nextRevision,
      closedAt: Timestamp.fromDate(new Date(occurredAt)),
      closedAtIso: occurredAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { transferId, cartularyId: transferData.cartularyId, status: 'rejected', revision: nextRevision, auditEventId: auditEvent.eventId };
    inputReceipt({ transaction, receiptRef, requestId, command: 'rejectCartularyTransfer', actorId: buyerUid, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const expireCartularyTransfer = async ({ firestore, transferId, occurredAt = new Date().toISOString() }) => {
  validateIdentifier(transferId, 'transferId');
  const transferRef = firestore.doc(`cartularyTransfers/${transferId}`);
  const initial = await transferRef.get();
  if (!initial.exists) return { transferId, status: 'ignored', reason: 'missing' };
  const rootRef = firestore.doc(`cartularies/${initial.data().cartularyId}`);
  return firestore.runTransaction(async (transaction) => {
    const [root, transfer] = await Promise.all([transaction.get(rootRef), transaction.get(transferRef)]);
    if (!transfer.exists || transfer.data().status !== 'proposed') return { transferId, status: 'ignored', reason: transfer.data()?.status || 'missing' };
    if (transfer.data().expiresAt.toMillis() > new Date(occurredAt).valueOf()) return { transferId, status: 'ignored', reason: 'not_expired' };
    const rootData = root.data();
    const expirationDigest = sha256Digest({ transferId, proposalHead: transfer.data().proposalHead, status: 'expired', occurredAt });
    const { auditEvent, nextRevision } = writeAudit({
      transaction, rootRef, rootData, requestId: `expire_${sha256Digest(transferId).slice(7, 31)}`, actorId: 'cartularia-system', actorRole: 'system', occurredAt,
      action: 'cartulary.transfer.expired', resource: { type: 'cartularyTransfer', id: transferId }, afterDigest: expirationDigest,
      rootPatch: { currentTransferId: null, transferStatus: 'expired' },
    });
    transaction.update(transferRef, { status: 'expired', closedRevision: nextRevision, closedAt: Timestamp.fromDate(new Date(occurredAt)), closedAtIso: occurredAt, updatedAt: FieldValue.serverTimestamp() });
    return { transferId, status: 'expired', revision: nextRevision, auditEventId: auditEvent.eventId };
  });
};

export const sealAcceptedTransferHead = async ({
  firestore,
  transferId,
  issueTimestamp = issueRfc3161Timestamp,
  publicAnchorAdapter,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(transferId, 'transferId');
  const transferRef = firestore.doc(`cartularyTransfers/${transferId}`);
  const transfer = await transferRef.get();
  if (!transfer.exists || !['accepted', 'completed'].includes(transfer.data().status)) {
    throw new TransferCommandError('transfer_not_accepted', 'La cession doit être acceptée avant scellement.');
  }
  if (transfer.data().sealing?.status === 'timestamped' && transfer.data().sealing?.batchId) {
    return { ...transfer.data().sealing, replayed: true };
  }
  const data = transfer.data();
  const root = await firestore.doc(`cartularies/${data.cartularyId}`).get();
  if (root.data().integrityHead !== data.acceptedHead || root.data().accountHolderId !== data.sellerUid) {
    throw new TransferCommandError('accepted_head_changed', 'La tête acceptée a changé avant son scellement.');
  }
  const digestSuffix = sha256Digest(transferId).slice(7, 31);
  const batchId = `batch_transfer_${digestSuffix}`;
  const batch = await createIntegrityBatch({
    firestore,
    batchId,
    cartularyIds: [data.cartularyId],
    actorId: data.sellerUid,
    requestId: `transfer_batch_${digestSuffix}`,
    occurredAt,
  });
  const persistedBatch = await firestore.doc(`integrityBatches/${batchId}`).get();
  let timestamp;
  if (persistedBatch.data()?.status === 'timestamped' && persistedBatch.data()?.timestampReceiptId) {
    timestamp = {
      receiptId: persistedBatch.data().timestampReceiptId,
      verificationStatus: persistedBatch.data().timestampStatus,
      qualified: persistedBatch.data().timestampQualified === true,
      replayed: true,
    };
  } else {
    const timestampRequestId = `transfer_timestamp_${digestSuffix}`;
    const timestampReceipt = await issueTimestamp({ digest: batch.merkleRoot, requestId: timestampRequestId });
    timestamp = await attachTimestampReceipt({
      firestore,
      batchId,
      actorId: data.sellerUid,
      requestId: `transfer_attach_${digestSuffix}`,
      receipt: timestampReceipt,
    });
  }
  const anchor = await processIntegrityBatchPublicAnchor({ firestore, batchId, adapter: publicAnchorAdapter, now: new Date(occurredAt) });
  const sealing = {
    status: 'timestamped',
    batchId,
    merkleRoot: batch.merkleRoot,
    timestampReceiptId: timestamp.receiptId,
    timestampVerificationStatus: timestamp.verificationStatus,
    publicAnchoringStatus: anchor.status,
    publicAnchorBlockHeight: anchor.blockHeight ?? null,
    acceptedHead: data.acceptedHead,
    sealedAtIso: occurredAt,
  };
  await transferRef.update({ sealing, updatedAt: FieldValue.serverTimestamp() });
  return { ...sealing, replayed: false };
};

const sectionMustBeWithheld = (data) => Boolean(findWithheldTransferMarker({
  id: data.id,
  schemaSectionId: data.schemaSectionId,
  title: data.title,
  fields: data.fields,
  extensions: data.extensions,
}));

const toCanonicalTransferValue = (value) => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Uint8Array) return { base64: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(toCanonicalTransferValue);
  if (typeof value === 'object') {
    if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
      return { latitude: value.latitude, longitude: value.longitude };
    }
    if (typeof value.path === 'string' && value.firestore) return { referencePath: value.path };
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, toCanonicalTransferValue(child)]),
    );
  }
  throw new TransferCommandError('unsupported_private_archive_value', 'Valeur privée non canonisable détectée.');
};

const loadTransferDisposition = async ({ rootRef, sellerUid }) => {
  const collectionNames = ['sections', 'reports', 'reminders', 'publicationApprovals', 'reportProjections', 'sources', 'assets'];
  const snapshots = await Promise.all(collectionNames.map((name) => rootRef.collection(name).get()));
  const archive = [];
  const patches = [];
  for (let index = 0; index < snapshots.length; index += 1) {
    const collectionName = collectionNames[index];
    for (const document of snapshots[index].docs) {
      const data = document.data();
      if (collectionName === 'sections' && sectionMustBeWithheld(data)) {
        archive.push({ ref: document.ref, data, reason: 'previous_owner_private_section' });
      } else if (['reports', 'reminders', 'publicationApprovals', 'reportProjections'].includes(collectionName)) {
        archive.push({ ref: document.ref, data, reason: `previous_owner_${collectionName}` });
        if (collectionName === 'reportProjections') {
          const blocks = await document.ref.collection('blocks').get();
          blocks.docs.forEach((block) => archive.push({ ref: block.ref, data: block.data(), reason: 'previous_owner_report_block' }));
        }
      } else if (collectionName === 'sources' && typeof data.locator === 'string' && data.locator.includes(sellerUid)) {
        archive.push({ ref: document.ref, data, reason: 'previous_owner_source_locator', keepOriginal: true });
        patches.push({ ref: document.ref, data: { locator: 'withheld:previous-owner-private-source', transferSanitized: true } });
      } else if (collectionName === 'assets' && typeof data.storagePath === 'string' && data.storagePath.includes(sellerUid)) {
        archive.push({ ref: document.ref, data, reason: 'previous_owner_private_binary_path', keepOriginal: true });
        patches.push({ ref: document.ref, data: { storagePath: null, binaryId: null, processingState: 'pending_successor_reingest', transferSanitized: true } });
      }
    }
  }
  if (archive.length + patches.length > 350) throw new TransferCommandError('transfer_too_large', 'Trop de données privées à isoler dans une seule transaction pilote.');
  return { archive, patches };
};

export const completeCartularyTransfer = async ({
  firestore,
  transferId,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(transferId, 'transferId');
  validateIdentifier(requestId, 'requestId');
  const transferRef = firestore.doc(`cartularyTransfers/${transferId}`);
  const initialTransfer = await transferRef.get();
  if (!initialTransfer.exists) throw new TransferCommandError('transfer_not_found', 'Cession introuvable.');
  if (initialTransfer.data().status === 'completed') return { ...initialTransfer.data().completionResult, replayed: true };
  const transferData = initialTransfer.data();
  const rootRef = firestore.doc(`cartularies/${transferData.cartularyId}`);
  const disposition = await loadTransferDisposition({ rootRef, sellerUid: transferData.sellerUid });
  const publicationRef = firestore.doc(`publications/${(await rootRef.get()).data().publicCode}`);
  const publicBlocks = await publicationRef.collection('blocks').get();
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);
  const inputDigest = sha256Digest({ command: 'completeCartularyTransfer', transferId, expectedRevision, sealing: transferData.sealing });

  return firestore.runTransaction(async (transaction) => {
    const [root, transfer, receipt, publication] = await Promise.all([
      transaction.get(rootRef), transaction.get(transferRef), transaction.get(receiptRef), transaction.get(publicationRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertRevision(root, expectedRevision);
    const currentTransfer = transfer.data();
    const rootData = root.data();
    if (
      currentTransfer.status !== 'accepted'
      || currentTransfer.acceptedRevision !== rootData.revision
      || currentTransfer.acceptedHead !== rootData.integrityHead
      || currentTransfer.sellerUid !== rootData.accountHolderId
      || currentTransfer.sellerDecision?.decisionSource !== 'human_confirmed'
      || currentTransfer.buyerDecision?.decisionSource !== 'human_confirmed'
      || currentTransfer.sealing?.status !== 'timestamped'
      || currentTransfer.sealing?.acceptedHead !== currentTransfer.acceptedHead
      || !['pending_confirmation', 'anchored'].includes(currentTransfer.sealing?.publicAnchoringStatus)
    ) {
      throw new TransferCommandError('transfer_not_sealed', 'La tête acceptée n’est pas entièrement scellée ou la cession est devenue obsolète.');
    }
    const buyerMembership = await transaction.get(firestore.doc(`organizations/${rootData.organizationId}/memberships/${currentTransfer.buyerUid}`));
    assertMembership(buyerMembership, rootData, currentTransfer.buyerUid, { legalOwnerCapability: true });
    const previousRelationRef = rootRef.collection('ownerRelations').doc(rootData.legalOwnerRelationId);
    const previousRelation = await transaction.get(previousRelationRef);
    const newRelationId = `owner_relation_${sha256Digest(transferId).slice(7, 23)}`;
    const newRelationRef = rootRef.collection('ownerRelations').doc(newRelationId);
    const registryItemRef = firestore.doc(`registries/${rootData.registryId}/items/${rootData.id}`);
    const sealRef = firestore.doc(`seals/${rootData.publicCode}`);
    const sealingBatchRef = firestore.doc(`integrityBatches/${currentTransfer.sealing.batchId}`);
    const [newRelation, registryItem, seal] = await Promise.all([
      transaction.get(newRelationRef), transaction.get(registryItemRef), transaction.get(sealRef),
    ]);
    if (newRelation.exists) throw new TransferCommandError('owner_relation_exists', 'La relation du successeur existe déjà.');

    const archiveRef = firestore.doc(`transferPrivateArchives/${transferId}`);
    const archiveManifest = disposition.archive.map((record) => ({
      path: record.ref.path,
      reason: record.reason,
      digest: sha256Digest(toCanonicalTransferValue(record.data)),
    }));
    const transition = {
      transferId,
      inheritedHead: currentTransfer.acceptedHead,
      inheritedSequence: currentTransfer.acceptedSequence,
      sealingBatchId: currentTransfer.sealing.batchId,
      timestampReceiptId: currentTransfer.sealing.timestampReceiptId,
      publicAnchoringStatus: currentTransfer.sealing.publicAnchoringStatus,
      archiveManifestDigest: sha256Digest(archiveManifest),
      decisionSource: 'human_confirmed',
    };
    const transitionDigest = sha256Digest(transition);
    const { auditEvent, nextRevision } = writeAudit({
      transaction,
      rootRef,
      rootData,
      requestId,
      actorId: currentTransfer.buyerUid,
      occurredAt,
      action: 'cartulary.transfer.completed',
      resource: { type: 'cartularyTransfer', id: transferId, inheritedHead: currentTransfer.acceptedHead, sealingBatchId: currentTransfer.sealing.batchId },
      afterDigest: transitionDigest,
      rootPatch: {
        accountHolderId: currentTransfer.buyerUid,
        legalOwnerRelationId: newRelationId,
        lifecycleStatus: 'active',
        possessionStatus: 'in_possession',
        publicationStatus: publication.exists && publication.data().status === 'published' ? 'revoked' : 'none',
        currentTransferId: null,
        transferStatus: 'completed',
        ownershipTransferCount: Number(rootData.ownershipTransferCount || 0) + 1,
        ownershipRollover: { ...transition, transferredAtIso: occurredAt },
      },
    });
    if (previousRelation.exists) {
      transaction.update(previousRelationRef, { status: 'transferred', validUntil: occurredAt, transferId, updatedAt: FieldValue.serverTimestamp() });
    }
    transaction.create(newRelationRef, {
      id: newRelationId,
      cartularyId: rootData.id,
      organizationId: rootData.organizationId,
      userId: currentTransfer.buyerUid,
      relationType: 'legal_owner',
      status: 'current',
      validFrom: occurredAt,
      validUntil: null,
      proofStatus: 'documented',
      sourceRefs: [transferId, currentTransfer.sealing.timestampReceiptId],
      transferId,
      inheritedHead: currentTransfer.acceptedHead,
      visibility: 'secret',
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(sealingBatchRef, {
      readerUids: FieldValue.arrayUnion(currentTransfer.buyerUid),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(archiveRef, {
      transferId,
      cartularyId: rootData.id,
      sellerUid: currentTransfer.sellerUid,
      successorUid: currentTransfer.buyerUid,
      recordCount: disposition.archive.length,
      manifest: archiveManifest,
      manifestDigest: transition.archiveManifestDigest,
      status: 'sealed_previous_owner_private_archive',
      createdAt: FieldValue.serverTimestamp(),
    });
    for (const record of disposition.archive) {
      const archiveRecordRef = archiveRef.collection('records').doc(`rec_${sha256Digest(record.ref.path).slice(7, 31)}`);
      transaction.create(archiveRecordRef, {
        originalPath: record.ref.path,
        reason: record.reason,
        digest: sha256Digest(toCanonicalTransferValue(record.data)),
        data: record.data,
        createdAt: FieldValue.serverTimestamp(),
      });
      if (!record.keepOriginal) transaction.delete(record.ref);
    }
    disposition.patches.forEach((patch) => transaction.update(patch.ref, patch.data));
    publicBlocks.docs.forEach((block) => transaction.delete(block.ref));
    if (publication.exists && publication.data().status === 'published') {
      transaction.update(publicationRef, {
        status: 'revoked', publicationStatus: 'revoked', blockIds: [], assetCount: 0,
        reexaminationRequired: true, reexaminationReason: 'legal_owner_transfer',
        sourceRevision: nextRevision, revokedAt: Timestamp.fromDate(new Date(occurredAt)), revokedAtIso: occurredAt,
        contentHash: sha256Digest({ previousContentHash: publication.data().contentHash, transferId, status: 'revoked_for_reexamination' }),
      });
    }
    if (seal.exists && seal.data().status === 'issued') {
      transaction.update(sealRef, { status: 'revoked', reexaminationRequired: true, revokedAt: Timestamp.fromDate(new Date(occurredAt)), revokedAtIso: occurredAt });
    }
    if (registryItem.exists) {
      transaction.update(registryItemRef, {
        lifecycleStatus: 'active', possessionStatus: 'in_possession', sourceRevision: nextRevision,
        ownershipTransitionStatus: 'completed', publicationStatus: 'review_required', updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.create(rootRef.collection('events').doc(`transfer_${sha256Digest(transferId).slice(7, 31)}`), {
      id: `transfer_${sha256Digest(transferId).slice(7, 31)}`,
      cartularyId: rootData.id,
      organizationId: rootData.organizationId,
      eventType: 'cartulary.transfer.completed',
      occurredAt,
      actorId: currentTransfer.buyerUid,
      summary: 'Cession contradictoire achevée ; le détail probant demeure dans la chaîne d’audit.',
      sourceRefs: [transferId, currentTransfer.sealing.batchId],
      proofStatus: 'documented',
      authority: 'audit_chain',
      visibility: 'secret',
    });
    const result = {
      transferId,
      cartularyId: rootData.id,
      status: 'completed',
      revision: nextRevision,
      inheritedHead: currentTransfer.acceptedHead,
      completedHead: auditEvent.hash,
      auditEventId: auditEvent.eventId,
      newLegalOwnerRelationId: newRelationId,
      publicProjectionStatus: publication.exists && publication.data().status === 'published' ? 'revoked_for_reexamination' : 'none',
      privateReportStatus: 'withheld_in_previous_owner_archive',
    };
    transaction.update(transferRef, {
      status: 'completed',
      effectiveRevision: nextRevision,
      effectiveHead: auditEvent.hash,
      completedAt: Timestamp.fromDate(new Date(occurredAt)),
      completedAtIso: occurredAt,
      completionResult: result,
      updatedAt: FieldValue.serverTimestamp(),
    });
    inputReceipt({ transaction, receiptRef, requestId, command: 'completeCartularyTransfer', actorId: currentTransfer.buyerUid, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const runExpiredTransferSweep = async ({ firestore, occurredAt = new Date().toISOString(), limit = 100 }) => {
  const snapshot = await firestore.collection('cartularyTransfers')
    .where('status', '==', 'proposed')
    .where('expiresAt', '<=', Timestamp.fromDate(new Date(occurredAt)))
    .limit(limit)
    .get();
  const results = [];
  for (const transfer of snapshot.docs) results.push(await expireCartularyTransfer({ firestore, transferId: transfer.id, occurredAt }));
  return { inspected: snapshot.size, expired: results.filter((result) => result.status === 'expired').length, results };
};
