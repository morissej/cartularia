export type PresentationImageFormat = 'avif' | 'webp';

export interface PresentationImageSet {
  source: string;
  width: number;
  height: number;
  aspectRatio: string;
  avifSrcSet: string;
  webpSrcSet: string;
}

const IWC_IMAGE_DIMENSIONS: Record<string, readonly [width: number, height: number]> = {
  'Focus Shift White Back.jpg': [1200, 801],
  'Focus Shift White Front.jpg': [1200, 800],
  '_DSC0975-3.jpg': [1200, 800],
  '_DSC0976-3.jpg': [1200, 800],
  '_DSC0977-3.jpg': [1200, 800],
  '_DSC0978-3.jpg': [1200, 800],
  '_DSC0980-3.jpg': [800, 1200],
  '_DSC0981-3.jpg': [800, 1200],
  '_DSC0985-3.jpg': [800, 1200],
  '_DSC0988-3.jpg': [1200, 800],
  '_DSC0990-3.jpg': [1200, 800],
  '_DSC0991-3.jpg': [1200, 800],
  '_DSC0992-3.jpg': [1200, 800],
  '_DSC0993-3.jpg': [1200, 800],
  '_DSC0994-3.jpg': [800, 1200],
  '_DSC1009-3.jpg': [800, 1200],
  '_DSC1012-2.jpg': [1200, 800],
  '_DSC1016-2.jpg': [1200, 800],
  '_DSC1019-3.jpg': [1200, 800],
};

const presentationWidths = (sourceWidth: number) => (
  [...new Set([240, 480, 768, sourceWidth])].filter((width) => width <= sourceWidth)
);

const normalizedIwcFilename = (source: string) => {
  const path = source.split(/[?#]/, 1)[0];
  if (!path.startsWith('/assets/IWC/') || !path.toLowerCase().endsWith('.jpg')) return null;
  try {
    return decodeURIComponent(path.slice('/assets/IWC/'.length));
  } catch {
    return null;
  }
};

const derivativeUrl = (filename: string, width: number, format: PresentationImageFormat) => {
  const stem = filename.slice(0, -4);
  return `/assets/IWC/derivatives/${encodeURIComponent(stem)}.${width}.${format}`;
};

export const presentationImageSetFor = (source: string | undefined): PresentationImageSet | null => {
  if (!source) return null;
  const filename = normalizedIwcFilename(source);
  const dimensions = filename ? IWC_IMAGE_DIMENSIONS[filename] : undefined;
  if (!filename || !dimensions) return null;
  const [width, height] = dimensions;
  const srcSet = (format: PresentationImageFormat) => presentationWidths(width)
    .map((candidateWidth) => `${derivativeUrl(filename, candidateWidth, format)} ${candidateWidth}w`)
    .join(', ');
  return {
    source,
    width,
    height,
    aspectRatio: `${width} / ${height}`,
    avifSrcSet: srcSet('avif'),
    webpSrcSet: srcSet('webp'),
  };
};

export const presentationDerivativeUrl = (
  source: string | undefined,
  preferredWidth: number,
  format: PresentationImageFormat = 'webp',
) => {
  if (!source) return source;
  const filename = normalizedIwcFilename(source);
  const dimensions = filename ? IWC_IMAGE_DIMENSIONS[filename] : undefined;
  if (!filename || !dimensions) return source;
  const widths = presentationWidths(dimensions[0]);
  const width = widths.find((candidate) => candidate >= preferredWidth) ?? widths.at(-1)!;
  return derivativeUrl(filename, width, format);
};
