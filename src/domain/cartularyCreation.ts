import { CREATION_PROFILE_DEFINITIONS, type CreationProfileDefinition } from '../../scripts/lib/creation-profile-map.mjs';
import type { PrivatePresentation } from './presentationVariants.ts';

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

/**
 * Identité minimale d'un Cartulaire relue depuis ses groupes de spécifications enregistrés
 * (`cartularia-specification-groups`), pour les Cartulaires dont le brouillon privé ne porte pas
 * de profil de création (dossiers antérieurs à la création depuis le Registre, comme le pilote IWC)
 * et lorsque l'enveloppe autoritaire n'est pas accessible (hors connexion, session verrouillée).
 * Renvoie `null` si ni marque ni modèle ne sont renseignés.
 */
export const creationProfileFromSpecificationGroups = (
  groups: unknown,
  base: CartularyCreationProfile,
): CartularyCreationProfile | null => {
  if (!Array.isArray(groups)) return null;
  const values = new Map<string, string>();
  for (const group of groups) {
    const items = (group as { items?: unknown })?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const { id, value } = (item ?? {}) as { id?: unknown; value?: unknown };
      if (typeof id === 'string' && typeof value === 'string' && value.trim() && !values.has(id)) values.set(id, value.trim());
    }
  }
  const brand = values.get('brand') ?? '';
  const model = values.get('model') ?? '';
  if (!brand && !model) return null;
  const year = Number.parseInt(values.get('year') ?? '', 10);
  return {
    ...base,
    brand: brand || base.brand,
    model: model || base.model,
    reference: values.get('reference') ?? base.reference,
    manufactureYear: Number.isInteger(year) && year >= 1500 && year <= 2200 ? year : base.manufactureYear,
    caliber: values.get('caliber') ?? base.caliber,
    sourceLabel: 'Fiche de spécifications enregistrée',
  };
};

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
  /**
   * Référence figée des variantes de présentation privées (contrat V3, K2/K4), posée dans
   * `cartularia-media-assets-v3` dès la fin de la vérification : le lecteur affiche ces variantes sans
   * relire le manifeste ; l'original n'est chargé que sur action explicite. Absente quand le serveur n'a
   * produit aucune variante (vidéo, PDF, échec) — l'aperçu est alors « en préparation », jamais l'original.
   * Si le chemin devient périmé (régénération), le service relit le manifeste une fois (G12).
   */
  privatePresentation?: PrivatePresentation;
}

/** Bilan honnête des médias téléversés, affiché sur l'écran de succès (décision V2 (d) : jamais de faux état). */
export interface CartularyCreationMediaSummary {
  total: number;
  /** Images dont les variantes de présentation sont prêtes (affichage immédiat, sans l'original). */
  imagesReady: number;
  /** Images acceptées sans variante : « Aperçu en préparation » jusqu'au passage nocturne (G5). */
  imagesPending: number;
  /** Vidéos sans copie de présentation (aucun transcodeur en production) : lisibles à la demande seulement. */
  videosOnDemand: number;
  documents: number;
}

export const summarizeCreationMedia = (assets: readonly Pick<CartularyCreationMediaAsset, 'type' | 'privatePresentation'>[]): CartularyCreationMediaSummary => assets.reduce<CartularyCreationMediaSummary>((summary, asset) => {
  summary.total += 1;
  if (asset.type === 'image') {
    if (asset.privatePresentation && asset.privatePresentation.variants.length > 0) summary.imagesReady += 1;
    else summary.imagesPending += 1;
  } else if (asset.type === 'video') summary.videosOnDemand += 1;
  else summary.documents += 1;
  return summary;
}, { total: 0, imagesReady: 0, imagesPending: 0, videosOnDemand: 0, documents: 0 });

const plural = (count: number, singular: string, pluralForm: string) => `${count} ${count > 1 ? pluralForm : singular}`;

/**
 * Phrases de l'écran de succès : seules les situations qui changent ce que le propriétaire verra sont
 * annoncées (aucune phrase quand tout est prêt). Le libellé ne promet jamais un dérivé qui n'existe pas.
 */
export const describeCreationMediaSummary = (summary: CartularyCreationMediaSummary | null | undefined): string[] => {
  if (!summary) return [];
  const notes: string[] = [];
  if (summary.imagesPending > 0) {
    notes.push(`${plural(summary.imagesPending, 'photo', 'photos')} sans aperçu pour l’instant : « Aperçu en préparation » dans le Cartulaire jusqu’à la production de la copie de présentation ; l’original reste consultable sur demande.`);
  }
  if (summary.videosOnDemand > 0) {
    notes.push(`${plural(summary.videosOnDemand, 'vidéo restera consultable', 'vidéos resteront consultables')} à la demande (copie de présentation non produite).`);
  }
  return notes;
};

export interface CartularyCreationResult {
  cartularyId: string;
  requestId: string;
  publicCode: string;
  uploadedFileCount: number;
  uploadedBytes: number;
  /** Absent pour une reprise antérieure à V3 : l'écran de succès n'annonce alors rien. */
  media?: CartularyCreationMediaSummary;
}

export const CARTULARY_CREATION_TIMEOUT_MESSAGE = 'La création peut encore aboutir. Vérifiez le catalogue avant de recommencer ; ce bouton reprendra la même demande sans téléverser à nouveau les fichiers.';

export const resumeOrCreateCartulary = async (
  pending: CartularyCreationResult | null,
  create: () => Promise<CartularyCreationResult>,
) => pending ?? create();
