import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { CANONICALIZATION_VERSION, sha256Digest } from './canonical-json.mjs';
import { ZERO_AUDIT_HASH } from './audit-verifier.mjs';
import { normalizeCollectionWebsiteSlug, registryCollectionVersion } from './collection-policy.mjs';

const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;

export class CollectionCommandError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new CollectionCommandError(code, message); };
const ids = (value) => [...new Set([value.collectionId, ...(value.collectionIds || [])].filter(Boolean))];

/** A form's version is mandatory for updates; neither retries nor deletion can turn it into a create. */
export async function saveRegistryCollectionCommand({ firestore, uid, registryId, collectionId, mode, expectedVersion, input, confirmedPublication = false }) {
  if (!uid) fail('unauthenticated', 'Connexion requise.');
  if (typeof registryId !== 'string' || typeof collectionId !== 'string' || !SAFE_ID.test(registryId) || !SAFE_ID.test(collectionId) || !['create', 'update'].includes(mode)
    || (mode === 'update' && (typeof expectedVersion !== 'string' || !expectedVersion || expectedVersion.length > 160))) fail('invalid-argument', 'Version et Collection précises requises.');
  if (!input || Object.keys(input).some((key) => !['name', 'description', 'websiteTitle', 'websiteSlug', 'status', 'visibility', 'publicationConsent', 'publishedCartularyIds'].includes(key))
    || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 160
    || typeof input.websiteTitle !== 'string' || input.websiteTitle.length > 160
    || typeof input.description !== 'string' || input.description.length > 2000
    || typeof input.websiteSlug !== 'string' || input.websiteSlug.length > 160
    || !['draft', 'published', 'archived'].includes(input.status) || !['secret', 'public'].includes(input.visibility)
    || typeof input.publicationConsent !== 'boolean' || !Array.isArray(input.publishedCartularyIds)
    || input.publishedCartularyIds.length > 200 || input.publishedCartularyIds.some((id) => typeof id !== 'string' || !SAFE_ID.test(id))
    || new Set(input.publishedCartularyIds).size !== input.publishedCartularyIds.length) fail('invalid-argument', 'Vérifiez les informations et la sélection de la Collection (200 objets maximum).');
  const published = input.publicationConsent;
  if (published && (input.status === 'archived' || !input.publishedCartularyIds.length || confirmedPublication !== true)) fail('failed-precondition', 'Confirmez explicitement la sélection à mettre en ligne.');
  const selectedIds = published ? input.publishedCartularyIds : [];
  const registryRef = firestore.doc(`registries/${registryId}`);
  const collectionRef = registryRef.collection('collections').doc(collectionId);
  const publicationRef = firestore.doc(`collectionPublications/${registryId}--${collectionId}`);
  return firestore.runTransaction(async (transaction) => {
    const [registry, profile, current, publication, children] = await Promise.all([
      transaction.get(registryRef), transaction.get(firestore.doc(`users/${uid}`)), transaction.get(collectionRef),
      transaction.get(publicationRef), transaction.get(publicationRef.collection('items').limit(201)),
    ]);
    if (!registry.exists || registry.data().status === 'archived' || !profile.exists || profile.data().status !== 'active'
      || profile.data().accountPurpose === 'public_read_only_demo') fail('permission-denied', 'Votre compte ne peut pas modifier cette Collection.');
    const organizationId = registry.data().organizationId;
    const member = await transaction.get(firestore.doc(`organizations/${organizationId}/memberships/${uid}`));
    const rights = member.data();
    if (!member.exists || rights.uid !== uid || rights.status !== 'active' || !rights.permissions?.includes('cartulary.edit')
      || !rights.scopes?.registryIds?.includes(registryId) || (rights.invitationManaged && !rights.invitationGrants?.[registryId]?.registry)) fail('permission-denied', 'Droits de gestion du Registre requis.');
    if ((published || current.data()?.publicationConsent === true || publication.data()?.status === 'published') && !rights.permissions?.includes('publication.manage')) fail('permission-denied', 'Le droit de publication est requis pour modifier ou retirer ce mini-site.');
    if (mode === 'create' && current.exists) fail('already-exists', 'Cette Collection existe déjà. Actualisez la liste avant de continuer.');
    if (mode === 'update' && !current.exists) fail('not-found', 'Cette Collection a été supprimée. Votre ancienne saisie ne peut pas la recréer.');
    if (current.exists && (current.data().registryId !== registryId || current.data().organizationId !== organizationId)) fail('permission-denied', 'Collection hors de ce Registre.');
    if (mode === 'update' && registryCollectionVersion(current.data()) !== expectedVersion) fail('aborted', 'La Collection a changé dans une autre session. Rechargez sa dernière version et vérifiez la sélection publique avant de réessayer.');
    if (publication.exists && (publication.data().registryId !== registryId || publication.data().organizationId !== organizationId || publication.data().collectionId !== collectionId || publication.data().publicationId !== publicationRef.id)) fail('permission-denied', 'Publication hors de cette Collection.');
    if (children.size > 200 || children.docs.some((child) => child.data().collectionId !== collectionId)) fail('failed-precondition', 'L’ancienne publication nécessite une vérification avant modification.');
    const sources = await Promise.all(selectedIds.map(async (id) => {
      const [item, root] = await Promise.all([transaction.get(registryRef.collection('items').doc(id)), transaction.get(firestore.doc(`cartularies/${id}`))]);
      const data = item.data(), authoritative = root.data();
      if (!item.exists || !root.exists || data.cartularyId !== id || data.organizationId !== organizationId || data.registryId !== registryId
        || authoritative.organizationId !== organizationId || authoritative.registryId !== registryId || data.projectionStatus !== 'active'
        || !ids(data).includes(collectionId) || !ids(authoritative).includes(collectionId)
        || !['assetType', 'displayTitle', 'makerName', 'modelName'].every((key) => typeof data[key] === 'string' && data[key].length <= 1000)
        || (data.referenceCode != null && (typeof data.referenceCode !== 'string' || data.referenceCode.length > 1000)) || (data.manufactureYear != null && !Number.isInteger(data.manufactureYear))) fail('failed-precondition', 'Un objet sélectionné a changé de Collection ou n’est plus disponible. Rechargez la sélection.');
      return { cartularyId: id, collectionId, assetType: data.assetType, displayTitle: data.displayTitle, makerName: data.makerName,
        modelName: data.modelName, referenceCode: data.referenceCode ?? null, manufactureYear: data.manufactureYear ?? null,
        publicCode: typeof authoritative.objectCode === 'string' ? authoritative.objectCode : typeof authoritative.publicCode === 'string' ? authoritative.publicCode : null };
    }));
    const versionToken = `collection_${randomUUID()}`;
    const data = { id: collectionId, organizationId, registryId, name: input.name.trim(), description: input.description.trim(),
      websiteTitle: input.websiteTitle.trim() || input.name.trim(), websiteSlug: normalizeCollectionWebsiteSlug(input.websiteSlug || input.name),
      status: published ? 'published' : input.status === 'archived' ? 'archived' : 'draft', visibility: published ? 'public' : 'secret',
      publicationConsent: published, publishedCartularyIds: selectedIds, publishedAt: published ? current.data()?.publishedAt || FieldValue.serverTimestamp() : null,
      versionToken, updatedAt: FieldValue.serverTimestamp(), ...(mode === 'create' ? { createdAt: FieldValue.serverTimestamp() } : {}) };
    if (mode === 'create') transaction.create(collectionRef, data); else transaction.update(collectionRef, data);
    transaction.set(publicationRef, { publicationId: publicationRef.id, organizationId, registryId, collectionId, websiteTitle: data.websiteTitle,
      websiteSlug: data.websiteSlug, description: data.description, status: published ? 'published' : 'revoked', itemCount: sources.length,
      publishedAt: published ? publication.data()?.publishedAt || FieldValue.serverTimestamp() : publication.data()?.publishedAt || null, updatedAt: FieldValue.serverTimestamp() });
    for (const item of sources) transaction.set(publicationRef.collection('items').doc(item.cartularyId), item);
    for (const child of children.docs) if (!selectedIds.includes(child.id)) transaction.delete(child.ref);
    return { collectionId, versionToken, status: data.status };
  });
}

