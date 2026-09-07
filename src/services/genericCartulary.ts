import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase.ts';
import type { CartularyEnvelope } from '../domain/cartulary.ts';
import type { Asset } from '../types';
import { requestAuthoritativeCartularySync, waitForAuthoritativeSyncCycle } from '../persistence/cloudDraft.ts';
import { uploadVerifiedCartularyMedia } from './cartularyCreation';

export interface GenericMediaMutation {
  changes: Array<{ id: string; name?: string; tags?: Asset['tags']; visibility?: Asset['visibility']; binaryId?: string }>;
  removeIds: string[];
  confirmedRemoval?: boolean;
  confirmedPublicIds?: string[];
}

async function hasGenericCartularyPermission(envelope: CartularyEnvelope, permission: string) {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user || user.uid !== envelope.accountHolderId) return false;
  const membership = await getDoc(doc(db, 'organizations', envelope.organizationId, 'memberships', user.uid));
  const data = membership.data();
  return Boolean(data?.status === 'active' && data.uid === user.uid && data.roles?.includes('legal_owner')
    && data.permissions?.includes(permission) && data.scopes?.registryIds?.includes(envelope.registryId));
}
export const canEditGenericCartulary = (envelope: CartularyEnvelope) => hasGenericCartularyPermission(envelope, 'cartulary.edit');
export const canPublishGenericCartulary = (envelope: CartularyEnvelope) => hasGenericCartularyPermission(envelope, 'publication.manage');

export async function loadGenericCartularyAssets(cartularyId: string): Promise<Asset[]> {
  const snapshot = await getDocs(collection(db, 'cartularies', cartularyId, 'assets'));
  return snapshot.docs.flatMap((document) => {
    const asset = document.data();
    if (asset.projectionStatus === 'withdrawn' || !['image', 'video', 'document'].includes(asset.mediaKind)) return [];
    const url = typeof asset.presentationDerivative?.url === 'string' && asset.presentationDerivative.url.startsWith('/assets/') ? asset.presentationDerivative.url : '';
    return [{ id: document.id, cartularyId, name: asset.displayName || document.id,
      type: asset.mediaKind, url, thumbnailUrl: url || undefined, hash: asset.sha256 || '',
      status: 'Archived', visibility: asset.requestedVisibility === 'public' ? 'Tous' : asset.requestedVisibility === 'community' ? 'Communauté' : 'Secret', tags: Array.isArray(asset.tags) ? asset.tags : [],
      binaryId: typeof asset.binaryId === 'string' ? asset.binaryId : undefined,
      mimeType: asset.mimeDeclared || undefined, originalFileName: asset.originalFileName || undefined,
      capturedAt: typeof asset.capturedAt === 'string' ? asset.capturedAt : undefined,
    } as Asset];
  });
}

