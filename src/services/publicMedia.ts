import { getBlob, getMetadata, ref } from 'firebase/storage';
import { storage } from '../firebase';
import { ObjectUrlLeaseCache } from '../utils/objectUrlLeaseCache';
import { createMediaLoadQueue } from '../utils/mediaLoadQueue';
import { MediaFailure } from '../utils/mediaFailure';
import { validPublicMediaPath } from '../utils/publicMediaReference';
import { mediaTransferAbort, observeMediaLease, type MediaTransferOptions, type MediaTransferProgress } from '../utils/mediaTransfer';
export { validPublicMediaPath } from '../utils/publicMediaReference';

const queue = createMediaLoadQueue(2);
const cache = new ObjectUrlLeaseCache(8, (url) => URL.revokeObjectURL(url), 48 * 1024 * 1024);
const transfers = new Map<string, { progress: MediaTransferProgress; listeners: Set<NonNullable<MediaTransferOptions['onProgress']>> }>();

/** Never creates a bearer URL: Storage Rules authorize every uncached request. */
export function acquirePublicMediaObjectUrl(storagePath: string, expectedHash?: string, options: MediaTransferOptions = {}) {
  if (options.signal?.aborted) return Promise.reject(mediaTransferAbort());
  if (!validPublicMediaPath(storagePath)) return Promise.reject(new MediaFailure('missing'));
  const key = `${storagePath}:${expectedHash || ''}`;
  let transfer = transfers.get(key);
  if (!transfer) { transfer = { progress: { stage: 'queued' }, listeners: new Set() }; transfers.set(key, transfer); }
  const current = transfer;
  const update = (progress: MediaTransferProgress) => { current.progress = progress; current.listeners.forEach((listener) => listener(progress)); };
  const listener = options.onProgress ? (progress: MediaTransferProgress) => options.onProgress!(progress) : undefined;
  if (listener) { current.listeners.add(listener); listener(current.progress); }
  const unlisten = () => { if (listener) current.listeners.delete(listener); options.signal?.removeEventListener('abort', unlisten); if (!current.listeners.size && current.progress.stage === 'ready' && transfers.get(key) === current) transfers.delete(key); };
  options.signal?.addEventListener('abort', unlisten, { once: true });
  const request = cache.acquire(key, () => queue(async () => {
    update({ stage: 'metadata' });
    const reference = ref(storage, storagePath);
    const metadata = await getMetadata(reference);
    const byteSize = Number.isFinite(metadata.size) && metadata.size >= 0 ? metadata.size : undefined;
    if (byteSize !== undefined && byteSize > 100 * 1024 * 1024) throw new MediaFailure('too-large');
    update({ stage: 'downloading', byteSize });
    const blob = await getBlob(reference, 100 * 1024 * 1024);
    update({ stage: 'verifying', byteSize: blob.size });
    const hash = expectedHash?.replace(/^sha256[:-]/, '').toLowerCase();
    if (hash && /^[a-f0-9]{64}$/.test(hash)) {
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      if ([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') !== hash) throw new MediaFailure('integrity');
    }
    update({ stage: 'ready', byteSize: blob.size });
    return { url: URL.createObjectURL(blob), byteSize: blob.size };
  }).finally(() => { if (transfers.get(key) === current) transfers.delete(key); })).then((lease) => { if (current.progress.stage === 'queued') update({ stage: 'ready' }); return lease; });
  return observeMediaLease(request, options.signal).finally(unlisten);
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', (event) => {
  // A bfcache entry keeps its mounted DOM and leases. Revoking them breaks Back.
  if (!event.persisted) cache.clear();
});
