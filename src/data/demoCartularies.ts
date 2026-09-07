import type { Asset } from '../types/index.ts';

export const DEMO_ACCOUNT = {
  userName: 'demo',
  password: 'Cartularia-Demo-2026!',
  displayName: 'Compte de démonstration',
  organizationId: 'org_cartularia_demo',
  registryId: 'reg_cartularia_demo',
  collectionId: 'col_demo_montres',
  collectionName: 'Les cinq icônes',
  collectionDescription: 'Collection privée fictive réunissant cinq références emblématiques de manufactures différentes.',
} as const;

export interface DemoCartularyDefinition {
  id: string;
  publicCode: string;
  brand: string;
  model: string;
  reference: string;
  manufactureYear: number;
  serialNumber: string;
  caliber: string;
  powerReserve: string;
  caseMaterial: string;
  diameter: number;
  thickness: number;
  waterResistance: string;
  mediaSlug: string;
  description: string;
  conditionSummary: string;
  technicalSpecs: Array<{ label: string; value: string }>;
  purchaseDate: string;
  purchasePrice: number;
  valuationDate: string;
  valuationLow: number;
  valuationMid: number;
  valuationHigh: number;
  currency: 'EUR';
  documents: string[];
  sourceLabel: string;
}

export const DEMO_CARTULARIES: DemoCartularyDefinition[] = [
  {
    id: 'cart_demo_rolex_submariner_124060',
    publicCode: 'DEMO-ROL-124060',
    brand: 'Rolex',
    model: 'Submariner',
    reference: '124060',
    manufactureYear: 2022,
    serialNumber: 'DEMO-124060-2022-01',
    caliber: 'Rolex 3230',
    powerReserve: 'Environ 70 heures',
    caseMaterial: 'Oystersteel',
    diameter: 41,
    thickness: 12.3,
    waterResistance: '300 mètres',
    mediaSlug: 'rolex-submariner',
    description: 'Exemplaire fictif de Rolex Oyster Perpetual Submariner sans date, en Oystersteel, cadran noir et lunette Cerachrom noire. Dossier de démonstration, sans lien avec une montre ou un propriétaire réel.',
    conditionSummary: 'Très bon état d’usage fictif. Légères micro-rayures déclarées sur le fermoir Oysterlock ; boîtier, verre et lunette sans choc signalé. Contrôle d’étanchéité et examen physique à renouveler avant toute conclusion réelle.',
    technicalSpecs: [
      { label: 'Boîtier', value: 'Oystersteel · 41 mm' },
      { label: 'Mouvement', value: 'Automatique · calibre Rolex 3230' },
      { label: 'Réserve de marche', value: 'Environ 70 heures' },
      { label: 'Étanchéité', value: '300 mètres' },
      { label: 'Lunette', value: 'Unidirectionnelle · Cerachrom noir · 60 minutes' },
      { label: 'Bracelet', value: 'Oyster · fermoir Oysterlock · extension Glidelock' },
    ],
    purchaseDate: '2022-11-18',
    purchasePrice: 8_850,
    valuationDate: '2026-08-01',
    valuationLow: 9_800,
    valuationMid: 10_300,
    valuationHigh: 10_900,
    currency: 'EUR',
    documents: ['Facture d’achat fictive', 'Carte de garantie fictive', 'Contrôle d’étanchéité fictif du 12.06.2025'],
    sourceLabel: 'Caractéristiques de référence Rolex · valeurs et historique entièrement fictifs',
  },
  {
    id: 'cart_demo_ap_royal_oak_15510st',
    publicCode: 'DEMO-AP-15510ST',
    brand: 'Audemars Piguet',
    model: 'Royal Oak Selfwinding',
    reference: '15510ST.OO.1320ST.06',
    manufactureYear: 2023,
    serialNumber: 'DEMO-15510ST-2023-02',
    caliber: 'AP 4302',
    powerReserve: '70 heures',
    caseMaterial: 'Acier inoxydable',
    diameter: 41,
    thickness: 10.5,
    waterResistance: '50 mètres',
    mediaSlug: 'audemars-piguet-royal-oak',
    description: 'Exemplaire fictif de Royal Oak Selfwinding de 41 mm en acier, cadran « Bleu Nuit, Nuage 50 » à motif Grande Tapisserie et bracelet acier intégré.',
    conditionSummary: 'Bon état fictif, porté avec soin. Micro-marques déclarées sur les maillons polis et la lunette ; géométrie du boîtier supposée non repolie. Une inspection indépendante reste requise.',
    technicalSpecs: [
      { label: 'Boîtier', value: 'Acier inoxydable · 41 mm' },
      { label: 'Mouvement', value: 'Automatique · calibre AP 4302' },
      { label: 'Réserve de marche', value: '70 heures' },
      { label: 'Fonctions', value: 'Heures, minutes, seconde centrale et date' },
      { label: 'Cadran', value: 'Bleu Nuit, Nuage 50 · Grande Tapisserie' },
      { label: 'Bracelet', value: 'Acier intégré · boucle déployante AP' },
    ],
    purchaseDate: '2023-09-07',
    purchasePrice: 33_800,
    valuationDate: '2026-08-01',
    valuationLow: 38_000,
    valuationMid: 41_500,
    valuationHigh: 45_000,
    currency: 'EUR',
    documents: ['Facture de boutique fictive', 'Certificat de garantie fictif', 'Relevé de service fictif'],
    sourceLabel: 'Caractéristiques de référence Audemars Piguet · valeurs et historique entièrement fictifs',
  },
  {
    id: 'cart_demo_tudor_black_bay_chrono_79360n',
    publicCode: 'DEMO-TUD-79360N',
    brand: 'Tudor',
    model: 'Black Bay Chrono',
    reference: 'M79360N-0013',
    manufactureYear: 2025,
    serialNumber: 'DEMO-79360N-2025-03',
    caliber: 'Tudor MT5813',
    powerReserve: 'Environ 70 heures',
    caseMaterial: 'Acier 316L',
    diameter: 41,
    thickness: 14.4,
    waterResistance: '200 mètres',
    mediaSlug: 'tudor-black-bay-chrono',
    description: 'Exemplaire fictif de Tudor Black Bay Chrono en acier, cadran noir à compteurs argentés, date à 6 heures et bracelet acier cinq maillons.',
    conditionSummary: 'Très bon état fictif. Traces d’usage légères déclarées sur le bracelet, poussoirs vissés fonctionnels et chronographe remis à zéro correctement. Étanchéité non garantie sans test récent.',
    technicalSpecs: [
      { label: 'Boîtier', value: 'Acier 316L · 41 mm · épaisseur 14,4 mm' },
      { label: 'Mouvement', value: 'Chronographe automatique · calibre MT5813 COSC' },
      { label: 'Réserve de marche', value: 'Environ 70 heures' },
      { label: 'Étanchéité', value: '200 mètres' },
      { label: 'Cadran', value: 'Noir bombé · compteurs argentés · date à 6 h' },
      { label: 'Bracelet', value: 'Acier cinq maillons · fermoir T-fit' },
    ],
    purchaseDate: '2025-10-22',
    purchasePrice: 5_150,
    valuationDate: '2026-08-01',
    valuationLow: 4_300,
    valuationMid: 4_700,
    valuationHigh: 5_100,
    currency: 'EUR',
    documents: ['Facture de détaillant fictive', 'Carte de garantie fictive', 'Test de marche fictif'],
    sourceLabel: 'Caractéristiques de référence Tudor · valeurs et historique entièrement fictifs',
  },
  {
    id: 'cart_demo_jlc_reverso_tribute_q397848j',
    publicCode: 'DEMO-JLC-Q397848J',
    brand: 'Jaeger-LeCoultre',
    model: 'Reverso Tribute Monoface Small Seconds',
    reference: 'Q397848J',
    manufactureYear: 2024,
    serialNumber: 'DEMO-Q397848J-2024-04',
    caliber: 'Jaeger-LeCoultre 822',
    powerReserve: '42 heures',
    caseMaterial: 'Acier inoxydable',
    diameter: 27.4,
    thickness: 8.51,
    waterResistance: '3 bar',
    mediaSlug: 'jaeger-lecoultre-reverso',
    description: 'Exemplaire fictif de Reverso Tribute Monoface Small Seconds en acier, cadran bleu soleillé, petite seconde et boîtier réversible inspiré de l’Art déco.',
    conditionSummary: 'Excellent état fictif. Cadran et verre sans marque déclarée ; très légère patine d’usage sur le bracelet en veau bleu. Le fond réversible vierge est supposé non gravé.',
    technicalSpecs: [
      { label: 'Boîtier', value: 'Acier · 45,6 × 27,4 mm · épaisseur 8,51 mm' },
      { label: 'Mouvement', value: 'Remontage manuel · calibre Jaeger-LeCoultre 822' },
      { label: 'Réserve de marche', value: '42 heures' },
      { label: 'Étanchéité', value: '3 bar' },
      { label: 'Cadran', value: 'Bleu soleillé · index appliqués · petite seconde' },
      { label: 'Bracelet', value: 'Veau bleu · boucle déployante acier' },
    ],
    purchaseDate: '2024-05-16',
    purchasePrice: 11_200,
    valuationDate: '2026-08-01',
    valuationLow: 8_900,
    valuationMid: 9_700,
    valuationHigh: 10_500,
    currency: 'EUR',
    documents: ['Facture de boutique fictive', 'Garantie fictive', 'Photographies de réception fictives'],
    sourceLabel: 'Caractéristiques de référence Jaeger-LeCoultre · valeurs et historique entièrement fictifs',
  },
  {
    id: 'cart_demo_breguet_classique_5157bb',
    publicCode: 'DEMO-BRG-5157BB',
    brand: 'Breguet',
    model: 'Classique 5157',
    reference: '5157BB/11/9V6',
    manufactureYear: 2019,
    serialNumber: 'DEMO-5157BB-2019-05',
    caliber: 'Breguet 502.3',
    powerReserve: '45 heures',
    caseMaterial: 'Or blanc 18 carats',
    diameter: 38,
    thickness: 5.5,
    waterResistance: '3 bar',
    mediaSlug: 'breguet-classique',
    description: 'Exemplaire fictif de Breguet Classique 5157 extra-plate en or blanc 18 carats, cadran argenté guilloché main, chiffres romains et aiguilles Breguet bleuies.',
    conditionSummary: 'Très bon état fictif. Fines marques déclarées sur la carrure cannelée et usure légère du bracelet alligator. Le fonctionnement est annoncé régulier ; aucune expertise indépendante n’est attachée.',
    technicalSpecs: [
      { label: 'Boîtier', value: 'Or blanc 18 ct · 38 mm · épaisseur 5,5 mm' },
      { label: 'Mouvement', value: 'Automatique extra-plat · calibre Breguet 502.3' },
      { label: 'Réserve de marche', value: '45 heures' },
      { label: 'Étanchéité', value: '3 bar' },
      { label: 'Cadran', value: 'Argenté · guilloché main · chiffres romains' },
      { label: 'Bracelet', value: 'Alligator noir · boucle en or blanc' },
    ],
    purchaseDate: '2019-12-03',
    purchasePrice: 20_500,
    valuationDate: '2026-08-01',
    valuationLow: 15_000,
    valuationMid: 16_500,
    valuationHigh: 18_000,
    currency: 'EUR',
    documents: ['Facture d’achat fictive', 'Certificat de garantie fictif', 'Facture de révision fictive de 2024'],
    sourceLabel: 'Caractéristiques de référence Breguet · valeurs et historique entièrement fictifs',
  },
];