// Every normal reassignment reads the destination in the same transaction as
// the object write. Deletion reads/deletes that document, so the two operations
// cannot both commit against a stale destination.
export async function assertNewCollectionAssignments({ transaction, firestore, registryId, organizationId, previous, next }) {
  const previousIds = new Set(ids(previous));
  const added = ids(next).filter((id) => !previousIds.has(id));
  if (added.length > 200 || added.some((id) => typeof id !== 'string' || !SAFE_ID.test(id))) fail('invalid-argument', 'Sélection de Collections invalide.');
  const snapshots = await Promise.all(added.map((id) => transaction.get(firestore.doc(`registries/${registryId}/collections/${id}`))));
  for (const snapshot of snapshots) {
    const value = snapshot.data();
    if (!snapshot.exists || value.registryId !== registryId || value.organizationId !== organizationId || value.status === 'archived') {
      fail('failed-precondition', 'Une Collection choisie a été retirée ou archivée. Actualisez la sélection avant de réessayer.');
    }
  }
}

export async function deleteEmptyRegistryCollection({ firestore, uid, registryId, collectionId, expectedVersion, confirmed, detachObjects = false }) {
  if (!uid) fail('unauthenticated', 'Connexion requise.');
  if (confirmed !== true || !SAFE_ID.test(registryId || '') || !SAFE_ID.test(collectionId || '')
    || typeof expectedVersion !== 'string' || !expectedVersion || expectedVersion.length > 160) fail('invalid-argument', 'Confirmez la dernière version de la Collection à retirer.');
  const registryRef = firestore.doc(`registries/${registryId}`);
  const collectionRef = registryRef.collection('collections').doc(collectionId);
  const publicationRef = firestore.doc(`collectionPublications/${registryId}--${collectionId}`);
  return firestore.runTransaction(async (transaction) => {
    const [registry, profile, target, publication] = await Promise.all([
      transaction.get(registryRef), transaction.get(firestore.doc(`users/${uid}`)), transaction.get(collectionRef), transaction.get(publicationRef),
    ]);
    if (!registry.exists || !profile.exists || profile.data().status !== 'active' || profile.data().accountPurpose === 'public_read_only_demo') fail('permission-denied', 'Votre compte ne peut pas retirer cette Collection.');
    const organizationId = registry.data().organizationId;
    const membership = await transaction.get(firestore.doc(`organizations/${organizationId}/memberships/${uid}`));
    const rights = membership.data();
    if (!membership.exists || rights.uid !== uid || rights.status !== 'active'
      || !rights.permissions?.includes('cartulary.edit') || !rights.scopes?.registryIds?.includes(registryId)
      || (rights.invitationManaged && !rights.invitationGrants?.[registryId]?.registry)) fail('permission-denied', 'Droits de gestion du Registre requis.');
    if ((target.data()?.publicationConsent === true || publication.data()?.status === 'published') && !rights.permissions?.includes('publication.manage')) fail('permission-denied', 'Le droit de publication est requis pour retirer ce mini-site.');
    if (target.exists) {
      const value = target.data();
      if (value.registryId !== registryId || value.organizationId !== organizationId) fail('permission-denied', 'Collection hors de ce Registre.');
      if (registryCollectionVersion(value) !== expectedVersion) fail('aborted', 'La Collection a changé. Actualisez-la avant de confirmer à nouveau.');
    }
    if (publication.exists) {
      const value = publication.data();
      if (value.publicationId !== publicationRef.id || value.registryId !== registryId
        || value.collectionId !== collectionId || value.organizationId !== organizationId) fail('permission-denied', 'Publication hors de cette Collection.');
    }
    const roots = firestore.collection('cartularies').where('registryId', '==', registryId);
    const items = registryRef.collection('items');
    const matches = await Promise.all([
      transaction.get(roots.where('collectionId', '==', collectionId).limit(detachObjects ? 41 : 1)),
      transaction.get(roots.where('collectionIds', 'array-contains', collectionId).limit(detachObjects ? 41 : 1)),
      transaction.get(items.where('collectionId', '==', collectionId).limit(detachObjects ? 41 : 1)),
      transaction.get(items.where('collectionIds', 'array-contains', collectionId).limit(detachObjects ? 41 : 1)),
    ]);
    if (!detachObjects && matches.some((snapshot) => !snapshot.empty)) fail('failed-precondition', 'Cette Collection contient encore un objet. Déplacez les objets avant de la retirer.');
    const objectIds = [...new Set(matches.flatMap((snapshot) => snapshot.docs.map((document) => document.id)))];
    if (objectIds.length > 40) fail('failed-precondition', 'Cette Collection contient plus de 40 objets. Réaffectez-les par lots avant de retirer la Collection. Aucun changement n’a été effectué.');
    const objects = await Promise.all(objectIds.map(async (id) => {
      const rootRef = firestore.doc(`cartularies/${id}`);
      const [root, ...projections] = await Promise.all([
        transaction.get(rootRef),
        ...['items', 'valuationItems', 'documentationItems'].map((name) => transaction.get(registryRef.collection(name).doc(id))),
        transaction.get(rootRef.collection('documentationAssessments').doc('current')),
      ]);
      if (!root.exists || root.data().registryId !== registryId || root.data().organizationId !== organizationId
        || projections.some((projection) => projection.exists && (projection.data().registryId !== registryId || projection.data().organizationId !== organizationId))) fail('failed-precondition', 'Un objet ou sa projection nécessite une vérification avant le retrait de la Collection. Aucun objet n’a été supprimé.');
      const remaining = ids(root.data()).filter((value) => value !== collectionId);
      return { root, projections, bindings: { collectionId: root.data().collectionId === collectionId ? remaining[0] || '' : root.data().collectionId || '', collectionIds: remaining } };
    }));
    const publicItems = await transaction.get(publicationRef.collection('items').limit(201));
    if (publicItems.size > 200) fail('failed-precondition', 'Cette publication dépasse la limite de nettoyage sécurisé. Une vérification est nécessaire avant de la retirer.');
    if (publicItems.docs.some((item) => item.data().collectionId !== collectionId)) fail('permission-denied', 'Un élément public est hors de cette Collection.');
    // Detach only the grouping. Preserve assets, sections, private drafts, and frozen statements.
    // Keeping legacyCollectionDigest prevents an unchanged old draft restoring the deleted link;
    // a changed draft must pass assertNewCollectionAssignments before it can assign anything.
    for (const { root, projections, bindings } of objects) {
      const data = root.data();
      const revision = Number(data.revision || 0) + 1;
      const occurredAt = new Date().toISOString();
      const previousEventHash = data.integrityHead || ZERO_AUDIT_HASH;
      const event = { eventId: `evt_collection_${randomUUID()}`, cartularyId: root.id,
        sequence: Number(data.integritySequence || 0) + 1, occurredAt,
        actor: { uid, role: rights.roles?.[0] || 'registry_editor' }, action: 'cartulary.collection.detached',
        resource: { type: 'collection', id: collectionId }, beforeDigest: previousEventHash,
        afterDigest: sha256Digest(bindings), previousEventHash, canonicalizationVersion: CANONICALIZATION_VERSION,
        requestId: `remove-${collectionId}-${expectedVersion}` };
      const hash = sha256Digest({ previousEventHash, event });
      transaction.update(root.ref, { ...bindings, revision, integrityHead: hash, integritySequence: event.sequence, updatedAt: FieldValue.serverTimestamp() });
      transaction.create(root.ref.collection('auditEvents').doc(event.eventId), { ...event, hash, occurredAt: Timestamp.fromDate(new Date(occurredAt)), occurredAtIso: occurredAt });
      for (const projection of projections.filter((document) => document.exists)) {
        const { contentHash: _hash, updatedAt: _updatedAt, ...previous } = projection.data();
        const next = { ...previous, ...bindings, sourceRevision: revision };
        transaction.update(projection.ref, { ...bindings, sourceRevision: revision, contentHash: sha256Digest(next), updatedAt: FieldValue.serverTimestamp() });
      }
    }
    // Read and remove the bounded child set atomically, including when a prior
    // removal left no parent. Recreating the same ID must not revive old items.
    // Private object roots and any other subcollections are never deleted here.
    for (const item of publicItems.docs) transaction.delete(item.ref);
    transaction.delete(publicationRef);
    transaction.delete(collectionRef);
    return { status: 'deleted', alreadyAbsent: !target.exists };
  });
}
