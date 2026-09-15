import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import exifr from 'exifr';
import { FieldValue } from 'firebase-admin/firestore';
import { createPdfPresentation, createVideoPresentation } from './media-presentation-runtime.mjs';
import {
  PRESENTATION_VARIANT_VERSION,
  PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS,
  assetPresentationMirror,
  binaryPresentationFailed,
  buildImagePresentationSet,
  manifestHasCurrentPresentationVariants,
  manifestVariantsFor,
  privateBinaryIsVerified,
  registryThumbnailFromManifest,
  sha256Of,
} from './presentation-variants.mjs';
import { normalizeRegistryThumbnail, registryThumbnailStatusFor } from './registry-thumbnail.mjs';

export const PRIVATE_UPLOAD_VERIFICATION_VERSION = 'private-upload@1.1.0';
// Prédicat unique « binaire vérifié » (tour 4 point 1) : défini dans presentation-variants.mjs, partagé avec les miroirs.
export { PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS, privateBinaryIsVerified };
/** Limite nocturne : au plus 10 manifestes par passe (première passe = vérification, seconde = variantes manquantes). */
export const PRIVATE_UPLOAD_BACKLOG_LIMIT = 10;
const PRIVATE_ORIGINAL_PATTERN = /^private-drafts\/([^/]+)\/([^/]+)\/([^/]+)\/([a-f0-9]{64})\/original$/;
const MIB = 1024 * 1024;
const PRIVATE_DERIVATIVE_CACHE_CONTROL = 'private, no-store, max-age=0';

export class PrivateUploadVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PrivateUploadVerificationError';
    this.code = code;
  }
}

const policies = {
  jpeg: { kind: 'image', mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'], mimeTypes: ['image/jpeg', 'image/jpg'], maximumBytes: 40 * MIB },
  png: { kind: 'image', mimeType: 'image/png', extensions: ['png'], mimeTypes: ['image/png'], maximumBytes: 40 * MIB },
  webp: { kind: 'image', mimeType: 'image/webp', extensions: ['webp'], mimeTypes: ['image/webp'], maximumBytes: 40 * MIB },
  heic: { kind: 'image', mimeType: 'image/heic', extensions: ['heic', 'heif'], mimeTypes: ['image/heic', 'image/heif'], maximumBytes: 40 * MIB },
  mp4: { kind: 'video', mimeType: 'video/mp4', extensions: ['mp4', 'm4v'], mimeTypes: ['video/mp4', 'video/x-m4v'], maximumBytes: 500 * MIB },
  quicktime: { kind: 'video', mimeType: 'video/quicktime', extensions: ['mov'], mimeTypes: ['video/quicktime'], maximumBytes: 500 * MIB },
  pdf: { kind: 'document', mimeType: 'application/pdf', extensions: ['pdf'], mimeTypes: ['application/pdf'], maximumBytes: 50 * MIB },
};

const textAt = (bytes, offset, length) => bytes.subarray(offset, offset + length).toString('latin1');

export const detectTrustedFileFormat = (bytes) => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && textAt(bytes, 1, 3) === 'PNG'
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return 'png';
  if (bytes.length >= 12 && textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 12 && textAt(bytes, 4, 4) === 'ftyp') {
    const brand = textAt(bytes, 8, 4).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (brand === 'qt  ') return 'quicktime';
    return 'mp4';
  }
  if (bytes.length >= 5 && textAt(bytes, 0, 5) === '%PDF-') return 'pdf';
  return null;
};

const extensionOf = (fileName) => /\.([A-Za-z0-9]+)$/.exec(String(fileName).trim())?.[1]?.toLowerCase() || '';

const hashFile = (path) => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = createReadStream(path);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('error', reject);
  stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
});

const extractSafeCaptureDate = async (path) => {
  try {
    const metadata = await exifr.parse(await readFile(path), { pick: ['DateTimeOriginal', 'CreateDate'] });
    const candidate = metadata?.DateTimeOriginal || metadata?.CreateDate;
    if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime())) return null;
    return {
      capturedAt: candidate.toISOString(),
      timestampSource: metadata?.DateTimeOriginal ? 'exif.DateTimeOriginal' : 'exif.CreateDate',
    };
  } catch {
    return null;
  }
};