export interface DemoCartularyContent {
  seller: string;
  specificationValues: Record<string, string>;
  checks: Array<{ id: string; title: string; note: string; checked: boolean }>;
  documentation: Array<{ id: string; category: 'Facture' | 'Garantie' | 'Assurances' | 'Boîte' | 'Écrin' | 'Manuel' | 'Certificat' | 'Accessoire' | 'Autre'; description: string; state: 'Présent' | 'Complet' | 'Incomplet' | 'Manquant' | 'À vérifier' }>;
  popularityResources: Array<{ id: string; name: string; type: 'Forum officiel' | 'Discussion dédiée' | 'Communauté' | 'Base de données' | 'Revue'; url: string }>;
  expenses: Array<{ id: string; kind: 'Révision' | 'Assurance' | 'Coûts de conservation' | 'Autre'; date: string; label: string; amount: number }>;
  comparableAnalysis: Array<{ id: string; angle: string; finding: string; reading: string }>;
  comparables: Array<{
    id: string; date: string; channel: string; description: string; amount: number; currency: string;
    condition: string; sourceType: 'Transaction' | 'Annonce' | 'Estimation'; source: string;
    saleChannel: 'Annonce' | 'Enchère' | 'Vente privée' | 'Marchand';
  }>;
  marketDepth: { activeListings: number; transactions12m: number; medianDaysOnMarket: number };
  valuationHistory: Array<{
    id: string;
    date: string;
    lowValue: number;
    midValue: number;
    highValue: number;
    currency: 'EUR';
    confidence: 'Faible';
    source: string;
    visibility: 'Secret';
  }>;
  editableCopy: {
    heroSummary: string;
    originParagraphs: string[];
    originKnowledge: string;
    watchDescription: string[];
    conditionSummary: string[];
    conditionFacts: { lastCondition: string; conclusion: string; openPoint: string };
  };
  conditionReports: Array<{ id: string; date: string; title: string; score: number; summary: string; dossierId: string }>;
  insurance: { status: 'Active'; insurer: string; insuredValue: number; deductible: number; currency: 'EUR'; renewalDate: string };
  location: { city: string; country: string; storageType: string; verifiedAt: string; visibility: 'Secret' };
  ownershipHistory: Array<{ id: string; fromYear: string; toYear: string; description: string; firstOwner: boolean }>;
  storageCodes: Array<{ id: string; correspondenceCode: string; codeName: string; note: string }>;
  transmissionCodes: Array<{ id: string; correspondenceCode: string; codeName: string; note: string }>;
}

