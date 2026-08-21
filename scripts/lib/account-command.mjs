import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';

const USER_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._'’-]{2,63}$/u;

export class AccountCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccountCommandError';
    this.code = code;
  }
}

const compactIdentifier = (prefix, uid) => `${prefix}_${createHash('sha256').update(uid).digest('hex').slice(0, 24)}`;

export const normalizeRegistryUserName = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 64);

export const activateRegistryAccount = async ({ firestore, uid, email, userName, timestamp = FieldValue.serverTimestamp() }) => {
  if (!uid || typeof uid !== 'string') throw new AccountCommandError('unauthenticated', 'Connexion requise.');
  const normalizedUserName = normalizeRegistryUserName(userName);
  if (!USER_NAME.test(normalizedUserName)) throw new AccountCommandError('invalid_argument', 'Le nom utilisateur est invalide.');

  const organizationId = compactIdentifier('org', uid);
  const registryId = compactIdentifier('reg', uid);
  const userRef = firestore.doc(`users/${uid}`);
  const organizationRef = firestore.doc(`organizations/${organizationId}`);
  const membershipRef = firestore.doc(`organizations/${organizationId}/memberships/${uid}`);
  const registryRef = firestore.doc(`registries/${registryId}`);
  const [userSnapshot, organizationSnapshot, membershipSnapshot, registrySnapshot] = await firestore.getAll(
    userRef,
    organizationRef,
    membershipRef,
    registryRef,
  );
  const batch = firestore.batch();
  const userDocument = {
    uid,
    email: String(email || ''),
    displayName: normalizedUserName,
    status: 'active',
    modelVersion: '1.0.0',
    createdAt: timestamp,
    lastActiveAt: timestamp,
    inactiveAt: null,
    purgeAfter: null,
    updatedAt: timestamp,
  };
  if (userSnapshot.exists) batch.update(userRef, { displayName: normalizedUserName, lastActiveAt: timestamp, updatedAt: timestamp });
  else batch.create(userRef, userDocument);
  if (!organizationSnapshot.exists) batch.create(organizationRef, {
    id: organizationId,
    name: `Espace de ${normalizedUserName}`,
    status: 'active',
    modelVersion: '1.0.0',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (!membershipSnapshot.exists) batch.create(membershipRef, {
    uid,
    organizationId,
    roles: ['account_holder', 'legal_owner'],
    status: 'active',
    scopes: { registryIds: [registryId] },
    permissions: [
      'organization.read',
      'membership.read',
      'registry.read',
      'access.read',
      'cartulary.read',
      'cartulary.edit',
      'cartulary.export',
      'integrity.batch',
      'publication.manage',
      'billing.read',
    ],
    createdAt: timestamp,
    revokedAt: null,
  });
  if (!registrySnapshot.exists) batch.create(registryRef, {
    id: registryId,
    organizationId,
    name: 'Mon Registre',
    description: 'Registre patrimonial privé',
    status: 'active',
    visibility: 'secret',
    itemCount: 0,
    modelVersion: '1.0.0',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await batch.commit();
  return { organizationId, registryId };
};
