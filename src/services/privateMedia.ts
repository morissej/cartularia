import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getBlob, getDownloadURL, ref } from 'firebase/storage';
import { ACTIVE_CARTULARY_ID } from '../domain/cartularyIds.ts';
import {
  pickPresentationVariantForRole,
  presentationDerivativeStateFromBinaryRecord,
  presentationFromBinaryRecord,
  restrictPresentationToIdentity,
  validPrivateDerivativePath,
  type PresentationDerivativeState,
  type PresentationRole,
  type PrivatePresentation,
} from '../domain/presentationVariants.ts';
import { auth, db, storage } from '../firebase.ts';
import { cartulariaLocalVault, type LocalBinaryRecord } from '../persistence/localVault.ts';
import { ObjectUrlLeaseCache, type ObjectUrlLease } from '../utils/objectUrlLeaseCache.ts';
import { MediaFailure } from '../utils/mediaFailure';
import { PRIVATE_SESSION_LOCK_EVENT } from '../security/privateSessionEvents';

const MAXIMUM_IDLE_OBJECT_URLS = 24;
const objectUrlCache = new ObjectUrlLeaseCache(MAXIMUM_IDLE_OBJECT_URLS, (url) => URL.revokeObjectURL(url));
/** Une variante de présentation pèse quelques dizaines à quelques centaines de ko : plafond défensif. */
const MAXIMUM_PRESENTATION_VARIANT_BYTES = 8 * 1024 * 1024;
let sessionGeneration = 0;
let observedUser = auth.currentUser;

/** Invalidate even pending acquisitions; the lease cache revokes late-created URLs. */
export const clearPrivateMediaSession = () => {
  sessionGeneration += 1;
  objectUrlCache.clear();
};
onAuthStateChanged(auth, (user) => {
  if (user !== observedUser) clearPrivateMediaSession();
  observedUser = user;
});

const captureMediaSession = () => {
  const user = auth.currentUser;
  if (!user) throw new MediaFailure('session');
  const epoch = sessionGeneration;
  const assertCurrent = () => {
    if (auth.currentUser !== user || sessionGeneration !== epoch) throw new MediaFailure('session');
  };
  const read = async <T,>(operation: Promise<T>): Promise<T> => {
    assertCurrent();
    try {
      const value = await operation;
      assertCurrent();
      return value;
    } catch (error) { assertCurrent(); throw error; }
  };
  const acquire = async (key: string, create: () => Promise<string | { url: string; byteSize: number }>) => {
    assertCurrent();
    const lease = await objectUrlCache.acquire(`${epoch}:${key}`, create);
    try { assertCurrent(); return lease; }
    catch (error) { lease.release(); throw error; }
  };
  return { uid: user.uid, assertCurrent, read, acquire };
};
type MediaSession = ReturnType<typeof captureMediaSession>;