interface DemoReferenceInput {
  collection: string;
  movement: string;
  baseCaliber: string;
  jewels: string;
  bezel: string;
  crystal: string;
  dial: string;
  numerals: string;
  braceletMaterial: string;
  braceletColor: string;
  clasp: string;
  claspMaterial: string;
  dateFunction: string;
  gmt: string;
  secondTimezone: string;
  seconds: string;
  crown: string;
  caseback: string;
  delivered: string;
  history: string[];
  knowledge: string;
  inspectionDate: string;
  conclusion: string;
  openPoint: string;
  previousReview: string;
  officialUrl: string;
  officialLabel: string;
  guideUrl: string;
  marketDepth: [number, number, number];
  historicalMidpoints: Array<[date: string, midpoint: number]>;
  serviceDate: string;
  serviceLabel: string;
  serviceAmount: number;
  insurancePremium: number;
  deductible: number;
  city: string;
}

const buildDemoContent = (
  cartulary: DemoCartularyDefinition,
  input: DemoReferenceInput,
): DemoCartularyContent => {
  const prefix = cartulary.mediaSlug;
  const inspectionIso = input.inspectionDate.split('.').reverse().join('-');
  const manufactureYear = String(cartulary.manufactureYear);
  return {
    seller: `Détaillant agréé fictif · ${input.city}`,
    specificationValues: {
      collection: input.collection,
      movement: input.movement,
      bracelet: input.braceletMaterial,
      delivered: input.delivered,
      'cal-movement': input.movement,
      'base-caliber': input.baseCaliber,
      jewels: input.jewels,
      bezel: input.bezel,
      crystal: input.crystal,
      dial: input.dial,
      numerals: input.numerals,
      'strap-material': input.braceletMaterial,
      'strap-color': input.braceletColor,
      clasp: input.clasp,
      'clasp-material': input.claspMaterial,
      date: input.dateFunction,
      gmt: input.gmt,
      timezone: input.secondTimezone,
      seconds: input.seconds,
      crown: input.crown,
      caseback: input.caseback,
    },
    checks: [
      { id: `${prefix}-reference`, title: `${cartulary.brand} ${cartulary.reference}`, note: `Référence, marquages et numéro fictif rapprochés de la fiche officielle ${cartulary.brand}.`, checked: true },
      { id: `${prefix}-case`, title: `${cartulary.caseMaterial} · ${cartulary.diameter} mm`, note: `${input.bezel}. ${input.crystal}. Géométrie et finitions déclarées cohérentes sur les visuels de démonstration.`, checked: true },
      { id: `${prefix}-dial`, title: 'Cadran, aiguilles et affichages', note: `${input.dial}. ${input.numerals}.`, checked: true },
      { id: `${prefix}-movement`, title: `${input.movement} · ${cartulary.caliber}`, note: `${input.baseCaliber} · ${input.jewels} rubis · réserve de marche ${cartulary.powerReserve.toLocaleLowerCase('fr')}.`, checked: true },
      { id: `${prefix}-bracelet`, title: 'Bracelet et boucle', note: `${input.braceletMaterial}, ${input.braceletColor.toLocaleLowerCase('fr')} · ${input.clasp}.`, checked: true },
      { id: `${prefix}-set`, title: 'Ensemble documentaire fictif', note: 'Facture, garantie, écrin, manuel et contrôle visuel sont présents dans la simulation ; aucune pièce ne constitue une preuve réelle.', checked: true },
    ],
    documentation: [
      { id: `${prefix}-invoice`, category: 'Facture', description: `Facture d’acquisition fictive du ${cartulary.purchaseDate.split('-').reverse().join('.')} auprès d’un détaillant agréé fictif.`, state: 'Présent' },
      { id: `${prefix}-warranty`, category: 'Garantie', description: `Carte de garantie fictive portant la référence ${cartulary.reference} et le numéro de démonstration.`, state: 'Présent' },
      { id: `${prefix}-box`, category: 'Boîte', description: `Boîte extérieure et écrin ${cartulary.brand} fictifs, illustrés par le média « ensemble associé ».`, state: 'Complet' },
      { id: `${prefix}-manual`, category: 'Manuel', description: `Livret d’utilisation fictif et fiche de caractéristiques de la référence ${cartulary.reference}.`, state: 'Présent' },
      { id: `${prefix}-condition`, category: 'Certificat', description: `Rapport d’état fictif daté du ${input.inspectionDate}, sans valeur d’expertise.`, state: 'Présent' },
      { id: `${prefix}-insurance`, category: 'Assurances', description: 'Attestation d’assurance collection fictive 2026–2027 ; assureur et contrat simulés.', state: 'Présent' },
      { id: `${prefix}-accessory`, category: 'Accessoire', description: input.delivered, state: 'Complet' },
    ],
    popularityResources: [
      { id: `${prefix}-official`, name: input.officialLabel, type: 'Base de données', url: input.officialUrl },
      { id: `${prefix}-guide`, name: `Guide d’utilisation ${cartulary.brand}`, type: 'Revue', url: input.guideUrl },
    ],
    expenses: [
      { id: `${prefix}-service`, kind: 'Révision', date: input.serviceDate, label: `${input.serviceLabel} · opération fictive`, amount: input.serviceAmount },
      { id: `${prefix}-insurance`, kind: 'Assurance', date: '2026-08-01', label: 'Prime collection fictive 2026–2027', amount: input.insurancePremium },
      { id: `${prefix}-storage`, kind: 'Coûts de conservation', date: '2026-01-05', label: 'Quote-part annuelle de conservation sécurisée fictive', amount: 120 },
    ],
    comparableAnalysis: [
      { id: `${prefix}-analysis-range`, angle: 'Fourchette de travail', finding: `${cartulary.valuationLow.toLocaleString('fr-FR')} € à ${cartulary.valuationHigh.toLocaleString('fr-FR')} €`, reading: 'Fourchette fictive cohérente avec la référence, l’année, l’état déclaré et la complétude simulée du dossier.' },
      { id: `${prefix}-analysis-mid`, angle: 'Valeur médiane retenue', finding: `${cartulary.valuationMid.toLocaleString('fr-FR')} €`, reading: 'Point médian de démonstration, sans cotation en temps réel ni avis d’expert.' },
      { id: `${prefix}-analysis-condition`, angle: 'État et ensemble', finding: input.conclusion, reading: 'L’état déclaré et l’ensemble complet fictif soutiennent le milieu de fourchette ; toute valeur réelle exigerait un examen physique.' },
      { id: `${prefix}-analysis-liquidity`, angle: 'Liquidité simulée', finding: `${input.marketDepth[2]} jours médians`, reading: 'Indicateur pédagogique calculé pour la démonstration ; il ne provient pas d’une base de transactions réelle.' },
    ],
    comparables: [
      { id: `${prefix}-listing-low`, date: '2026-07-12', channel: 'Plateforme spécialisée · simulation', description: `${cartulary.brand} ${cartulary.reference} · montre seule · observation fictive`, amount: cartulary.valuationLow, currency: 'EUR', condition: 'Bon état fictif', sourceType: 'Annonce', source: 'Simulation Cartularia · aucune annonce réelle', saleChannel: 'Annonce' },
      { id: `${prefix}-listing-high`, date: '2026-07-28', channel: 'Marchand · simulation', description: `${cartulary.brand} ${cartulary.reference} · ensemble complet · observation fictive`, amount: cartulary.valuationHigh, currency: 'EUR', condition: 'Très bon état fictif', sourceType: 'Annonce', source: 'Simulation Cartularia · aucun marchand réel', saleChannel: 'Marchand' },
      { id: `${prefix}-transaction`, date: '2026-06-19', channel: 'Vente privée · simulation', description: `${cartulary.brand} ${cartulary.reference} · transaction pédagogique fictive`, amount: cartulary.valuationMid, currency: 'EUR', condition: 'État comparable fictif', sourceType: 'Transaction', source: 'Simulation Cartularia · aucune transaction réelle', saleChannel: 'Vente privée' },
    ],
    marketDepth: { activeListings: input.marketDepth[0], transactions12m: input.marketDepth[1], medianDaysOnMarket: input.marketDepth[2] },
    valuationHistory: [
      ...input.historicalMidpoints.map(([date, midpoint], index) => ({
        id: `${prefix}-valuation-${index + 1}`,
        date,
        lowValue: Math.round(midpoint * 0.94 / 100) * 100,
        midValue: midpoint,
        highValue: Math.round(midpoint * 1.06 / 100) * 100,
        currency: 'EUR' as const,
        confidence: 'Faible' as const,
        source: 'Simulation Cartularia · historique fictif non indexé sur des transactions réelles',
        visibility: 'Secret' as const,
      })),
      {
        id: 'demo_valuation',
        date: cartulary.valuationDate,
        lowValue: cartulary.valuationLow,
        midValue: cartulary.valuationMid,
        highValue: cartulary.valuationHigh,
        currency: 'EUR',
        confidence: 'Faible',
        source: `${cartulary.sourceLabel} · valeur de démonstration`,
        visibility: 'Secret',
      },
    ],
    editableCopy: {
      heroSummary: cartulary.description,
      originParagraphs: input.history,
      originKnowledge: input.knowledge,
      watchDescription: [
        cartulary.description,
        `L’exemplaire de démonstration est daté de ${manufactureYear}, porte le numéro fictif ${cartulary.serialNumber} et est présenté avec ${input.delivered.toLocaleLowerCase('fr')}.`,
      ],
      conditionSummary: [
        cartulary.conditionSummary,
        `Revue fictive du ${input.inspectionDate} : identité, affichages, remontage, mise à l’heure et ensemble associé contrôlés dans le scénario. Aucun contrôle physique réel ni garantie d’étanchéité n’est attaché.`,
      ],
      conditionFacts: { lastCondition: input.inspectionDate, conclusion: input.conclusion, openPoint: input.openPoint },
    },
    conditionReports: [
      { id: `${prefix}-condition-current`, date: inspectionIso, title: 'Rapport d’état fictif de référence', score: 4, summary: `${cartulary.conditionSummary} Rapport créé uniquement pour la démonstration.`, dossierId: `${prefix}-media-dossier` },
      { id: `${prefix}-condition-previous`, date: input.serviceDate, title: 'Revue antérieure fictive', score: 4, summary: input.previousReview, dossierId: `${prefix}-service-dossier` },
    ],
    insurance: { status: 'Active', insurer: 'Assureur collection fictif', insuredValue: cartulary.valuationHigh, deductible: input.deductible, currency: 'EUR', renewalDate: '2027-07-31' },
    location: { city: `${input.city} · localisation fictive`, country: 'Suisse', storageType: 'Coffre sécurisé fictif', verifiedAt: inspectionIso, visibility: 'Secret' },
    ownershipHistory: [{ id: `${prefix}-owner-1`, fromYear: manufactureYear, toYear: '2026', description: `Acquisition neuve fictive auprès d’un détaillant agréé, avec continuité documentaire simulée jusqu’à la date de valorisation.`, firstOwner: true }],
    storageCodes: [{ id: `${prefix}-storage-1`, correspondenceCode: `DEMO-LOC-${cartulary.publicCode}`, codeName: 'Coffre principal fictif', note: 'Lieu pseudonymisé de démonstration ; aucune adresse réelle.' }],
    transmissionCodes: [{ id: `${prefix}-transmission-1`, correspondenceCode: `DEMO-PER-${cartulary.publicCode}`, codeName: 'Bénéficiaire A fictif', note: 'Contact pseudonymisé de démonstration ; aucune identité réelle.' }],
  };
};

