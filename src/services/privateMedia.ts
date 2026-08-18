import { doc, getDoc } from 'firebase/firestore';
import { getBlob, ref } from 'firebase/storage';
import { ACTIVE_CARTULARY_ID } from '../domain/cartularyIds.ts';
import { ownerUidFromPrivateDraftStoragePath } from '../domain/gallery.ts';
import { auth, db, storage } from '../firebase.ts';
import { cartulariaLocalVault, type LocalBinaryRecord } from '../persistence/localVault.ts';
import { ObjectUrlLeaseCache, type ObjectUrlLease } from '../utils/objectUrlLeaseCache.ts';

const MAXIMUM_IDLE_OBJECT_URLS = 24;
const objectUrlCache = new ObjectUrlLeaseCache(MAXIMUM_IDLE_OBJECT_URLS, (url) => URL.revokeObjectURL(url));

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

export const acquirePrivateMediaObjectUrl = async (
  binaryId: string,
  cartularyId = ACTIVE_CARTULARY_ID,
): Promise<ObjectUrlLease> => {
  const cacheKey = `${cartularyId}:${binaryId}`;
  return objectUrlCache.acquire(cacheKey, async () => {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) throw new Error('Session Firebase requise pour lire ce média privé.');

    let record = cartulariaLocalVault?.cartularyId === cartularyId
      ? await cartulariaLocalVault.getBinary(binaryId)
      : null;
    if (!record || record.deleted || !record.cloudStoragePath) {
      record = await loadCloudBinaryRecord(user.uid, cartularyId, binaryId);
    }
    if (
      !record
      || record.deleted
      || !validPrivateStoragePath(record.cloudStoragePath, user.uid, cartularyId, binaryId)
    ) throw new Error('Original privé indisponible.');

    const blob = record.blob ?? await getBlob(ref(storage, record.cloudStoragePath));
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
    URL.createObjectURL(await getBlob(ref(storage, storagePath)))
  ))).url;
};

export const releasePrivateMediaObjectUrl = (url: string) => objectUrlCache.releaseByUrl(url);

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    objectUrlCache.clear();
  }, { once: true });
}