const sha256Hex = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Seule lecture par getDownloadURL du module (contrat V3, tour 4 point 4) : l'ORIGINAL privé, sur action explicite
 * (« Afficher l'original », téléchargement, préparation du rapport). Les copies de présentation passent par getBlob
 * sous règles ; aucune autre voie vers Storage n'existe côté lecteur.
 */
const downloadPrivateStorageBlob = async (storagePath: string, session: MediaSession) => {
  const downloadUrl = await session.read(getDownloadURL(ref(storage, storagePath)));
  const response = await session.read(fetch(downloadUrl, {
    cache: 'no-store',
    credentials: 'omit',
  }));
  if (!response.ok) {
    throw new Error(`Téléchargement du média privé refusé (${response.status}).`);
  }
  return session.read(response.blob());
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
  const requestedGeneration = sessionGeneration;
  await auth.authStateReady();
  if (requestedGeneration !== sessionGeneration) throw new MediaFailure('session');
  const session = captureMediaSession();
  const uid = session.uid;
  const vault = cartulariaLocalVault?.cartularyId === cartularyId ? cartulariaLocalVault : null;
  const cacheKey = `${uid}:${cartularyId}:${binaryId}`;
  return session.acquire(cacheKey, async () => {
    const expectedLocal = vault ? await session.read(vault.getBinary(binaryId)) : null;
    let record = expectedLocal;
    if (!record || record.deleted || !record.cloudStoragePath) {
      try { record = await session.read(loadCloudBinaryRecord(uid, cartularyId, binaryId)); }
      catch (failure) {
        if ((failure as { code?: string })?.code === 'permission-denied') await session.read(explainUnavailableGuestCopy(uid, cartularyId));
        throw failure;
      }
    }
    if (!record) {
      await session.read(explainUnavailableGuestCopy(uid, cartularyId));
    }
    if (
      !record
      || record.deleted
      || !validPrivateStoragePath(record.cloudStoragePath, uid, cartularyId, binaryId)
    ) throw new MediaFailure('missing');

    const blob = record.blob ?? await downloadPrivateStorageBlob(record.cloudStoragePath, session);
    const expectedHash = record.sha256.replace(/^sha256[:-]/, '').toLowerCase();
    if (/^[a-f0-9]{64}$/.test(expectedHash)) {
      if (await session.read(sha256Hex(blob)) !== expectedHash) throw new MediaFailure('integrity');
    }
    if (!record.blob && vault) {
      await session.read(vault.applyCloudBinary({ ...record, blob }, expectedLocal));
    }
    session.assertCurrent();
    const url = URL.createObjectURL(blob);
    return url;
  });
};

export interface PrivatePresentationRequest {
  binaryId: string;
  cartularyId?: string;
  /** Miroir Admin déjà chargé (asset.privatePresentation) : évite la lecture du manifeste binaire. */
  asset?: { privatePresentation?: PrivatePresentation | null } | null;
  role: PresentationRole;
}

const storageErrorCode = (error: unknown) => String((error as { code?: string })?.code || '');

/**
 * Manifeste binaire (propriétaire seulement sous les règles) → variantes v3 de ce binaire (ou null) et état des dérivés :
 * 'failed' quand le manifeste consigne un échec définitif (variantsFailure, original rejeté), 'pending' sinon.
 */
const loadPresentationFromManifest = async (uid: string, cartularyId: string, binaryId: string): Promise<{ exists: boolean; presentation: PrivatePresentation | null; state: PresentationDerivativeState }> => {
  const snapshot = await getDoc(doc(db, privateDraftBinaryPath(uid, cartularyId, binaryId)));
  if (!snapshot.exists()) return { exists: false, presentation: null, state: 'pending' };
  const data = snapshot.data();
  return {
    exists: true,
    presentation: restrictPresentationToIdentity(presentationFromBinaryRecord(data, binaryId), uid, cartularyId, binaryId),
    state: presentationDerivativeStateFromBinaryRecord(data, binaryId),
  };
};

/** Sans variante : « en préparation » par défaut ; « non produite » dès que le manifeste porte un échec définitif (décision (d)). */
const derivativeUnavailable = (state: PresentationDerivativeState) => new MediaFailure(state === 'failed' ? 'derivative-failed' : 'derivative-pending');

/**
 * Copie de présentation privée (variantes presentation-v3-*.webp) pour une vignette ou une scène.
 * Jamais l'original, jamais presentation-v2, jamais getDownloadURL (aucun jeton) : getBlob sous storage.rules,
 * empreinte SHA-256 vérifiée contre le manifeste, cache d'Object URL partagé avec les originaux.
 * Sans variante : MediaFailure('derivative-pending') (« Aperçu en préparation »), sans repli sur l'original ; si le
 * manifeste consigne un échec définitif (variantsFailure, original rejeté) : MediaFailure('derivative-failed')
 * (« Copie de présentation non produite »), jamais un « en préparation » perpétuel.
 * Variante référencée par le brouillon mais absente de Storage : relecture du manifeste une fois (G12).
 */
export const acquirePrivatePresentationObjectUrl = async ({
  binaryId,
  cartularyId = ACTIVE_CARTULARY_ID,
  asset = null,
  role,
}: PrivatePresentationRequest): Promise<ObjectUrlLease> => {
  const requestedGeneration = sessionGeneration;
  await auth.authStateReady();
  if (requestedGeneration !== sessionGeneration) throw new MediaFailure('session');
  const session = captureMediaSession();
  const uid = session.uid;
  const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const explainDenied = async (failure: unknown) => {
    await session.read(explainUnavailableGuestCopy(uid, cartularyId));
    throw failure;
  };
  const readManifest = async () => {
    try {
      return await session.read(loadPresentationFromManifest(uid, cartularyId, binaryId));
    } catch (failure) {
      if (storageErrorCode(failure) === 'permission-denied') await explainDenied(failure);
      throw failure;
    }
  };

  let presentation = restrictPresentationToIdentity(asset?.privatePresentation ?? null, uid, cartularyId, binaryId);
  let manifestRead = false;
  let derivativeState: PresentationDerivativeState = 'pending';
  if (!presentation) {
    const manifest = await readManifest();
    manifestRead = true;
    if (!manifest.exists) {
      await session.read(explainUnavailableGuestCopy(uid, cartularyId));
      throw new MediaFailure('missing');
    }
    presentation = manifest.presentation;
    derivativeState = manifest.state;
  }
  if (!presentation) throw derivativeUnavailable(derivativeState);

  const acquireVariant = (candidate: PrivatePresentation) => {
    const variant = pickPresentationVariantForRole(candidate, role, devicePixelRatio);
    if (!variant || !validPrivateDerivativePath(variant.storagePath, uid, cartularyId, binaryId)) throw derivativeUnavailable(derivativeState);
    const cacheKey = `${uid}:${cartularyId}:${binaryId}:${variant.storagePath.split('/').at(-1)}`;
    return session.acquire(cacheKey, async () => {
      let blob: Blob;
      try {
        blob = await session.read(getBlob(ref(storage, variant.storagePath), MAXIMUM_PRESENTATION_VARIANT_BYTES));
      } catch (failure) {
        const code = storageErrorCode(failure);
        if (/unauthorized|permission-denied/.test(code)) await explainDenied(failure);
        if (/object-not-found|not-found/.test(code)) throw new MediaFailure('missing');
        throw failure;
      }
      const expectedHash = variant.sha256.replace(/^sha256[:-]/, '').toLowerCase();
      if (await session.read(sha256Hex(blob)) !== expectedHash) throw new MediaFailure('integrity');
      session.assertCurrent();
      return { url: URL.createObjectURL(blob), byteSize: blob.size };
    });
  };

  try {
    return await acquireVariant(presentation);
  } catch (failure) {
    if (!(failure instanceof MediaFailure) || failure.kind !== 'missing' || manifestRead) throw failure;
    // Référence figée périmée (chemin régénéré par le backlog) : relire le manifeste une seule fois.
    const manifest = await readManifest();
    if (!manifest.exists || !manifest.presentation) throw failure;
    return acquireVariant(manifest.presentation);
  }
};

export const releasePrivateMediaObjectUrl = (url: string) => objectUrlCache.releaseByUrl(url);

if (typeof window !== 'undefined') {
  window.addEventListener(PRIVATE_SESSION_LOCK_EVENT, clearPrivateMediaSession);
  window.addEventListener('pagehide', clearPrivateMediaSession);
}