async function ensureGenericPrivateDraft(envelope: CartularyEnvelope) {
  if (!await canEditGenericCartulary(envelope)) throw new Error('Seul le propriétaire éditeur peut modifier ces informations.');
  const user = auth.currentUser!;
  const draftRef = doc(db, 'privateDrafts', user.uid, 'cartularies', envelope.id);
  // Rules require an active parent before its state can be read or created.
  // Imported objects may not yet have a private draft; never recreate a deleted one.
  await runTransaction(db, async (transaction) => {
    const draft = await transaction.get(draftRef);
    if (draft.exists() && draft.data().status !== 'active') throw new Error('Le brouillon de ce Cartulaire n’est plus actif.');
    if (!draft.exists()) transaction.set(draftRef, { ownerUid: user.uid, cartularyId: envelope.id, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1', updatedAt: serverTimestamp() });
  });
  return { user, draftRef };
}

export async function uploadGenericCartularyMedia(envelope: CartularyEnvelope, file: File, onProgress?: (message: string) => void): Promise<Asset> {
  const { user } = await ensureGenericPrivateDraft(envelope);
  const media = await uploadVerifiedCartularyMedia({ user, cartularyId: envelope.id, file, onProgress: (phase, bytes) => onProgress?.(phase === 'verifying' ? 'Vérification serveur du fichier…' : phase === 'hashing' ? 'Vérification du format et calcul de l’empreinte…' : `Téléversement privé · ${Math.round(100 * bytes / Math.max(1, file.size))} %`) });
  return { ...media, cartularyId: envelope.id };
}

export async function saveGenericCartularyMedia(envelope: CartularyEnvelope, mutation: GenericMediaMutation) {
  if (mutation.changes.some((change) => change.visibility === 'Tous') && !await canPublishGenericCartulary(envelope)) throw new Error('Le droit de publication est requis pour autoriser des médias publics.');
  return saveGenericDraftState(envelope, 'cartularia-generic-media', { version: 1, baseRevision: envelope.revision, ...mutation });
}

export async function saveGenericCartularyFields(envelope: CartularyEnvelope, edits: Array<{ fieldId: string; value: unknown }>) {
  return saveGenericDraftState(envelope, 'cartularia-generic-sections', { version: 1, schemaId: envelope.schemaId, schemaVersion: envelope.schemaVersion, baseRevision: envelope.revision, edits });
}

async function saveGenericDraftState(envelope: CartularyEnvelope, key: string, value: unknown) {
  const { user, draftRef } = await ensureGenericPrivateDraft(envelope);
  const rootRef = doc(db, 'cartularies', envelope.id);
  const stateRef = doc(draftRef, 'state', key);
  const operationRef = doc(draftRef, 'state', 'cartularia-generic-operation');
  const operationToken = crypto.randomUUID();
  await runTransaction(db, async (transaction) => {
    const [root, draft, state] = await Promise.all([transaction.get(rootRef), transaction.get(draftRef), transaction.get(stateRef)]);
    if (!root.exists() || root.data().revision !== envelope.revision) throw new Error('Le Cartulaire a changé. Rechargez ses données avant d’enregistrer vos modifications.');
    if (draft.exists() && draft.data().status !== 'active') throw new Error('Le brouillon de ce Cartulaire n’est plus actif.');
    transaction.set(draftRef, { ownerUid: user.uid, cartularyId: envelope.id, status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1', updatedAt: serverTimestamp() }, { merge: true });
    transaction.set(stateRef, { ownerUid: user.uid, cartularyId: envelope.id, key,
      value: JSON.stringify(value),
      deleted: false, revision: Number(state.data()?.revision || 0) + 1, clientUpdatedAt: Date.now(), updatedAt: serverTimestamp() });
    transaction.set(operationRef, { ownerUid: user.uid, cartularyId: envelope.id, key: 'cartularia-generic-operation',
      value: JSON.stringify({ kind: key === 'cartularia-generic-media' ? 'media' : 'sections', token: operationToken }), deleted: false,
      revision: Number(state.data()?.revision || 0) + 1, clientUpdatedAt: Date.now(), updatedAt: serverTimestamp() });
  });
  let request = await requestAuthoritativeCartularySync({ uid: user.uid, cartularyId: envelope.id });
  if (!request.requestId) throw new Error('Une synchronisation incomplète bloque l’enregistrement. Réessayez après son traitement.');
  if (request.status === 'in_progress') {
    await waitForAuthoritativeSyncCycle(envelope.id, request.requestId);
    request = await requestAuthoritativeCartularySync({ uid: user.uid, cartularyId: envelope.id });
  }
  if (!request.requestId) throw new Error('La demande de synchronisation ne peut pas être confirmée. Réessayez.');
  await waitForAuthoritativeSyncCycle(envelope.id, request.requestId);
  const result = await getDoc(doc(db, 'cartularySyncRequests', envelope.id));
  if (result.data()?.requestId !== request.requestId || result.data()?.status !== 'processed') {
    throw new Error(result.data()?.errorMessage || 'La synchronisation n’est pas confirmée. Votre saisie reste affichée ; réessayez.');
  }
  const authoritative = await getDoc(rootRef);
  if (authoritative.data()?.lastGenericOperationToken !== operationToken) throw new Error('Une autre modification a été traitée entre-temps. Cette saisie ne peut pas être confirmée ; rechargez le Cartulaire avant de réessayer.');
}