const assertIsoMediaStructure = async (path, fileSize) => {
  const fileHandle = await open(path, 'r');
  let offset = 0;
  let boxCount = 0;
  let hasFtyp = false;
  let hasMediaData = false;
  let hasMovieIndex = false;
  try {
    while (offset + 8 <= fileSize && boxCount < 100_000) {
      const header = Buffer.alloc(16);
      const { bytesRead } = await fileHandle.read(header, 0, header.length, offset);
      if (bytesRead < 8) break;
      const size32 = header.readUInt32BE(0);
      const type = header.subarray(4, 8).toString('latin1');
      let headerSize = 8;
      let boxSize = size32;
      if (size32 === 1) {
        if (bytesRead < 16) throw new PrivateUploadVerificationError('invalid_media_container', 'Le conteneur vidéo est tronqué.');
        boxSize = Number(header.readBigUInt64BE(8));
        headerSize = 16;
      } else if (size32 === 0) {
        boxSize = fileSize - offset;
      }
      if (!Number.isSafeInteger(boxSize) || boxSize < headerSize || offset + boxSize > fileSize) {
        throw new PrivateUploadVerificationError('invalid_media_container', 'La structure du conteneur vidéo est incohérente.');
      }
      hasFtyp ||= type === 'ftyp';
      hasMediaData ||= type === 'mdat';
      hasMovieIndex ||= type === 'moov' || type === 'moof';
      offset += boxSize;
      boxCount += 1;
    }
  } finally {
    await fileHandle.close();
  }
  if (!hasFtyp || !hasMediaData || !hasMovieIndex) {
    throw new PrivateUploadVerificationError('invalid_media_container', 'Le conteneur vidéo ne contient pas les index et données attendus.');
  }
};

const assertSafePdf = async (path) => {
  const bytes = await readFile(path);
  const tail = bytes.subarray(Math.max(0, bytes.length - 4_096)).toString('latin1');
  if (!tail.includes('%%EOF')) {
    throw new PrivateUploadVerificationError('invalid_pdf', 'Le document PDF est incomplet ou illisible.');
  }
  const source = bytes.toString('latin1');
  const forbidden = /\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/i.exec(source);
  if (forbidden) {
    throw new PrivateUploadVerificationError('active_pdf_content', `Le document PDF contient une fonction active interdite (${forbidden[0]}).`);
  }
};

