import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  ref,
  uploadBytesResumable,
} from 'firebase/storage';
import {
  CARTULARY_CREATION_TIMEOUT_MESSAGE,
  CARTULARY_CREATION_PROFILE_VERSION,
  SUPPORTED_CREATION_PROFILES,
  buildCreationSpecificationGroups,
  slugifyCartularyLabel,
  type CartularyCreationProfile,
  type SupportedCreationAssetType,
  type CartularyCreationMediaAsset,
  type CartularyCreationResult,
  type WatchCartularyCreationProfile,
} from '../domain/cartularyCreation.ts';
import { db, storage } from '../firebase.ts';
import { scopedStorageForCartulary } from '../persistence/localVault.ts';
import { validateFileForUpload, type TrustedFileInspection } from '../security/fileValidation.ts';
import { waitForPrivateUploadVerification } from './privateUploadVerification.ts';
import { generateCorrespondenceCode } from '../domain/correspondenceCodes.ts';
import { loadCreationSchemaVersion } from './schemaCatalog.ts';

export interface CreateWatchCartularyInput {
  assetType?: SupportedCreationAssetType;
  user: User;
  organizationId: string;
  registryId: string;
  profile: Omit<WatchCartularyCreationProfile, 'profileVersion' | 'assetType' | 'schemaId' | 'schemaVersion' | 'assertedAt'>;
  coverFile: File;
  files: File[];
  onProgress?: (progress: CartularyCreationProgress) => void;
}

export interface CartularyCreationProgress {
  phase: 'preparing' | 'hashing' | 'uploading' | 'verifying' | 'finalizing' | 'processing';
  fileName: string | null;
  completedFiles: number;
  totalFiles: number;
  uploadedBytes: number;
  totalBytes: number;
}

interface CreationRequestDocument {
  status: 'pending' | 'processing' | 'processed' | 'failed';
  requestDocumentId: string;
  requestId: string;
  ownerUid: string;
  cartularyId: string;
  organizationId: string;
  registryId: string;
  publicCode: string;
  errorCode?: string;
  errorMessage?: string;
}

export class CartularyCreationFailedError extends Error {
  override name = 'CartularyCreationFailedError';
}

export class CartularyCreationTimeoutError extends Error {
  override name = 'CartularyCreationTimeoutError';
}

const CREATION_RETRY_DELAYS_MS = [1_000, 2_500] as const;
const RETRYABLE_CREATION_ERROR_CODES = new Set([
  'aborted',
  'create_failed',
  'deadline-exceeded',
  'internal',
  'unavailable',
]);

const randomToken = (length = 12) => {
  const bytes = crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, length);
};

const fileIdentity = (file: File) => `${file.name}\u0000${file.size}\u0000${file.lastModified}`;

const uniqueFiles = (coverFile: File, files: File[]) => {
  const seen = new Set<string>();
  return [coverFile, ...files].filter((file) => {
    const identity = fileIdentity(file);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};

const sha256 = async (file: File): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const fileSizeLabel = (size: number) => size >= 1024 * 1024
  ? `${(size / (1024 * 1024)).toFixed(1)} Mo`
  : `${Math.ceil(size / 1024)} ko`;

const uploadFile = async ({
  user,
  cartularyId,
  file,
  binaryId,
  digest,
  uploadedBefore,
  totalBytes,
  progress,
  inspection,
}: {
  user: User;
  cartularyId: string;
  file: File;
  binaryId: string;
  digest: string;
  uploadedBefore: number;
  totalBytes: number;
  progress: (uploadedBytes: number) => void;
  inspection: TrustedFileInspection;
}) => {
  const digestValue = digest.slice('sha256:'.length);
  const storagePath = `private-drafts/${user.uid}/${cartularyId}/${binaryId}/${digestValue}/original`;
  const task = uploadBytesResumable(ref(storage, storagePath), file, {
    contentType: inspection.canonicalMimeType,
    customMetadata: {
      ownerUid: user.uid,
      cartularyId,
      binaryId,
      sha256: digest,
      kind: 'media',
      originalFileName: file.name,
      inspectionRequested: 'true',
    },
  });

  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', (snapshot) => {
      progress(Math.min(totalBytes, uploadedBefore + snapshot.bytesTransferred));
    }, reject, resolve);
  });
  return storagePath;
};

