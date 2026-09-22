import { useEffect, useRef, useState } from 'react';
import type { Asset } from '../types';
import type { ObjectUrlLease } from '../utils/objectUrlLeaseCache';
import { mediaFailureKind, mediaFailureMessage, type MediaFailureKind } from '../utils/mediaFailure';
import { observeMediaLease, type MediaTransferProgress } from '../utils/mediaTransfer';

export type MediaSource = Pick<Asset, 'url'> & Partial<Pick<Asset, 'binaryId' | 'cartularyId' | 'publicStoragePath' | 'publicContentHash' | 'privatePresentation' | 'type'>>;
/**
 * 'original' (défaut) : original privé, réservé aux usages à la demande (vidéo, PDF, « Afficher l'original ») ;
 * 'thumbnail' | 'stage' : variantes presentation-v3 (Spin360, scènes), jamais l'original.
 */
export type MediaSourceRole = 'thumbnail' | 'stage' | 'original';
export interface MediaSourceOptions { role?: MediaSourceRole }
export const usableMediaUrl = (url?: string | null) => url && !url.startsWith('data:image/gif;base64,R0lGODlhAQAB') ? url : undefined;

/** Resolves authorized private media without exposing originals in public projections. */
export function useMediaSource(asset: MediaSource, enabled = true, options: MediaSourceOptions = {}) {
  const role: MediaSourceRole = options.role ?? 'original';
  const direct = usableMediaUrl(asset.url);
  const [resolved, setResolved] = useState<{ key: string; url?: string; errorKind?: MediaFailureKind; cancelled?: boolean; progress?: MediaTransferProgress }>({ key: '' });
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const presentationRef = useRef(asset.privatePresentation);
  presentationRef.current = asset.privatePresentation;
  const key = `${asset.cartularyId || ''}:${asset.binaryId || ''}:${asset.publicStoragePath || ''}:${asset.publicContentHash || ''}:${direct || ''}:${role}`;
  const resolvable = Boolean(asset.binaryId || asset.publicStoragePath);
  useEffect(() => {
    if (direct || !resolvable || !enabled) return;
    let active = true;
    let lease: ObjectUrlLease | undefined;
    const pending = new AbortController(); controller.current = pending;
    setResolved({ key, progress: { stage: 'queued' } });
    const onProgress = (progress: MediaTransferProgress) => { if (active && !pending.signal.aborted) setResolved({ key, progress }); };
    const request = asset.publicStoragePath
      ? import('../services/publicMedia').then(({ acquirePublicMediaObjectUrl }) => acquirePublicMediaObjectUrl(asset.publicStoragePath!, asset.publicContentHash, { signal: pending.signal, onProgress }))
      : role === 'original'
        ? import('../services/privateMedia.ts').then(({ acquirePrivateMediaObjectUrl }) => { onProgress({ stage: 'downloading' }); return acquirePrivateMediaObjectUrl(asset.binaryId!, asset.cartularyId); })
        : import('../services/privateMedia.ts').then(({ acquirePrivatePresentationObjectUrl }) => { onProgress({ stage: 'downloading' }); return acquirePrivatePresentationObjectUrl({ binaryId: asset.binaryId!, cartularyId: asset.cartularyId, asset: { privatePresentation: presentationRef.current }, role }); });
    void observeMediaLease(request, pending.signal)
      .then((value) => {
        if (!active || pending.signal.aborted) return value.release();
        lease = value;
        setResolved({ key, url: value.url, progress: { stage: 'ready' } });
      })
      .catch((failure: unknown) => { if (active) setResolved(pending.signal.aborted ? { key, cancelled: true } : { key, errorKind: mediaFailureKind(failure) }); });
    return () => { active = false; pending.abort(); if (controller.current === pending) controller.current = null; lease?.release(); };
  }, [asset.binaryId, asset.cartularyId, asset.publicStoragePath, asset.publicContentHash, direct, enabled, key, attempt, resolvable, role]);
  const value = resolved.key === key ? resolved : undefined;
  return {
    url: direct || (enabled && !value?.cancelled ? value?.url : undefined),
    error: value?.errorKind ? mediaFailureMessage(value.errorKind) : undefined,
    errorKind: value?.errorKind,
    loading: enabled && !direct && resolvable && !value?.url && !value?.errorKind && !value?.cancelled,
    progress: value?.progress,
    cancelled: Boolean(value?.cancelled),
    cancel: () => { controller.current?.abort(); setResolved({ key, cancelled: true }); },
    retry: () => { setResolved({ key, progress: { stage: 'queued' } }); setAttempt((current) => current + 1); },
  };
}
