import { CREATION_PROFILE_DEFINITIONS, type CreationProfileDefinition } from '../../scripts/lib/creation-profile-map.mjs';

export const CARTULARY_CREATION_PROFILE_VERSION = '1.0.0';

/**
 * Longueur maximale du slug lisible inséré dans `cart_<slug>_<jeton>` : l'identifiant complet
 * fait au plus 5 + 44 + 1 + 12 = 62 caractères, sous la borne serveur de 128
 * (`firestore.rules`, `scripts/lib/timestamp-request-command.mjs`, `scripts/lib/transfer-request-command.mjs`).
 */
export const CARTULARY_SLUG_MAX_LENGTH = 44;

/**
 * Slug d'identifiant de cartulaire : accents retirés, minuscules, toute séquence non
 * alphanumérique réduite à un seul `_`, sans `_` de bord. Au-delà de `maxLength`, la troncature
 * se fait sur une frontière de mot (dernier `_` avant la limite) pour ne jamais se terminer par
 * `_` — sinon la concaténation `cart_<slug>_<jeton>` produirait un double soulignement (audit
 * parcours propriétaire, défaut D5). Repli : si le premier mot dépasse à lui seul la limite,
 * coupe brute à la limite. Une entrée vide ou sans caractère alphanumérique donne `''` ;
 * l'appelant applique son propre repli.
 */
export const slugifyCartularyLabel = (value: string, maxLength: number = CARTULARY_SLUG_MAX_LENGTH): string => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (normalized.length <= maxLength) return normalized;
  const cut = normalized.slice(0, maxLength);
  // La coupe tombe juste avant un séparateur : le dernier mot est complet, on le garde.
  if (normalized[maxLength] === '_') return cut;
  const boundary = cut.lastIndexOf('_');
  const truncated = boundary > 0 ? cut.slice(0, boundary) : cut;
  return truncated.replace(/_+$/g, '');
};

/**
 * Types d'objets proposés à la création : libellés et règles de saisie viennent de la table de
 * création partagée avec le serveur (ADR-030). La version de schéma n'est pas codée ici : elle
 * est résolue dans le catalogue au moment de la création (`loadCreationSchemaVersion`).
 */
export const SUPPORTED_CREATION_PROFILES: { readonly watch: CreationProfileDefinition; readonly car: CreationProfileDefinition } = CREATION_PROFILE_DEFINITIONS;
export type SupportedCreationAssetType = keyof typeof SUPPORTED_CREATION_PROFILES;

export interface CartularyCreationProfile {
  profileVersion: typeof CARTULARY_CREATION_PROFILE_VERSION;
  assetType: SupportedCreationAssetType;
  schemaId: SupportedCreationAssetType;
  /** Version publiée du catalogue retenue à la création (`x.y.z`). */
  schemaVersion: string;
  collectionId: string;
  brand: string;
  model: string;
  reference: string;
  manufactureYear: number | null;
  serialNumber: string;
  caliber: string;
  description: string;
  conditionSummary: string;
  purchaseDate: string;
  purchasePrice: number | null;
  currency: string;
  seller: string;
  valuationDate: string;
  valuationLow: number | null;
  valuationMid: number | null;
  valuationHigh: number | null;
  sourceLabel: string;
  assertedAt: string;
}

export type WatchCartularyCreationProfile = CartularyCreationProfile & { assetType: 'watch'; schemaId: 'watch' };

export interface CartularyCreationSpecificationItem {
  id: string;
  label: string;
  value: string;
}

export interface CartularyCreationSpecificationGroup {
  id: string;
  title: string;
  items: CartularyCreationSpecificationItem[];
}

/**
 * Groupe de spécifications écrit dans l'état du brouillon privé à la création
 * (`cartularia-specification-groups`). La forme `{ id, title, items: [{ id, label, value }] }`
 * est la seule lue sans réparation par `src/persistence/storedStateValidation.ts` ; le seed Rolex
 * (`src/migrations/rolexImport.ts`) et le seed IWC (`scripts/update-iwc-dossier.mjs`) l'utilisent
 * aussi. Verrouillée par `tests/stored-state-validation.test.mjs`.
 */
export const buildCreationSpecificationGroups = (
  definition: Pick<CreationProfileDefinition, 'makerLabel' | 'referenceLabel' | 'technicalLabel'>,
  profile: Pick<CartularyCreationProfile, 'brand' | 'model' | 'reference' | 'manufactureYear' | 'caliber'>,
): CartularyCreationSpecificationGroup[] => [{
  id: 'identity',
  title: 'Identification',
  items: [
    { id: 'brand', label: definition.makerLabel, value: profile.brand },
    { id: 'model', label: 'Modèle', value: profile.model },
    { id: 'reference', label: definition.referenceLabel, value: profile.reference },
    { id: 'year', label: 'Année de fabrication', value: profile.manufactureYear ? String(profile.manufactureYear) : '' },
    { id: 'caliber', label: definition.technicalLabel, value: profile.caliber },
  ],
}];

export interface CartularyCreationMediaAsset {
  id: string;
  name: string;
  originalFileName: string;
  type: 'image' | 'video' | 'document';
  mimeType: string;
  url: '';
  hash: string;
  status: 'Archived';
  binaryId: string;
  tags: Array<'main-photo' | 'main-video' | 'slideshow' | 'documentation' | 'other'>;
  category: 'ensemble' | 'documentation';
  visibility: 'Secret';
  fileSize: string;
  derivativeStatus: 'not-required' | 'pending' | 'ready';
  capturedAt: string;
  timestampSource: 'file.lastModified' | 'exif.DateTimeOriginal' | 'exif.CreateDate';
}

export interface CartularyCreationResult {
  cartularyId: string;
  requestId: string;
  publicCode: string;
  uploadedFileCount: number;
  uploadedBytes: number;
}

export const CARTULARY_CREATION_TIMEOUT_MESSAGE = 'La création peut encore aboutir. Vérifiez le catalogue avant de recommencer ; ce bouton reprendra la même demande sans téléverser à nouveau les fichiers.';

export const resumeOrCreateCartulary = async (
  pending: CartularyCreationResult | null,
  create: () => Promise<CartularyCreationResult>,
) => pending ?? create();
