import { PRESENTATION_CATALOG, type PresentationCatalogEntry } from './presentationCatalog.generated.ts';

export type PresentationImageFormat = 'avif' | 'webp';
export type { PresentationCatalogEntry } from './presentationCatalog.generated.ts';

export interface PresentationImageSet {
  source: string;
  width: number;
  height: number;
  aspectRatio: string;
  /** Vide lorsque la racine ne publie pas d'AVIF : un `<source>` au srcset vide est ignoré par le navigateur. */
  avifSrcSet: string;
  webpSrcSet: string;
}

/** Vignette de bundle (plus petite variante WebP) d'un original catalogué : contrat `item.thumbnail` kind 'bundle'. */
export interface PresentationBundleThumbnail {
  path: string;
  width: number;
  height: number;
  sha256: string;
}

const publicPathOf = (source: string): string | null => {
  const path = source.split(/[?#]/, 1)[0];
  if (!path.startsWith('/assets/') || path.startsWith('//')) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return null;
  }
};

/** Entrée du catalogue statique pour une URL same-origin du bundle ; `null` pour toute autre source (blob, https, privée). */
export const presentationCatalogEntryFor = (source: string | undefined): PresentationCatalogEntry | null => {
  if (!source) return null;
  const path = publicPathOf(source);
  if (!path) return null;
  return Object.hasOwn(PRESENTATION_CATALOG, path) ? PRESENTATION_CATALOG[path] : null;
};

const variantUrl = (entry: PresentationCatalogEntry, width: number, format: PresentationImageFormat) => `${entry.base}.${width}.${format}`;

const srcSetFor = (entry: PresentationCatalogEntry, format: PresentationImageFormat) => (
  entry.formats.includes(format)
    ? entry.variants.map((variant) => `${variantUrl(entry, variant.width, format)} ${variant.width}w`).join(', ')
    : ''
);

export const presentationImageSetFor = (source: string | undefined): PresentationImageSet | null => {
  const entry = presentationCatalogEntryFor(source);
  if (!source || !entry) return null;
  return {
    source,
    width: entry.width,
    height: entry.height,
    aspectRatio: `${entry.width} / ${entry.height}`,
    avifSrcSet: srcSetFor(entry, 'avif'),
    webpSrcSet: srcSetFor(entry, 'webp'),
  };
};

/**
 * Plus petite variante dont la largeur atteint `preferredWidth` (sinon la plus grande), dans le
 * format demandé s'il est publié, sinon en WebP ; la source est rendue telle quelle hors catalogue.
 */
export const presentationDerivativeUrl = (
  source: string | undefined,
  preferredWidth: number,
  format: PresentationImageFormat = 'webp',
) => {
  const entry = presentationCatalogEntryFor(source);
  if (!source || !entry) return source;
  const chosenFormat = entry.formats.includes(format) ? format : 'webp';
  if (!entry.formats.includes(chosenFormat)) return source;
  const variant = entry.variants.find((candidate) => candidate.width >= preferredWidth) ?? entry.variants.at(-1);
  return variant ? variantUrl(entry, variant.width, chosenFormat) : source;
};

export const presentationBundleThumbnailFor = (source: string | undefined): PresentationBundleThumbnail | null => {
  const entry = presentationCatalogEntryFor(source);
  if (!entry) return null;
  const smallest = entry.variants[0];
  if (!smallest) return null;
  return { path: variantUrl(entry, smallest.width, 'webp'), width: entry.thumbnail.width, height: entry.thumbnail.height, sha256: entry.thumbnail.sha256 };
};
