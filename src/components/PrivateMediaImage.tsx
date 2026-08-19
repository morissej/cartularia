import { useEffect, useMemo, useRef, useState } from 'react';
import type { ImgHTMLAttributes } from 'react';
import type { Asset } from '../types';
import type { ObjectUrlLease } from '../utils/objectUrlLeaseCache.ts';
import { presentationImageSetFor } from '../media/presentationDerivatives.ts';

interface PrivateMediaImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  asset: Asset;
  eager?: boolean;
  sourceOverride?: string;
}

const usableSource = (value: string | undefined) => (
  value && !value.startsWith('data:image/gif;base64,R0lGODlhAQAB') ? value : undefined
);

export function PrivateMediaImage({
  asset,
  eager = false,
  sourceOverride,
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
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setFailedDirectSource(undefined);
  }, [directSource]);

  useEffect(() => {
    setSource(effectiveDirectSource);
  }, [effectiveDirectSource]);

  useEffect(() => {
    if (effectiveDirectSource || asset.type !== 'image' || !asset.binaryId) return undefined;
    let active = true;
    let shouldRetain = eager;
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
      void import('../services/privateMedia.ts')
        .then(({ acquirePrivateMediaObjectUrl }) => acquirePrivateMediaObjectUrl(asset.binaryId!))
        .then((acquiredLease) => {
          loadingLease = false;
          if (!active || !shouldRetain) {
            acquiredLease.release();
            return;
          }
          lease = acquiredLease;
          setSource(acquiredLease.url);
        })
        .catch(() => {
          loadingLease = false;
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
  }, [asset.binaryId, asset.type, eager, effectiveDirectSource]);

  const responsive = presentationImageSetFor(source);
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
      data-media-state={source ? 'ready' : 'loading'}
      onError={(event) => {
        onError?.(event);
        if (source === directSource && asset.binaryId) setFailedDirectSource(directSource);
      }}
    />
  );

  return responsive ? (
    <picture className="presentation-picture">
      <source type="image/avif" srcSet={responsive.avifSrcSet} sizes={sizes} />
      <source type="image/webp" srcSet={responsive.webpSrcSet} sizes={sizes} />
      {image}
    </picture>
  ) : image;
}