const [demoRolex, demoAp, demoTudor, demoJlc, demoBreguet] = DEMO_CARTULARIES;

export const DEMO_CARTULARY_CONTENT: Record<string, DemoCartularyContent> = {
  [demoRolex.id]: buildDemoContent(demoRolex, {
    collection: 'Oyster Perpetual Submariner', movement: 'Remontage automatique', baseCaliber: 'Rolex 3230', jewels: '31',
    bezel: 'Lunette unidirectionnelle en Oystersteel, disque Cerachrom noir gradué 60 minutes', crystal: 'Saphir inrayable',
    dial: 'Noir, index Chromalight appliqués', numerals: 'Index géométriques appliqués · sans chiffres', braceletMaterial: 'Oystersteel', braceletColor: 'Acier',
    clasp: 'Oysterlock de sécurité avec extension Rolex Glidelock', claspMaterial: 'Oystersteel', dateFunction: 'Sans date', gmt: 'Non', secondTimezone: 'Non',
    seconds: 'Seconde centrale avec stop-seconde', crown: 'Triplock vissée', caseback: 'Plein, vissé', delivered: 'Montre, bracelet Oyster, boîte, écrin, carte et manuel fictifs',
    history: [
      'La Submariner est la montre de plongée professionnelle de Rolex. La référence 124060, sans date, adopte un boîtier Oyster de 41 mm et succède à la génération 114060.',
      'Sa lunette unidirectionnelle à disque Cerachrom noir gradué 60 minutes et son affichage Chromalight répondent à la lecture du temps d’immersion.',
      'Le calibre Rolex 3230 automatique offre environ 70 heures de réserve de marche. Les caractéristiques techniques sont reprises de la fiche manufacture ; l’exemplaire et son histoire sont fictifs.',
    ],
    knowledge: 'La référence 124060 est une Submariner sans date : l’absence de guichet et de loupe Cyclope est conforme à cette configuration.',
    inspectionDate: '12.06.2025', conclusion: 'Très bon état fictif', openPoint: 'Renouveler le test d’étanchéité', previousReview: 'Contrôle d’étanchéité fictif à 30 bar et mesure de marche déclarée dans les tolérances du scénario.',
    officialUrl: 'https://www.rolex.com/watches/submariner/m124060-0001.html', officialLabel: 'Rolex Submariner 124060', guideUrl: 'https://www.rolex.com/watch-care-and-service/user-guides/submariner',
    marketDepth: [84, 36, 24], serviceDate: '2025-06-12', serviceLabel: 'Contrôle d’étanchéité et réglage', serviceAmount: 280, insurancePremium: 230, deductible: 500, city: 'Genève',
    historicalMidpoints: [['2022-11-18', 8_850], ['2023-12-15', 9_200], ['2024-12-15', 9_700], ['2025-12-15', 10_100]],
  }),
  [demoAp.id]: buildDemoContent(demoAp, {
    collection: 'Royal Oak', movement: 'Remontage automatique', baseCaliber: 'AP 4302', jewels: '32', bezel: 'Acier, octogonale, huit vis hexagonales', crystal: 'Saphir antireflet',
    dial: 'Bleu Nuit, Nuage 50 · motif Grande Tapisserie', numerals: 'Index appliqués et aiguilles Royal Oak luminescents', braceletMaterial: 'Acier inoxydable intégré', braceletColor: 'Acier',
    clasp: 'Boucle déployante AP', claspMaterial: 'Acier inoxydable', dateFunction: 'Guichet à 3 heures', gmt: 'Non', secondTimezone: 'Non', seconds: 'Seconde centrale', crown: 'Vissée',
    caseback: 'Saphir, mouvement visible', delivered: 'Montre, bracelet acier intégré, boîte, écrin, garantie et manuel fictifs',
    history: [
      'Créée en 1972, la Royal Oak a imposé le langage de la montre sportive de luxe en acier avec lunette octogonale, vis apparentes et bracelet intégré.',
      'La référence 15510ST marque le cinquantième anniversaire de la collection avec un boîtier de 41 mm et le cadran Grande Tapisserie « Bleu Nuit, Nuage 50 » pour la variante .06.',
      'Le calibre automatique AP 4302 affiche heures, minutes, seconde centrale et date, avec 70 heures de réserve de marche. L’historique particulier présenté ici est fictif.',
    ],
    knowledge: 'Les alternances de surfaces satinées et polies sont déterminantes sur une Royal Oak ; une reprise de polissage doit être évaluée avec attention.',
    inspectionDate: '08.07.2026', conclusion: 'Bon état fictif · géométrie préservée', openPoint: 'Contrôle des arêtes sous loupe', previousReview: 'Revue fictive du bracelet et de la marche ; micro-marques homogènes déclarées, sans intervention lourde.',
    officialUrl: 'https://www.audemarspiguet.com/us/en/watch-collection/royal-oak/15510ST.OO.1320ST.06', officialLabel: 'Audemars Piguet Royal Oak 15510ST', guideUrl: 'https://www.audemarspiguet.com/com/en/services/caring-for-your-watch.html',
    marketDepth: [31, 14, 42], serviceDate: '2025-09-18', serviceLabel: 'Contrôle fonctionnel et bracelet', serviceAmount: 620, insurancePremium: 680, deductible: 1_000, city: 'Lausanne',
    historicalMidpoints: [['2023-09-07', 33_800], ['2024-06-30', 42_500], ['2025-06-30', 40_000]],
  }),
  [demoTudor.id]: buildDemoContent(demoTudor, {
    collection: 'Black Bay Chrono', movement: 'Chronographe à remontage automatique', baseCaliber: 'Manufacture Tudor MT5813', jewels: '41', bezel: 'Acier, disque aluminium anodisé noir et échelle tachymétrique', crystal: 'Saphir bombé',
    dial: 'Noir bombé · compteurs argentés · date à 6 heures', numerals: 'Index appliqués luminescents', braceletMaterial: 'Acier 316L à cinq maillons', braceletColor: 'Acier',
    clasp: 'Fermoir Tudor T-fit à réglage rapide', claspMaterial: 'Acier 316L', dateFunction: 'Guichet à 6 heures', gmt: 'Non', secondTimezone: 'Non', seconds: 'Petite seconde et seconde de chronographe centrale',
    crown: 'Vissée avec rose Tudor en relief · poussoirs vissés', caseback: 'Plein, vissé', delivered: 'Montre, bracelet cinq maillons, boîte, écrin, garantie et manuel fictifs',
    history: [
      'Le Black Bay Chrono transpose les codes de la ligne Black Bay dans un chronographe sportif de 41 mm étanche à 200 mètres.',
      'La référence M79360N-0013 associe un cadran noir à compteurs argentés, un guichet de date à 6 heures et un bracelet acier à cinq maillons avec fermoir T-fit.',
      'Le calibre Manufacture MT5813 est un chronographe automatique certifié COSC offrant environ 70 heures de réserve de marche. Toutes les données de l’exemplaire restent fictives.',
    ],
    knowledge: 'Les poussoirs et la couronne sont vissés : ils doivent être correctement verrouillés avant toute exposition à l’eau.',
    inspectionDate: '04.08.2026', conclusion: 'Très bon état fictif · chronographe fonctionnel', openPoint: 'Test d’étanchéité annuel', previousReview: 'Test fictif de marche, démarrage, arrêt et remise à zéro du chronographe ; alignement déclaré satisfaisant.',
    officialUrl: 'https://www.tudorwatch.com/en/watches/black-bay-chrono/m79360n-0013', officialLabel: 'Tudor Black Bay Chrono M79360N-0013', guideUrl: 'https://www.tudorwatch.com/en/tudor-care/tutorials/tudor-black-bay-chrono',
    marketDepth: [46, 22, 31], serviceDate: '2026-04-11', serviceLabel: 'Test de marche et chronographe', serviceAmount: 190, insurancePremium: 145, deductible: 300, city: 'Neuchâtel',
    historicalMidpoints: [['2025-10-22', 5_150], ['2026-02-15', 4_900], ['2026-05-15', 4_800]],
  }),
  [demoJlc.id]: buildDemoContent(demoJlc, {
    collection: 'Reverso Tribute', movement: 'Remontage manuel', baseCaliber: 'Jaeger-LeCoultre 822', jewels: '19', bezel: 'Sans lunette rapportée · brancards et godrons Art déco', crystal: 'Saphir',
    dial: 'Bleu soleillé · petite seconde', numerals: 'Index appliqués facettés', braceletMaterial: 'Cuir de veau', braceletColor: 'Bleu', clasp: 'Boucle déployante double', claspMaterial: 'Acier inoxydable',
    dateFunction: 'Sans date', gmt: 'Non', secondTimezone: 'Non', seconds: 'Petite seconde à 6 heures', crown: 'Non vissée', caseback: 'Boîtier réversible Monoface · verso plein personnalisable',
    delivered: 'Montre, bracelet veau bleu, boucle déployante, boîte, écrin, garantie et manuel fictifs',
    history: [
      'La Reverso naît en 1931 d’un boîtier réversible conçu pour protéger le cadran pendant les matchs de polo. Sa forme rectangulaire et ses godrons en font une icône Art déco.',
      'La Reverso Tribute Monoface Small Seconds Q397848J reprend ces codes avec un cadran bleu soleillé, des index appliqués et une petite seconde.',
      'Son calibre 822 à remontage manuel réunit 108 composants, 19 rubis et une réserve de marche de 42 heures. L’exemplaire présenté dans ce Cartulaire est fictif.',
    ],
    knowledge: 'Le verso plein d’une Reverso Monoface peut être personnalisé ; celui de l’exemplaire fictif est déclaré vierge et non gravé.',
    inspectionDate: '19.07.2026', conclusion: 'Excellent état fictif', openPoint: 'Surveiller l’usure du bracelet cuir', previousReview: 'Contrôle fictif du retournement du boîtier, de la mise à l’heure et de l’état du bracelet ; aucun défaut déclaré.',
    officialUrl: 'https://www.jaeger-lecoultre.com/us-en/watches/reverso/reverso-tribute/reverso-tribute-monoface-small-seconds-stainless-steel-q397848j', officialLabel: 'Jaeger-LeCoultre Reverso Tribute Q397848J', guideUrl: 'https://www.jaeger-lecoultre.com/us-en/services/user-manuals',
    marketDepth: [18, 9, 54], serviceDate: '2026-02-14', serviceLabel: 'Contrôle de marche et boîtier réversible', serviceAmount: 240, insurancePremium: 210, deductible: 500, city: 'Genève',
    historicalMidpoints: [['2024-05-16', 11_200], ['2025-01-15', 10_700], ['2025-10-15', 10_100]],
  }),
  [demoBreguet.id]: buildDemoContent(demoBreguet, {
    collection: 'Classique', movement: 'Remontage automatique extra-plat', baseCaliber: 'Breguet 502.3', jewels: '35', bezel: 'Or blanc 18 carats, carrure finement cannelée', crystal: 'Saphir',
    dial: 'Argenté or · guilloché main', numerals: 'Chiffres romains', braceletMaterial: 'Alligator', braceletColor: 'Noir', clasp: 'Boucle ardillon', claspMaterial: 'Or blanc 18 carats',
    dateFunction: 'Sans date', gmt: 'Non', secondTimezone: 'Non', seconds: 'Deux aiguilles · sans seconde', crown: 'Non vissée', caseback: 'Saphir, mouvement visible',
    delivered: 'Montre, bracelet alligator, boucle or blanc, boîte, écrin, certificat et manuel fictifs',
    history: [
      'La collection Classique transpose dans une lecture contemporaine les codes associés à Abraham-Louis Breguet : cadran guilloché, chiffres romains, aiguilles bleuies et carrure cannelée.',
      'La référence 5157BB/11/9V6 est une montre extra-plate de 38 mm en or blanc, avec cadran argenté guilloché main et affichage épuré à deux aiguilles.',
      'Le calibre automatique 502.3 oscille à 3 Hz, utilise un spiral plat en silicium et offre 45 heures de réserve de marche. L’exemplaire et sa provenance sont entièrement fictifs.',
    ],
    knowledge: 'Le cadran guilloché main et les arêtes de la carrure cannelée doivent être examinés avec précaution ; une intervention cosmétique peut altérer leur netteté.',
    inspectionDate: '27.06.2026', conclusion: 'Très bon état fictif · finitions préservées', openPoint: 'Documenter le prochain service complet', previousReview: 'Révision complète fictive en 2024 avec contrôle de marche, nettoyage et remplacement du bracelet déclaré.',
    officialUrl: 'https://www.breguet.com/fr/montres/classique/classique-5157/5157bb119v6', officialLabel: 'Breguet Classique 5157BB/11/9V6', guideUrl: 'https://www.breguet.com/fr/service-client',
    marketDepth: [12, 6, 68], serviceDate: '2024-10-03', serviceLabel: 'Révision complète', serviceAmount: 1_180, insurancePremium: 340, deductible: 750, city: 'Zurich',
    historicalMidpoints: [['2019-12-03', 20_500], ['2021-12-15', 18_500], ['2023-12-15', 17_000], ['2025-12-15', 16_000]],
  }),
};

