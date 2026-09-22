import type { Cartulary, Valuation } from '../types';
import { creationProfileFromSpecificationGroups, type WatchCartularyCreationProfile } from '../domain/cartularyCreation.ts';
import { ACTIVE_CARTULARY_ID } from '../domain/cartularyIds.ts';
import { WATCH_SCHEMA_VERSION } from '../schema/watchSchema.ts';
import { cartulariaStorage } from '../persistence/localVault.ts';
import { normalizeWatchCreationProfile, readValidatedStoredJson } from '../persistence/storedStateValidation.ts';
import {
  buildDemoCartularyAssets,
  demoCartularyById,
  demoCartularyContentById,
  type DemoCartularyDefinition,
} from './demoCartularies.ts';

const parseStored = <T,>(key: string): T | null => readValidatedStoredJson({
  storage: cartulariaStorage,
  key,
  fallback: null as T | null,
  onRepair: ({ reason }) => console.warn(`État persistant réparé pour ${key} (${reason}).`),
});

/** Profil neutre d'un Cartulaire dont le brouillon privé n'est pas encore hydraté. Aucune marque n'est présumée. */
const placeholderProfile: WatchCartularyCreationProfile = {
  profileVersion: '1.0.0',
  assetType: 'watch',
  schemaId: 'watch',
  schemaVersion: WATCH_SCHEMA_VERSION,
  collectionId: 'col_pilots',
  brand: 'Montre',
  model: 'Dossier à compléter',
  reference: 'À documenter',
  manufactureYear: null,
  serialNumber: '',
  caliber: 'À documenter',
  description: 'Cartulaire créé depuis le Registre. Les données privées restent à compléter.',
  conditionSummary: 'État à documenter.',
  purchaseDate: '',
  purchasePrice: null,
  currency: 'EUR',
  seller: '',
  valuationDate: '',
  valuationLow: null,
  valuationMid: null,
  valuationHigh: null,
  sourceLabel: 'Dossier privé',
  assertedAt: '2026-08-16T00:00:00.000Z',
};

export const activeDemoCartulary = demoCartularyById(ACTIVE_CARTULARY_ID);
export const activeDemoContent = demoCartularyContentById(ACTIVE_CARTULARY_ID);

const demoCreationProfile = (cartulary: DemoCartularyDefinition): WatchCartularyCreationProfile => ({
  profileVersion: '1.0.0',
  assetType: 'watch',
  schemaId: 'watch',
  schemaVersion: WATCH_SCHEMA_VERSION,
  collectionId: 'col_demo_montres',
  brand: cartulary.brand,
  model: cartulary.model,
  reference: cartulary.reference,
  manufactureYear: cartulary.manufactureYear,
  serialNumber: cartulary.serialNumber,
  caliber: cartulary.caliber,
  description: cartulary.description,
  conditionSummary: cartulary.conditionSummary,
  purchaseDate: cartulary.purchaseDate,
  purchasePrice: cartulary.purchasePrice,
  currency: cartulary.currency,
  seller: demoCartularyContentById(cartulary.id)?.seller || 'Démonstration Cartularia · vendeur fictif',
  valuationDate: cartulary.valuationDate,
  valuationLow: cartulary.valuationLow,
  valuationMid: cartulary.valuationMid,
  valuationHigh: cartulary.valuationHigh,
  sourceLabel: cartulary.sourceLabel,
  assertedAt: '2026-08-22T08:00:00.000Z',
});

// Ordre de repli hors démo : profil de création du brouillon privé, sinon identité relue dans la
// fiche de spécifications enregistrée (dossiers sans profil, session verrouillée ou hors ligne).
// Connecté, l'enveloppe autoritaire prend le pas dans le lecteur (ADR-028).
export const activeCreationProfile = activeDemoCartulary
  ? demoCreationProfile(activeDemoCartulary)
  : (normalizeWatchCreationProfile(parseStored<unknown>('cartularia-creation-profile')) as WatchCartularyCreationProfile | null)
    ?? (creationProfileFromSpecificationGroups(parseStored<unknown>('cartularia-specification-groups'), placeholderProfile) as WatchCartularyCreationProfile | null);

export const isDemoCartulary = Boolean(activeDemoCartulary);

const fallbackPublicCode = () => {
  if (activeDemoCartulary) return activeDemoCartulary.publicCode;
  const stored = parseStored<string>('cartularia-public-code');
  if (stored) return stored;
  return `WCH-${ACTIVE_CARTULARY_ID.slice(-8).toUpperCase()}`;
};

const positiveValue = (value: number | null | undefined, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
);

const buildValuation = (profile: WatchCartularyCreationProfile): Valuation => {
  const purchase = positiveValue(profile.purchasePrice, 0);
  const mid = positiveValue(profile.valuationMid, purchase);
  const low = positiveValue(profile.valuationLow, mid);
  const high = positiveValue(profile.valuationHigh, mid);
  return {
    id: 'valuation-imported',
    date: profile.valuationDate || profile.purchaseDate || profile.assertedAt.slice(0, 10),
    lowValue: Math.min(low, mid, high),
    midValue: mid,
    highValue: Math.max(low, mid, high),
    currency: profile.currency || 'EUR',
    confidence: 'Faible',
    source: `${profile.sourceLabel || 'Dossier transmis par le propriétaire'} · import non revu`,
    visibility: 'Secret',
  };
};