export const inspectTrustedUpload = async ({
  path,
  fileName,
  declaredMimeType,
  expectedDigest,
  expectedSize,
}) => {
  const fileStat = await stat(path);
  if (fileStat.size !== Number(expectedSize)) {
    throw new PrivateUploadVerificationError('size_mismatch', 'La taille du fichier ne correspond pas au manifeste privé.');
  }
  const fileHandle = await open(path, 'r');
  const header = Buffer.alloc(32);
  try {
    await fileHandle.read(header, 0, header.length, 0);
  } finally {
    await fileHandle.close();
  }
  const format = detectTrustedFileFormat(header);
  if (!format) throw new PrivateUploadVerificationError('unsupported_signature', 'La signature binaire du fichier est inconnue.');
  const policy = policies[format];
  const extension = extensionOf(fileName);
  if (!policy.extensions.includes(extension)) {
    throw new PrivateUploadVerificationError('extension_mismatch', 'L’extension ne correspond pas à la signature binaire.');
  }
  if (!policy.mimeTypes.includes(String(declaredMimeType).toLowerCase())) {
    throw new PrivateUploadVerificationError('mime_mismatch', 'Le type MIME ne correspond pas à la signature binaire.');
  }
  if (fileStat.size > policy.maximumBytes) {
    throw new PrivateUploadVerificationError('file_too_large', 'Le fichier dépasse la limite autorisée pour son format.');
  }
  const digest = await hashFile(path);
  if (digest !== expectedDigest) {
    throw new PrivateUploadVerificationError('digest_mismatch', 'L’empreinte SHA-256 du fichier ne correspond pas au chemin d’archive.');
  }

  let width = null;
  let height = null;
  let derivative = null;
  let variants = [];
  let thumbnail = null;
  let captureDate = null;
  let presentationFailure = null;
  if (policy.kind === 'image') {
    // Une seule passe sharp : copie principale (contrat publication), variantes v3 et vignette inline (C3).
    let set;
    try {
      set = await buildImagePresentationSet({ path });
    } catch (error) {
      if (error?.code === 'invalid_dimensions') throw new PrivateUploadVerificationError('invalid_dimensions', error.message);
      throw error;
    }
    width = set.sourceWidth;
    height = set.sourceHeight;
    derivative = {
      bytes: set.primary.bytes,
      mimeType: set.primary.mimeType,
      width: set.primary.width,
      height: set.primary.height,
      sha256: set.primary.sha256,
      size: set.primary.size,
    };
    variants = set.variants;
    thumbnail = set.thumbnail;
    captureDate = await extractSafeCaptureDate(path);
  } else if (policy.kind === 'document') {
    await assertSafePdf(path);
  } else if (policy.kind === 'video') {
    await assertIsoMediaStructure(path, fileStat.size);
  }
  if (policy.kind === 'document' || policy.kind === 'video') {
    const workingDirectory = await mkdtemp(join(tmpdir(), 'cartularia-presentation-'));
    try {
      derivative = await (policy.kind === 'document' ? createPdfPresentation : createVideoPresentation)({ path, workingDirectory });
    } catch (error) {
      // Availability of a presentation pipeline never authorizes publishing the
      // original as a fallback. An otherwise valid original stays private.
      presentationFailure = error?.code || 'presentation_processing_failed';
    } finally { await rm(workingDirectory, { recursive: true, force: true }); }
  }

  return {
    accepted: true,
    format,
    kind: policy.kind,
    detectedMimeType: policy.mimeType,
    size: fileStat.size,
    digest,
    width,
    height,
    captureDate,
    derivative,
    variants,
    thumbnail,
    derivativeStatus: derivative ? 'ready' : policy.kind === 'video' ? 'pending_transcode' : 'private_only',
    mediaDecodeStatus: policy.kind === 'video' ? derivative ? 'decoded_transcoded_verified' : 'container_structure_verified' : 'not_applicable',
    malwareScanStatus: policy.kind === 'document' ? derivative ? 'rasterized_copy_only_not_antivirus' : 'not_available_private_only' : 'not_applicable',
    publicationEligible: Boolean(derivative),
    presentationFailure,
  };
};

const parsePrivateOriginalPath = (name) => {
  const match = PRIVATE_ORIGINAL_PATTERN.exec(String(name || ''));
  if (!match) return null;
  return { uid: match[1], cartularyId: match[2], binaryId: match[3], digest: match[4] };
};

const privateDerivativeMetadata = ({ identity, derivativeId, sourceSha256, contentType }) => ({
  contentType,
  cacheControl: PRIVATE_DERIVATIVE_CACHE_CONTROL,
  metadata: {
    ownerUid: identity.uid,
    cartularyId: identity.cartularyId,
    binaryId: identity.binaryId,
    derivativeId,
    sourceSha256,
    metadataStripped: 'true',
    firebaseStorageDownloadTokens: '',
  },
});

/** Écrit les variantes v3 (derivativeId = nom de fichier complet, exigence storage.rules) et renvoie les entrées du manifeste. */
const writePresentationVariants = async ({ bucket, identity, sourceSha256, variants }) => {
  const entries = manifestVariantsFor({ variants }, identity);
  for (const [index, variant] of variants.entries()) {
    await bucket.file(entries[index].storagePath).save(variant.bytes, {
      resumable: false,
      metadata: privateDerivativeMetadata({ identity, derivativeId: variant.derivativeId, sourceSha256, contentType: variant.mimeType }),
    });
  }
  return entries;
};

