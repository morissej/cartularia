import type { CartulariaLocalVault } from '../../../persistence/localVault.ts';
import type { Asset, MediaTag } from '../../../types/index.ts';
import { digestFile } from '../../../utils/fileDigest.ts';
import { formatFileSize } from '../../../utils/formatting.ts';
import { newId } from '../../../utils/identifiers.ts';

/**
 * Pipeline unique d'import des médias (V5 P-D3), extrait de `addMediaAssets` (`App.tsx`) sans changement
 * de comportement : les deux portes d'entrée — la Bibliothèque (tags cochés) et les emplacements vides de la
 * page Médias (tag imposé) — partagent exactement cette validation (`putValidatedBinary`) et cette forme `Asset`.
 *
 * Module pur : aucun React, aucun accès distant, aucune connaissance du mode démonstration. Toute erreur du coffre
 * (fichier refusé, quota) est propagée telle quelle ; l'appelant décide de l'affichage.
 */

/** Emplacements de la page Médias qui imposent leur tag à l'import (composant `EmptyMediaSlot`). */
export type MediaSlotKind = 'main-video' | 'spin-3d';

/** Tag imposé par l'emplacement : une vidéo importée ici est « Vidéo principale », des photos « Séquence 3D ». */
export const MEDIA_SLOT_TAGS: Record<MediaSlotKind, MediaTag> = { 'main-video': 'main-video', 'spin-3d': 'spin-3d' };

/** Sous-ensemble du coffre local nécessaire à l'import : la validation puis le dépôt du binaire. */
export type MediaImportVault = Pick<CartulariaLocalVault, 'putValidatedBinary'>;

export interface BuildImportedAssetsInput {
  files: File[];
  /** Tags initiaux appliqués à chaque actif importé (cochés dans la Bibliothèque, ou imposés par l'emplacement). */
  tags: MediaTag[];
  /** Coffre local ; `null` hors navigateur (l'actif est alors décrit sans binaire local). */
  vault: MediaImportVault | null;
}

/** Type d'actif déduit du MIME canonique (celui constaté par le coffre, sinon celui déclaré par le navigateur). */
export const assetTypeFromMimeType = (mimeType: string): Asset['type'] => mimeType.startsWith('image/')
  ? 'image'
  : mimeType.startsWith('video/') ? 'video' : 'document';

export const buildImportedAssets = async ({ files, tags, vault }: BuildImportedAssetsInput): Promise<Asset[]> => Promise.all(
  files.map(async (file): Promise<Asset> => {
    const hash = await digestFile(file);
    const binaryId = newId('media-binary');
    const storedBinary = await vault?.putValidatedBinary({
      binaryId,
      kind: 'media',
      fileName: file.name,
      mimeType: file.type,
      sha256: hash,
      blob: file,
    });
    const canonicalMimeType = storedBinary?.mimeType || file.type;
    const type = assetTypeFromMimeType(canonicalMimeType);
    return {
      id: newId('asset'),
      name: file.name.replace(/\.[^/.]+$/, ''),
      originalFileName: file.name,
      url: URL.createObjectURL(file),
      type,
      ratio: type === 'video' ? '16:9' : '4:5',
      hash,
      status: 'Archived',
      visibility: 'Secret',
      tags,
      capturedAt: new Date(file.lastModified || Date.now()).toISOString().slice(0, 10),
      metadataTimestamp: new Date(file.lastModified || Date.now()).toISOString(),
      timestampSource: 'file.lastModified',
      fileSize: formatFileSize(file.size),
      mimeType: canonicalMimeType,
      binaryId,
      localAvailability: 'available',
      derivativeStatus: type === 'video' ? 'pending' : 'not-required',
    };
  }),
);
