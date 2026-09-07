import type { ObjectUrlLease } from './objectUrlLeaseCache';

export interface MediaTransferProgress {
  stage: 'queued' | 'metadata' | 'downloading' | 'verifying' | 'ready';
  byteSize?: number;
}
export interface MediaTransferOptions {
  signal?: AbortSignal;
  onProgress?: (progress: MediaTransferProgress) => void;
}
export const mediaTransferAbort = () => new DOMException('Attente du média annulée.', 'AbortError');

/** Cancels this observer, never claims to abort Firebase getBlob's network work. */
export function observeMediaLease(request: Promise<ObjectUrlLease>, signal?: AbortSignal): Promise<ObjectUrlLease> {
  if (!signal) return request;
  return new Promise((resolve, reject) => {
    let cancelled = signal.aborted;
    const abort = () => { cancelled = true; signal.removeEventListener('abort', abort); reject(mediaTransferAbort()); };
    if (cancelled) reject(mediaTransferAbort());
    else signal.addEventListener('abort', abort, { once: true });
    request.then((lease) => {
      signal.removeEventListener('abort', abort);
      if (cancelled) lease.release(); else resolve(lease);
    }, (error) => { signal.removeEventListener('abort', abort); if (!cancelled) reject(error); });
  });
}

export function mediaByteSize(bytes?: number, language: 'FR' | 'EN' = 'FR') {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  const unit = bytes >= 1024 * 1024 ? 1024 * 1024 : bytes >= 1024 ? 1024 : 1;
  return `${new Intl.NumberFormat(language === 'FR' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: unit === 1 ? 0 : 1 }).format(bytes / unit)} ${unit === 1 ? (language === 'FR' ? 'octets' : 'bytes') : unit === 1024 ? 'Kio' : 'Mio'}`;
}
