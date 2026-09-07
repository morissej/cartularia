import { createHash } from 'node:crypto';

const ADMIN_ROLE = 'cartulariaAdmin';
const MAX_PAGE_SIZE = 200;
const RECENT_AUTH_SECONDS = 15 * 60;
const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'revoked'];

export class AdministrationCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AdministrationCommandError';
    this.code = code;
  }
}

export const requireAdministrator = (requestAuth, nowSeconds = Math.floor(Date.now() / 1000)) => {
  if (!requestAuth?.uid) {
    throw new AdministrationCommandError('unauthenticated', 'Connexion administrateur requise.');
  }
  if (requestAuth.token?.[ADMIN_ROLE] !== true) {
    throw new AdministrationCommandError('permission_denied', 'Ce compte ne possède pas le rôle administrateur.');
  }
  const authenticationTime = Number(requestAuth.token?.auth_time || 0);
  if (!authenticationTime || nowSeconds - authenticationTime > RECENT_AUTH_SECONDS) {
    throw new AdministrationCommandError('unauthenticated', 'Reconnectez-vous avec votre mot de passe administrateur.');
  }
  return requestAuth.uid;
};

const timestampIso = (value) => {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value.toISOString === 'function') return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
};

const sourceReference = (source, uid) => {
  if (source.id === 'registry') return source.firestore.doc(`users/${uid}`);
  if (source.id === 'personal') return source.firestore.doc(`vaultUsers/${uid}/vault/profile`);
  return source.firestore.doc(`codeAccounts/${uid}/account/profile`);
};

const publicUser = (source, user, documentSnapshot) => {
  const document = documentSnapshot?.exists ? documentSnapshot.data() : null;
  const fallbackLabel = source.id === 'registry' ? 'Compte Registre' : source.id === 'personal' ? 'Compte Coffre' : 'Compte de correspondance';
  return {
    uid: user.uid,
    label: source.id === 'registry' && typeof document?.displayName === 'string'
      ? document.displayName
      : user.displayName || fallbackLabel,
    email: source.id === 'registry' ? user.email || null : null,
    disabled: user.disabled === true,
    emailVerified: user.emailVerified === true,
    createdAt: user.metadata?.creationTime || null,
    lastSignInAt: user.metadata?.lastSignInTime || null,
    recordPresent: documentSnapshot?.exists === true,
    recordStatus: source.id === 'registry' && typeof document?.status === 'string' ? document.status : null,
    recordUpdatedAt: timestampIso(document?.updatedAt),
    codedReference: source.id === 'bridge' && typeof document?.primaryClientNumber === 'string'
      ? document.primaryClientNumber
      : null,
  };
};

const safeArray = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const normalizedAlias = (value) => String(value || '').trim().toLocaleLowerCase('fr');
const secondaryAuthenticationEmail = (databaseId, alias) => databaseId === 'personal'
  ? `${sha256Hex(`alias\u0000${normalizedAlias(alias)}`)}@access.cartularia.invalid`
  : `${sha256Hex(`bridge\u0000${normalizedAlias(alias)}`)}@codes.cartularia.invalid`;

