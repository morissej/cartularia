import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import type { Asset } from '../types';
import type { ObjectUrlLease } from '../utils/objectUrlLeaseCache.ts';
import { presentationImageSetFor } from '../media/presentationDerivatives.ts';
import { mediaFailureKind, mediaFailureMessage, type MediaFailureKind } from '../utils/mediaFailure';

/**
 * Copie affichée pour un média privé (contrat V3, K4) :
 * - 'thumbnail' (≈ 240-480 px) et 'stage' (≈ 768-1200 px, défaut) : variantes presentation-v3 via acquirePrivatePresentationObjectUrl ;
 *   sans variante → « Aperçu en préparation », JAMAIS de repli automatique sur l'original ;
 * - 'original' : uniquement sur action explicite de l'utilisateur (« Afficher l'original ») via acquirePrivateMediaObjectUrl.
 * `onDerivativeUnavailable` (tour 4, point 3) informe SEULEMENT le parent qu'aucune variante n'existe ('derivative-pending'
 * ou 'derivative-failed') ; s'il répond `true`, il prend la décision (ReportPrintImage : original pendant la préparation
 * explicite du rapport) et aucun état d'échec n'est rendu ici. Ce composant n'acquiert jamais l'original de lui-même.
 */
export type PrivateMediaImageRole = 'thumbnail' | 'stage' | 'original';
export type PrivateMediaDerivativeFailure = Extract<MediaFailureKind, 'derivative-pending' | 'derivative-failed'>;

interface PrivateMediaImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  asset: Asset;
  eager?: boolean;
  sourceOverride?: string;
  language?: 'FR' | 'EN';
  role?: PrivateMediaImageRole;
  onDerivativeUnavailable?: (kind: PrivateMediaDerivativeFailure) => boolean | void;
}

const usableSource = (value: string | undefined) => (
  value && !value.startsWith('data:image/gif;base64,R0lGODlhAQAB') ? value : undefined
);

