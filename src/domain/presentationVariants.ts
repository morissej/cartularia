/**
 * Contrat unique des dérivés de présentation privés côté client (V3, K1-K4). Module pur, sans Firebase.
 *
 * - Variantes Storage : private-derivatives/{uid}/{cartularyId}/{binaryId}/presentation-v3-{240|480|768|1200}.webp ;
 *   presentation-v2.<ext> est réservé à la publication Admin et n'est JAMAIS admis ici (C1).
 * - Source côté client : `asset.privatePresentation` (miroir Admin) ou `binaries/{id}.presentationDerivative` (propriétaire).
 * - Rôles : 'thumbnail' (≈ 240-480 px) et 'stage' (≈ 768-1200 px) ; l'original ne passe jamais par ce module.
 */

export const PRESENTATION_VARIANT_VERSION = 'presentation-v3';
export const PRESENTATION_VARIANT_WIDTHS = [240, 480, 768, 1200] as const;
export const INLINE_THUMBNAIL_MAXIMUM_CHARACTERS = 24_000;

export type PresentationRole = 'thumbnail' | 'stage';

export interface PrivatePresentationVariant {
  width: number;
  height: number;
  storagePath: string;
  sha256: string;
  size: number;
  mimeType: 'image/webp';
}

export interface PrivatePresentationThumbnail {
  dataUrl: string;
  width: number;
  height: number;
  sha256: string;
}

export interface PrivatePresentation {
  binaryId: string;
  version: typeof PRESENTATION_VARIANT_VERSION;
  variants: PrivatePresentationVariant[];
  thumbnail: PrivatePresentationThumbnail | null;
}

const VARIANT_FILE_PATTERN = /^presentation-v3-(240|480|768|1200)\.webp$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const isPositiveInteger = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const asRecord = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);

/** Vrai si `storagePath` est une variante v3 de ce binaire (dernier segment = derivativeId attendu par storage.rules). */
export const validPrivateDerivativePath = (storagePath: unknown, uid: string, cartularyId: string, binaryId: string): storagePath is string => (
  typeof storagePath === 'string'
  && storagePath.startsWith(`private-derivatives/${uid}/${cartularyId}/${binaryId}/`)
  && storagePath.split('/').length === 5
  && VARIANT_FILE_PATTERN.test(storagePath.split('/').at(-1) ?? '')
);

const normalizeVariant = (value: unknown): PrivatePresentationVariant | null => {
  const record = asRecord(value);
  if (!record) return null;
  const storagePath = record.storagePath;
  if (
    typeof storagePath !== 'string' || !storagePath.startsWith('private-derivatives/') || storagePath.split('/').length !== 5
    || !VARIANT_FILE_PATTERN.test(storagePath.split('/').at(-1) ?? '')
    || !isPositiveInteger(record.width) || !isPositiveInteger(record.height) || !isPositiveInteger(record.size)
    || typeof record.sha256 !== 'string' || !DIGEST_PATTERN.test(record.sha256)
    || record.mimeType !== 'image/webp'
  ) return null;
  return { width: record.width, height: record.height, storagePath, sha256: record.sha256, size: record.size, mimeType: 'image/webp' };
};

export const normalizePresentationThumbnail = (value: unknown): PrivatePresentationThumbnail | null => {
  const record = asRecord(value);
  if (
    !record || typeof record.dataUrl !== 'string' || !record.dataUrl.startsWith('data:image/webp;base64,')
    || record.dataUrl.length > INLINE_THUMBNAIL_MAXIMUM_CHARACTERS
    || !isPositiveInteger(record.width) || !isPositiveInteger(record.height) || record.width > 240 || record.height > 240
    || typeof record.sha256 !== 'string' || !DIGEST_PATTERN.test(record.sha256)
  ) return null;
  return { dataUrl: record.dataUrl, width: record.width, height: record.height, sha256: record.sha256 };
};