const getUserOrNull = async (source, email) => {
  if (!source?.auth || !email) return null;
  try {
    return await source.auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
};

const sourceAccount = async (source, user) => {
  if (!source || !user) return null;
  const snapshot = await sourceReference(source, user.uid).get();
  return publicUser(source, user, snapshot);
};

const resolveRegistryIdentity = async ({ selectedSource, selectedUser, registrySource }) => {
  if (selectedSource.id === 'registry') return selectedUser;
  const result = await registrySource.auth.listUsers(MAX_PAGE_SIZE);
  const references = result.users.map((candidate) => sourceReference(registrySource, candidate.uid));
  const snapshots = references.length > 0 ? await registrySource.firestore.getAll(...references) : [];
  return result.users.find((candidate, index) => {
    const document = snapshots[index]?.exists ? snapshots[index].data() : null;
    const alias = typeof document?.displayName === 'string' ? document.displayName : candidate.displayName;
    return alias && secondaryAuthenticationEmail(selectedSource.id, alias) === selectedUser.email;
  }) || null;
};

const linkedDatabaseAccounts = async ({ sources, registryUser, registryDocument }) => {
  const alias = typeof registryDocument?.displayName === 'string'
    ? registryDocument.displayName
    : registryUser?.displayName || '';
  return Promise.all(sources.map(async (source) => {
    if (!source?.auth || !source?.firestore) {
      return { id: source.id, label: source.label, state: 'unconfigured', account: null };
    }
    try {
      const candidate = source.id === 'registry'
        ? registryUser
        : await getUserOrNull(source, secondaryAuthenticationEmail(source.id, alias));
      return {
        id: source.id,
        label: source.label,
        state: 'ready',
        account: candidate ? await sourceAccount(source, candidate) : null,
      };
    } catch {
      return { id: source.id, label: source.label, state: 'error', account: null };
    }
  }));
};

const registryDashboard = async ({ firestore, uid }) => {
  const [userSnapshot, membershipSnapshots, cartulariesSnapshot, draftsSnapshot] = await Promise.all([
    firestore.doc(`users/${uid}`).get(),
    Promise.all(MEMBERSHIP_STATUSES.map((status) => firestore.collectionGroup('memberships')
      .where('uid', '==', uid)
      .where('status', '==', status)
      .limit(50)
      .get())),
    firestore.collection('cartularies').where('accountHolderId', '==', uid).limit(200).get(),
    firestore.collection(`privateDrafts/${uid}/cartularies`).limit(200).get(),
  ]);
  const membershipDocuments = membershipSnapshots.flatMap((snapshot) => snapshot.docs);
  const memberships = membershipDocuments.map((snapshot) => {
    const data = snapshot.data();
    return {
      organizationId: String(data.organizationId || ''),
      status: String(data.status || 'unknown'),
      roles: safeArray(data.roles),
      permissions: safeArray(data.permissions),
      registryIds: safeArray(data.scopes?.registryIds),
    };
  }).filter((entry) => entry.organizationId);
  const cartularies = cartulariesSnapshot.docs.map((snapshot) => {
    const data = snapshot.data();
    return {
      id: snapshot.id,
      displayTitle: String(data.displayTitle || data.modelName || snapshot.id),
      makerName: String(data.makerName || ''),
      modelName: String(data.modelName || ''),
      assetType: String(data.assetType || 'other'),
      lifecycleStatus: String(data.lifecycleStatus || 'unknown'),
      publicationStatus: String(data.publicationStatus || 'none'),
      registryId: String(data.registryId || ''),
      collectionId: String(data.collectionId || ''),
      publicCode: typeof data.publicCode === 'string' ? data.publicCode : null,
      revision: Number.isFinite(data.revision) ? data.revision : null,
    };
  });
  const registryIds = [...new Set([
    ...memberships.flatMap((membership) => membership.registryIds),
    ...cartularies.map((cartulary) => cartulary.registryId),
  ].filter(Boolean))].slice(0, 100);
  const registrySnapshots = registryIds.length > 0
    ? await firestore.getAll(...registryIds.map((registryId) => firestore.doc(`registries/${registryId}`)))
    : [];
  const registries = registrySnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
    const data = snapshot.data();
    return {
      id: snapshot.id,
      organizationId: String(data.organizationId || ''),
      name: String(data.name || snapshot.id),
      description: String(data.description || ''),
      status: String(data.status || 'unknown'),
      itemCount: Number.isFinite(data.itemCount) ? data.itemCount : 0,
    };
  });
  const organizationIds = [...new Set(memberships.map((membership) => membership.organizationId))];
  const organizationSnapshots = organizationIds.length > 0
    ? await firestore.getAll(...organizationIds.map((organizationId) => firestore.doc(`organizations/${organizationId}`)))
    : [];
  const organizations = organizationSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
    const data = snapshot.data();
    return { id: snapshot.id, name: String(data.name || snapshot.id), status: String(data.status || 'unknown') };
  });
  const collectionGroups = await Promise.all(registries.map(async (registry) => {
    const snapshot = await firestore.collection(`registries/${registry.id}/collections`).limit(200).get();
    return snapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        registryId: registry.id,
        name: String(data.name || document.id),
        description: String(data.description || ''),
        status: String(data.status || 'draft'),
        visibility: String(data.visibility || 'secret'),
        publicationConsent: data.publicationConsent === true,
        publishedItemCount: safeArray(data.publishedCartularyIds).length,
      };
    });
  }));
  const drafts = draftsSnapshot.docs.map((snapshot) => {
    const data = snapshot.data();
    return {
      id: snapshot.id,
      status: String(data.status || 'unknown'),
      assetType: String(data.assetType || 'other'),
      registryId: String(data.registryId || ''),
    };
  });
  return {
    profile: userSnapshot.exists ? {
      displayName: String(userSnapshot.data().displayName || ''),
      status: String(userSnapshot.data().status || 'unknown'),
      updatedAt: timestampIso(userSnapshot.data().updatedAt),
      lastActiveAt: timestampIso(userSnapshot.data().lastActiveAt),
    } : null,
    organizations,
    memberships,
    registries,
    cartularies,
    collections: collectionGroups.flat(),
    drafts,
    truncated: {
      memberships: membershipSnapshots.some((snapshot) => snapshot.size >= 50),
      cartularies: cartulariesSnapshot.size >= 200,
      drafts: draftsSnapshot.size >= 200,
      collections: collectionGroups.some((group) => group.length >= 200),
    },
  };
};

