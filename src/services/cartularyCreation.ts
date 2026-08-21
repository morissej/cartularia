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
  type CartularyCreationMediaAsset,
  type CartularyCreationResult,
  type WatchCartularyCreationProfile,
} from '../domain/cartularyCreation.ts';
import { db, storage } from '../firebase.ts';
import { scopedStorageForCartulary } from '../persistence/localVault.ts';
import { validateFileForUpload, type TrustedFileInspection } from '../security/fileValidation.ts';
import { waitForPrivateUploadVerification } from './privateUploadVerification.ts';
import { generateCorrespondenceCode } from '../domain/correspondenceCodes.ts';

export interface CreateWatchCartularyInput {
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

const slugify = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 44);

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

export const createWatchCartulary = async ({
  user,
  organizationId,
  registryId,
  profile,
  coverFile,
  files,
  onProgress,
}: CreateWatchCartularyInput): Promise<CartularyCreationResult> => {
  const cartularySlug = slugify([profile.brand, profile.model, profile.reference].filter(Boolean).join(' ')) || 'objet';
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
    emit('hashing', file.name);
    const digest = await sha256(file);
    const binaryId = `bin_${randomToken(28)}`;
    const assetId = `asset_${randomToken(28)}`;
    const inspection = inspections.get(file)!;
    const type = inspection.kind;
    const uploadedBefore = uploadedBytes;
    const storagePath = `private-drafts/${user.uid}/${cartularyId}/${binaryId}/${digest.slice('sha256:'.length)}/original`;
    const binaryDocumentRef = doc(draftRef, 'binaries', binaryId);
    await setDoc(binaryDocumentRef, {
      ownerUid: user.uid,
      cartularyId,
      binaryId,
      deleted: false,
      revision: 1,
      fileName: file.name,
      mimeType: inspection.canonicalMimeType,
      size: file.size,
      sha256: digest,
      kind: 'media',
      storagePath,
      clientUpdatedAt: Date.now(),
      uploadStatus: 'pending_upload',
      updatedAt: serverTimestamp(),
    });
    emit('uploading', file.name);
    await uploadFile({
      user,
      cartularyId,
      file,
      binaryId,
      digest,
      uploadedBefore,
      totalBytes,
      inspection,
      progress: (nextUploadedBytes) => {
        uploadedBytes = nextUploadedBytes;
        emit('uploading', file.name);
      },
    });
    uploadedBytes = uploadedBefore + file.size;
    emit('verifying', file.name);
    const verification = await waitForPrivateUploadVerification({
      uid: user.uid,
      cartularyId,
      binaryId,
    });
    completedFiles += 1;

    const capturedAt = verification.capturedAt || (Number.isFinite(file.lastModified) && file.lastModified > 0
      ? new Date(file.lastModified).toISOString()
      : new Date().toISOString());
    mediaAssets.push({
      id: assetId,
      name: file.name,
      originalFileName: file.name,
      type,
      mimeType: verification.detectedMimeType,
      url: '',
      hash: digest,
      status: 'Archived',
      binaryId,
      tags: index === 0
        ? ['main-photo', 'slideshow']
        : type === 'image'
          ? ['slideshow']
          : type === 'video'
            ? ['main-video']
            : ['documentation'],
      category: type === 'document' ? 'documentation' : 'ensemble',
      visibility: 'Secret',
      fileSize: fileSizeLabel(file.size),
      derivativeStatus: verification.derivativeStatus,
      capturedAt,
      timestampSource: verification.timestampSource || 'file.lastModified',
    });
    emit('uploading', file.name);
  }

  uploadedBytes = totalBytes;
  emit('finalizing', null);
  const creationProfile: WatchCartularyCreationProfile = {
    profileVersion: CARTULARY_CREATION_PROFILE_VERSION,
    assetType: 'watch',
    schemaId: 'watch',
    schemaVersion: '1.6.0',
    ...profile,
    assertedAt: new Date().toISOString(),
  };
  const specifications = [{
    id: 'identity',
    label: 'Identification',
    items: [
      { id: 'brand', label: 'Marque', value: profile.brand },
      { id: 'model', label: 'Modèle', value: profile.model },
      { id: 'reference', label: 'Numéro de référence', value: profile.reference },
      { id: 'year', label: 'Année de fabrication', value: profile.manufactureYear ? String(profile.manufactureYear) : '' },
      { id: 'caliber', label: 'Calibre', value: profile.caliber },
    ],
  }];

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
