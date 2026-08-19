import type { ImgHTMLAttributes } from 'react';
import { presentationImageSetFor } from '../media/presentationDerivatives.ts';

interface PresentationImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

export function PresentationImage({ src, sizes, width, height, style, ...imageProps }: PresentationImageProps) {
  const responsive = presentationImageSetFor(src);
  if (!responsive) {
    return <img {...imageProps} src={src} sizes={sizes} width={width} height={height} style={style} />;
  }

  return (
    <picture className="presentation-picture">
      <source type="image/avif" srcSet={responsive.avifSrcSet} sizes={sizes} />
      <source type="image/webp" srcSet={responsive.webpSrcSet} sizes={sizes} />
      <img
        {...imageProps}
        src={src}
        sizes={sizes}
        width={width ?? responsive.width}
        height={height ?? responsive.height}
        style={{ aspectRatio: responsive.aspectRatio, ...style }}
      />
    </picture>
  );
}
