import { createHash } from 'node:crypto';
import sharp from 'sharp';

/**
 * Contrat unique des dérivés de présentation privés (V3, K1-K3).
 *
 * Storage : private-derivatives/{uid}/{cartularyId}/{binaryId}/presentation-v3-{240|480|768|1200}.webp
 *   — WebP q80, largeurs ≤ largeur de la copie principale (withoutEnlargement), au moins la plus petite ;
 *   — métadonnée derivativeId = nom de fichier COMPLET (storage.rules exige derivativeId == dernier segment) ;
 *   — cacheControl private, aucun jeton de téléchargement (le client lit par getBlob sous règles).
 *   presentation-v2.<ext> reste réservé à la publication Admin (website-publication-command) ; le client ne le lit jamais.
 *
 * Manifeste binaries/{binaryId} : tout est IMBRIQUÉ sous presentationDerivative (règle R4, aucune clé de premier niveau) :
 *   presentationDerivative.variantsVersion = 'presentation-v3'
 *   presentationDerivative.variants = [{ width, height, storagePath, sha256, size, mimeType }]
 *   presentationDerivative.thumbnail = { dataUrl (WebP ≤ 240 px, ≤ 24 000 caractères), width, height, sha256 }
 *   presentationDerivative.variantsGeneratedAt = ISO
 * La vignette inline provient des octets de la variante 240 (une seule passe sharp, C3) quand ils tiennent dans
 * 240 × 240 et sous la limite de caractères ; sinon (portrait : la variante 240 mesure 240 × > 240 ; ou trop lourde)
 * elle est ré-encodée DEPUIS ces octets (grand côté ≤ 240, qualité réduite au besoin) et son sha256 est alors celui
 * des octets réellement inscrits. La validation (`validInlineThumbnail`, client `normalizePresentationThumbnail`,
 * `normalizeRegistryThumbnail`) exige width ≤ 240 ET height ≤ 240 : une vignette non produite rendrait le manifeste
 * « incomplet » à perpétuité (régénération à chaque passage, aucun items.thumbnail : faux état, tour 2 point 2).
 *
 * Miroirs (écrits par le serveur Admin seulement, K3) :
 *   cartularies/{id}/assets/{assetId}.privatePresentation = { binaryId, version, variants, thumbnail }
 *   registries/{r}/items/{id}.thumbnail = { kind: 'inline', dataUrl, width, height, assetId, sha256 }
 * Un SEUL prédicat « binaire vérifié » (`privateBinaryIsVerified`, tour 4 point 1) gouverne à la fois le classement
 * du rattrapage et les miroirs : un binaire accepté d'époque (verificationVersion absente ou 1.0.0, clientUpdatedAt
 * antérieur au seuil de transition) reçoit ses miroirs comme un binaire accepté en 1.1.0 ; sinon le rattrapage Rolex
 * régénérait les variantes sans jamais poser assets.privatePresentation ni items.thumbnail (faux état permanent).
 * Ce module ne fait aucune écriture : fonctions pures + génération sharp.
 */

export const PRESENTATION_VARIANT_VERSION = 'presentation-v3';
/** Seuil de transition (private-upload@1.1.0) : un manifeste sans version, prêt et antérieur, est accepté d'époque. */
export const PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS = Date.parse('2026-08-18T10:45:00.000Z');

/**
 * Prédicat unique « binaire vérifié » : non supprimé, transfert terminé, accepté par la vérification OU accepté d'époque
 * (aucune version de vérification, clientUpdatedAt antérieur au seuil). Partagé par le rattrapage, la création, la
 * synchronisation et les miroirs K3 : jamais deux définitions.
 */
export const privateBinaryIsVerified = (data) => (
  data?.deleted === false
  && data?.uploadStatus === 'ready'
  && (
    data?.verificationStatus === 'accepted'
    || (
      data?.verificationVersion == null
      && Number(data?.clientUpdatedAt || 0) > 0
      && Number(data.clientUpdatedAt) < PRIVATE_UPLOAD_VERIFICATION_CUTOFF_MS
    )
  )
);

/**
 * Vrai si la copie de présentation de ce binaire ne sera PAS produite (état définitif, décision (d)) :
 * échec sharp consigné (`presentationDerivative.variantsFailure`), original rejeté ou transfert échoué.
 * Même règle que `presentationDerivativeStateFromBinaryRecord` côté client.
 */
