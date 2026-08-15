import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CANONICALIZATION_VERSION, sha256Digest } from './canonical-json.mjs';

const ZERO_HASH = `sha256:${'0'.repeat(64)}`;
const MEMBER_PERMISSIONS = Object.freeze([
  'community.read',
  'community.post',
  'community.comment',
  'community.react',
]);
const REACTIONS = new Set(['appreciate', 'useful', 'curious']);
const PROVENANCE_KEYS = new Set(['visibility', 'sourceRefs', 'assertedBy', 'proofStatus', 'confidence']);

export class CommunityCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CommunityCommandError';
    this.code = code;
  }
}

const validateIdentifier = (value, label) => {
  if (!/^[a-z0-9][a-z0-9_-]{5,127}$/.test(value || '')) {
    throw new CommunityCommandError('invalid_identifier', `${label} doit être opaque et compatible Firestore.`);
  }
};

const validateText = (value, label, { min = 1, max = 2000 } = {}) => {
  const normalized = String(value ?? '').trim();
  if (normalized.length < min || normalized.length > max) {
    throw new CommunityCommandError('invalid_text', `${label} doit contenir entre ${min} et ${max} caractères.`);
  }
  return normalized;
};

const assertCommunityPermission = (membership, actorId, permission) => {
  const data = membership.exists ? membership.data() : null;
  if (
    !data ||
    membership.id !== actorId ||
    data.uid !== actorId ||
    data.status !== 'active' ||
    !Array.isArray(data.permissions) ||
    !data.permissions.includes(permission)
  ) {
    throw new CommunityCommandError('community_permission_denied', `Permission ${permission} absente.`);
  }
};

const assertPatrimonialPublisher = (membership, rootData, actorId) => {
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
    throw new CommunityCommandError(
      'publication_permission_denied',
      'Seul un propriétaire légal actif peut créer la projection communautaire.',
    );
  }
};

const replayOrThrow = (receipt, inputDigest) => {
  if (!receipt.exists) return null;
  if (receipt.data().inputDigest !== inputDigest) {
    throw new CommunityCommandError('idempotency_conflict', 'requestId déjà utilisé avec une autre entrée.');
  }
  return { ...receipt.data().result, replayed: true };
};

const createReceipt = ({ transaction, receiptRef, requestId, command, actorId, inputDigest, result }) => {
  transaction.create(receiptRef, {
    requestId,
    command,
    actorId,
    inputDigest,
    result,
    createdAt: FieldValue.serverTimestamp(),
  });
};