const buildImportedCartulary = (profile: WatchCartularyCreationProfile | null): Cartulary => {
  const safeProfile = profile ?? placeholderProfile;
  const valuation = buildValuation(safeProfile);
  const reviewDate = safeProfile.purchaseDate || safeProfile.assertedAt.slice(0, 10);
  const publicCode = fallbackPublicCode();
  return {
    id: ACTIVE_CARTULARY_ID,
    publicCode,
    watchInstance: {
      serialNumber: safeProfile.serialNumber,
      publicCode,
      status: 'InPossession',
      acquisitionDate: safeProfile.purchaseDate,
      acquisitionPrice: safeProfile.purchasePrice ?? undefined,
      currency: safeProfile.currency || 'EUR',
      lastVerificationDate: reviewDate,
      reference: {
        brand: safeProfile.brand,
        model: safeProfile.model,
        reference: safeProfile.reference,
        caliber: safeProfile.caliber || 'À documenter',
        powerReserve: activeDemoCartulary?.powerReserve ?? 'À documenter',
        material: activeDemoCartulary?.caseMaterial ?? 'Acier inoxydable',
        diameter: activeDemoCartulary?.diameter ?? 39,
        thickness: activeDemoCartulary?.thickness ?? 13,
        waterResistance: activeDemoCartulary?.waterResistance ?? 'Étanchéité non garantie',
      },
      observations: [{
        id: 'observation-imported-condition',
        component: 'État déclaré',
        description: safeProfile.conditionSummary || 'À documenter',
        proofStatus: 'Déclaré',
        confidence: 'Faible',
        date: reviewDate,
      }],
      valuations: activeDemoContent?.valuationHistory ?? [valuation],
      reminders: activeDemoCartulary ? [{
        id: `${activeDemoCartulary.mediaSlug}-reminder`,
        title: 'Renouveler le contrôle annuel fictif',
        dueDate: '2027-06-30',
        status: 'À faire',
        description: 'Échéance pédagogique de démonstration, sans lien avec un objet réel.',
      }] : [],
    },
    sections: {
      '01': { sectionId: '01', visibility: 'Secret' },
      '02': { sectionId: '02', visibility: 'Secret' },
      '03': { sectionId: '03', visibility: 'Secret' },
      '04': { sectionId: '04', visibility: 'Secret' },
      '05': { sectionId: '05', visibility: 'Secret' },
      '06': { sectionId: '06', visibility: 'Secret' },
      '07': { sectionId: '07', visibility: 'Secret' },
      '08': { sectionId: '08', visibility: 'Secret' },
      '09': { sectionId: '09', visibility: 'Secret' },
      '10': { sectionId: '10', visibility: 'Secret' },
      '11': { sectionId: '11', visibility: 'Secret' },
    },
    assets: activeDemoCartulary ? buildDemoCartularyAssets(activeDemoCartulary) : [],
    mediaDossiers: activeDemoCartulary ? [{
      id: `${activeDemoCartulary.mediaSlug}-media-dossier`,
      date: '2026-08-22',
      title: 'Dossier média fictif complet',
      summary: 'Vue principale, vue arrière, ensemble associé et animation éditoriale de démonstration.',
      assetIds: buildDemoCartularyAssets(activeDemoCartulary).map((asset) => asset.id),
      author: 'Cartularia Demo',
      status: 'Reviewed',
    }] : [],
    comparables: activeDemoContent?.comparables ?? [],
    marketSnapshot: {
      date: valuation.date,
      activeListings: activeDemoContent?.marketDepth.activeListings ?? 0,
      observedTransactions90d: activeDemoContent?.marketDepth.transactions12m ?? 0,
      medianDaysOnMarket: activeDemoContent?.marketDepth.medianDaysOnMarket ?? 0,
      lowValue: valuation.lowValue,
      midValue: valuation.midValue,
      highValue: valuation.highValue,
      currency: valuation.currency,
    },
    conditionReports: activeDemoContent?.conditionReports ?? [{
      id: 'condition-imported-declaration',
      date: reviewDate,
      title: 'État déclaré — revue requise',
      score: 0,
      summary: safeProfile.conditionSummary || 'État à documenter.',
      dossierId: 'creation-import',
    }],
    insurance: activeDemoContent?.insurance ?? {
      status: 'Pending',
      insurer: 'À documenter',
      insuredValue: valuation.midValue,
      deductible: 0,
      currency: valuation.currency,
      renewalDate: '',
    },
    location: activeDemoContent?.location ?? {
      city: 'À documenter',
      country: 'À documenter',
      storageType: 'Emplacement privé',
      verifiedAt: reviewDate,
      visibility: 'Secret',
    },
    visibility: 'Secret',
  };
};

/** Tout Cartulaire, IWC et Rolex compris, est construit depuis son brouillon privé et son enveloppe (ADR-029). */
export const activeCartulary = buildImportedCartulary(activeCreationProfile);