/** Écrit presentation-v2.<ext> (contrat publication Admin, inchangé) et renvoie les champs historiques du manifeste. */
const writePrimaryPresentation = async ({ bucket, identity, sourceSha256, derivative }) => {
  const extension = derivative.mimeType === 'application/pdf' ? 'pdf' : derivative.mimeType === 'video/mp4' ? 'mp4' : 'webp';
  const derivativePath = `private-derivatives/${identity.uid}/${identity.cartularyId}/${identity.binaryId}/presentation-v2.${extension}`;
  await bucket.file(derivativePath).save(derivative.bytes, {
    resumable: false,
    metadata: privateDerivativeMetadata({ identity, derivativeId: 'presentation-v2', sourceSha256, contentType: derivative.mimeType }),
  });
  return {
    storagePath: derivativePath,
    mimeType: derivative.mimeType,
    width: derivative.width ?? null,
    height: derivative.height ?? null,
    pageCount: derivative.pageCount ?? null,
    duration: derivative.duration ?? null,
    processingMethod: derivative.processingMethod || 'image_reencoded_v1',
    sha256: derivative.sha256 || sha256Of(derivative.bytes),
    size: derivative.bytes.length,
    metadataStripped: true,
    sourceSha256,
    verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
  };
};

/** Champs imbriqués sous presentationDerivative (règle R4 : aucune clé de premier niveau). */
const presentationVariantFields = ({ variantEntries, thumbnail, generatedAt = new Date().toISOString() }) => (
  variantEntries.length
    ? {
      variantsVersion: PRESENTATION_VARIANT_VERSION,
      variants: variantEntries,
      variantsGeneratedAt: generatedAt,
      variantsFailure: null,
      thumbnail: thumbnail ? { dataUrl: thumbnail.dataUrl, width: thumbnail.width, height: thumbnail.height, sha256: thumbnail.sha256 } : null,
    }
    : {}
);

const waitForManifest = async (reference, attempts = 20) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await reference.get();
    if (snapshot.exists) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
};

