import {
  PRESENTATION_VARIANT_VERSION,
  assetPresentationMirror,
  binaryPresentationFailed,
  registryThumbnailFromAsset,
  validRegistryThumbnail,
} from './presentation-variants.mjs';

/**
 * Vignette d'item du Registre (contrat V3, K3) : normalisation et sélection, aucune génération
 * (les octets viennent de presentation-variants.mjs, la vignette inline de la variante 240).
 *
 * registries/{r}/items/{id}.thumbnail :
 *   inline : { kind: 'inline', dataUrl (WebP ≤ 24 000 caractères), width, height, assetId, sha256 }
 *   bundle : { kind: 'bundle', path (/assets/…/<stem>.240.webp), width, height, assetId, sha256 }
 * registries/{r}/items/{id}.primaryMediaKind : 'image' | 'video' | 'audio' | 'document' | null — nature de la
 *   couverture, pour distinguer « Vignette en préparation » (image) d'« Aucune vignette disponible » (vidéo, PDF).
 * registries/{r}/items/{id}.thumbnailStatus (K3 étendu, tour 4 point 2) : 'ready' | 'pending' | 'failed' | 'none',
 *   dérivé de l'asset primaire et du manifeste de son binaire : vignette posée → 'ready' ; image sans miroir ni échec
 *   → 'pending' ; échec définitif consigné (variantsFailure, original rejeté) → 'failed' ; vidéo ou PDF sans dérivé,
 *   nature inconnue ou aucun asset primaire → 'none'. Le client rend « Vignette en préparation », « Copie de
 *   présentation non produite », « Aucune vignette disponible » : jamais un « en préparation » perpétuel (décision (d)).
 * Les trois champs sont des aides de présentation hors `contentHash` : une réécriture d'item les recalcule depuis
 * l'asset primaire ou CONSERVE la vignette existante quand elle désigne encore cet asset ; jamais effacée sinon.
 */

export const REGISTRY_THUMBNAIL_KINDS = Object.freeze(['inline', 'bundle']);
export const REGISTRY_ITEM_MEDIA_KINDS = Object.freeze(['image', 'video', 'audio', 'document']);
export const REGISTRY_THUMBNAIL_STATUSES = Object.freeze(['ready', 'pending', 'failed', 'none']);
const INLINE_DATA_URL_PATTERN = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;

/** Vignette d'item nettoyée (clés du contrat seulement) ou null si elle ne respecte pas le contrat. */
export const normalizeRegistryThumbnail = (value) => {
  if (!validRegistryThumbnail(value)) return null;
  if (value.kind === 'inline') {
    if (!INLINE_DATA_URL_PATTERN.test(value.dataUrl)) return null;
    return { kind: 'inline', dataUrl: value.dataUrl, width: value.width, height: value.height, assetId: value.assetId, sha256: value.sha256 };
  }
  return { kind: 'bundle', path: value.path, width: value.width, height: value.height, assetId: value.assetId, sha256: value.sha256 };
};

/** Nature de média admise sur l'item (jamais autre chose que les quatre genres connus). */
export const registryPrimaryMediaKind = (value) => (REGISTRY_ITEM_MEDIA_KINDS.includes(value) ? value : null);

/**
 * Miroir `privatePresentation` d'un asset : depuis le manifeste vérifié de son binaire, sinon le miroir déjà porté
 * par l'asset s'il désigne toujours ce binaire (un binaire remplacé n'hérite jamais des variantes de l'ancien).
 */
export const assetPrivatePresentationFor = ({ binary, identity, existing }) => {
  const mirror = binary ? assetPresentationMirror(binary, identity) : null;
  if (mirror) return mirror;
  const current = existing?.privatePresentation;
  if (
    current
    && typeof current === 'object'
    && current.version === PRESENTATION_VARIANT_VERSION
    && typeof identity?.binaryId === 'string'
    && current.binaryId === identity.binaryId
    && Array.isArray(current.variants)
    && current.variants.length > 0
  ) return current;
  return null;
};

/**
 * Vignette de l'item : recalculée depuis l'asset primaire (miroir Admin), sinon conservée telle quelle si elle
 * désigne encore l'asset primaire (vignette posée par le script de rattrapage, le backlog ou le seed démo), sinon null.
 */
export const registryItemThumbnailFor = ({ primaryAssetId, primaryAsset, existingThumbnail }) => {
  if (typeof primaryAssetId !== 'string' || !primaryAssetId) return null;
  const computed = normalizeRegistryThumbnail(registryThumbnailFromAsset(primaryAsset, primaryAssetId));
  if (computed) return computed;
  const preserved = normalizeRegistryThumbnail(existingThumbnail);
  return preserved && preserved.assetId === primaryAssetId ? preserved : null;
};

/**
 * État de vignette de l'item (K3 étendu) depuis la vignette retenue, l'asset primaire et le manifeste de son binaire
 * (`primaryBinary`, null quand il n'est pas lisible : l'absence de manifeste n'est jamais un échec).
 */
export const registryThumbnailStatusFor = ({ primaryAssetId, primaryAsset, thumbnail, primaryBinary = null }) => {
  if (typeof primaryAssetId !== 'string' || !primaryAssetId) return 'none';
  if (normalizeRegistryThumbnail(thumbnail)?.assetId === primaryAssetId) return 'ready';
  if (registryPrimaryMediaKind(primaryAsset?.mediaKind) !== 'image') return 'none';
  return binaryPresentationFailed(primaryBinary) ? 'failed' : 'pending';
};

/** Champs de présentation de l'item (frères de la projection, hors contentHash). */
export const registryItemPresentationFields = ({ primaryAssetId, primaryAsset, existingItem, primaryBinary = null }) => {
  const thumbnail = registryItemThumbnailFor({ primaryAssetId, primaryAsset, existingThumbnail: existingItem?.thumbnail });
  const primaryMediaKind = typeof primaryAssetId === 'string' && primaryAssetId
    ? registryPrimaryMediaKind(primaryAsset?.mediaKind) ?? registryPrimaryMediaKind(existingItem?.primaryMediaKind)
    : null;
  return {
    thumbnail,
    primaryMediaKind,
    thumbnailStatus: registryThumbnailStatusFor({ primaryAssetId, primaryAsset: { mediaKind: primaryMediaKind }, thumbnail, primaryBinary }),
  };
};

/** Texte d'un item pour les contrôles de confidentialité : la base64 de la vignette est exclue (G7). */
export const registryItemAuditText = (item) => JSON.stringify(
  item && typeof item === 'object' && item.thumbnail && typeof item.thumbnail === 'object'
    ? { ...item, thumbnail: { ...item.thumbnail, dataUrl: item.thumbnail.dataUrl ? '<dataUrl>' : undefined } }
    : item,
);
