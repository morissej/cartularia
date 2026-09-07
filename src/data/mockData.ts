import type { Cartulary, WatchReference, WatchInstance, Asset, SpinSet, Observation, Valuation } from '../types';
import { IWC_CARTULARY_ID } from '../domain/cartularyIds.ts';

const watchReference: WatchReference = {
  brand: "IWC Schaffhausen",
  model: "Flieger UTC (Die Fliegeruhr)",
  reference: "IW3251-001 (Réf. 3251-001)",
  caliber: "IWC 37526 (Module TZC - Time Zone Corrector)",
  powerReserve: "42 heures",
  material: "Acier fin brossé (chanfreins polis)",
  diameter: 39.0,
  thickness: 13.5,
  waterResistance: "6 bar / 6 ATM (60 m)",
};

const coreMedia: Asset[] = [
  {
    id: "ref-front",
    name: "Focus Shift White Front",
    url: "/assets/IWC/Focus Shift White Front.jpg",
    thumbnailUrl: "/assets/IWC/Focus Shift White Front.jpg",
    type: "image",
    ratio: "4:5",
    hash: "sha256-a1b2c3d4...",
    status: "Archived",
    visibility: "Tous",
    tags: ["main-photo", "slideshow"],
    category: "ensemble",
    description: "Vue principale de référence sur fond neutre.",
    capturedAt: "2026-08-05",
  },
  {
    id: "main-video",
    name: "Relevé vidéo d'août 2026",
    url: "/media-vault/DSC_1265.MOV",
    thumbnailUrl: "/assets/IWC/_DSC0978-3.jpg",
    posterUrl: "/assets/IWC/_DSC0978-3.jpg",
    type: "video",
    ratio: "16:9",
    hash: "sha256:81d212c94c33e514faff8d5c3ee6c856edb8f87a5ffd5d4ba35c1df0a512a111",
    status: "Archived",
    visibility: "Communauté",
    tags: ["main-video", "slideshow"],
    category: "ensemble",
    description: "Séquence vidéo privée ajoutée au relevé d'état d'août 2026.",
    capturedAt: "2026-08-26",
    fileSize: "143.3 Mo",
  },
  {
    id: "ref-back",
    name: "Focus Shift White Back",
    url: "/assets/IWC/Focus Shift White Back.jpg",
    thumbnailUrl: "/assets/IWC/Focus Shift White Back.jpg",
    type: "image",
    ratio: "4:5",
    hash: "sha256-e5f6g7h8...",
    status: "Archived",
    visibility: "Communauté",
    tags: ["slideshow"],
    category: "mouvement",
    description: "Vue du fond et du mouvement, utilisée à la fois en présentation et en contrôle technique.",
    capturedAt: "2026-08-05",
  },
  {
    id: "macro-buckle",
    name: "Vue frontale studio",
    url: "/assets/IWC/_DSC1016-2.jpg",
    thumbnailUrl: "/assets/IWC/_DSC1016-2.jpg",
    type: "image",
    ratio: "3:4",
    hash: "sha256-i9j0k1l2...",
    status: "Archived",
    visibility: "Secret",
    tags: ["slideshow"],
    category: "ensemble",
    description: "Vue frontale du cadran, des affichages, du bracelet et du boîtier.",
    capturedAt: "2026-08-05",
  },
  {
    id: "macro-case",
    name: "Vue frontale avec instruments",
    url: "/assets/IWC/_DSC1012-2.jpg",
    thumbnailUrl: "/assets/IWC/_DSC1012-2.jpg",
    type: "image",
    ratio: "3:4",
    hash: "sha256-m3n4o5p6...",
    status: "Archived",
    visibility: "Secret",
    tags: ["slideshow"],
    category: "ensemble",
    description: "Vue de contexte de la montre avec instruments de mesure ; aucun résultat de test n'est lisible sur cette photographie.",
    capturedAt: "2026-08-05",
  },
  {
    id: "macro-crown",
    name: "Vue trois-quarts côté couronne",
    url: "/assets/IWC/_DSC1019-3.jpg",
    thumbnailUrl: "/assets/IWC/_DSC1019-3.jpg",
    type: "image",
    ratio: "3:4",
    hash: "sha256-q7r8s9t0...",
    status: "Archived",
    visibility: "Secret",
    tags: ["accessories"],
    category: "accessoire",
    description: "La couronne est visible de profil ; sa gravure n'est pas lisible et reste à documenter.",
    capturedAt: "2026-08-05",
  }
];