export function PrivateMediaImage({
  asset,
  eager = false,
  sourceOverride,
  language = 'FR',
  role = 'stage',
  onDerivativeUnavailable,
  loading,
  onError,
  sizes,
  width,
  height,
  style,
  ...imageProps
}: PrivateMediaImageProps) {
  const directSource = useMemo(() => usableSource(
    sourceOverride || asset.posterUrl || asset.thumbnailUrl || (asset.type === 'image' ? asset.url : undefined),
  ), [asset.posterUrl, asset.thumbnailUrl, asset.type, asset.url, sourceOverride]);
  const [failedDirectSource, setFailedDirectSource] = useState<string | undefined>();
  const effectiveDirectSource = directSource === failedDirectSource ? undefined : directSource;
  const [source, setSource] = useState<string | undefined>(effectiveDirectSource);
  const [loadFailed, setLoadFailed] = useState(false);
  const [failureKind, setFailureKind] = useState<MediaFailureKind>('network');
  const [attempt, setAttempt] = useState(0);
  const [insideAction, setInsideAction] = useState(false);
  const [decodedSource, setDecodedSource] = useState<string | undefined>();
  const imageRef = useRef<HTMLImageElement>(null);
  // Miroir facultatif lu à la résolution : il ne déclenche pas de rechargement par lui-même.
  const presentationRef = useRef(asset.privatePresentation);
  presentationRef.current = asset.privatePresentation;
  const derivativeHandlerRef = useRef(onDerivativeUnavailable);
  derivativeHandlerRef.current = onDerivativeUnavailable;

  useEffect(() => {
    setFailedDirectSource(undefined);
  }, [directSource]);

  useEffect(() => {
    setSource(effectiveDirectSource);
    setLoadFailed(false);
  }, [effectiveDirectSource]);

  useEffect(() => {
    if (effectiveDirectSource || asset.type !== 'image' || (!asset.binaryId && !asset.publicStoragePath)) return undefined;
    let active = true;
    let shouldRetain = eager || typeof IntersectionObserver === 'undefined';
    let loadingLease = false;
    let lease: ObjectUrlLease | null = null;
    let observer: IntersectionObserver | null = null;

    const release = () => {
      const currentLease = lease;
      lease = null;
      currentLease?.release();
      if (currentLease && active) setSource((current) => current === currentLease.url ? undefined : current);
    };
    const resolve = () => {
      if (lease || loadingLease) return;
      loadingLease = true;
      setLoadFailed(false);
      const request = asset.publicStoragePath
        ? import('../services/publicMedia').then(({ acquirePublicMediaObjectUrl }) => acquirePublicMediaObjectUrl(asset.publicStoragePath!, asset.publicContentHash))
        : role === 'original'
          ? import('../services/privateMedia.ts').then(({ acquirePrivateMediaObjectUrl }) => acquirePrivateMediaObjectUrl(asset.binaryId!, asset.cartularyId))
          : import('../services/privateMedia.ts').then(({ acquirePrivatePresentationObjectUrl }) => acquirePrivatePresentationObjectUrl({ binaryId: asset.binaryId!, cartularyId: asset.cartularyId, asset: { privatePresentation: presentationRef.current }, role }));
      void request
        .then((acquiredLease) => {
          loadingLease = false;
          if (!active || !shouldRetain) {
            acquiredLease.release();
            return;
          }
          lease = acquiredLease;
          setSource(acquiredLease.url);
        })
        .catch((error: unknown) => {
          loadingLease = false;
          if (!active) return;
          const kind = mediaFailureKind(error);
          // Aucune variante : le parent peut prendre la décision (rapport en préparation) ; sinon état honnête ci-dessous.
          if ((kind === 'derivative-pending' || kind === 'derivative-failed') && derivativeHandlerRef.current?.(kind) === true) return;
          setFailureKind(kind);
          setInsideAction(Boolean(imageRef.current?.closest('button,a')));
          setLoadFailed(true);
        });
    };

    if (eager || typeof IntersectionObserver === 'undefined') resolve();
    else if (imageRef.current) {
      observer = new IntersectionObserver((entries) => {
        shouldRetain = entries.some((entry) => entry.isIntersecting);
        if (shouldRetain) resolve();
        else release();
      }, { rootMargin: '240px' });
      observer.observe(imageRef.current);
    }
    return () => {
      active = false;
      observer?.disconnect();
      release();
    };
  }, [asset.binaryId, asset.cartularyId, asset.publicStoragePath, asset.publicContentHash, asset.type, eager, effectiveDirectSource, attempt, role]);

  const responsive = presentationImageSetFor(source);
  // États des dérivés (décision (d)) : 'pending' = « Aperçu en préparation » (le backlog ou le rattrapage peut encore la produire :
  // reprise offerte) ; 'unavailable' = « Copie de présentation non produite » (échec définitif consigné) ou copie privée d'un
  // autre propriétaire ('shared-unavailable', tour 4 point 7) : aucune reprise (rien à attendre), l'original ne s'obtient que
  // par l'action explicite de la modale. Toute autre panne reste 'error' avec reprise.
  const derivativeState = failureKind === 'derivative-pending' ? 'pending' : failureKind === 'derivative-failed' || failureKind === 'shared-unavailable' ? 'unavailable' : null;
  const image = (
    <img
      {...imageProps}
      ref={imageRef}
      src={source}
      sizes={sizes}
      width={width ?? responsive?.width}
      height={height ?? responsive?.height}
      style={responsive ? { aspectRatio: responsive.aspectRatio, ...style } : style}
      loading={loading ?? (eager ? 'eager' : 'lazy')}
      decoding="async"
      data-media-state={source && decodedSource === source ? 'ready' : 'loading'}
      onLoad={(event) => { setDecodedSource(source); imageProps.onLoad?.(event); }}
      title={loadFailed ? (derivativeState ? mediaFailureMessage(failureKind, language) : 'Média privé momentanément indisponible') : imageProps.title}
      onError={(event) => {
        onError?.(event);
        if (source === directSource && (asset.binaryId || asset.publicStoragePath)) setFailedDirectSource(directSource);
        else { setFailureKind('network'); setInsideAction(Boolean(imageRef.current?.closest('button,a'))); setLoadFailed(true); }
      }}
    />
  );

  if (loadFailed) return <span role="status" data-media-state={derivativeState ?? 'error'} data-media-failure={failureKind} data-media-name={imageProps.alt} className={`media-empty media-load-error${derivativeState ? ' media-derivative-pending' : ''}`}>{mediaFailureMessage(failureKind, language)}{derivativeState === 'unavailable' ? null : insideAction ? <small>{language === 'FR' ? 'Ouvrez le média pour réessayer.' : 'Open this media to retry.'}</small> : <button type="button" onClick={() => { setLoadFailed(false); setDecodedSource(undefined); setSource(effectiveDirectSource); setAttempt((value) => value + 1); }}>{language === 'FR' ? 'Réessayer le média' : 'Retry media'}</button>}</span>;
  return responsive ? (
    <picture className="presentation-picture">
      <source type="image/avif" srcSet={responsive.avifSrcSet} sizes={sizes} />
      <source type="image/webp" srcSet={responsive.webpSrcSet} sizes={sizes} />
      {image}
    </picture>
  ) : image;
}
