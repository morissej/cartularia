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
  return firestore.runTransaction(async (transaction) => {
  const [userSnapshot, organizationSnapshot, membershipSnapshot, registrySnapshot] = await transaction.getAll(
    userRef,
    organizationRef,
    membershipRef,
    registryRef,
  );
  const snapshots = [userSnapshot, organizationSnapshot, membershipSnapshot, registrySnapshot];
  if (snapshots.some((snapshot) => snapshot.exists && snapshot.data().status !== 'active')) {
    throw new AccountCommandError('permission_denied', 'Cet accès est suspendu ou retiré. La création ne peut pas rétablir ses droits.');
  }
  // The four documents are created atomically. An existing user with a missing
  // membership is not an interrupted activation: never recreate removed rights.
  if (userSnapshot.exists && snapshots.some((snapshot) => !snapshot.exists)) {
    throw new AccountCommandError('failed_precondition', 'Cet espace existant nécessite une vérification de ses droits.');
  }
  if (snapshots.every((snapshot) => snapshot.exists)) return { organizationId, registryId };
  if (snapshots.some((snapshot) => snapshot.exists)) {
    throw new AccountCommandError('failed_precondition', 'La configuration de cet espace nécessite une vérification.');
  }
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
  transaction.create(userRef, userDocument);
  transaction.create(organizationRef, {
    id: organizationId,
    name: `Espace de ${normalizedUserName}`,
    status: 'active',
    modelVersion: '1.0.0',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  transaction.create(membershipRef, {
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
  transaction.create(registryRef, {
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
  return { organizationId, registryId };
  });
};
