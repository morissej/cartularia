import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{2,127}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class InvitationCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InvitationCommandError';
    this.code = code;
  }
}

const digest = (value) => createHash('sha256').update(value).digest('hex');
const normalizeEmail = (value) => String(value || '').trim().toLocaleLowerCase('en-US');
const maskEmail = (email) => {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(3, local.length - 1))}@${domain}`;
};
const assertIdentifier = (value, label) => {
  if (!IDENTIFIER.test(value || '')) throw new InvitationCommandError('invalid_argument', `${label} est invalide.`);
};
const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left || '', 'hex');
  const rightBuffer = Buffer.from(right || '', 'hex');
  return leftBuffer.length === rightBuffer.length && leftBuffer.length > 0 && timingSafeEqual(leftBuffer, rightBuffer);
};

const assertManager = (membership, { actorUid, organizationId, registryId }) => {
  const data = membership.exists ? membership.data() : null;
  if (
    !data
    || data.uid !== actorUid
    || data.organizationId !== organizationId
    || data.status !== 'active'
    || !data.permissions?.includes('cartulary.edit')
    || !data.scopes?.registryIds?.includes(registryId)
  ) throw new InvitationCommandError('permission_denied', "Ce compte ne peut pas gérer les invitations de ce Registre.");
};

const assertScope = async ({ firestore, registryId, organizationId, scopeType, scopeId }) => {
  if (!['registry', 'collection', 'cartulary'].includes(scopeType)) {
    throw new InvitationCommandError('invalid_argument', 'La portée est invalide.');
  }
  if (scopeType === 'registry') {
    if (scopeId !== registryId) throw new InvitationCommandError('invalid_argument', 'Le Registre ciblé est incohérent.');
    return;
  }
  const ref = scopeType === 'collection'
    ? firestore.doc(`registries/${registryId}/collections/${scopeId}`)
    : firestore.doc(`registries/${registryId}/items/${scopeId}`);
  const snapshot = await ref.get();
  const data = snapshot.exists ? snapshot.data() : null;
  if (!data || data.registryId !== registryId || data.organizationId !== organizationId) {
    throw new InvitationCommandError('scope_not_found', 'Le périmètre invité est introuvable dans ce Registre.');
  }
};

export const issueRegistryInvitation = async ({
  firestore,
  auth,
  actorUid,
  registryId,
  recipientEmail,
  scopeType,
  scopeId,
  displayTitle,
  expiresAt = null,
  continueUrl,
  now = new Date(),
}) => {
  assertIdentifier(registryId, 'registryId');
  assertIdentifier(scopeId, 'scopeId');
  const email = normalizeEmail(recipientEmail);
  if (!EMAIL.test(email)) throw new InvitationCommandError('invalid_argument', "L’adresse électronique est invalide.");
  const registryRef = firestore.doc(`registries/${registryId}`);
  const registry = await registryRef.get();
  if (!registry.exists) throw new InvitationCommandError('not_found', 'Registre introuvable.');
  const organizationId = registry.data().organizationId;
  const membership = await firestore.doc(`organizations/${organizationId}/memberships/${actorUid}`).get();
  assertManager(membership, { actorUid, organizationId, registryId });
  await assertScope({ firestore, registryId, organizationId, scopeType, scopeId });

  const expiration = expiresAt ? new Date(expiresAt) : new Date(now.valueOf() + INVITATION_LIFETIME_MS);
  if (Number.isNaN(expiration.valueOf()) || expiration <= now || expiration.valueOf() > now.valueOf() + 31 * 24 * 60 * 60 * 1000) {
    throw new InvitationCommandError('invalid_argument', "L’expiration doit être comprise entre maintenant et 31 jours.");
  }
  const invitationId = `invite_${randomBytes(12).toString('hex')}`;
  const token = randomBytes(32).toString('base64url');
  const invitationRef = firestore.doc(`registryInvitations/${invitationId}`);
  const accessRef = firestore.doc(`registries/${registryId}/accesses/${invitationId}`);
  let appUrl;
  try {
    appUrl = new URL(continueUrl);
  } catch {
    throw new InvitationCommandError('invalid_argument', "L’adresse de retour est invalide.");
  }
  const allowedOrigins = new Set([
    process.env.INVITATION_APP_ORIGIN,
    process.env.GCLOUD_PROJECT ? `https://${process.env.GCLOUD_PROJECT}.web.app` : null,
    ...(process.env.FUNCTIONS_EMULATOR === 'true' ? ['http://127.0.0.1:5174', 'http://localhost:5174'] : []),
  ].filter(Boolean));
  if (!allowedOrigins.has(appUrl.origin) || appUrl.pathname !== '/invitation/accept') {
    throw new InvitationCommandError('permission_denied', "L’adresse de retour n’est pas autorisée.");
  }
  appUrl.searchParams.set('invitationId', invitationId);
  appUrl.searchParams.set('token', token);
  const signInLink = await auth.generateSignInWithEmailLink(email, {
    url: appUrl.toString(),
    handleCodeInApp: true,
  });
  const title = String(displayTitle || '').trim().slice(0, 160) || 'Accès Cartularia';
  const issuedAt = Timestamp.fromDate(now);
  const expirationTimestamp = Timestamp.fromDate(expiration);
  const tokenHash = digest(token);
  const emailHash = digest(email);

  await firestore.runTransaction(async (transaction) => {
    transaction.create(invitationRef, {
      id: invitationId,
      organizationId,
      registryId,
      scopeType,
      scopeId,
      displayTitle: title,
      recipientEmailHash: emailHash,
      tokenHash,
      status: 'pending',
      createdBy: actorUid,
      createdAt: issuedAt,
      expiresAt: expirationTimestamp,
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
    });
    transaction.create(accessRef, {
      id: invitationId,
      organizationId,
      registryId,
      cartularyId: scopeType === 'cartulary' ? scopeId : null,
      collectionId: scopeType === 'collection' ? scopeId : null,
      scopeType,
      scopeId,
      permissions: ['read'],
      displayTitle: title,
      recipientLabel: maskEmail(email),
      recipientKind: 'person',
      accessKind: 'invitation',
      sourceStatus: 'pending',
      issuedAt,
      expiresAt: expirationTimestamp,
      revokedAt: null,
      lastConsultedAt: null,
      consultationCount: 0,
      sourceRevision: 1,
      projectionStatus: 'active',
      contentHash: `sha256:${digest(`${invitationId}:${emailHash}:${tokenHash}`)}`,
      generatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(firestore.doc(`mail/${invitationId}`), {
      to: [email],
      message: {
        subject: `Invitation Cartularia · ${title}`,
        text: `Vous êtes invité à consulter ${title}. Ce lien personnel expire le ${expiration.toLocaleDateString('fr-FR')}. ${signInLink}`,
        html: `<p>Vous êtes invité à consulter <strong>${title.replaceAll('<', '&lt;')}</strong>.</p><p><a href="${signInLink}">Accepter l’invitation et se connecter</a></p><p>Ce lien personnel expire le ${expiration.toLocaleDateString('fr-FR')}.</p>`,
      },
      invitationId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { invitationId, expiresAt: expiration.toISOString(), signInLink };
};

const grantsFromSources = (sources) => Object.values(sources).reduce((grants, source) => {
  const previous = grants[source.registryId] || { registry: false, collectionIds: [], cartularyIds: [] };
  grants[source.registryId] = {
    registry: previous.registry || source.scopeType === 'registry',
    collectionIds: [...new Set([...previous.collectionIds, ...(source.scopeType === 'collection' ? [source.scopeId] : [])])],
    cartularyIds: [...new Set([...previous.cartularyIds, ...(source.scopeType === 'cartulary' ? [source.scopeId] : [])])],
  };
  return grants;
}, {});

const mergeInvitationGrant = (membership, invitationId, { registryId, scopeType, scopeId }) => {
  const invitationSources = {
    ...(membership?.invitationSources || {}),
    [invitationId]: { registryId, scopeType, scopeId },
  };
  return { invitationSources, invitationGrants: grantsFromSources(invitationSources) };
};

export const acceptRegistryInvitation = async ({ firestore, actorUid, actorEmail, invitationId, token, now = new Date() }) => {
  assertIdentifier(invitationId, 'invitationId');
  if (!actorUid || !token) throw new InvitationCommandError('unauthenticated', 'Connexion et jeton requis.');
  const emailHash = digest(normalizeEmail(actorEmail));
  const tokenHash = digest(String(token));
  const invitationRef = firestore.doc(`registryInvitations/${invitationId}`);

  return firestore.runTransaction(async (transaction) => {
    const invitation = await transaction.get(invitationRef);
    if (!invitation.exists) throw new InvitationCommandError('not_found', 'Invitation introuvable.');
    const data = invitation.data();
    if (data.status === 'active' && data.acceptedBy === actorUid) {
      return { registryId: data.registryId, scopeType: data.scopeType, scopeId: data.scopeId, replayed: true };
    }
    if (data.status !== 'pending') throw new InvitationCommandError('failed_precondition', "Cette invitation n’est plus active.");
    if (data.expiresAt.toDate() <= now) throw new InvitationCommandError('deadline_exceeded', 'Cette invitation a expiré.');
    if (!safeEqual(data.tokenHash, tokenHash) || !safeEqual(data.recipientEmailHash, emailHash)) {
      throw new InvitationCommandError('permission_denied', "Cette invitation ne correspond pas au compte connecté.");
    }
    const membershipRef = firestore.doc(`organizations/${data.organizationId}/memberships/${actorUid}`);
    const userRef = firestore.doc(`users/${actorUid}`);
    const accessRef = firestore.doc(`registries/${data.registryId}/accesses/${invitationId}`);
    const [membership, user] = await Promise.all([transaction.get(membershipRef), transaction.get(userRef)]);
    const currentMembership = membership.exists ? membership.data() : null;
    if (currentMembership && currentMembership.status === 'active' && currentMembership.invitationManaged !== true) {
      // Un membre existant conserve ses droits supérieurs : l'invitation ne peut jamais les réduire.
    } else {
      const mergedGrant = mergeInvitationGrant(currentMembership, invitationId, data);
      transaction.set(membershipRef, {
        uid: actorUid,
        organizationId: data.organizationId,
        roles: ['guest'],
        status: 'active',
        scopes: { registryIds: [...new Set([...(currentMembership?.scopes?.registryIds || []), data.registryId])] },
        permissions: ['organization.read', 'registry.read', 'cartulary.read'],
        invitationManaged: true,
        invitationSources: mergedGrant.invitationSources,
        invitationGrants: mergedGrant.invitationGrants,
        createdAt: currentMembership?.createdAt || FieldValue.serverTimestamp(),
        revokedAt: null,
      }, { merge: true });
    }
    if (!user.exists) {
      transaction.create(userRef, {
        uid: actorUid,
        email: normalizeEmail(actorEmail),
        displayName: '',
        status: 'active',
        modelVersion: '1.0.0',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(invitationRef, { status: 'active', acceptedAt: FieldValue.serverTimestamp(), acceptedBy: actorUid });
    transaction.update(accessRef, { sourceStatus: 'active', sourceRevision: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() });
    return { registryId: data.registryId, scopeType: data.scopeType, scopeId: data.scopeId, replayed: false };
  });
};

export const revokeRegistryInvitation = async ({ firestore, actorUid, registryId, invitationId }) => {
  assertIdentifier(registryId, 'registryId');
  assertIdentifier(invitationId, 'invitationId');
  const registry = await firestore.doc(`registries/${registryId}`).get();
  if (!registry.exists) throw new InvitationCommandError('not_found', 'Registre introuvable.');
  const organizationId = registry.data().organizationId;
  const manager = await firestore.doc(`organizations/${organizationId}/memberships/${actorUid}`).get();
  assertManager(manager, { actorUid, organizationId, registryId });
  const invitationRef = firestore.doc(`registryInvitations/${invitationId}`);
  const accessRef = firestore.doc(`registries/${registryId}/accesses/${invitationId}`);

  return firestore.runTransaction(async (transaction) => {
    const invitation = await transaction.get(invitationRef);
    if (!invitation.exists || invitation.data().registryId !== registryId) {
      throw new InvitationCommandError('not_found', 'Invitation introuvable.');
    }
    const data = invitation.data();
    if (data.status === 'revoked') return { replayed: true };
    if (data.acceptedBy) {
      const membershipRef = firestore.doc(`organizations/${organizationId}/memberships/${data.acceptedBy}`);
      const membership = await transaction.get(membershipRef);
      if (membership.exists && membership.data().invitationManaged === true) {
        const invitationSources = { ...(membership.data().invitationSources || {}) };
        delete invitationSources[invitationId];
        const invitationGrants = grantsFromSources(invitationSources);
        transaction.update(membershipRef, {
          invitationSources,
          invitationGrants,
          scopes: { registryIds: Object.keys(invitationGrants) },
          status: Object.keys(invitationGrants).length > 0 ? 'active' : 'revoked',
          revokedAt: Object.keys(invitationGrants).length > 0 ? null : FieldValue.serverTimestamp(),
        });
      }
    }
    transaction.update(invitationRef, { status: 'revoked', revokedAt: FieldValue.serverTimestamp() });
    transaction.update(accessRef, {
      sourceStatus: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
      sourceRevision: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { replayed: false };
  });
};
