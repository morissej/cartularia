export type TrustedFileKind = 'image' | 'video' | 'document';
export type TrustedFileFormat =
  | 'jpeg' | 'png' | 'webp' | 'heic' | 'mp4' | 'quicktime' | 'pdf'
  | 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx' | 'odt' | 'rtf' | 'markdown' | 'text' | 'csv';

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
  doc: { kind: 'document', format: 'doc', canonicalMimeType: 'application/msword', maximumBytes: 50 * MIB },
  docx: { kind: 'document', format: 'docx', canonicalMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', maximumBytes: 50 * MIB },
  xls: { kind: 'document', format: 'xls', canonicalMimeType: 'application/vnd.ms-excel', maximumBytes: 50 * MIB },
  xlsx: { kind: 'document', format: 'xlsx', canonicalMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', maximumBytes: 50 * MIB },
  ppt: { kind: 'document', format: 'ppt', canonicalMimeType: 'application/vnd.ms-powerpoint', maximumBytes: 50 * MIB },
  pptx: { kind: 'document', format: 'pptx', canonicalMimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', maximumBytes: 50 * MIB },
  odt: { kind: 'document', format: 'odt', canonicalMimeType: 'application/vnd.oasis.opendocument.text', maximumBytes: 50 * MIB },
  rtf: { kind: 'document', format: 'rtf', canonicalMimeType: 'application/rtf', maximumBytes: 20 * MIB },
  markdown: { kind: 'document', format: 'markdown', canonicalMimeType: 'text/markdown', maximumBytes: 10 * MIB },
  text: { kind: 'document', format: 'text', canonicalMimeType: 'text/plain', maximumBytes: 10 * MIB },
  csv: { kind: 'document', format: 'csv', canonicalMimeType: 'text/csv', maximumBytes: 20 * MIB },
};

const extensionsByFormat: Record<TrustedFileFormat, readonly string[]> = {
  jpeg: ['jpg', 'jpeg'],
  png: ['png'],
  webp: ['webp'],
  heic: ['heic', 'heif'],
  mp4: ['mp4', 'm4v'],
  quicktime: ['mov'],
  pdf: ['pdf'],
  doc: ['doc'], docx: ['docx'], xls: ['xls'], xlsx: ['xlsx'], ppt: ['ppt'], pptx: ['pptx'],
  odt: ['odt'], rtf: ['rtf'], markdown: ['md', 'markdown'], text: ['txt'], csv: ['csv'],
};

const mimeTypesByFormat: Record<TrustedFileFormat, readonly string[]> = {
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  heic: ['image/heic', 'image/heif'],
  mp4: ['video/mp4', 'video/x-m4v'],
  quicktime: ['video/quicktime'],
  pdf: ['application/pdf'],
  doc: ['application/msword', 'application/octet-stream'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'],
  xls: ['application/vnd.ms-excel', 'application/octet-stream'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'],
  ppt: ['application/vnd.ms-powerpoint', 'application/octet-stream'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream'],
  odt: ['application/vnd.oasis.opendocument.text', 'application/zip', 'application/octet-stream'],
  rtf: ['application/rtf', 'text/rtf', 'application/octet-stream'],
  markdown: ['text/markdown', 'text/plain'],
  text: ['text/plain'],
  csv: ['text/csv', 'text/plain', 'application/vnd.ms-excel'],
};

const isUtf8Text = (bytes: Uint8Array) => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
};

const detectFormat = (bytes: Uint8Array, extension: string): TrustedFileFormat | null => {
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
  if (bytes.length >= 8 && [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => bytes[index] === byte)) {
    return (['doc', 'xls', 'ppt'] as TrustedFileFormat[]).includes(extension as TrustedFileFormat) ? extension as TrustedFileFormat : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3])) {
    return (['docx', 'xlsx', 'pptx', 'odt'] as TrustedFileFormat[]).includes(extension as TrustedFileFormat) ? extension as TrustedFileFormat : null;
  }
  if (bytes.length >= 5 && textAt(bytes, 0, 5) === '{\\rtf') return 'rtf';
  if (isUtf8Text(bytes)) {
    if (extension === 'md' || extension === 'markdown') return 'markdown';
    if (extension === 'txt') return 'text';
    if (extension === 'csv') return 'csv';
  }
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
  const extension = extensionOf(fileName);
  const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  const format = detectFormat(bytes, extension);
  if (!format) {
    throw new FileValidationError(
      'unsupported_signature',
      `${fileName} est refusé : signature inconnue. Formats acceptés : images, vidéos, PDF, Word, OpenDocument, présentations, tableurs, Markdown et texte.`,
    );
  }
  const policy = policyByFormat[format];
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