/** Same private upload/manifest/verification pipeline for creation and later enrichment. */
export const uploadVerifiedCartularyMedia = async ({ user, cartularyId, file, inspection: inspected, onProgress }: {
  user: User; cartularyId: string; file: File; inspection?: TrustedFileInspection;
  onProgress?: (phase: 'hashing' | 'uploading' | 'verifying', uploadedBytes: number) => void;
}): Promise<CartularyCreationMediaAsset> => {
  const inspection = inspected || await validateFileForUpload({ blob: file, fileName: file.name, declaredMimeType: file.type });
  onProgress?.('hashing', 0);
  const digest = await sha256(file);
  const binaryId = `bin_${randomToken(28)}`;
  const assetId = `asset_${randomToken(28)}`;
  const storagePath = `private-drafts/${user.uid}/${cartularyId}/${binaryId}/${digest.slice('sha256:'.length)}/original`;
  await setDoc(doc(db, 'privateDrafts', user.uid, 'cartularies', cartularyId, 'binaries', binaryId), {
    ownerUid: user.uid, cartularyId, binaryId, deleted: false, revision: 1,
    fileName: file.name, mimeType: inspection.canonicalMimeType, size: file.size, sha256: digest,
    kind: 'media', storagePath, clientUpdatedAt: Date.now(), uploadStatus: 'pending_upload', updatedAt: serverTimestamp(),
  });
  onProgress?.('uploading', 0);
  await uploadFile({ user, cartularyId, file, binaryId, digest, uploadedBefore: 0, totalBytes: file.size, inspection, progress: (bytes) => onProgress?.('uploading', bytes) });
  onProgress?.('verifying', file.size);
  const verification = await waitForPrivateUploadVerification({ uid: user.uid, cartularyId, binaryId });
  return { id: assetId, name: file.name, originalFileName: file.name, type: inspection.kind,
    mimeType: verification.detectedMimeType, url: '', hash: digest, status: 'Archived', binaryId,
    tags: inspection.kind === 'image' ? ['slideshow'] : inspection.kind === 'video' ? ['main-video'] : ['documentation'],
    category: inspection.kind === 'document' ? 'documentation' : 'ensemble', visibility: 'Secret', fileSize: fileSizeLabel(file.size),
    derivativeStatus: verification.derivativeStatus,
    capturedAt: verification.capturedAt || (Number.isFinite(file.lastModified) && file.lastModified > 0 ? new Date(file.lastModified).toISOString() : new Date().toISOString()),
    timestampSource: verification.timestampSource || 'file.lastModified' };
};

