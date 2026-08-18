export type TrustedFileKind = 'image' | 'video' | 'document';
export type TrustedFileFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'mp4' | 'quicktime' | 'pdf';

export interface TrustedFileInspection {
  kind: TrustedFileKind;
  format: TrustedFileFormat;
  canonicalMimeType: string;
  extension: string;
  maximumBytes: number;
}

export class FileValidationError extends Error {
  override name = 'FileValidationError';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MIB = 1024 * 1024;
const textAt = (bytes: Uint8Array, offset: number, length: number) => (
  String.fromCharCode(...bytes.slice(offset, offset + length))
);

const policyByFormat: Record<TrustedFileFormat, Omit<TrustedFileInspection, 'extension'>> = {
  jpeg: { kind: 'image', format: 'jpeg', canonicalMimeType: 'image/jpeg', maximumBytes: 40 * MIB },
  png: { kind: 'image', format: 'png', canonicalMimeType: 'image/png', maximumBytes: 40 * MIB },
  webp: { kind: 'image', format: 'webp', canonicalMimeType: 'image/webp', maximumBytes: 40 * MIB },
  heic: { kind: 'image', format: 'heic', canonicalMimeType: 'image/heic', maximumBytes: 40 * MIB },
  mp4: { kind: 'video', format: 'mp4', canonicalMimeType: 'video/mp4', maximumBytes: 500 * MIB },
  quicktime: { kind: 'video', format: 'quicktime', canonicalMimeType: 'video/quicktime', maximumBytes: 500 * MIB },
  pdf: { kind: 'document', format: 'pdf', canonicalMimeType: 'application/pdf', maximumBytes: 50 * MIB },
};

const extensionsByFormat: Record<TrustedFileFormat, readonly string[]> = {
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
  heic: ['heic', 'heif'],
  mp4: ['mp4', 'm4v'],
  quicktime: ['mov'],
  pdf: ['pdf'],
};

const mimeTypesByFormat: Record<TrustedFileFormat, readonly string[]> = {
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  heic: ['image/heic', 'image/heif'],
  mp4: ['video/mp4', 'video/x-m4v'],
  quicktime: ['video/quicktime'],
  pdf: ['application/pdf'],
};

const detectFormat = (bytes: Uint8Array): TrustedFileFormat | null => {
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
  if (bytes.length >= 8 && textAt(bytes, 4, 4) === 'ftyp') {
    const brand = textAt(bytes, 8, 4).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (brand === 'qt  ') return 'quicktime';
    return 'mp4';
  }
  if (bytes.length >= 5 && textAt(bytes, 0, 5) === '%PDF-') return 'pdf';
  return null;
};

const extensionOf = (fileName: string) => {
  const match = /\.([A-Za-z0-9]+)$/.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? '';
};

export const validateFileForUpload = async ({
  blob,
  fileName,
  declaredMimeType,
  expectedKind,
  allowedKinds,
}: {
  blob: Blob;
  fileName: string;
  declaredMimeType?: string;
  expectedKind?: TrustedFileKind;
  allowedKinds?: readonly TrustedFileKind[];
}): Promise<TrustedFileInspection> => {
  if (blob.size <= 0) throw new FileValidationError('empty_file', `${fileName || 'Le fichier'} est vide.`);
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const format = detectFormat(bytes);
  if (!format) {
    throw new FileValidationError(
      'unsupported_signature',
      `${fileName} est refusé : signature inconnue. Formats acceptés : JPG, PNG, WEBP, HEIC, MP4, MOV et PDF.`,
    );
  }
  const policy = policyByFormat[format];
  const extension = extensionOf(fileName);
  if (!extensionsByFormat[format].includes(extension)) {
    throw new FileValidationError(
      'extension_mismatch',
      `${fileName} est refusé : son extension ne correspond pas au format ${format.toUpperCase()} détecté.`,
    );
  }
  const normalizedMimeType = declaredMimeType?.trim().toLowerCase() ?? '';
  if (normalizedMimeType && !mimeTypesByFormat[format].includes(normalizedMimeType)) {
    throw new FileValidationError(
      'mime_mismatch',
      `${fileName} est refusé : le type déclaré ${normalizedMimeType} ne correspond pas à sa signature.`,
    );
  }
  if (expectedKind && policy.kind !== expectedKind) {
    throw new FileValidationError('unexpected_kind', `${fileName} doit être un fichier de type ${expectedKind}.`);
  }
  if (allowedKinds && !allowedKinds.includes(policy.kind)) {
    throw new FileValidationError('unexpected_kind', `${fileName} n’est pas autorisé dans cette rubrique.`);
  }
  if (blob.size > policy.maximumBytes) {
    throw new FileValidationError(
      'file_too_large',
      `${fileName} dépasse la limite de ${Math.round(policy.maximumBytes / MIB)} Mo pour ce format.`,
    );
  }
  return { ...policy, extension };
};
