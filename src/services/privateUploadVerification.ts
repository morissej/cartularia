import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.ts';

export interface PrivateUploadVerificationResult {
  detectedMimeType: string;
  detectedFormat: string;
  capturedAt: string | null;
  timestampSource: 'exif.DateTimeOriginal' | 'exif.CreateDate' | null;
  derivativeStatus: 'ready' | 'pending' | 'not-required';
}

export const waitForPrivateUploadVerification = ({
  uid,
  cartularyId,
  binaryId,
  timeoutMs = 180_000,
}: {
  uid: string;
  cartularyId: string;
  binaryId: string;
  timeoutMs?: number;
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
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    if (data.verificationStatus === 'rejected' || data.uploadStatus === 'failed') {
      finish(undefined, new Error(
        typeof data.verificationMessage === 'string'
          ? data.verificationMessage
          : 'Le fichier a été refusé par la vérification de sécurité.',
      ));
      return;
    }
    if (data.verificationStatus !== 'accepted' || data.uploadStatus !== 'ready') return;
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
    });
  }, (error) => finish(undefined, error));
});