export const demoCartularyContentById = (cartularyId: string | null | undefined) => (
  cartularyId ? DEMO_CARTULARY_CONTENT[cartularyId] ?? null : null
);

export const DEMO_SUBMARINER_CARTULARY_ID = DEMO_CARTULARIES[0].id;

export const demoCartularyById = (cartularyId: string | null | undefined) => (
  DEMO_CARTULARIES.find((cartulary) => cartulary.id === cartularyId) ?? null
);

export const isDemoCartularyId = (cartularyId: string | null | undefined) => (
  demoCartularyById(cartularyId) !== null
);

const demoMediaAsset = (
  cartulary: DemoCartularyDefinition,
  input: Pick<Asset, 'id' | 'name' | 'url' | 'type' | 'tags' | 'category'> & Partial<Asset>,
): Asset => {
  // Explicitly public fictional fixtures, not an exception to real-media privacy.
  const knownDemo = DEMO_CARTULARIES.some((item) => item.id === cartulary.id && item.mediaSlug === cartulary.mediaSlug);
  const publicFixture = knownDemo && !input.binaryId && (
    input.url === '/assets/demo-watches/NOTICE_DEMO.txt'
    || input.url.startsWith(`/assets/demo-watches/${cartulary.mediaSlug}/`)
  );
  return {
    hash: `sha256:demo-generated-${cartulary.publicCode.toLocaleLowerCase('fr')}-${input.id}`,
    status: 'Archived',
    capturedAt: '2026-08-22',
    metadataTimestamp: '2026-08-22T19:30:00+02:00',
    timestampSource: 'catalogue',
    localAvailability: 'available',
    derivativeStatus: 'not-required',
    ...input,
    visibility: publicFixture ? 'Tous' : 'Secret',
  };
};