export const createCartulary = async ({
  assetType = 'watch',
  user,
  organizationId,
  registryId,
  profile,
  coverFile,
  files,
  onProgress,
}: CreateWatchCartularyInput): Promise<CartularyCreationResult> => {
  const definition = SUPPORTED_CREATION_PROFILES[assetType];
  if (!definition) throw new Error('Ce type d’objet n’est pas encore proposé à la création.');
  const schemaVersion = await loadCreationSchemaVersion(definition.schemaId);
  const cartularySlug = slugifyCartularyLabel([profile.brand, profile.model, profile.reference].filter(Boolean).join(' ')) || 'objet';
  const cartularyId = `cart_${cartularySlug}_${randomToken()}`;
  const publicCode = generateCorrespondenceCode('object', profile.brand || 'WCH');
  const requestId = `create_${randomToken(28)}`;
  const allFiles = uniqueFiles(coverFile, files);
  const inspections = new Map<File, TrustedFileInspection>();
  for (const file of allFiles) {
    inspections.set(file, await validateFileForUpload({
      blob: file,
      fileName: file.name,
      declaredMimeType: file.type,
      expectedKind: file === coverFile ? 'image' : undefined,
    }));
  }
  const totalBytes = allFiles.reduce((sum, file) => sum + file.size, 0);
  let uploadedBytes = 0;
  let completedFiles = 0;

  const emit = (phase: CartularyCreationProgress['phase'], fileName: string | null) => onProgress?.({
    phase,
    fileName,
    completedFiles,
    totalFiles: allFiles.length,
    uploadedBytes,
    totalBytes,
  });

  emit('preparing', null);
  const draftRef = doc(db, 'privateDrafts', user.uid, 'cartularies', cartularyId);
  await setDoc(draftRef, {
    ownerUid: user.uid,
    cartularyId,
    status: 'active',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    purgeAfter: null,
    lastActiveAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const mediaAssets: CartularyCreationMediaAsset[] = [];
  for (const [index, file] of allFiles.entries()) {
    const uploadedBefore = uploadedBytes;
    const asset = await uploadVerifiedCartularyMedia({ user, cartularyId, file, inspection: inspections.get(file), onProgress: (phase, bytes) => { uploadedBytes = uploadedBefore + bytes; emit(phase, file.name); } });
    uploadedBytes = uploadedBefore + file.size;
    completedFiles += 1;
    mediaAssets.push({ ...asset, ...(index === 0 ? { tags: ['main-photo', 'slideshow'] } : {}) });
    emit('uploading', file.name);
  }

  uploadedBytes = totalBytes;
  emit('finalizing', null);
  const creationProfile: CartularyCreationProfile = {
    profileVersion: CARTULARY_CREATION_PROFILE_VERSION,
    assetType,
    schemaId: definition.schemaId as SupportedCreationAssetType,
    schemaVersion,
    ...profile,
    assertedAt: new Date().toISOString(),
  };
  const specifications = buildCreationSpecificationGroups(definition, profile);

  const writeState = (key: string, value: unknown) => setDoc(doc(draftRef, 'state', key), {
    ownerUid: user.uid,
    cartularyId,
    key,
    value: JSON.stringify(value),
    deleted: false,
    revision: 1,
    clientUpdatedAt: Date.now(),
    updatedAt: serverTimestamp(),
  });
  await Promise.all([
    writeState('cartularia-creation-profile', creationProfile),
    writeState('cartularia-specification-groups', specifications),
    writeState('cartularia-media-assets-v3', mediaAssets),
    writeState('cartularia-public-code', publicCode),
  ]);

  const targetStorage = scopedStorageForCartulary(window.localStorage, cartularyId);
  targetStorage.setItem('cartularia-creation-profile', JSON.stringify(creationProfile));
  targetStorage.setItem('cartularia-specification-groups', JSON.stringify(specifications));
  targetStorage.setItem('cartularia-media-assets-v3', JSON.stringify(mediaAssets));
  targetStorage.setItem('cartularia-public-code', JSON.stringify(publicCode));

  await setDoc(doc(db, 'cartularyCreateRequests', cartularyId), {
    requestDocumentId: cartularyId,
    requestId,
    ownerUid: user.uid,
    cartularyId,
    organizationId,
    registryId,
    publicCode,
    status: 'pending',
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  emit('processing', null);
  return { cartularyId, requestId, publicCode, uploadedFileCount: allFiles.length, uploadedBytes: totalBytes };
};

/** Compatibility for callers explicitly creating a watch. */
export const createWatchCartulary = (input: CreateWatchCartularyInput) => createCartulary({ ...input, assetType: 'watch' });

export const waitForCartularyCreation = async (
  cartularyId: string,
  timeoutMs = 120_000,
): Promise<void> => {
  const requestRef = doc(db, 'cartularyCreateRequests', cartularyId);
  const startedAt = Date.now();
  let retryAttempt = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getDoc(requestRef);
    if (!snapshot.exists()) throw new Error('La demande de création a disparu.');
    const request = snapshot.data() as CreationRequestDocument;
    if (request.status === 'processed') return;
    if (request.status === 'failed') {
      const errorCode = request.errorCode || 'create_failed';
      const retryDelay = CREATION_RETRY_DELAYS_MS[retryAttempt];
      if (retryDelay !== undefined && RETRYABLE_CREATION_ERROR_CODES.has(errorCode)) {
        retryAttempt += 1;
        await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
        await runTransaction(db, async (transaction) => {
          const currentSnapshot = await transaction.get(requestRef);
          if (!currentSnapshot.exists()) throw new Error('La demande de création a disparu.');
          const current = currentSnapshot.data() as CreationRequestDocument;
          if (current.status !== 'failed') return;
          transaction.set(requestRef, {
            requestDocumentId: current.requestDocumentId,
            requestId: current.requestId,
            ownerUid: current.ownerUid,
            cartularyId: current.cartularyId,
            organizationId: current.organizationId,
            registryId: current.registryId,
            publicCode: current.publicCode,
            status: 'pending',
            requestedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });
        continue;
      }
      throw new CartularyCreationFailedError(request.errorMessage || `Création refusée (${request.errorCode || 'erreur inconnue'}).`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  throw new CartularyCreationTimeoutError(CARTULARY_CREATION_TIMEOUT_MESSAGE);
};
