import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.ts';
import {
  presentationFromBinaryRecord,
  restrictPresentationToIdentity,
  type PrivatePresentation,
} from '../domain/presentationVariants.ts';

export interface PrivateUploadVerificationResult {
  detectedMimeType: string;
  detectedFormat: string;
  capturedAt: string | null;
  timestampSource: 'exif.DateTimeOriginal' | 'exif.CreateDate' | null;
  derivativeStatus: 'ready' | 'pending' | 'not-required';
  /** Version serveur de la vérification (`private-upload@x.y.z`), informative. */
  verificationVersion: string | null;
  /**
   * Variantes de présentation privées (contrat V3, K2/K4) lues dans le manifeste accepté :
   * `presentationDerivative.variants` restreintes à ce propriétaire/objet/binaire, sans la vignette inline
   * (elle vit dans les miroirs Admin : assets.privatePresentation et items.thumbnail, K3).
   * `null` quand le serveur n'en a produit aucune (vidéo, PDF, échec sharp) : l'aperçu reste « en préparation ».
   */
  privatePresentation: PrivatePresentation | null;
}

/**
 * Référence figée posée dans `cartularia-media-assets-v3` dès la création : variantes seulement, jamais la
 * vignette inline (≤ 24 000 caractères par asset, inutile au client et coûteuse dans l'état du brouillon).
 */
export const presentationReferenceFromManifest = (
  data: unknown,
  { uid, cartularyId, binaryId }: { uid: string; cartularyId: string; binaryId: string },
): PrivatePresentation | null => {
  const presentation = restrictPresentationToIdentity(presentationFromBinaryRecord(data, binaryId), uid, cartularyId, binaryId);
  return presentation ? { ...presentation, thumbnail: null } : null;
};

export const waitForPrivateUploadVerification = ({
  uid,
  cartularyId,
  binaryId,
  timeoutMs = 180_000,
  expectedOriginal,
  assertActive = () => undefined,
}: {
  uid: string;
  cartularyId: string;
  binaryId: string;
  timeoutMs?: number;
  expectedOriginal?: { storagePath: string; sha256: string; size: number; generation: string };
  assertActive?: () => void;
}) => new Promise<PrivateUploadVerificationResult>((resolve, reject) => {
  const reference = doc(db, 'privateDrafts', uid, 'cartularies', cartularyId, 'binaries', binaryId);
  let unsubscribe: () => void = () => undefined;
  let settled = false;
  const finish = (result?: PrivateUploadVerificationResult, error?: Error) => {
    if (settled) return;
    settled = true;
    window.clearTimeout(timeout);
    unsubscribe();
    if (error) reject(error);
    else if (result) resolve(result);
  };
  const timeout = window.setTimeout(() => {
    finish(undefined, new Error('La vérification du fichier tarde à se terminer. Le brouillon privé reste conservé.'));
  }, timeoutMs);
  unsubscribe = onSnapshot(reference, (snapshot) => {
    try { assertActive(); } catch (error) { finish(undefined, error as Error); return; }
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    if (expectedOriginal && (data.deleted === true || data.ownerUid !== uid || data.cartularyId !== cartularyId
      || data.binaryId !== binaryId || data.storagePath !== expectedOriginal.storagePath
      || data.sha256 !== expectedOriginal.sha256 || data.size !== expectedOriginal.size)) {
      finish(undefined, new Error('Le fichier a changé pendant sa vérification. Une nouvelle synchronisation est nécessaire.'));
      return;
    }
    if (data.verificationStatus === 'rejected' || data.uploadStatus === 'failed') {
      finish(undefined, new Error(
        typeof data.verificationMessage === 'string'
          ? data.verificationMessage
          : 'Le fichier a été refusé par la vérification de sécurité.',
      ));
      return;
    }
    if (data.verificationStatus !== 'accepted' || data.uploadStatus !== 'ready') return;
    if (expectedOriginal && (data.verificationIdentity?.schemaVersion !== 'private-binary-identity@1.0.0'
      || data.verificationIdentity?.ownerUid !== uid || data.verificationIdentity?.cartularyId !== cartularyId
      || data.verificationIdentity?.binaryId !== binaryId
      || data.verificationIdentity?.storagePath !== expectedOriginal.storagePath
      || data.verificationIdentity?.sha256 !== expectedOriginal.sha256
      || data.verificationIdentity?.size !== expectedOriginal.size
      || data.verificationIdentity?.generation !== expectedOriginal.generation)) {
      finish(undefined, new Error('L’attestation du fichier ne correspond pas à l’original transféré.'));
      return;
    }
    finish({
      detectedMimeType: typeof data.detectedMimeType === 'string' ? data.detectedMimeType : 'application/octet-stream',
      detectedFormat: typeof data.detectedFormat === 'string' ? data.detectedFormat : 'unknown',
      capturedAt: typeof data.capturedAtExtracted === 'string' ? data.capturedAtExtracted : null,
      timestampSource: data.capturedAtSource === 'exif.DateTimeOriginal' || data.capturedAtSource === 'exif.CreateDate'
        ? data.capturedAtSource
        : null,
      derivativeStatus: data.derivativeStatus === 'ready'
        ? 'ready'
        : data.derivativeStatus === 'pending_transcode' ? 'pending' : 'not-required',
      verificationVersion: typeof data.verificationVersion === 'string' ? data.verificationVersion : null,
      privatePresentation: presentationReferenceFromManifest(data, { uid, cartularyId, binaryId }),
    });
  }, (error) => finish(undefined, error));
  if (settled) unsubscribe();
});
