import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mediaDownloadFileName, type DownloadableMedia } from '../utils/mediaDownload.ts';
import { usableMediaUrl } from '../hooks/useMediaSource';
import { mediaFailureKind, mediaFailureMessage, type MediaFailureKind } from '../utils/mediaFailure';
import { observeMediaLease, type MediaTransferProgress } from '../utils/mediaTransfer';
import { MediaTransferStatus } from './MediaTransferStatus';

interface MediaDownloadLinkProps {
  media: DownloadableMedia;
  language?: 'FR' | 'EN';
  compact?: boolean;
  className?: string;
  showName?: boolean;
}

export function MediaDownloadLink({
  media,
  language = 'FR',
  compact = false,
  className = '',
  showName = false,
}: MediaDownloadLinkProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MediaFailureKind | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [progress, setProgress] = useState<MediaTransferProgress>();
  const pending = useRef<AbortController | null>(null);
  const identity = `${media.id || ''}:${media.cartularyId || ''}:${media.publicStoragePath || ''}:${media.publicContentHash || ''}:${media.binaryId || ''}:${media.url || ''}`;
  useEffect(() => {
    setLoading(false); setError(null); setCancelled(false); setProgress(undefined);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [identity]);
  const directUrl = usableMediaUrl(media.url);
  if (!directUrl && !media.binaryId && !media.publicStoragePath) return null;
  const fileName = mediaDownloadFileName(media);
  const label = language === 'FR' ? 'Télécharger le média' : 'Download media';

  return (
    <span className="media-download-action no-print"><a
      className={`media-download-link no-print ${compact ? 'media-download-link--compact' : ''} ${className}`.trim()}
      href={directUrl || '#'}
      download={fileName}
      aria-label={`${label} : ${media.name || fileName}`}
      aria-busy={loading}
      title={error ? mediaFailureMessage(error, language) : undefined}
      onClick={async (event) => {
        if (directUrl) return;
        event.preventDefault();
        if (pending.current || (!media.binaryId && !media.publicStoragePath)) return;
        const controller = new AbortController(); pending.current = controller;
        setLoading(true);
        setError(null);
        setCancelled(false); setProgress({ stage: 'queued' });
        try {
          const onProgress = (value: MediaTransferProgress) => { if (pending.current === controller && !controller.signal.aborted) setProgress(value); };
          const request = media.publicStoragePath
            ? import('../services/publicMedia').then(({ acquirePublicMediaObjectUrl }) => acquirePublicMediaObjectUrl(media.publicStoragePath!, media.publicContentHash, { signal: controller.signal, onProgress }))
            : import('../services/privateMedia.ts').then(({ acquirePrivateMediaObjectUrl }) => { onProgress({ stage: 'downloading' }); return acquirePrivateMediaObjectUrl(media.binaryId!, media.cartularyId); });
          const lease = await observeMediaLease(request, controller.signal);
          if (pending.current !== controller || controller.signal.aborted) { lease.release(); return; }
          let link: HTMLAnchorElement | undefined;
          try {
            link = document.createElement('a');
            link.href = lease.url;
            link.download = fileName;
            document.body.append(link);
            link.click();
          } finally { link?.remove(); window.setTimeout(() => lease.release(), 1000); }
        } catch (failure) { if (pending.current === controller && !controller.signal.aborted) setError(mediaFailureKind(failure)); }
        finally { if (pending.current === controller) { pending.current = null; setLoading(false); } }
      }}
    >
      <Download size={14} aria-hidden="true" />
      <span role={error ? 'alert' : undefined}>{loading ? (language === 'FR' ? 'Préparation…' : 'Preparing…') : error ? `${mediaFailureMessage(error, language)} ${language === 'FR' ? 'Réessayer' : 'Retry'}` : compact ? (language === 'FR' ? 'Télécharger' : 'Download') : label}{showName && <> · {media.name || fileName}</>}</span>
    </a>{loading && <MediaTransferStatus progress={progress} language={language} onCancel={() => { pending.current?.abort(); pending.current = null; setLoading(false); setCancelled(true); }} />}{cancelled && <small role="status">{language === 'FR' ? 'Attente annulée. Aucun téléchargement ne sera déclenché ; le transfert demandé peut continuer en arrière-plan. Cliquez pour recommencer.' : 'Waiting cancelled. No file download will be triggered; the requested transfer may continue in the background. Click to retry.'}</small>}</span>
  );
}