export const processPrivateDraftUpload = async ({ firestore, storage, object }) => {
  const identity = parsePrivateOriginalPath(object?.name);
  if (!identity) return { status: 'ignored', reason: 'outside_private_originals' };
  const { uid, cartularyId, binaryId, digest } = identity;
  const manifestRef = firestore.doc(`privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${binaryId}`);
  const manifestSnapshot = await waitForManifest(manifestRef);
  if (!manifestSnapshot) {
    throw new PrivateUploadVerificationError('manifest_missing', 'Le manifeste Firestore du fichier est absent.');
  }
  const manifest = manifestSnapshot.data();
  const metadata = object.metadata || {};
  const expectedPath = `private-drafts/${uid}/${cartularyId}/${binaryId}/${digest}/original`;
  if (
    manifest.ownerUid !== uid
    || manifest.cartularyId !== cartularyId
    || manifest.binaryId !== binaryId
    || manifest.storagePath !== expectedPath
    || manifest.sha256 !== `sha256:${digest}`
    || Number(manifest.size) !== Number(object.size)
    || metadata.ownerUid !== uid
    || metadata.cartularyId !== cartularyId
    || metadata.binaryId !== binaryId
    || metadata.sha256 !== `sha256:${digest}`
  ) {
    await manifestRef.set({
      uploadStatus: 'failed',
      verificationStatus: 'rejected',
      verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
      verificationReason: 'identity_mismatch',
      verificationMessage: 'Le chemin, les métadonnées et le manifeste ne désignent pas le même original.',
      publicationEligible: false,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 'rejected', uid, cartularyId, binaryId, reason: 'identity_mismatch' };
  }

  await manifestRef.set({
    uploadStatus: 'verifying',
    verificationStatus: 'processing',
    verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
    verificationStartedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const workingDirectory = await mkdtemp(join(tmpdir(), 'cartularia-upload-'));
  const localPath = join(workingDirectory, 'original');
  try {
    const bucket = storage.bucket(object.bucket);
    await bucket.file(expectedPath).download({ destination: localPath });
    const inspection = await inspectTrustedUpload({
      path: localPath,
      fileName: manifest.fileName || metadata.originalFileName || 'original',
      declaredMimeType: object.contentType || manifest.mimeType,
      expectedDigest: `sha256:${digest}`,
      expectedSize: Number(object.size),
    });
    let presentationDerivative = null;
    if (inspection.derivative) {
      // Ordre : variantes v3 d'abord, presentation-v2 ensuite, manifeste en dernier (un manifeste écrit implique des fichiers présents).
      const identity = { uid, cartularyId, binaryId };
      const sourceSha256 = `sha256:${digest}`;
      const variantEntries = await writePresentationVariants({ bucket, identity, sourceSha256, variants: inspection.variants });
      presentationDerivative = {
        ...await writePrimaryPresentation({ bucket, identity, sourceSha256, derivative: inspection.derivative }),
        ...presentationVariantFields({ variantEntries, thumbnail: inspection.thumbnail }),
      };
    }
    await manifestRef.set({
      uploadStatus: 'ready',
      verificationStatus: 'accepted',
      verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
      verificationReason: null,
      verificationMessage: inspection.presentationFailure ? `Original privé conservé ; copie de présentation non autorisée (${inspection.presentationFailure}).` : null,
      detectedMimeType: inspection.detectedMimeType,
      detectedFormat: inspection.format,
      verifiedSize: inspection.size,
      imageWidth: inspection.width,
      imageHeight: inspection.height,
      capturedAtExtracted: inspection.captureDate?.capturedAt || null,
      capturedAtSource: inspection.captureDate?.timestampSource || null,
      derivativeStatus: inspection.derivativeStatus,
      mediaDecodeStatus: inspection.mediaDecodeStatus,
      presentationDerivative,
      metadataPolicy: 'original_unchanged_derivative_stripped',
      malwareScanStatus: inspection.malwareScanStatus,
      publicationEligible: inspection.publicationEligible,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 'accepted', uid, cartularyId, binaryId, format: inspection.format, derivativeCreated: Boolean(presentationDerivative) };
  } catch (error) {
    await manifestRef.set({
      uploadStatus: 'failed',
      verificationStatus: 'rejected',
      verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
      verificationReason: error?.code || 'inspection_failed',
      verificationMessage: String(error?.message || error).slice(0, 500),
      publicationEligible: false,
      verifiedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 'rejected', uid, cartularyId, binaryId, reason: error?.code || 'inspection_failed' };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};

const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'heic']);
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

/** Vrai si le manifeste décrit une image (format détecté, MIME déclaré ou extension du nom). */
export const manifestDescribesImage = (manifest) => (
  IMAGE_FORMATS.has(String(manifest?.detectedFormat || ''))
  || /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(String(manifest?.detectedMimeType || manifest?.mimeType || ''))
  || IMAGE_EXTENSIONS.has(extensionOf(manifest?.fileName || ''))
);

const manifestPath = ({ uid, cartularyId, binaryId }) => `privateDrafts/${uid}/cartularies/${cartularyId}/binaries/${binaryId}`;

const fileExists = async (file) => {
  const [exists] = await file.exists();
  return exists === true;
};

/**
 * Classement d'un manifeste avant régénération (aucune écriture) :
 * skipped (deleted / not_accepted / not_image / invalid_storage_path / manifest_missing / failure_recorded), original_missing,
 * already_current (variantes v3 + vignette présentes et fichiers existants, sauf force) ou to_generate.
 * failure_recorded : sharp a déjà refusé l'original (presentationDerivative.variantsFailure) ; sans --force, aucun rejeu
 * (ni téléchargement, ni réécriture du manifeste) — même règle que la seconde passe du backlog.
 */
export const classifyPresentationRegeneration = async ({ bucket, identity, manifest, force = false }) => {
  if (!manifest) return { status: 'skipped', reason: 'manifest_missing' };
  if (manifest.deleted === true) return { status: 'skipped', reason: 'deleted' };
  if (!privateBinaryIsVerified(manifest)) return { status: 'skipped', reason: 'not_accepted' };
  if (!manifestDescribesImage(manifest)) return { status: 'skipped', reason: 'not_image' };
  const original = parsePrivateOriginalPath(manifest.storagePath);
  if (!original || original.uid !== identity.uid || original.cartularyId !== identity.cartularyId || original.binaryId !== identity.binaryId
    || manifest.sha256 !== `sha256:${original.digest}`) {
    return { status: 'skipped', reason: 'invalid_storage_path' };
  }
  if (!force && manifestHasCurrentPresentationVariants(manifest)) {
    const present = await Promise.all(manifest.presentationDerivative.variants.map((variant) => fileExists(bucket.file(variant.storagePath))));
    if (present.every(Boolean)) return { status: 'already_current' };
  }
  if (!force && manifest.presentationDerivative?.variantsFailure) return { status: 'skipped', reason: 'failure_recorded' };
  if (!await fileExists(bucket.file(manifest.storagePath))) return { status: 'original_missing' };
  return { status: 'to_generate' };
};

/**
 * Régénère les dérivés d'un binaire image ACCEPTÉ sans jamais toucher verificationStatus/uploadStatus/verificationVersion :
 * variantes v3 + vignette inline (+ presentation-v2.webp seulement s'il manque ou si son empreinte diffère du manifeste).
 * Idempotent (already_current), sans écriture en simulation (dryRun), digest_mismatch sans écriture, échec sharp
 * consigné dans presentationDerivative.variantsFailure sans dégradation de l'acceptation.
 */
export const regeneratePresentationDerivatives = async ({ firestore, storage, bucketName = undefined, uid, cartularyId, binaryId, dryRun = false, force = false, now = () => new Date().toISOString() }) => {
  const identity = { uid, cartularyId, binaryId };
  const manifestRef = firestore.doc(manifestPath(identity));
  const snapshot = await manifestRef.get();
  const manifest = snapshot.exists ? snapshot.data() : null;
  const bucket = storage.bucket(bucketName);
  const classification = await classifyPresentationRegeneration({ bucket, identity, manifest, force });
  if (classification.status !== 'to_generate') return { ...identity, ...classification };
  if (dryRun) return { ...identity, status: 'planned' };

  const workingDirectory = await mkdtemp(join(tmpdir(), 'cartularia-regenerate-'));
  const localPath = join(workingDirectory, 'original');
  try {
    await bucket.file(manifest.storagePath).download({ destination: localPath });
    const fileStat = await stat(localPath);
    if (fileStat.size !== Number(manifest.size) || await hashFile(localPath) !== manifest.sha256) {
      return { ...identity, status: 'digest_mismatch' };
    }
    const existing = manifest.presentationDerivative && typeof manifest.presentationDerivative === 'object' ? manifest.presentationDerivative : null;
    let set;
    try {
      set = await buildImagePresentationSet({ path: localPath });
    } catch (error) {
      const failure = error?.code || 'variants_processing_failed';
      await manifestRef.set({
        presentationDerivative: { ...(existing || {}), variantsVersion: null, variants: [], thumbnail: null, variantsFailure: failure, variantsGeneratedAt: now() },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { ...identity, status: 'failed', reason: failure };
    }
    const sourceSha256 = manifest.sha256;
    const variantEntries = await writePresentationVariants({ bucket, identity, sourceSha256, variants: set.variants });
    let primaryFields = existing && typeof existing.storagePath === 'string' && existing.sourceSha256 === sourceSha256 && existing.mimeType === 'image/webp'
      && await fileExists(bucket.file(existing.storagePath))
      ? null
      : await writePrimaryPresentation({ bucket, identity, sourceSha256, derivative: set.primary });
    if (!primaryFields && existing.sha256 && existing.size) {
      const [bytes] = await bucket.file(existing.storagePath).download();
      if (sha256Of(bytes) !== existing.sha256 || bytes.length !== Number(existing.size)) {
        primaryFields = await writePrimaryPresentation({ bucket, identity, sourceSha256, derivative: set.primary });
      }
    }
    const presentationDerivative = {
      ...(existing || {}),
      ...(primaryFields || {}),
      ...presentationVariantFields({ variantEntries, thumbnail: set.thumbnail, generatedAt: now() }),
    };
    await manifestRef.set({
      presentationDerivative,
      derivativeStatus: 'ready',
      publicationEligible: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ...identity, status: 'generated', variants: variantEntries.map((variant) => variant.storagePath), primaryRewritten: Boolean(primaryFields), thumbnail: Boolean(set.thumbnail) };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
};

/**
 * Miroirs K3 sur le chemin de l'objet seulement : cartularies/{id}/assets/{assetId}.privatePresentation pour les assets
 * dont binaryId correspond, et registries/{r}/items/{id}.thumbnail (kind inline) + thumbnailStatus si l'asset primaire
 * est parmi eux. Ne touche ni updatedAt/revision/contentHash de l'item ni les autres champs des assets ; n'efface jamais
 * une vignette. Idempotent strict (tour 4 point 6) : aucune écriture quand le contenu est identique (`writes` = 0).
 * Sans variante mais avec un échec définitif consigné (variantsFailure, original rejeté), seul thumbnailStatus 'failed'
 * est posé sur l'item (statut 'failure_recorded', décision (d)).
 */
export const applyPresentationMirrors = async ({ firestore, uid, cartularyId, binaryId, manifest = null, dryRun = false }) => {
  const identity = { uid, cartularyId, binaryId };
  const record = manifest ?? (await firestore.doc(manifestPath(identity)).get()).data() ?? null;
  const mirror = assetPresentationMirror(record, identity);
  const failed = !mirror && binaryPresentationFailed(record);
  const skipped = (reason) => ({ ...identity, status: 'skipped', reason, assets: [], itemThumbnail: false, thumbnailStatus: null, writes: 0 });
  if (!mirror && !failed) return skipped('no_current_variants');
  const rootSnapshot = await firestore.doc(`cartularies/${cartularyId}`).get();
  const root = rootSnapshot.exists ? rootSnapshot.data() : null;
  if (!root) return skipped('root_missing');
  if (root.accountHolderId !== uid) return skipped('owner_mismatch');
  const assets = await firestore.collection(`cartularies/${cartularyId}/assets`).where('binaryId', '==', binaryId).get();
  const assetIds = assets.docs.map((document) => document.id).sort();
  let writes = 0;
  let itemThumbnail = false;
  let itemThumbnailAssetId = null;
  let thumbnailStatus = null;
  if (typeof root.registryId === 'string' && root.registryId) {
    const itemRef = firestore.doc(`registries/${root.registryId}/items/${cartularyId}`);
    const item = await itemRef.get();
    const existing = item.exists ? item.data() ?? {} : null;
    const primaryAssetId = typeof existing?.primaryAssetId === 'string' ? existing.primaryAssetId : null;
    if (existing && primaryAssetId && assetIds.includes(primaryAssetId)) {
      const computed = mirror ? registryThumbnailFromManifest(record, { assetId: primaryAssetId }) : null;
      const preserved = normalizeRegistryThumbnail(existing.thumbnail);
      const thumbnail = computed ?? (preserved?.assetId === primaryAssetId ? preserved : null);
      const primaryAsset = assets.docs.find((document) => document.id === primaryAssetId)?.data() ?? null;
      thumbnailStatus = registryThumbnailStatusFor({ primaryAssetId, primaryAsset, thumbnail, primaryBinary: record });
      const patch = {};
      if (computed && !isDeepStrictEqual(existing.thumbnail, computed)) patch.thumbnail = computed;
      if (existing.thumbnailStatus !== thumbnailStatus) patch.thumbnailStatus = thumbnailStatus;
      if (computed) { itemThumbnail = true; itemThumbnailAssetId = primaryAssetId; }
      // update() (document existant) : la map `thumbnail` est REMPLACÉE ; set(…, { merge: true }) la fusionnerait en
      // profondeur (clé `path` d'une vignette bundle ou `dataUrl` d'une inline conservée : clé étrangère au contrat).
      if (Object.keys(patch).length && !dryRun) { await itemRef.update(patch); writes += 1; }
    }
  }
  if (mirror && !dryRun) {
    for (const document of assets.docs) {
      if (isDeepStrictEqual(document.data()?.privatePresentation, mirror)) continue;
      await firestore.doc(`cartularies/${cartularyId}/assets/${document.id}`).update({ privatePresentation: mirror });
      writes += 1;
    }
  }
  const status = dryRun ? 'planned' : mirror ? 'mirrored' : 'failure_recorded';
  return { ...identity, status, assets: mirror ? assetIds : [], itemThumbnail, itemThumbnailAssetId, thumbnailStatus, registryId: root.registryId ?? null, writes };
};

/**
 * Seconde passe du backlog (K7/G5/G6) : variantes manquantes sur binaire image vérifié, sans re-vérification ni dégradation,
 * puis miroirs de l'objet (ou thumbnailStatus 'failed' sur l'item quand sharp refuse l'original). `limit` borne le nombre
 * de régénérations par passage (10 par nuit, PRIVATE_UPLOAD_BACKLOG_LIMIT).
 */
export const regenerateMissingPresentationVariants = async ({ firestore, storage, limit = PRIVATE_UPLOAD_BACKLOG_LIMIT }) => {
  const [files] = await storage.bucket().getFiles({ prefix: 'private-drafts/' });
  let regenerated = 0;
  let failed = 0;
  let mirrored = 0;
  const seen = new Set();
  for (const file of files) {
    if (regenerated + failed >= limit) break;
    const identity = parsePrivateOriginalPath(file.name);
    if (!identity) continue;
    const key = manifestPath(identity);
    if (seen.has(key)) continue;
    seen.add(key);
    const manifest = (await firestore.doc(key).get()).data() ?? null;
    if (!manifest || manifest.deleted === true || !privateBinaryIsVerified(manifest) || !manifestDescribesImage(manifest)) continue;
    if (manifestHasCurrentPresentationVariants(manifest) || manifest.presentationDerivative?.variantsFailure) continue;
    const result = await regeneratePresentationDerivatives({ firestore, storage, ...identity });
    if (result.status === 'generated') {
      regenerated += 1;
      const mirror = await applyPresentationMirrors({ firestore, ...identity });
      if (mirror.status === 'mirrored') mirrored += 1;
    } else if (result.status === 'failed' || result.status === 'digest_mismatch') {
      failed += 1;
      // Échec définitif consigné : l'item de l'objet passe à thumbnailStatus 'failed' (jamais « en préparation » perpétuel).
      if (result.status === 'failed') await applyPresentationMirrors({ firestore, ...identity });
    }
  }
  return { variantsRegenerated: regenerated, variantsFailed: failed, mirrored };
};

/**
 * Backlog nocturne (verifyPrivateDraftBacklogDaily), deux passes bornées à `limit` = 10 manifestes chacune :
 * 1. vérification des binaires JAMAIS vérifiés ou en attente (aucun verificationStatus accepté/rejeté, aucune acceptation
 *    d'époque) ; un binaire déjà accepté — quelle que soit sa version de vérification — ou déjà rejeté n'est jamais
 *    repassé par processPrivateDraftUpload (G5 tranché, tour 4 point 8 : ni re-vérification ni dégradation) ;
 * 2. variantes manquantes sur binaires vérifiés + miroirs de l'objet (regenerateMissingPresentationVariants).
 */
const backlogNeedsVerification = (manifest) => (
  manifest.verificationVersion !== PRIVATE_UPLOAD_VERIFICATION_VERSION
  && !privateBinaryIsVerified(manifest)
  && manifest.verificationStatus !== 'accepted'
  && manifest.verificationStatus !== 'rejected'
);

export const processPrivateDraftUploadBacklog = async ({ firestore, storage, limit = PRIVATE_UPLOAD_BACKLOG_LIMIT, variantLimit = limit }) => {
  const [files] = await storage.bucket().getFiles({ prefix: 'private-drafts/' });
  let inspected = 0;
  let accepted = 0;
  let rejected = 0;
  for (const file of files) {
    if (inspected >= limit) break;
    const identity = parsePrivateOriginalPath(file.name);
    if (!identity) continue;
    const manifest = await firestore.doc(
      `privateDrafts/${identity.uid}/cartularies/${identity.cartularyId}/binaries/${identity.binaryId}`,
    ).get();
    if (!manifest.exists || !backlogNeedsVerification(manifest.data())) continue;
    const [metadata] = await file.getMetadata();
    const result = await processPrivateDraftUpload({ firestore, storage, object: metadata });
    inspected += 1;
    if (result.status === 'accepted') accepted += 1;
    if (result.status === 'rejected') rejected += 1;
  }
  // Seconde passe : variantes manquantes sur binaires vérifiés (jamais de re-vérification, jamais de dégradation).
  const second = await regenerateMissingPresentationVariants({ firestore, storage, limit: variantLimit });
  return { inspected, accepted, rejected, ...second };
};
