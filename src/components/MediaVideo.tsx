import { useRef, useState, type VideoHTMLAttributes } from 'react';
import type { Asset } from '../types';
import { useMediaSource } from '../hooks/useMediaSource';
import { presentationDerivativeUrl } from '../media/presentationDerivatives';
import { mediaFailureMessage } from '../utils/mediaFailure';
import { MediaTransferStatus } from './MediaTransferStatus';

export function MediaVideo({ asset, language = 'FR', ...props }: {
  asset: Asset;
  language?: 'FR' | 'EN';
} & Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src'>) {
  const identity = `${asset.id}:${asset.cartularyId || ''}:${asset.publicStoragePath || ''}:${asset.publicContentHash || ''}:${asset.binaryId || ''}:${asset.url}`;
  const [requested, setRequested] = useState('');
  const [decodeFailure, setDecodeFailure] = useState('');
  const [attempt, setAttempt] = useState(0);
  const decodeKey = `${identity}:${attempt}`;
  const currentKey = useRef(decodeKey); currentKey.current = decodeKey;
  const needsRequest = Boolean(asset.publicStoragePath) && requested !== identity;
  const source = useMediaSource(asset, !needsRequest);
  if (needsRequest) return <div className="media-load-prompt"><p>{language === 'FR' ? 'La vidéo se charge uniquement à votre demande. Sa taille sera vérifiée avant le transfert.' : 'The video loads only when requested. Its size is checked before transfer.'}{asset.fileSize && <> · {asset.fileSize}</>}</p>{props.controls !== false && <button type="button" onClick={() => setRequested(identity)}>{language === 'FR' ? 'Charger la vidéo' : 'Load video'}</button>}</div>;
  if (source.cancelled) return <div className="media-load-prompt" role="status"><p>{language === 'FR' ? 'Attente annulée. La vidéo ne sera pas ouverte ; le transfert demandé peut continuer en arrière-plan.' : 'Waiting cancelled. The video will not open; the requested transfer may continue in the background.'}</p>{props.controls !== false && <button type="button" onClick={source.retry}>{language === 'FR' ? 'Reprendre le chargement' : 'Resume loading'}</button>}</div>;
  if (source.error || decodeFailure === decodeKey || (!source.loading && !source.url)) return <div role="status" className="media-load-error"><p>{source.errorKind ? mediaFailureMessage(source.errorKind, language) : language === 'FR' ? 'Cette vidéo ne peut pas être lue. Réessayez ou téléchargez le fichier pour l’ouvrir avec un lecteur compatible.' : 'This video cannot be played. Retry or download the file to open it in a compatible player.'}</p>{props.controls !== false && <button type="button" onClick={() => { setDecodeFailure(''); setAttempt((value) => value + 1); source.retry(); }}>{language === 'FR' ? 'Réessayer' : 'Retry'}</button>}</div>;
  if (!source.url) return <MediaTransferStatus progress={source.progress} language={language} onCancel={props.controls === false ? undefined : source.cancel} />;
  return <video {...props} key={decodeKey} src={source.url} onError={(event) => { if (currentKey.current === decodeKey) { props.onError?.(event); setDecodeFailure(decodeKey); } }} poster={presentationDerivativeUrl(asset.posterUrl || asset.thumbnailUrl, 768)} controls={props.controls ?? true} preload={props.preload ?? 'metadata'} aria-label={props['aria-label'] || asset.name}>{language === 'FR' ? 'Votre navigateur ne peut pas lire cette vidéo.' : 'Your browser cannot play this video.'}</video>;
}
