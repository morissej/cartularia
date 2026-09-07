interface DownloadableMedia {
  id?: string;
  name?: string;
  url?: string | null;
  mimeType?: string;
  originalFileName?: string;
  binaryId?: string;
  cartularyId?: string;
  publicStoragePath?: string;
  publicContentHash?: string;
}

const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

const cleanFileName = (value: string) => [...value]
  .map((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return character === '/' || character === '\\' || codePoint < 32 || codePoint === 127 ? '-' : character;
  })
  .join('')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^[.\s-]+|[.\s]+$/g, '');

const extensionFromUrl = (url: string | null | undefined) => {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return '';
  try {
    const match = decodeURIComponent(url.split(/[?#]/, 1)[0]).match(/\.([a-z0-9]{2,5})$/i);
    return match?.[1]?.toLowerCase() || '';
  } catch {
    return '';
  }
};

export const mediaDownloadFileName = (media: DownloadableMedia) => {
  const preferredName = cleanFileName(media.originalFileName || media.name || media.id || 'media') || 'media';
  // Original filenames remain intact. Presentation labels can retain a source
  // suffix (e.g. JPG) even though the actual public copy has become WEBP.
  if (media.originalFileName && !media.publicStoragePath) return preferredName;
  const mime = (media.mimeType || '').split(';', 1)[0].trim().toLowerCase();
  const extension = MIME_EXTENSIONS[mime] || extensionFromUrl(media.url);
  const suffix = preferredName.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (suffix && extension) {
    if (suffix === extension || (extension === 'jpg' && suffix === 'jpeg')) return preferredName;
    if ([...Object.values(MIME_EXTENSIONS), 'jpeg', 'gif', 'tiff', 'tif', 'bmp'].includes(suffix)) return `${preferredName.slice(0, -suffix.length)}${extension}`;
  }
  if (suffix && !extension) return preferredName;
  return extension ? `${preferredName}.${extension}` : preferredName;
};

export type { DownloadableMedia };