// Fichiers pour la rotation 360°
const spinImages: Asset[] = [
  "_DSC0975-3.jpg",
  "_DSC0976-3.jpg",
  "_DSC0977-3.jpg",
  "_DSC0978-3.jpg",
  "_DSC0980-3.jpg",
  "_DSC0981-3.jpg",
  "_DSC0985-3.jpg",
  "_DSC0988-3.jpg",
  "_DSC0990-3.jpg",
  "_DSC0991-3.jpg",
  "_DSC0992-3.jpg",
  "_DSC0993-3.jpg",
  "_DSC0994-3.jpg",
  "_DSC1009-3.jpg"
].map((filename, index) => ({
  id: `spin-${index}`,
  name: `Angle ${index * 25}°`,
  url: `/assets/IWC/${filename}`,
  thumbnailUrl: `/assets/IWC/${filename}`,
  type: "image",
  ratio: "4:5",
  hash: `sha256-spin-hash-${index}`,
  status: "Archived",
  visibility: "Tous",
  tags: index === 2 || index === 6 || index === 10
    ? ["spin-3d", "slideshow"]
    : ["spin-3d"],
  category: "ensemble",
  description: `Vue ordonnée ${index + 1} de la séquence de rotation.`,
  capturedAt: "2026-08-05",
} as Asset));

// Catalogue unique : les chevauchements sont portés par `tags`, pas par des doublons.
const assets: Asset[] = [...coreMedia, ...spinImages];

const spinSet: SpinSet = {
  id: "spin-iwc-utc-360",
  images: spinImages,
  angles: spinImages.map((_, i) => Math.round((i * 360) / spinImages.length)),
  posterImageUrl: "/assets/IWC/Focus Shift White Front.jpg",
  isComplete: true,
  visibility: "Tous",
};

const observations: Observation[] = [
  {
    id: "obs-1",
    component: "Boîtier & Chanfreins de cornes",
    description: "Les vues documentent les cornes, le brossage et les arêtes. L'absence de sur-polissage reste à confirmer par une expertise physique ou des mesures.",
    assetId: "macro-case",
    proofStatus: "Non vérifié",
    confidence: "Moyenne",
    date: "2026-08-05",
  },
  {
    id: "obs-2",
    component: "Couronne 'Poisson'",
    description: "La couronne est visible, mais sa gravure n'est pas lisible sur les fichiers versés. La couronne poisson attendue pour la période reste à confirmer.",
    assetId: "macro-crown",
    proofStatus: "Non vérifié",
    confidence: "Faible",
    date: "2026-08-05",
  },
  {
    id: "obs-3",
    component: "Disque UTC & Guichet Date",
    description: "Le disque 24 heures et le guichet de date sont visibles et centrés sur les photographies. Le fonctionnement du module TZC n'est pas établi par un compte rendu de test.",
    proofStatus: "Non vérifié",
    confidence: "Moyenne",
    date: "2026-08-05",
  },
  {
    id: "obs-4",
    component: "Boucle ardillon & Bracelet",
    description: "Le bracelet cuir marron est fortement patiné et usé. La boucle et son origine doivent être documentées par une vue dédiée.",
    assetId: "macro-buckle",
    proofStatus: "Observé",
    confidence: "Moyenne",
    date: "2026-08-05",
  }
];

const valuations: Valuation[] = [
  {
    id: "val-1",
    date: "2026-08-18",
    lowValue: 2500,
    midValue: 2900,
    highValue: 3300,
    currency: "EUR",
    confidence: "Moyenne",
    source: "Croisement note de cession du 18/08/2026 et revue Chrono24 du 08/08/2026 · scénarios selon boîte et révision",
    visibility: "Secret",
  },
  {
    id: "val-2",
    date: "2024-02-15",
    lowValue: 2500,
    midValue: 2750,
    highValue: 3100,
    currency: "EUR",
    confidence: "Moyenne",
    source: "Point bas historique marché néo-vintage",
    visibility: "Secret",
  },
  {
    id: "val-3",
    date: "2025-02-15",
    lowValue: 2700,
    midValue: 3050,
    highValue: 3400,
    currency: "EUR",
    confidence: "Moyenne",
    source: "Revue annuelle des comparables du dossier",
    visibility: "Secret",
  },
  {
    id: "val-4",
    date: "2026-01-15",
    lowValue: 2950,
    midValue: 3350,
    highValue: 3800,
    currency: "EUR",
    confidence: "Moyenne",
    source: "Revue semestrielle des comparables du dossier",
    visibility: "Secret",
  }
];

const watchInstance: WatchInstance = {
  serialNumber: "2715537",
  publicCode: "OP-4892-XZ9",
  status: "InPossession",
  acquisitionDate: "2002-03-08",
  acquisitionPrice: 3200,
  currency: "EUR",
  lastVerificationDate: "2026-08-28",
  reference: watchReference,
  observations: observations,
  valuations: valuations,
  reminders: [
    {
      id: "rem-1",
      title: "Contrôle d'étanchéité périodique (6 ATM)",
      dueDate: "2027-03-08",
      status: "Planned",
      category: "maintenance",
    },
    {
      id: "rem-2",
      title: "Renouvellement contrat assurance collection",
      dueDate: "2027-08-01",
      status: "Planned",
      category: "insurance",
    }
  ],
};

