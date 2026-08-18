import type { Cartulary, ComparableTransaction, Valuation } from '../types';
import type { WatchCartularyCreationProfile } from '../domain/cartularyCreation.ts';
import { ACTIVE_CARTULARY_ID, IWC_CARTULARY_ID, ROLEX_CARTULARY_ID } from '../domain/cartularyIds.ts';
import { cartulariaStorage } from '../persistence/localVault.ts';
import { normalizeWatchCreationProfile, readValidatedStoredJson } from '../persistence/storedStateValidation.ts';
import { mockCartulary as iwcCartulary } from './mockData.ts';

const parseStored = <T,>(key: string): T | null => readValidatedStoredJson({
  storage: cartulariaStorage,
  key,
  fallback: null as T | null,
  onRepair: ({ reason }) => console.warn(`État persistant réparé pour ${key} (${reason}).`),
});

const rolexFallbackProfile: WatchCartularyCreationProfile = {
  profileVersion: '1.0.0',
  assetType: 'watch',
  schemaId: 'watch',
  schemaVersion: '1.5.0',
  collectionId: 'col_pilots',
  brand: 'Rolex',
  model: 'GMT-Master Mark I Long E',
  reference: '1675',
  manufactureYear: 1969,
  serialNumber: '1 982 530',
  caliber: 'Rolex 1575',
  description: 'Rolex GMT-Master réf. 1675 de 1969, cadran mat Mark I « Long E », insert Pepsi fuchsia et bracelet Jubilee.',
  conditionSummary: 'État déclaré par le propriétaire et le vendeur. L’authenticité, la configuration, le niveau de polissage et l’étanchéité restent à confirmer par une revue indépendante.',
  purchaseDate: '2026-07-23',
  purchasePrice: 21_900,
  currency: 'EUR',
  seller: 'L’Atelier du Temps',
  valuationDate: '2026-08-16',
  valuationLow: 21_000,
  valuationMid: 23_000,
  valuationHigh: 25_000,
  sourceLabel: 'Dossier Rolex transmis par le propriétaire · données à revoir',
  assertedAt: '2026-08-16T00:00:00.000Z',
};

export const activeCreationProfile = normalizeWatchCreationProfile(parseStored<unknown>('cartularia-creation-profile')) as WatchCartularyCreationProfile | null
  ?? (ACTIVE_CARTULARY_ID === ROLEX_CARTULARY_ID ? rolexFallbackProfile : null);

export const isIwcCartulary = ACTIVE_CARTULARY_ID === IWC_CARTULARY_ID;
export const isRolexCartulary = ACTIVE_CARTULARY_ID === ROLEX_CARTULARY_ID;

const fallbackPublicCode = () => {
  const stored = parseStored<string>('cartularia-public-code');
  if (stored) return stored;
  if (ACTIVE_CARTULARY_ID === ROLEX_CARTULARY_ID) return 'ROL-487D9CAD';
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

const rolexComparables: ComparableTransaction[] = [
  {
    id: 'rolex-comparable-17000',
    date: '2026-08-16',
    channel: 'Chrono24',
    description: 'Rolex GMT-Master 1675 Long E · annonce observée dans le dossier',
    amount: 17_000,
    currency: 'EUR',
    condition: 'À vérifier',
    sourceType: 'Annonce',
    source: 'Chrono24 · prix affiché documenté dans le dossier',
    saleChannel: 'Annonce',
  },
  {
    id: 'rolex-comparable-16958',
    date: '2026-08-16',
    channel: 'Chrono24',
    description: 'Rolex GMT-Master 1675 Long E · annonce observée dans le dossier',
    amount: 16_958,
    currency: 'EUR',
    condition: 'À vérifier',
    sourceType: 'Annonce',
    source: 'Chrono24 · prix affiché documenté dans le dossier',
    saleChannel: 'Annonce',
  },
  {
    id: 'rolex-comparable-21774',
    date: '2026-08-16',
    channel: 'Chrono24',
    description: 'Rolex GMT-Master 1675 Long E · exemplaire annoncé full set',
    amount: 21_774,
    currency: 'EUR',
    condition: 'Full set déclaré',
    sourceType: 'Annonce',
    source: 'Chrono24 · prix affiché documenté dans le dossier',
    saleChannel: 'Annonce',
  },
];

const buildImportedCartulary = (profile: WatchCartularyCreationProfile | null): Cartulary => {
  const safeProfile = profile ?? {
    ...rolexFallbackProfile,
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
    seller: '',
    valuationDate: '',
    valuationLow: null,
    valuationMid: null,
    valuationHigh: null,
    sourceLabel: 'Dossier privé',
  };
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
        powerReserve: 'À documenter',
        material: 'Acier inoxydable',
        diameter: 39,
        thickness: 13,
        waterResistance: 'Étanchéité non garantie',
      },
      observations: [{
        id: 'observation-imported-condition',
        component: 'État déclaré',
        description: safeProfile.conditionSummary || 'À documenter',
        proofStatus: 'Déclaré',
        confidence: 'Faible',
        date: reviewDate,
      }],
      valuations: [valuation],
      reminders: [],
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
    assets: [],
    mediaDossiers: [],
    comparables: isRolexCartulary ? rolexComparables : [],
    marketSnapshot: {
      date: valuation.date,
      activeListings: isRolexCartulary ? 56 : 0,
      observedTransactions90d: 0,
      medianDaysOnMarket: 0,
      lowValue: valuation.lowValue,
      midValue: valuation.midValue,
      highValue: valuation.highValue,
      currency: valuation.currency,
    },
    conditionReports: [{
      id: 'condition-imported-declaration',
      date: reviewDate,
      title: 'État déclaré — revue requise',
      score: 0,
      summary: safeProfile.conditionSummary || 'État à documenter.',
      dossierId: 'creation-import',
    }],
    insurance: {
      status: 'Pending',
      insurer: 'À documenter',
      insuredValue: valuation.midValue,
      deductible: 0,
      currency: valuation.currency,
      renewalDate: '',
    },
    location: {
      city: 'À documenter',
      country: 'À documenter',
      storageType: 'Emplacement privé',
      verifiedAt: reviewDate,
      visibility: 'Secret',
    },
    visibility: 'Secret',
  };
};

export const activeCartulary = isIwcCartulary
  ? iwcCartulary
  : buildImportedCartulary(activeCreationProfile);