export const binaryPresentationFailed = (data) => Boolean(
  data
  && typeof data === 'object'
  && (
    (typeof data.presentationDerivative?.variantsFailure === 'string' && data.presentationDerivative.variantsFailure)
    || data.verificationStatus === 'rejected'
    || data.uploadStatus === 'failed'
  ),
);
export const PRESENTATION_VARIANT_WIDTHS = Object.freeze([240, 480, 768, 1200]);
export const PRESENTATION_VARIANT_QUALITY = 80;
export const PRESENTATION_PRIMARY_MAXIMUM_EDGE = 2_400;
export const PRESENTATION_MAXIMUM_IMAGE_PIXELS = 100_000_000;
export const INLINE_THUMBNAIL_MAXIMUM_WIDTH = 240;
export const INLINE_THUMBNAIL_MAXIMUM_CHARACTERS = 24_000;
export const PRESENTATION_VARIANT_MIME_TYPE = 'image/webp';
const PRESENTATION_VARIANT_FILE_PATTERN = /^presentation-v3-(240|480|768|1200)\.webp$/;

export const sha256Of = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export const presentationVariantDerivativeId = (nominalWidth) => `${PRESENTATION_VARIANT_VERSION}-${nominalWidth}.webp`;

export const presentationVariantPath = (uid, cartularyId, binaryId, nominalWidth) => (
  `private-derivatives/${uid}/${cartularyId}/${binaryId}/${presentationVariantDerivativeId(nominalWidth)}`
);

/** Vrai si `storagePath` désigne une variante v3 de ce binaire (dernier segment = derivativeId attendu par les règles). */
export const validPresentationVariantPath = (storagePath, uid, cartularyId, binaryId) => (
  typeof storagePath === 'string'
  && storagePath.startsWith(`private-derivatives/${uid}/${cartularyId}/${binaryId}/`)
  && PRESENTATION_VARIANT_FILE_PATTERN.test(storagePath.split('/').at(-1))
  && storagePath.split('/').length === 5
);

export const thumbnailDataUrl = (bytes) => `data:${PRESENTATION_VARIANT_MIME_TYPE};base64,${Buffer.from(bytes).toString('base64')}`;

/** Largeurs nominales à produire pour une copie principale de largeur `primaryWidth` : ≤ source, au moins la plus petite. */
export const presentationVariantWidthsFor = (primaryWidth) => {
  const widths = PRESENTATION_VARIANT_WIDTHS.filter((width) => width <= primaryWidth);
  return widths.length ? widths : [PRESENTATION_VARIANT_WIDTHS[0]];
};

const encodeWebp = (input, { width, quality }) => sharp(input)
  .resize({ width, withoutEnlargement: true })
  .webp({ quality, effort: 4 })
  .toBuffer({ resolveWithObject: true });

/** Ré-encodage de la vignette inline : grand côté ≤ `edge` (boîte carrée, jamais agrandi), WebP `quality`. */
const encodeInlineThumbnailWebp = (input, { edge, quality }) => sharp(input)
  .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
  .webp({ quality, effort: 4 })
  .toBuffer({ resolveWithObject: true });

/** Vrai si la variante 240 tient dans la boîte 240 × 240 (faux pour un portrait : 240 × > 240). */
const fitsInlineThumbnailBox = (variant) => variant.width <= INLINE_THUMBNAIL_MAXIMUM_WIDTH && variant.height <= INLINE_THUMBNAIL_MAXIMUM_WIDTH;

/**
 * Vignette inline : octets de la variante 240 tels quels si elle tient dans 240 × 240 et sous la limite de caractères ;
 * sinon ré-encodage depuis ces octets : portrait → grand côté ramené à 240 (q80 d'abord), trop lourde → qualité réduite.
 * Null seulement si aucune tentative ne tient sous 24 000 caractères.
 */
export const buildInlineThumbnail = async (variant240) => {
  const fits = (bytes) => thumbnailDataUrl(bytes).length <= INLINE_THUMBNAIL_MAXIMUM_CHARACTERS;
  const boxed = fitsInlineThumbnailBox(variant240);
  if (boxed && fits(variant240.bytes)) {
    return { dataUrl: thumbnailDataUrl(variant240.bytes), width: variant240.width, height: variant240.height, sha256: variant240.sha256, bytes: variant240.size };
  }
  const attempts = [...(boxed ? [] : [[240, PRESENTATION_VARIANT_QUALITY]]), [240, 60], [240, 45], [200, 45], [160, 40], [120, 35]];
  for (const [edge, quality] of attempts) {
    const output = await encodeInlineThumbnailWebp(variant240.bytes, { edge, quality });
    if (fits(output.data)) {
      return { dataUrl: thumbnailDataUrl(output.data), width: output.info.width, height: output.info.height, sha256: sha256Of(output.data), bytes: output.data.length };
    }
  }
  return null;
};