export const loadAdministrationUserDashboard = async ({ sources, databaseId, targetUid }) => {
  const selectedSource = sources.find((source) => source.id === databaseId);
  const registrySource = sources.find((source) => source.id === 'registry');
  if (!selectedSource || !selectedSource.auth || !selectedSource.firestore || !registrySource?.auth || !registrySource?.firestore) {
    throw new AdministrationCommandError('failed_precondition', 'Cette base n’est pas configurée.');
  }
  if (!targetUid || typeof targetUid !== 'string') {
    throw new AdministrationCommandError('invalid_argument', 'Compte utilisateur invalide.');
  }
  let selectedUser;
  try {
    selectedUser = await selectedSource.auth.getUser(targetUid);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') throw new AdministrationCommandError('not_found', 'Compte utilisateur introuvable.');
    throw error;
  }
  const selectedAccount = await sourceAccount(selectedSource, selectedUser);
  const registryUser = await resolveRegistryIdentity({ selectedSource, selectedUser, registrySource });
  const registryDocument = registryUser ? await registrySource.firestore.doc(`users/${registryUser.uid}`).get() : null;
  const details = registryUser
    ? await registryDashboard({ firestore: registrySource.firestore, uid: registryUser.uid })
    : { profile: null, organizations: [], memberships: [], registries: [], cartularies: [], collections: [], drafts: [], truncated: {} };
  return {
    generatedAt: new Date().toISOString(),
    selectedDatabase: { id: selectedSource.id, label: selectedSource.label },
    selectedAccount,
    registryUid: registryUser?.uid || null,
    linkedDatabases: registryUser
      ? await linkedDatabaseAccounts({
        sources,
        registryUser,
        registryDocument: registryDocument?.exists ? registryDocument.data() : null,
      })
      : [{ id: selectedSource.id, label: selectedSource.label, state: 'ready', account: selectedAccount }],
    ...details,
    totals: {
      organizations: details.organizations.length,
      registries: details.registries.length,
      cartularies: details.cartularies.length,
      collections: details.collections.length,
      drafts: details.drafts.length,
    },
  };
};

const listSource = async (source, pageSize) => {
  if (!source?.auth || !source?.firestore) {
    return { id: source?.id || 'unknown', label: source?.label || 'Base inconnue', state: 'unconfigured', users: [], error: null };
  }
  try {
    const result = await source.auth.listUsers(pageSize);
    const references = result.users.map((user) => sourceReference(source, user.uid));
    const snapshots = references.length > 0 ? await source.firestore.getAll(...references) : [];
    return {
      id: source.id,
      label: source.label,
      state: 'ready',
      users: result.users.map((user, index) => publicUser(source, user, snapshots[index])),
      truncated: Boolean(result.pageToken),
      error: null,
    };
  } catch (error) {
    return {
      id: source.id,
      label: source.label,
      state: 'error',
      users: [],
      error: 'Cette base est momentanément inaccessible à la console.',
      diagnosticCode: error?.code || 'unknown',
    };
  }
};

export const loadAdministrationOverview = async ({ sources, pageSize = 100 }) => {
  const normalizedPageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(pageSize) || 100));
  const databases = await Promise.all(sources.map((source) => listSource(source, normalizedPageSize)));
  return {
    generatedAt: new Date().toISOString(),
    databases,
    totals: {
      users: databases.reduce((total, database) => total + database.users.length, 0),
      disabled: databases.reduce((total, database) => total + database.users.filter((user) => user.disabled).length, 0),
      configured: databases.filter((database) => database.state !== 'unconfigured').length,
    },
  };
};

const validReason = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 240);

export const setAdministrationUserDisabled = async ({
  actorUid,
  source,
  targetUid,
  disabled,
  reason,
  auditFirestore,
  timestamp,
}) => {
  if (!source?.auth || !source?.firestore) {
    throw new AdministrationCommandError('failed_precondition', 'Cette base n’est pas configurée.');
  }
  if (!targetUid || typeof targetUid !== 'string') {
    throw new AdministrationCommandError('invalid_argument', 'Compte utilisateur invalide.');
  }
  if (source.id === 'registry' && targetUid === actorUid && disabled === true) {
    throw new AdministrationCommandError('failed_precondition', 'Vous ne pouvez pas suspendre votre propre compte administrateur.');
  }
  const normalizedReason = validReason(reason);
  if (normalizedReason.length < 8) {
    throw new AdministrationCommandError('invalid_argument', 'Un motif d’au moins 8 caractères est requis.');
  }

  const previousUser = await source.auth.getUser(targetUid);
  const registryReference = source.id === 'registry' ? source.firestore.doc(`users/${targetUid}`) : null;
  const registrySnapshot = registryReference ? await registryReference.get() : null;
  const previousRegistryDocument = registrySnapshot?.exists ? registrySnapshot.data() : null;
  await source.auth.updateUser(targetUid, { disabled: disabled === true });
  try {
    if (registryReference && registrySnapshot?.exists) {
        await registryReference.update({
          status: disabled ? 'suspended' : 'active',
          inactiveAt: disabled ? timestamp : null,
          updatedAt: timestamp,
        });
    }
    await auditFirestore.collection('administrationAudit').add({
      schemaVersion: 'administration-audit@1.0.0',
      actorUid,
      targetUid,
      database: source.id,
      action: disabled ? 'user.suspend' : 'user.reactivate',
      reason: normalizedReason,
      createdAt: timestamp,
    });
  } catch (error) {
    await Promise.allSettled([
      source.auth.updateUser(targetUid, { disabled: previousUser.disabled === true }),
      ...(registryReference && previousRegistryDocument
        ? [registryReference.set(previousRegistryDocument)]
        : []),
    ]);
    throw error;
  }
  return { database: source.id, uid: targetUid, disabled: disabled === true };
};