export const mockCartulary: Cartulary = {
  id: IWC_CARTULARY_ID,
  publicCode: "OP-4892-XZ9",
  watchInstance: watchInstance,
  sections: {
    "01": { sectionId: "01", visibility: "Tous" }, // Synthèse publique
    "02": { sectionId: "02", visibility: "Tous" }, // Fiche technique publique
    "03": { sectionId: "03", visibility: "Tous" }, // Galerie studio publique
    "04": { sectionId: "04", visibility: "Communauté" }, // Condition visible par la communauté
    "05": { sectionId: "05", visibility: "Communauté" }, // Vidéo visible par la communauté
    "06": { sectionId: "06", visibility: "Secret" }, // Papiers & Facture 2002 secrets
    "07": { sectionId: "07", visibility: "Tous" }, // Histoire de la Flieger UTC publique
    "08": { sectionId: "08", visibility: "Communauté" }, // Historique exemplaire communauté
    "09": { sectionId: "09", visibility: "Secret" }, // Valorisation secrète
    "10": { sectionId: "10", visibility: "Tous" }, // Conditions de vente publiques
    "11": { sectionId: "11", visibility: "Secret" }, // Couverture & assurance secrètes
  },
  assets: assets,
  spinSet: spinSet,
  mediaDossiers: [
    {
      id: "inspection-2026-08-08",
      date: "2026-08-08",
      title: "Inspection de référence",
      summary: "Relevé photographique du boîtier, du cadran, du fond et du mouvement. Les fonctions, la marche et l'étanchéité restent à contrôler.",
      assetIds: ["macro-case", "macro-crown", "macro-buckle", "ref-back", "main-video"],
      author: "Propriétaire",
      status: "Reviewed",
    },
    {
      id: "inspection-2024-02-15",
      date: "2024-02-15",
      title: "Revue documentaire et visuelle",
      summary: "Point de situation antérieur à l'inspection de référence, conservé pour comparaison longitudinale.",
      assetIds: ["ref-back", "macro-case"],
      author: "Propriétaire",
      status: "Reviewed",
    },
  ],
  comparables: [
    {
      id: "comp-1",
      date: "2026-07-21",
      channel: "Marchand spécialisé",
      description: "IWC Flieger UTC 3251-001, full set, état très bon",
      amount: 4050,
      currency: "EUR",
      condition: "Très bon",
      sourceType: "Annonce",
      source: "Chrono24 · annonce observée",
      saleChannel: "Annonce",
    },
    {
      id: "comp-2",
      date: "2026-06-30",
      channel: "Vente européenne",
      description: "Référence comparable, papiers partiels, traces d'usage",
      amount: 3450,
      currency: "EUR",
      condition: "Bon",
      sourceType: "Transaction",
      source: "EveryWatch · résultat agrégé",
      saleChannel: "Enchère",
    },
    {
      id: "comp-3",
      date: "2026-05-18",
      channel: "Plateforme internationale",
      description: "Référence comparable, boîte et papiers, révision récente",
      amount: 4250,
      currency: "EUR",
      condition: "Très bon",
      sourceType: "Annonce",
      source: "Chrono24 · annonce observée",
      saleChannel: "Annonce",
    },
  ],
  marketSnapshot: {
    date: "2026-08-08",
    activeListings: 19,
    observedTransactions90d: 0,
    medianDaysOnMarket: 0,
    lowValue: 2576,
    midValue: 3521,
    highValue: 4606,
    currency: "EUR",
  },
  conditionReports: [
    {
      id: "report-2026-08-08",
      date: "2026-08-08",
      title: "Rapport d'état de référence",
      score: 88,
      summary: "Exemplaire cohérent et bien conservé. Boîtier non sur-poli, fonctions conformes et composants visibles compatibles avec la référence. Micro-rayures d'usage sur la boucle.",
      dossierId: "inspection-2026-08-08",
    },
    {
      id: "report-2024-02-15",
      date: "2024-02-15",
      title: "Revues antérieures",
      score: 84,
      summary: "État général jugé bon sur la base des éléments alors disponibles.",
      dossierId: "inspection-2024-02-15",
    },
  ],
  insurance: {
    status: "Active",
    insurer: "À documenter",
    insuredValue: 0,
    deductible: 0,
    currency: "EUR",
    renewalDate: "2027-08-01",
  },
  location: {
    city: "Paris",
    country: "France",
    storageType: "Coffre sécurisé",
    verifiedAt: "2026-08-08",
    visibility: "Secret",
  },
  seal: {
    id: "seal-iwc-01",
    status: "Issued",
    hash: "ea3b2d1c9f8e7d6c5b4a3f2e1d0c9b8a7fa6e5d4c3b2a10f9e8d7c6b5a4f3e2d",
    qrCodeUrl: "",
    issuedAt: "2026-08-08T10:00:00Z",
    supportCode: "2715-537-UTC-XZ9",
  },
  visibility: "Secret",
};
