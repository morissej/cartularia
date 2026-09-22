import type { LocalBinaryInput, LocalBinaryKind } from '../../../persistence/localVault.ts';
import { validateFileForUpload, type TrustedFileInspection, type TrustedFileKind } from '../../../security/fileValidation.ts';
import type { Asset, MediaTag } from '../../../types/index.ts';
import { digestFile } from '../../../utils/fileDigest.ts';
import { formatFileSize } from '../../../utils/formatting.ts';
import { newId } from '../../../utils/identifiers.ts';
import type { ConditionAttachment } from '../state/cartularyStateTypes.ts';

export type MediaSlotKind = 'main-video' | 'spin-3d';
export const MEDIA_SLOT_TAGS: Record<MediaSlotKind, MediaTag> = { 'main-video': 'main-video', 'spin-3d': 'spin-3d' };

/** Shared by every import in this document, including simultaneous entry points. */
export const MEDIA_IMPORT_CONCURRENCY = 2;
let activePreparations = 0;
const preparationWaiters: Array<() => void> = [];

const withinImportLimit = async <T>(prepare: () => Promise<T>): Promise<T> => {
  await new Promise<void>((resolve) => {
    if (activePreparations < MEDIA_IMPORT_CONCURRENCY) {
      activePreparations += 1;
      resolve();
    } else {
      preparationWaiters.push(resolve);
    }
  });
  try {
    return await prepare();
  } finally {
    const next = preparationWaiters.shift();
    if (next) next();
    else activePreparations -= 1;
  }
};

/** Stop queued work after a failure, but settle every started task before cleanup. */
const prepareBounded = async <T, R>(values: readonly T[], prepare: (value: T, index: number) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  let failed = false;
  let failure: unknown;
  await Promise.all(values.map((value, index) => withinImportLimit(async () => {
    if (failed) return;
    try {
      results[index] = await prepare(value, index);
    } catch (error) {
      if (!failed) failure = error;
      failed = true;
    }
  })));
  if (failed) throw failure;
  return results;
};

/** Preview URLs belong to the caller until dispose; binaries contain no URLs. */
export interface PreparedImport<T> {
  items: T[];
  binaries: LocalBinaryInput[];
  dispose(): void;
}

interface PreparedFile {
  file: File;
  inspection: TrustedFileInspection;
  binaryId: string;
  hash: string;
  url: string;
}

/** Only prepares a lot. The caller must commit its binaries and references atomically. */
const prepareImport = async <T>({
  files,
  expectedKind,
  allowedKinds,
  binaryKind,
  binaryPrefix,
  buildItem,
}: {
  files: readonly File[];
  expectedKind?: TrustedFileKind;
  allowedKinds?: readonly TrustedFileKind[];
  binaryKind: LocalBinaryKind;
  binaryPrefix: string;
  buildItem: (file: PreparedFile) => T;
}): Promise<PreparedImport<T>> => {
  const selectedFiles = [...files];
  const urls = new Set<string>();
  const dispose = () => {
    for (const url of urls) {
      try { URL.revokeObjectURL(url); } catch { /* Continue releasing the remaining previews. */ }
    }
    urls.clear();
  };
  try {
    // No whole-file read or hashing until every file's signature, kind and size pass.
    const inspections = await prepareBounded(selectedFiles, (file) => validateFileForUpload({
      blob: file,
      fileName: file.name,
      declaredMimeType: file.type,
      expectedKind,
      allowedKinds,
    }));
    const prepared = await prepareBounded(selectedFiles, async (file, index) => {
      const inspection = inspections[index];
      const hash = await digestFile(file);
      const binaryId = newId(binaryPrefix);
      const url = URL.createObjectURL(file);
      urls.add(url);
      return {
        item: buildItem({ file, inspection, binaryId, hash, url }),
        binary: {
          binaryId,
          kind: binaryKind,
          fileName: file.name,
          mimeType: inspection.canonicalMimeType,
          sha256: hash,
          blob: file,
        },
      };
    });
    return { items: prepared.map(({ item }) => item), binaries: prepared.map(({ binary }) => binary), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
};

export const assetTypeFromMimeType = (mimeType: string): Asset['type'] => mimeType.startsWith('image/')
  ? 'image'
  : mimeType.startsWith('video/') ? 'video' : 'document';

export interface PrepareImportedAssetsInput {
  files: readonly File[];
  tags: readonly MediaTag[];
  referenceReport?: boolean;
}

export const prepareImportedAssets = ({ files, tags, referenceReport = false }: PrepareImportedAssetsInput): Promise<PreparedImport<Asset>> => {
  const selectedTags: MediaTag[] = referenceReport ? ['documentation'] : [...tags];
  return prepareImport({
    files,
    expectedKind: referenceReport ? 'document' : undefined,
    binaryKind: 'media',
    binaryPrefix: referenceReport ? 'reference-report-binary' : 'media-binary',
    buildItem: ({ file, inspection, binaryId, hash, url }): Asset => {
      const type = assetTypeFromMimeType(inspection.canonicalMimeType);
      const metadataTimestamp = new Date(file.lastModified || Date.now()).toISOString();
      return {
        id: newId(referenceReport ? 'reference-report' : 'asset'),
        name: file.name.replace(/\.[^/.]+$/, ''),
        originalFileName: file.name,
        url,
        type,
        ratio: type === 'video' ? '16:9' : '4:5',
        hash,
        status: 'Archived',
        visibility: 'Secret',
        tags: [...selectedTags],
        capturedAt: metadataTimestamp.slice(0, 10),
        metadataTimestamp,
        timestampSource: 'file.lastModified',
        fileSize: formatFileSize(file.size),
        mimeType: inspection.canonicalMimeType,
        binaryId,
        localAvailability: 'available',
        derivativeStatus: type === 'video' ? 'pending' : 'not-required',
        ...(referenceReport ? { category: 'documentation', sourceSection: 'reference-report' } : {}),
      };
    },
  });
};

export const prepareConditionAttachments = ({ files }: { files: readonly File[] }): Promise<PreparedImport<ConditionAttachment>> => prepareImport({
  files,
  allowedKinds: ['image', 'document'],
  binaryKind: 'condition_attachment',
  binaryPrefix: 'condition-binary',
  buildItem: ({ file, inspection, binaryId, hash, url }) => ({
    id: newId('attachment'),
    name: file.name,
    size: file.size,
    type: inspection.canonicalMimeType,
    binaryId,
    sha256: hash,
    url,
  }),
});