export const buildDemoCartularyAssets = (cartulary: DemoCartularyDefinition): Asset[] => {
  const base = `/assets/demo-watches/${cartulary.mediaSlug}`;
  const mainUrl = `${base}/main.jpg`;
  const referenceReport = demoMediaAsset(cartulary, {
    id: `${cartulary.id}-reference-report`,
    name: `${cartulary.brand} ${cartulary.reference} · note de référence fictive`,
    url: '/assets/demo-watches/NOTICE_DEMO.txt',
    type: 'document',
    mimeType: 'text/plain',
    originalFileName: `Note_reference_${cartulary.publicCode}.txt`,
    fileSize: '1 ko',
    tags: ['documentation'],
    category: 'documentation',
    sourceSection: 'reference-report',
    description: 'Note explicite rappelant que les caractéristiques de référence proviennent de la manufacture et que le dossier est fictif.',
  });

  if (cartulary.mediaSlug === 'rolex-submariner') {
    const spinAngles = [0, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 315, 330];
    const spinAssets = spinAngles.map((angle, index) => {
      const pad = String(index).padStart(2, '0');
      const url = `${base}/spin-${pad}.jpg`;
      return demoMediaAsset(cartulary, {
        id: `${cartulary.id}-spin-${pad}`,
        name: `${cartulary.brand} ${cartulary.model} · plateau tournant ${angle}°`,
        url,
        thumbnailUrl: url,
        type: 'image',
        ratio: '4:5',
        mimeType: 'image/jpeg',
        fileSize: 'Image optimisée 360°',
        tags: index === 0 ? ['main-photo', 'spin-3d', 'slideshow'] : ['spin-3d'],
        category: angle >= 120 && angle <= 240 ? 'boite' : 'cadran',
        description: `Vue détaillée de la Rolex Submariner sur plateau tournant à ${angle}°.`,
      });
    });

    return [
      ...spinAssets,
      demoMediaAsset(cartulary, {
        id: `${cartulary.id}-rear`,
        name: `${cartulary.brand} ${cartulary.model} · vue arrière fictive`,
        url: `${base}/rear.jpg`,
        type: 'image',
        ratio: '4:5',
        mimeType: 'image/jpeg',
        fileSize: 'Image optimisée de démonstration',
        tags: ['slideshow'],
        category: 'boite',
        description: 'Vue arrière sur plateau tournant illustrant le fond cannelé et la boucle Oysterlock.',
      }),
      demoMediaAsset(cartulary, {
        id: `${cartulary.id}-full-set`,
        name: `${cartulary.brand} ${cartulary.model} · ensemble associé fictif`,
        url: `${base}/full-set.jpg`,
        type: 'image',
        ratio: '4:5',
        mimeType: 'image/jpeg',
        fileSize: 'Image optimisée de démonstration',
        tags: ['slideshow', 'accessories', 'documentation', 'other'],
        category: 'ensemble',
        description: 'Boîte, papiers et accessoires fictifs sans donnée personnelle ni numéro réel.',
      }),
      demoMediaAsset(cartulary, {
        id: `${cartulary.id}-motion`,
        name: `${cartulary.brand} ${cartulary.model} · rotation sur plateau tournant 360°`,
        url: `${base}/motion.webm`,
        posterUrl: mainUrl,
        thumbnailUrl: mainUrl,
        type: 'video',
        ratio: '16:9',
        mimeType: 'video/webm',
        duration: '00:07',
        fileSize: '4.7 Mo · Vidéo 360° plateau tournant',
        tags: ['main-video'],
        category: 'ensemble',
        description: 'Séquence vidéo haute définition montrant la Rolex Submariner en rotation 360° sur son plateau tournant.',
      }),
      referenceReport,
    ];
  }

  return [
    demoMediaAsset(cartulary, {
      id: `${cartulary.id}-main`,
      name: `${cartulary.brand} ${cartulary.model} · vue principale fictive`,
      url: mainUrl,
      thumbnailUrl: mainUrl,
      type: 'image',
      ratio: '4:5',
      mimeType: 'image/jpeg',
      fileSize: 'Image optimisée de démonstration',
      tags: ['main-photo', 'spin-3d', 'slideshow'],
      category: 'cadran',
      description: 'Visuel généré pour la démonstration Cartularia ; il ne représente aucun exemplaire réel.',
    }),
    demoMediaAsset(cartulary, {
      id: `${cartulary.id}-rear`,
      name: `${cartulary.brand} ${cartulary.model} · vue arrière fictive`,
      url: `${base}/rear.jpg`,
      type: 'image',
      ratio: '4:5',
      mimeType: 'image/jpeg',
      fileSize: 'Image optimisée de démonstration',
      tags: ['spin-3d', 'slideshow'],
      category: 'boite',
      description: 'Vue arrière générée pour illustrer la séquence 360° du gabarit standard.',
    }),
    demoMediaAsset(cartulary, {
      id: `${cartulary.id}-full-set`,
      name: `${cartulary.brand} ${cartulary.model} · ensemble associé fictif`,
      url: `${base}/full-set.jpg`,
      type: 'image',
      ratio: '4:5',
      mimeType: 'image/jpeg',
      fileSize: 'Image optimisée de démonstration',
      tags: ['slideshow', 'accessories', 'documentation', 'other'],
      category: 'ensemble',
      description: 'Boîte, papiers et accessoires fictifs sans donnée personnelle ni numéro réel.',
    }),
    demoMediaAsset(cartulary, {
      id: `${cartulary.id}-motion`,
      name: `${cartulary.brand} ${cartulary.model} · animation principale fictive`,
      url: `${base}/motion.webm`,
      posterUrl: mainUrl,
      thumbnailUrl: mainUrl,
      type: 'video',
      ratio: '16:9',
      mimeType: 'video/webm',
      duration: '00:03',
      fileSize: 'Animation courte de démonstration',
      tags: ['main-video'],
      category: 'ensemble',
      description: 'Animation éditoriale créée à partir du visuel fictif principal.',
    }),
    referenceReport,
  ];
};