/**
 * Une seule passe de décodage : copie principale (≤ 2400, q84, contrat publication inchangé) puis, depuis CE buffer,
 * les variantes v3 (q80) et la vignette inline (octets de la variante 240).
 */
export const buildImagePresentationSet = async ({ path, input = null, primaryQuality = 84 }) => {
  const pipeline = sharp(input ?? path, { failOn: 'warning', limitInputPixels: PRESENTATION_MAXIMUM_IMAGE_PIXELS }).rotate();
  const metadata = await pipeline.metadata();
  const sourceWidth = Number(metadata.width || 0);
  const sourceHeight = Number(metadata.height || 0);
  if (!sourceWidth || !sourceHeight || sourceWidth * sourceHeight > PRESENTATION_MAXIMUM_IMAGE_PIXELS) {
    throw Object.assign(new Error('Les dimensions de l’image sont absentes ou excessives.'), { code: 'invalid_dimensions' });
  }
  const primary = await pipeline
    .resize({ width: PRESENTATION_PRIMARY_MAXIMUM_EDGE, height: PRESENTATION_PRIMARY_MAXIMUM_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: primaryQuality, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  const variants = [];
  for (const nominalWidth of presentationVariantWidthsFor(primary.info.width)) {
    const output = await encodeWebp(primary.data, { width: nominalWidth, quality: PRESENTATION_VARIANT_QUALITY });
    variants.push({
      nominalWidth,
      derivativeId: presentationVariantDerivativeId(nominalWidth),
      width: output.info.width,
      height: output.info.height,
      bytes: output.data,
      size: output.data.length,
      sha256: sha256Of(output.data),
      mimeType: PRESENTATION_VARIANT_MIME_TYPE,
    });
  }
  const thumbnail = await buildInlineThumbnail(variants[0]);
  return {
    sourceWidth,
    sourceHeight,
    primary: { bytes: primary.data, width: primary.info.width, height: primary.info.height, mimeType: PRESENTATION_VARIANT_MIME_TYPE, sha256: sha256Of(primary.data), size: primary.data.length },
    variants,
    thumbnail,
  };
};

/** Entrées du manifeste (sans octets) pour `presentationDerivative.variants`. */
export const manifestVariantsFor = (set, { uid, cartularyId, binaryId }) => set.variants.map((variant) => ({
  width: variant.width,
  height: variant.height,
  storagePath: presentationVariantPath(uid, cartularyId, binaryId, variant.nominalWidth),
  sha256: variant.sha256,
  size: variant.size,
  mimeType: variant.mimeType,
}));

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isDigest = (value) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

/** Vignette inline valide : dataUrl WebP ≤ 24 000 caractères, dimensions ≤ 240, empreinte. */
export const validInlineThumbnail = (thumbnail) => Boolean(
  thumbnail
  && typeof thumbnail === 'object'
  && typeof thumbnail.dataUrl === 'string'
  && thumbnail.dataUrl.startsWith('data:image/webp;base64,')
  && thumbnail.dataUrl.length <= INLINE_THUMBNAIL_MAXIMUM_CHARACTERS
  && isPositiveInteger(thumbnail.width)
  && isPositiveInteger(thumbnail.height)
  && thumbnail.width <= INLINE_THUMBNAIL_MAXIMUM_WIDTH
  && thumbnail.height <= INLINE_THUMBNAIL_MAXIMUM_WIDTH
  && isDigest(thumbnail.sha256),
);

/**
 * Variantes v3 lisibles depuis un manifeste binaire (identité optionnelle vérifiée sur les chemins).
 * Retourne null si le manifeste ne porte pas de variantes v3 valides.
 */
export const presentationVariantsFromManifest = (manifest, identity = null) => {
  const derivative = manifest?.presentationDerivative;
  if (!derivative || derivative.variantsVersion !== PRESENTATION_VARIANT_VERSION || !Array.isArray(derivative.variants)) return null;
  const variants = derivative.variants.filter((variant) => (
    variant
    && typeof variant === 'object'
    && isPositiveInteger(variant.width)
    && isPositiveInteger(variant.height)
    && typeof variant.storagePath === 'string'
    && PRESENTATION_VARIANT_FILE_PATTERN.test(variant.storagePath.split('/').at(-1))
    && variant.storagePath.startsWith('private-derivatives/')
    && (!identity || validPresentationVariantPath(variant.storagePath, identity.uid, identity.cartularyId, identity.binaryId))
    && isDigest(variant.sha256)
    && isPositiveInteger(variant.size)
    && variant.mimeType === PRESENTATION_VARIANT_MIME_TYPE
  )).map((variant) => ({ width: variant.width, height: variant.height, storagePath: variant.storagePath, sha256: variant.sha256, size: variant.size, mimeType: variant.mimeType }))
    .sort((left, right) => left.width - right.width);
  return variants.length ? variants : null;
};

/** Vrai si le manifeste porte un jeu de variantes v3 complet (variantes + vignette inline). */
export const manifestHasCurrentPresentationVariants = (manifest) => Boolean(
  presentationVariantsFromManifest(manifest) && validInlineThumbnail(manifest?.presentationDerivative?.thumbnail),
);

/**
 * Miroir pour cartularies/{id}/assets/{assetId}.privatePresentation (K3) : { binaryId, version, variants, thumbnail } ou null.
 * Exige un binaire vérifié (`privateBinaryIsVerified` : accepté, ou accepté d'époque) avec variantes v3 ; la vignette
 * est omise si invalide.
 */
export const assetPresentationMirror = (manifest, identity = null) => {
  if (!privateBinaryIsVerified(manifest)) return null;
  const binaryId = typeof manifest.binaryId === 'string' ? manifest.binaryId : identity?.binaryId ?? null;
  const variants = presentationVariantsFromManifest(manifest, identity && binaryId ? { ...identity, binaryId } : null);
  if (!binaryId || !variants) return null;
  const thumbnail = manifest.presentationDerivative?.thumbnail;
  return {
    binaryId,
    version: PRESENTATION_VARIANT_VERSION,
    variants,
    thumbnail: validInlineThumbnail(thumbnail)
      ? { dataUrl: thumbnail.dataUrl, width: thumbnail.width, height: thumbnail.height, sha256: thumbnail.sha256 }
      : null,
  };
};

const inlineRegistryThumbnail = (thumbnail, assetId) => (
  validInlineThumbnail(thumbnail) && typeof assetId === 'string' && assetId
    ? { kind: 'inline', dataUrl: thumbnail.dataUrl, width: thumbnail.width, height: thumbnail.height, assetId, sha256: thumbnail.sha256 }
    : null
);

/** registries/{r}/items/{id}.thumbnail (kind inline) depuis un manifeste binaire vérifié (même prédicat que le miroir), ou null. */
export const registryThumbnailFromManifest = (manifest, { assetId }) => {
  if (!privateBinaryIsVerified(manifest)) return null;
  if (!presentationVariantsFromManifest(manifest)) return null;
  return inlineRegistryThumbnail(manifest.presentationDerivative?.thumbnail, assetId);
};

/** registries/{r}/items/{id}.thumbnail (kind inline) depuis un document asset portant privatePresentation, ou null. */
export const registryThumbnailFromAsset = (asset, assetId) => {
  const presentation = asset?.privatePresentation;
  if (!presentation || presentation.version !== PRESENTATION_VARIANT_VERSION) return null;
  return inlineRegistryThumbnail(presentation.thumbnail, assetId);
};

/** registries/{r}/items/{id}.thumbnail (kind bundle) : dérivé statique du bundle Hosting (IWC, démos), aucun Storage. */
export const registryThumbnailFromBundle = ({ path, width, height, assetId, sha256 }) => {
  if (typeof path !== 'string' || !path.startsWith('/assets/') || !/\.webp$/i.test(path) || path.includes('..')) return null;
  if (!isPositiveInteger(width) || !isPositiveInteger(height) || width > INLINE_THUMBNAIL_MAXIMUM_WIDTH || height > INLINE_THUMBNAIL_MAXIMUM_WIDTH) return null;
  if (typeof assetId !== 'string' || !assetId || !isDigest(sha256)) return null;
  return { kind: 'bundle', path, width, height, assetId, sha256 };
};

/** Vrai si `value` est une vignette d'item valide (inline ou bundle) : à conserver telle quelle lors d'une réécriture d'item. */
export const validRegistryThumbnail = (value) => {
  if (!value || typeof value !== 'object' || typeof value.assetId !== 'string' || !value.assetId || !isDigest(value.sha256)) return false;
  if (value.kind === 'inline') return validInlineThumbnail(value);
  if (value.kind === 'bundle') return registryThumbnailFromBundle(value) !== null;
  return false;
};
