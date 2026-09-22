/**
 * Vignette d'item du Registre côté client (contrat V3, K3/K5). Module pur, sans Firebase.
 *
 * registries/{r}/items/{id}.thumbnail est écrit par le serveur Admin seulement (synchronisation, projection,
 * création, script de rattrapage, seed démo) :
 *   inline : { kind: 'inline', dataUrl (WebP ≤ 24 000 caractères), width, height, assetId, sha256 }
 *   bundle : { kind: 'bundle', path (/assets/…/<stem>.240.webp, same-origin), width, height, assetId, sha256 }
 * Les cartes de la Galerie et du Catalogue lisent UNIQUEMENT ce champ : aucune lecture d'assets, aucun Storage.
 * Sans vignette, l'état est honnête (décision (d)) et vient du serveur (K3 étendu, tour 4 point 2) :
 * registries/{r}/items/{id}.thumbnailStatus = 'ready' | 'pending' | 'failed' | 'none', posé par la synchronisation, la
 * création, la projection et le script de rattrapage → « Vignette en préparation » (pending), « Copie de présentation
 * non produite » (failed), « Aucune vignette disponible » (none) ; jamais un « en préparation » perpétuel. Un item
 * antérieur (sans thumbnailStatus) retombe sur la nature de la couverture (image → préparation, sinon indisponible).
 */

export const REGISTRY_THUMBNAIL_MAXIMUM_EDGE = 240;
export const REGISTRY_THUMBNAIL_MAXIMUM_CHARACTERS = 24_000;

export interface RegistryInlineThumbnail {
  kind: 'inline';
  dataUrl: string;
  width: number;
  height: number;
  assetId: string;
  sha256: string;
}

export interface RegistryBundleThumbnail {
  kind: 'bundle';
  path: string;
  width: number;
  height: number;
  assetId: string;
  sha256: string;
}

export type RegistryItemThumbnail = RegistryInlineThumbnail | RegistryBundleThumbnail;
export type RegistryItemMediaKind = 'image' | 'video' | 'audio' | 'document';
/** État écrit par le serveur sur l'item (frère de `thumbnail`, hors contentHash). */
export type RegistryItemThumbnailStatus = 'ready' | 'pending' | 'failed' | 'none';
export type RegistryThumbnailState = 'ready' | 'pending' | 'failed' | 'unavailable' | 'none';

const INLINE_DATA_URL_PATTERN = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MEDIA_KINDS: readonly string[] = ['image', 'video', 'audio', 'document'];
const THUMBNAIL_STATUSES: readonly string[] = ['ready', 'pending', 'failed', 'none'];

const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);

/** Chemin same-origin du bundle Hosting : `/assets/…/<stem>.<w>.webp`, jamais protocol-relative, jamais remontant. */
export const safeBundleThumbnailPath = (value: unknown): value is string => typeof value === 'string'
  && value.startsWith('/assets/')
  && !value.startsWith('//')
  && !value.includes('\\')
  && !value.includes('..')
  && !/[?#]/.test(value)
  && /\.webp$/i.test(value);

/** Vignette d'item validée (clés du contrat seulement) ou null. */
export const normalizeRegistryThumbnail = (value: unknown): RegistryItemThumbnail | null => {
  const record = asRecord(value);
  if (
    !record
    || typeof record.assetId !== 'string' || !record.assetId
    || typeof record.sha256 !== 'string' || !DIGEST_PATTERN.test(record.sha256)
    || !isPositiveInteger(record.width) || !isPositiveInteger(record.height)
    || record.width > REGISTRY_THUMBNAIL_MAXIMUM_EDGE || record.height > REGISTRY_THUMBNAIL_MAXIMUM_EDGE
  ) return null;
  if (record.kind === 'inline') {
    if (typeof record.dataUrl !== 'string' || record.dataUrl.length > REGISTRY_THUMBNAIL_MAXIMUM_CHARACTERS || !INLINE_DATA_URL_PATTERN.test(record.dataUrl)) return null;
    return { kind: 'inline', dataUrl: record.dataUrl, width: record.width, height: record.height, assetId: record.assetId, sha256: record.sha256 };
  }
  if (record.kind === 'bundle') {
    if (!safeBundleThumbnailPath(record.path)) return null;
    return { kind: 'bundle', path: record.path, width: record.width, height: record.height, assetId: record.assetId, sha256: record.sha256 };
  }
  return null;
};

/** Source `<img>` de la vignette (data URL WebP ou chemin same-origin), null si la vignette est absente ou invalide. */
export const registryThumbnailSrc = (value: unknown): string | null => {
  const thumbnail = normalizeRegistryThumbnail(value);
  if (!thumbnail) return null;
  return thumbnail.kind === 'inline' ? thumbnail.dataUrl : thumbnail.path;
};

export const registryItemMediaKind = (value: unknown): RegistryItemMediaKind | null => (
  typeof value === 'string' && MEDIA_KINDS.includes(value) ? value as RegistryItemMediaKind : null
);

export const registryItemThumbnailStatus = (value: unknown): RegistryItemThumbnailStatus | null => (
  typeof value === 'string' && THUMBNAIL_STATUSES.includes(value) ? value as RegistryItemThumbnailStatus : null
);

/**
 * État de vignette d'un item :
 * - 'ready' : vignette valide ;
 * - 'pending' : couverture image sans vignette, copie encore attendue (« Vignette en préparation ») ;
 * - 'failed' : copie de présentation définitivement non produite, consignée par le serveur (« Copie de présentation
 *   non produite ») ;
 * - 'unavailable' : aucune vignette pour cette couverture (vidéo, document, nature inconnue, ou statut serveur
 *   « ready » sans vignette lisible) (« Aucune vignette disponible ») ;
 * - 'none' : aucune photo de couverture.
 * Le statut serveur (`thumbnailStatus`) prime ; sans lui (item antérieur), la nature de la couverture décide.
 */
export const registryThumbnailState = (item: { thumbnail?: unknown; primaryAssetId: string | null; primaryMediaKind?: unknown; thumbnailStatus?: unknown }): RegistryThumbnailState => {
  if (registryThumbnailSrc(item.thumbnail)) return 'ready';
  if (!item.primaryAssetId) return 'none';
  const status = registryItemThumbnailStatus(item.thumbnailStatus);
  if (status === 'pending' || status === 'failed') return status;
  if (status === 'none' || status === 'ready') return 'unavailable';
  return registryItemMediaKind(item.primaryMediaKind) === 'image' ? 'pending' : 'unavailable';
};

export const REGISTRY_THUMBNAIL_STATE_LABELS: Readonly<Record<Exclude<RegistryThumbnailState, 'ready'>, string>> = {
  pending: 'Vignette en préparation',
  failed: 'Copie de présentation non produite',
  unavailable: 'Aucune vignette disponible',
  none: 'Aucune photo de couverture',
};