const validateProjectedValue = (value, path = 'value', depth = 0) => {
  if (depth > 5) throw new CommunityCommandError('unsafe_projection_value', `${path} est trop imbriqué.`);
  if (value === null || ['string', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string' && value.length > 5000) {
      throw new CommunityCommandError('unsafe_projection_value', `${path} dépasse 5 000 caractères.`);
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CommunityCommandError('unsafe_projection_value', `${path} est invalide.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new CommunityCommandError('unsafe_projection_value', `${path} contient trop d’éléments.`);
    value.forEach((item, index) => validateProjectedValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 20 || entries.some(([key]) => PROVENANCE_KEYS.has(key))) {
      throw new CommunityCommandError(
        'unsafe_projection_value',
        `${path} contient une structure patrimoniale ou non bornée.`,
      );
    }
    entries.forEach(([key, child]) => validateProjectedValue(child, `${path}.${key}`, depth + 1));
    return;
  }
  throw new CommunityCommandError('unsafe_projection_value', `${path} contient un type non sérialisable.`);
};

const normalizeCommunityBlocks = (blocks, schema) => {
  if (!schema?.schemaId || !schema?.version || !Array.isArray(schema?.fields)) {
    throw new CommunityCommandError('invalid_schema', 'Le schéma vertical versionné est requis.');
  }
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 12) {
    throw new CommunityCommandError('invalid_blocks', 'La projection requiert entre 1 et 12 blocs.');
  }
  const policies = new Map(schema.fields.map((field) => [field.fieldId, field]));
  const normalized = blocks.map((block, index) => {
    validateIdentifier(block?.id, 'blockId');
    const title = validateText(block?.title, 'Titre du bloc', { max: 120 });
    const fields = block?.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new CommunityCommandError('invalid_block_fields', `Le bloc ${block.id} doit porter un objet fields.`);
    }
    const entries = Object.entries(fields);
    if (entries.length === 0 || entries.length > 40) {
      throw new CommunityCommandError('invalid_block_fields', `Le bloc ${block.id} doit contenir 1 à 40 champs.`);
    }
    for (const [fieldId, value] of entries) {
      const policy = policies.get(fieldId);
      if (!policy || !Array.isArray(policy.publishableTo) || !policy.publishableTo.includes('community')) {
        throw new CommunityCommandError(
          'secret_field_detected',
          `Le champ ${fieldId} n’est pas autorisé dans une projection communautaire.`,
        );
      }
      validateProjectedValue(value, `${block.id}.${fieldId}`);
    }
    return {
      blockId: block.id,
      title,
      order: (index + 1) * 10,
      fields: Object.fromEntries(entries),
      fieldIds: entries.map(([fieldId]) => fieldId).sort(),
    };
  });
  if (new Set(normalized.map((block) => block.blockId)).size !== normalized.length) {
    throw new CommunityCommandError('duplicate_block', 'Les blockId doivent être uniques.');
  }
  return normalized;
};

const createCartularyAudit = ({ rootData, requestId, actorId, occurredAt, publicationId, afterDigest }) => {
  const previousEventHash = rootData.integrityHead || ZERO_HASH;
  const sequence = Number(rootData.integritySequence || 0) + 1;
  const eventId = `evt_${sha256Digest(`community.published:${requestId}`).slice(7, 31)}`;
  const eventWithoutHash = {
    eventId,
    cartularyId: rootData.id,
    sequence,
    occurredAt,
    actor: { uid: actorId, role: 'legal_owner' },
    action: 'community.published',
    resource: { type: 'communityPublication', id: publicationId },
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

export const admitCommunityMember = async ({
  firestore,
  actorId,
  targetUid,
  pseudonym,
  requestId,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(targetUid, 'targetUid');
  validateIdentifier(requestId, 'requestId');
  const safePseudonym = validateText(pseudonym, 'Pseudonyme', { min: 3, max: 32 });
  const inputDigest = sha256Digest({ command: 'admitCommunityMember', targetUid, pseudonym: safePseudonym });
  const actorMembershipRef = firestore.doc(`communityMemberships/${actorId}`);
  const targetMembershipRef = firestore.doc(`communityMemberships/${targetUid}`);
  const targetProfileRef = firestore.doc(`communityProfiles/${targetUid}`);
  const receiptRef = firestore.doc(`communityCommandReceipts/${requestId}`);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, actorMembership, targetMembership] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(actorMembershipRef),
      transaction.get(targetMembershipRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertCommunityPermission(actorMembership, actorId, 'community.moderate');
    if (targetMembership.exists) {
      throw new CommunityCommandError('member_exists', 'Le membre communautaire existe déjà.');
    }
    transaction.create(targetMembershipRef, {
      uid: targetUid,
      roles: ['member'],
      permissions: [...MEMBER_PERMISSIONS],
      status: 'active',
      admittedBy: actorId,
      admittedAt: Timestamp.fromDate(new Date(occurredAt)),
      revokedAt: null,
    });
    transaction.create(targetProfileRef, {
      uid: targetUid,
      pseudonym: safePseudonym,
      bio: '',
      avatarAssetId: null,
      status: 'active',
      visibility: 'community',
      createdAt: Timestamp.fromDate(new Date(occurredAt)),
      updatedAt: Timestamp.fromDate(new Date(occurredAt)),
    });
    const result = { uid: targetUid, profileId: targetUid, status: 'active' };
    createReceipt({ transaction, receiptRef, requestId, command: 'admitCommunityMember', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const updateCommunityProfile = async ({
  firestore,
  actorId,
  pseudonym,
  bio = '',
  avatarAssetId = null,
  requestId,
}) => {
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  const safePseudonym = validateText(pseudonym, 'Pseudonyme', { min: 3, max: 32 });
  const safeBio = bio ? validateText(bio, 'Biographie', { max: 280 }) : '';
  if (avatarAssetId !== null) validateIdentifier(avatarAssetId, 'avatarAssetId');
  const inputDigest = sha256Digest({ command: 'updateCommunityProfile', actorId, safePseudonym, safeBio, avatarAssetId });
  const membershipRef = firestore.doc(`communityMemberships/${actorId}`);
  const profileRef = firestore.doc(`communityProfiles/${actorId}`);
  const receiptRef = profileRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, membership, profile] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(membershipRef),
      transaction.get(profileRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertCommunityPermission(membership, actorId, 'community.read');
    if (!profile.exists || profile.data().status !== 'active') {
      throw new CommunityCommandError('profile_not_ready', 'Profil communautaire absent ou suspendu.');
    }
    transaction.update(profileRef, {
      pseudonym: safePseudonym,
      bio: safeBio,
      avatarAssetId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { profileId: actorId, pseudonym: safePseudonym };
    createReceipt({ transaction, receiptRef, requestId, command: 'updateCommunityProfile', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const publishCommunityBlocks = async ({
  firestore,
  schema,
  cartularyId,
  publicationId,
  blocks,
  actorId,
  requestId,
  expectedRevision,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(cartularyId, 'cartularyId');
  validateIdentifier(publicationId, 'publicationId');
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  const normalizedBlocks = normalizeCommunityBlocks(blocks, schema);
  const inputDigest = sha256Digest({
    command: 'publishCommunityBlocks', cartularyId, publicationId, normalizedBlocks, expectedRevision,
  });
  const rootRef = firestore.doc(`cartularies/${cartularyId}`);
  const publicationRef = firestore.doc(`communityPublications/${publicationId}`);
  const receiptRef = rootRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, root, existingPublication] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(rootRef),
      transaction.get(publicationRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    if (!root.exists) throw new CommunityCommandError('cartulary_not_found', 'Cartulaire introuvable.');
    if (root.data().revision !== expectedRevision) {
      throw new CommunityCommandError('revision_conflict', 'La révision du Cartulaire a évolué.');
    }
    if (existingPublication.exists) {
      throw new CommunityCommandError('publication_exists', 'La publication communautaire existe déjà.');
    }
    const rootData = root.data();
    if (rootData.schemaId !== schema.schemaId || rootData.schemaVersion !== schema.version) {
      throw new CommunityCommandError('schema_mismatch', 'Le profil de projection ne correspond pas au Cartulaire.');
    }
    const publisherMembershipRef = firestore.doc(
      `organizations/${rootData.organizationId}/memberships/${actorId}`,
    );
    const communityMembershipRef = firestore.doc(`communityMemberships/${actorId}`);
    const [publisherMembership, communityMembership] = await Promise.all([
      transaction.get(publisherMembershipRef),
      transaction.get(communityMembershipRef),
    ]);
    assertPatrimonialPublisher(publisherMembership, rootData, actorId);
    assertCommunityPermission(communityMembership, actorId, 'community.post');

    const nextRevision = rootData.revision + 1;
    const projectionCore = {
      publicationId,
      audience: 'community',
      assetType: rootData.assetType,
      schemaVersion: `${rootData.schemaId}@${rootData.schemaVersion}`,
      displayTitle: rootData.displayTitle,
      makerName: rootData.makerName,
      modelName: rootData.modelName,
      referenceCode: rootData.referenceCode,
      status: 'published',
      publicationStatus: 'published',
      moderationStatus: 'approved',
      sourceRevision: nextRevision,
      blockIds: normalizedBlocks.map((block) => block.blockId),
      publishedAtIso: occurredAt,
    };
    const contentHash = sha256Digest({ projectionCore, blocks: normalizedBlocks });
    const auditEvent = createCartularyAudit({
      rootData, requestId, actorId, occurredAt, publicationId, afterDigest: contentHash,
    });
    transaction.update(rootRef, {
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
    transaction.create(publicationRef, {
      ...projectionCore,
      contentHash,
      publishedAt: Timestamp.fromDate(new Date(occurredAt)),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const block of normalizedBlocks) {
      transaction.create(publicationRef.collection('blocks').doc(block.blockId), {
        ...block,
        publicationId,
        audience: 'community',
        sourceRevision: nextRevision,
        contentHash: sha256Digest(block),
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    const result = { publicationId, revision: nextRevision, sourceRevision: nextRevision, contentHash };
    createReceipt({ transaction, receiptRef, requestId, command: 'publishCommunityBlocks', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const createCommunityPost = async ({
  firestore,
  postId,
  publicationId,
  actorId,
  body,
  requestId,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(postId, 'postId');
  validateIdentifier(publicationId, 'publicationId');
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  const safeBody = validateText(body, 'Texte du post', { max: 2000 });
  const inputDigest = sha256Digest({ command: 'createCommunityPost', postId, publicationId, safeBody });
  const postRef = firestore.doc(`communityPosts/${postId}`);
  const receiptRef = postRef.collection('commandReceipts').doc(requestId);
  const membershipRef = firestore.doc(`communityMemberships/${actorId}`);
  const profileRef = firestore.doc(`communityProfiles/${actorId}`);
  const publicationRef = firestore.doc(`communityPublications/${publicationId}`);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, post, membership, profile, publication] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(postRef),
      transaction.get(membershipRef),
      transaction.get(profileRef),
      transaction.get(publicationRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertCommunityPermission(membership, actorId, 'community.post');
    if (!profile.exists || profile.data().status !== 'active') {
      throw new CommunityCommandError('profile_not_ready', 'Profil communautaire absent ou suspendu.');
    }
    if (
      !publication.exists ||
      publication.data().status !== 'published' ||
      publication.data().moderationStatus !== 'approved'
    ) {
      throw new CommunityCommandError('publication_not_active', 'Publication communautaire indisponible.');
    }
    if (post.exists) throw new CommunityCommandError('post_exists', 'Le post existe déjà.');
    const core = {
      postId,
      communityPublicationId: publicationId,
      authorProfileId: actorId,
      authorPseudonym: profile.data().pseudonym,
      body: safeBody,
      status: 'active',
      moderationStatus: 'visible',
      commentCount: 0,
      reactionCount: 0,
      publishedAtIso: occurredAt,
    };
    const contentHash = sha256Digest(core);
    transaction.create(postRef, {
      ...core,
      contentHash,
      publishedAt: Timestamp.fromDate(new Date(occurredAt)),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { postId, publicationId, contentHash };
    createReceipt({ transaction, receiptRef, requestId, command: 'createCommunityPost', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const addCommunityComment = async ({
  firestore,
  postId,
  commentId,
  actorId,
  body,
  requestId,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(postId, 'postId');
  validateIdentifier(commentId, 'commentId');
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  const safeBody = validateText(body, 'Texte du commentaire', { max: 1200 });
  const inputDigest = sha256Digest({ command: 'addCommunityComment', postId, commentId, safeBody });
  const postRef = firestore.doc(`communityPosts/${postId}`);
  const commentRef = postRef.collection('comments').doc(commentId);
  const receiptRef = postRef.collection('commandReceipts').doc(requestId);
  const membershipRef = firestore.doc(`communityMemberships/${actorId}`);
  const profileRef = firestore.doc(`communityProfiles/${actorId}`);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, post, comment, membership, profile] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(postRef),
      transaction.get(commentRef),
      transaction.get(membershipRef),
      transaction.get(profileRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertCommunityPermission(membership, actorId, 'community.comment');
    if (!profile.exists || profile.data().status !== 'active') {
      throw new CommunityCommandError('profile_not_ready', 'Profil communautaire absent ou suspendu.');
    }
    if (!post.exists || post.data().status !== 'active' || post.data().moderationStatus !== 'visible') {
      throw new CommunityCommandError('post_not_active', 'Post communautaire indisponible.');
    }
    const publication = await transaction.get(
      firestore.doc(`communityPublications/${post.data().communityPublicationId}`),
    );
    if (!publication.exists || publication.data().status !== 'published') {
      throw new CommunityCommandError('publication_not_active', 'Publication communautaire indisponible.');
    }
    if (comment.exists) throw new CommunityCommandError('comment_exists', 'Le commentaire existe déjà.');
    const core = {
      commentId,
      postId,
      authorProfileId: actorId,
      authorPseudonym: profile.data().pseudonym,
      body: safeBody,
      status: 'visible',
      proofStatus: 'not_cartulary_evidence',
      createdAtIso: occurredAt,
    };
    const contentHash = sha256Digest(core);
    transaction.create(commentRef, {
      ...core,
      contentHash,
      createdAt: Timestamp.fromDate(new Date(occurredAt)),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(postRef, {
      commentCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = { postId, commentId, contentHash };
    createReceipt({ transaction, receiptRef, requestId, command: 'addCommunityComment', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const setCommunityReaction = async ({
  firestore,
  postId,
  actorId,
  reaction,
  requestId,
}) => {
  validateIdentifier(postId, 'postId');
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  if (!REACTIONS.has(reaction)) throw new CommunityCommandError('invalid_reaction', 'Réaction communautaire inconnue.');
  const inputDigest = sha256Digest({ command: 'setCommunityReaction', postId, actorId, reaction });
  const postRef = firestore.doc(`communityPosts/${postId}`);
  const reactionRef = postRef.collection('reactions').doc(actorId);
  const receiptRef = postRef.collection('commandReceipts').doc(requestId);
  const membershipRef = firestore.doc(`communityMemberships/${actorId}`);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, post, existingReaction, membership] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(postRef),
      transaction.get(reactionRef),
      transaction.get(membershipRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertCommunityPermission(membership, actorId, 'community.react');
    if (!post.exists || post.data().status !== 'active' || post.data().moderationStatus !== 'visible') {
      throw new CommunityCommandError('post_not_active', 'Post communautaire indisponible.');
    }
    transaction.set(reactionRef, {
      actorProfileId: actorId,
      reaction,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (!existingReaction.exists) {
      transaction.update(postRef, {
        reactionCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const result = { postId, reaction, created: !existingReaction.exists };
    createReceipt({ transaction, receiptRef, requestId, command: 'setCommunityReaction', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};

export const moderateCommunityPublication = async ({
  firestore,
  publicationId,
  actorId,
  reasonCode,
  requestId,
  occurredAt = new Date().toISOString(),
}) => {
  validateIdentifier(publicationId, 'publicationId');
  validateIdentifier(actorId, 'actorId');
  validateIdentifier(requestId, 'requestId');
  const safeReason = validateText(reasonCode, 'Motif de modération', { max: 120 });
  const inputDigest = sha256Digest({ command: 'moderateCommunityPublication', publicationId, safeReason });
  const publicationRef = firestore.doc(`communityPublications/${publicationId}`);
  const membershipRef = firestore.doc(`communityMemberships/${actorId}`);
  const receiptRef = publicationRef.collection('commandReceipts').doc(requestId);

  return firestore.runTransaction(async (transaction) => {
    const [receipt, publication, membership] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(publicationRef),
      transaction.get(membershipRef),
    ]);
    const replay = replayOrThrow(receipt, inputDigest);
    if (replay) return replay;
    assertCommunityPermission(membership, actorId, 'community.moderate');
    if (!publication.exists) throw new CommunityCommandError('publication_not_found', 'Publication introuvable.');
    const eventId = `mod_${sha256Digest(requestId).slice(7, 31)}`;
    transaction.update(publicationRef, {
      status: 'suspended',
      publicationStatus: 'suspended',
      moderationStatus: 'suspended',
      moderationReasonCode: safeReason,
      moderatedAt: Timestamp.fromDate(new Date(occurredAt)),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(publicationRef.collection('moderationEvents').doc(eventId), {
      eventId,
      publicationId,
      action: 'publication.suspended',
      reasonCode: safeReason,
      actorProfileId: actorId,
      occurredAt: Timestamp.fromDate(new Date(occurredAt)),
      occurredAtIso: occurredAt,
    });
    const result = { publicationId, status: 'suspended', moderationEventId: eventId };
    createReceipt({ transaction, receiptRef, requestId, command: 'moderateCommunityPublication', actorId, inputDigest, result });
    return { ...result, replayed: false };
  });
};