/** Normalise un miroir `privatePresentation` (asset) ; null si absent ou invalide. */
export const normalizePrivatePresentation = (value: unknown): PrivatePresentation | null => {
  const record = asRecord(value);
  if (!record || record.version !== PRESENTATION_VARIANT_VERSION || typeof record.binaryId !== 'string' || !record.binaryId || !Array.isArray(record.variants)) return null;
  const variants = record.variants.map(normalizeVariant).filter((variant): variant is PrivatePresentationVariant => variant !== null).sort((left, right) => left.width - right.width);
  if (!variants.length) return null;
  return { binaryId: record.binaryId, version: PRESENTATION_VARIANT_VERSION, variants, thumbnail: normalizePresentationThumbnail(record.thumbnail) };
};

/** Lit `cartularies/{id}/assets/{assetId}.privatePresentation`. */
export const presentationFromAssetDocument = (data: unknown): PrivatePresentation | null => normalizePrivatePresentation(asRecord(data)?.privatePresentation);

/** Lit `privateDrafts/{uid}/cartularies/{id}/binaries/{binaryId}` (propriétaire) : variantes imbriquées sous presentationDerivative. */
export const presentationFromBinaryRecord = (data: unknown, binaryId: string): PrivatePresentation | null => {
  const record = asRecord(data);
  if (!record || record.deleted === true) return null;
  const derivative = asRecord(record.presentationDerivative);
  if (!derivative) return null;
  return normalizePrivatePresentation({ binaryId, version: derivative.variantsVersion, variants: derivative.variants, thumbnail: derivative.thumbnail });
};

/**
 * État des dérivés d'un manifeste binaire lu par le propriétaire (décision (d), jamais de faux état) :
 * - 'ready' : variantes v3 présentes ;
 * - 'failed' : copie de présentation définitivement non produite — le serveur a consigné
 *   `presentationDerivative.variantsFailure` (échec sharp, jamais repris par le backlog nocturne) ou la vérification a
 *   rejeté l'original (`verificationStatus: 'rejected'` / `uploadStatus: 'failed'`) ; « Aperçu en préparation » serait un
 *   faux état permanent ;
 * - 'pending' : tout le reste (vérification en cours, binaire d'époque en attente du backlog ou du rattrapage).
 */
export type PresentationDerivativeState = 'ready' | 'pending' | 'failed';

export const presentationDerivativeStateFromBinaryRecord = (data: unknown, binaryId: string): PresentationDerivativeState => {
  const record = asRecord(data);
  if (!record) return 'pending';
  if (presentationFromBinaryRecord(record, binaryId)) return 'ready';
  const derivative = asRecord(record.presentationDerivative);
  if (typeof derivative?.variantsFailure === 'string' && derivative.variantsFailure) return 'failed';
  if (record.verificationStatus === 'rejected' || record.uploadStatus === 'failed') return 'failed';
  return 'pending';
};

/** Ne conserve que les variantes appartenant à ce propriétaire/objet/binaire (jamais un chemin tiers). */
export const restrictPresentationToIdentity = (presentation: PrivatePresentation | null, uid: string, cartularyId: string, binaryId: string): PrivatePresentation | null => {
  if (!presentation || presentation.binaryId !== binaryId) return null;
  const variants = presentation.variants.filter((variant) => validPrivateDerivativePath(variant.storagePath, uid, cartularyId, binaryId));
  return variants.length ? { ...presentation, variants } : null;
};

/** Largeur cible par rôle : vignette 240 (480 en haute densité), scène 768 (1200 en haute densité). */
export const presentationTargetWidth = (role: PresentationRole, devicePixelRatio = 1): number => {
  const dense = devicePixelRatio > 1.25;
  return role === 'thumbnail' ? (dense ? 480 : 240) : (dense ? 1200 : 768);
};

/** La plus petite variante ≥ cible, sinon la plus grande disponible. */
export const pickPresentationVariant = (variants: readonly PrivatePresentationVariant[], targetWidth: number): PrivatePresentationVariant | null => {
  if (!variants.length) return null;
  const sorted = [...variants].sort((left, right) => left.width - right.width);
  return sorted.find((variant) => variant.width >= targetWidth) ?? sorted[sorted.length - 1];
};

export const pickPresentationVariantForRole = (presentation: PrivatePresentation, role: PresentationRole, devicePixelRatio = 1) => (
  pickPresentationVariant(presentation.variants, presentationTargetWidth(role, devicePixelRatio))
);
