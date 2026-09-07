import { doc, getDoc } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import { ACTIVE_CARTULARY_ID } from '../domain/cartularyIds.ts';
import { ownerUidFromPrivateDraftStoragePath } from '../domain/gallery.ts';
import { auth, db, storage } from '../firebase.ts';
import { cartulariaLocalVault, type LocalBinaryRecord } from '../persistence/localVault.ts';
import { ObjectUrlLeaseCache, type ObjectUrlLease } from '../utils/objectUrlLeaseCache.ts';
import { MediaFailure } from '../utils/mediaFailure';

const MAXIMUM_IDLE_OBJECT_URLS = 24;
const objectUrlCache = new ObjectUrlLeaseCache(MAXIMUM_IDLE_OBJECT_URLS, (url) => URL.revokeObjectURL(url));

const downloadPrivateStorageBlob = async (storagePath: string) => {
  const downloadUrl = await getDownloadURL(ref(storage, storagePath));
  const response = await fetch(downloadUrl, {
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok) {
    throw new Error(`Téléchargement du média privé refusé (${response.status}).`);
  }
  return response.blob();
};

const privateDraftBinaryPath = (uid: string, cartularyId: string, binaryId: string) => (
  `privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${binaryId}`
);

const validPrivateStoragePath = (
  storagePath: unknown,
  uid: string,
  cartularyId: string,
  binaryId: string,
): storagePath is string => typeof storagePath === 'string'
  && storagePath.startsWith(`private-drafts/${uid}/${cartularyId}/${binaryId}/`)
  && storagePath.endsWith('/original');

const loadCloudBinaryRecord = async (
  uid: string,
  cartularyId: string,
  binaryId: string,
): Promise<LocalBinaryRecord | null> => {
  const snapshot = await getDoc(doc(db, privateDraftBinaryPath(uid, cartularyId, binaryId)));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (
    data.deleted === true
    || !validPrivateStoragePath(data.storagePath, uid, cartularyId, binaryId)
  ) return null;
  return {
    id: `${cartularyId}::${binaryId}`,
    cartularyId,
    binaryId,
    kind: data.kind === 'owner_document' || data.kind === 'condition_attachment' ? data.kind : 'media',
    fileName: typeof data.fileName === 'string' ? data.fileName : binaryId,
    mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'application/octet-stream',
    size: typeof data.size === 'number' ? data.size : 0,
    sha256: typeof data.sha256 === 'string' ? data.sha256 : '',
    blob: null,
    updatedAt: typeof data.clientUpdatedAt === 'number' ? data.clientUpdatedAt : 0,
    dirty: false,
    deleted: false,
    cloudRevision: Number.isInteger(data.revision) ? Number(data.revision) : 0,
    cloudStoragePath: data.storagePath,
  };
};

async function explainUnavailableGuestCopy(uid: string, cartularyId: string) {
  const cartulary = await getDoc(doc(db, 'cartularies', cartularyId));
  const owner = cartulary.exists() ? cartulary.data().accountHolderId : null;
  if (typeof owner === 'string' && owner && owner !== uid) throw new MediaFailure('shared-unavailable');
}

export const acquirePrivateMediaObjectUrl = async (
  binaryId: string,
  cartularyId = ACTIVE_CARTULARY_ID,
): Promise<ObjectUrlLease> => {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new MediaFailure('session');
  const cacheKey = `${user.uid}:${cartularyId}:${binaryId}`;
  return objectUrlCache.acquire(cacheKey, async () => {

    let record = cartulariaLocalVault?.cartularyId === cartularyId
      ? await cartulariaLocalVault.getBinary(binaryId)
      : null;
    if (!record || record.deleted || !record.cloudStoragePath) {
      try { record = await loadCloudBinaryRecord(user.uid, cartularyId, binaryId); }
      catch (failure) {
        if ((failure as { code?: string })?.code === 'permission-denied') await explainUnavailableGuestCopy(user.uid, cartularyId);
        throw failure;
      }
    }
    if (!record) {
      await explainUnavailableGuestCopy(user.uid, cartularyId);
    }
    if (
      !record
      || record.deleted
      || !validPrivateStoragePath(record.cloudStoragePath, user.uid, cartularyId, binaryId)
    ) throw new MediaFailure('missing');

    const blob = record.blob ?? await downloadPrivateStorageBlob(record.cloudStoragePath);
    const expectedHash = record.sha256.replace(/^sha256[:-]/, '').toLowerCase();
    if (/^[a-f0-9]{64}$/.test(expectedHash)) {
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const actualHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      if (actualHash !== expectedHash) throw new MediaFailure('integrity');
    }
    if (!record.blob && cartulariaLocalVault?.cartularyId === cartularyId) {
      await cartulariaLocalVault.applyCloudBinary({ ...record, blob });
    }
    const url = URL.createObjectURL(blob);
    return url;
  });
};

export const loadPrivateMediaObjectUrl = async (binaryId: string, cartularyId = ACTIVE_CARTULARY_ID) => (
  (await acquirePrivateMediaObjectUrl(binaryId, cartularyId)).url
);

export const loadPrivateStorageObjectUrl = async (storagePath: string) => {
  await auth.authStateReady();
  const ownerUid = ownerUidFromPrivateDraftStoragePath(storagePath);
  if (!ownerUid || auth.currentUser?.uid !== ownerUid) {
    throw new Error('Original privé tiers non accessible depuis la Galerie.');
  }
  const cacheKey = `storage:${storagePath}`;
  return (await objectUrlCache.acquire(cacheKey, async () => (
    URL.createObjectURL(await downloadPrivateStorageBlob(storagePath))
  ))).url;
};

export const releasePrivateMediaObjectUrl = (url: string) => objectUrlCache.releaseByUrl(url);

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) objectUrlCache.clear();
  });
}
