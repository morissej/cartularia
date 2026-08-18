import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import exifr from 'exifr';
import { FieldValue } from 'firebase-admin/firestore';
import sharp from 'sharp';

export const PRIVATE_UPLOAD_VERIFICATION_VERSION = 'private-upload@1.0.0';
export const PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS = Date.parse('2026-08-18T10:45:00.000Z');
const PRIVATE_ORIGINAL_PATTERN = /^private-drafts\/([^/]+)\/([^/]+)\/([^/]+)\/([a-f0-9]{64})\/original$/;
const MIB = 1024 * 1024;
const MAXIMUM_IMAGE_PIXELS = 100_000_000;
const PRESENTATION_MAXIMUM_EDGE = 2_400;

export const privateBinaryIsVerified = (data) => (
  data?.deleted === false
  && data?.uploadStatus === 'ready'
  && (
    data?.verificationStatus === 'accepted'
    || (
      data?.verificationVersion == null
      && Number(data?.clientUpdatedAt || 0) > 0
      && Number(data.clientUpdatedAt) < PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS
    )
  )
);

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
  let captureDate = null;
  if (policy.kind === 'image') {
    const pipeline = sharp(path, { failOn: 'warning', limitInputPixels: MAXIMUM_IMAGE_PIXELS }).rotate();
    const metadata = await pipeline.metadata();
    width = Number(metadata.width || 0);
    height = Number(metadata.height || 0);
    if (!width || !height || width * height > MAXIMUM_IMAGE_PIXELS) {
      throw new PrivateUploadVerificationError('invalid_dimensions', 'Les dimensions de l’image sont absentes ou excessives.');
    }
    const output = await pipeline
      .resize({ width: PRESENTATION_MAXIMUM_EDGE, height: PRESENTATION_MAXIMUM_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    derivative = {
      bytes: output.data,
      mimeType: 'image/webp',
      width: output.info.width,
      height: output.info.height,
    };
    captureDate = await extractSafeCaptureDate(path);
  } else if (policy.kind === 'document') {
    await assertSafePdf(path);
  } else if (policy.kind === 'video') {
    await assertIsoMediaStructure(path, fileStat.size);
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
    derivativeStatus: derivative ? 'ready' : policy.kind === 'video' ? 'pending_transcode' : 'not_required',
    mediaDecodeStatus: policy.kind === 'video' ? 'container_structure_verified' : 'not_applicable',
    malwareScanStatus: policy.kind === 'document' ? 'not_available_private_only' : 'not_applicable',
    publicationEligible: Boolean(derivative),
  };
};

const parsePrivateOriginalPath = (name) => {
  const match = PRIVATE_ORIGINAL_PATTERN.exec(String(name || ''));
  if (!match) return null;
  return { uid: match[1], cartularyId: match[2], binaryId: match[3], digest: match[4] };
};

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
      const derivativePath = `private-derivatives/${uid}/${cartularyId}/${binaryId}/presentation-v1.webp`;
      await bucket.file(derivativePath).save(inspection.derivative.bytes, {
        resumable: false,
        metadata: {
          contentType: inspection.derivative.mimeType,
          cacheControl: 'private, max-age=31536000, immutable',
          metadata: {
            ownerUid: uid,
            cartularyId,
            binaryId,
            derivativeId: 'presentation-v1',
            sourceSha256: `sha256:${digest}`,
            metadataStripped: 'true',
          },
        },
      });
      presentationDerivative = {
        storagePath: derivativePath,
        mimeType: inspection.derivative.mimeType,
        width: inspection.derivative.width,
        height: inspection.derivative.height,
        metadataStripped: true,
        sourceSha256: `sha256:${digest}`,
        verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
      };
    }
    await manifestRef.set({
      uploadStatus: 'ready',
      verificationStatus: 'accepted',
      verificationVersion: PRIVATE_UPLOAD_VERIFICATION_VERSION,
      verificationReason: null,
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

export const processPrivateDraftUploadBacklog = async ({ firestore, storage, limit = 10 }) => {
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
    if (!manifest.exists || manifest.data().verificationVersion === PRIVATE_UPLOAD_VERIFICATION_VERSION) continue;
    const [metadata] = await file.getMetadata();
    const result = await processPrivateDraftUpload({ firestore, storage, object: metadata });
    inspected += 1;
    if (result.status === 'accepted') accepted += 1;
    if (result.status === 'rejected') rejected += 1;
  }
  return { inspected, accepted, rejected };
};
