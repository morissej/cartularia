import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  ExternalLink,
  FileText,
  Globe2,
  Eye,
  Lock,
  Paperclip,
  Pencil,
  Play,
  Plus,
  Printer,
  RotateCw,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  activeCartulary as mockCartulary,
  activeCreationProfile,
  isIwcCartulary,
  isRolexCartulary,
} from './data/activeCartulary';
import type { Asset, ComparableTransaction, MediaTag, Valuation, VisibilityLevel } from './types';
import { BarreDossier } from './components/BarreDossier';
import { BrandLogo } from './components/BrandLogo';
import { MediaCarousel } from './components/MediaCarousel';
import { computeHash, IntegrityJournal, isRfc3161Receipt } from './utils/integrityJournal';
import { AI_SCHEMA_VERSION, aiFieldProps } from './ai/fieldCatalog';
import { ProjectedPublicBlock } from './components/ProjectedPublicBlock';
import { PrivateMediaImage } from './components/PrivateMediaImage';
import { loadPublicProjection } from './services/projections';
import type { LoadedPublicProjection } from './domain/projections';
import {
  cartulariaLocalVault,
  cartulariaStorage,
  mirrorCartulariaLocalStorage,
  persistCartulariaJson,
} from './persistence/localVault';
import { readValidatedStoredJson } from './persistence/storedStateValidation';
import {
  CLOUD_PULL_APPLIED_EVENT,
  useHybridPersistence,
  type CloudPullAppliedDetail,
} from './persistence/useHybridPersistence';
import {
  PUBLISHED_BLOCK_IDS,
  applyPublicationDecision,
  destinationLabel,
  destinationMarker,
  evaluatePublicationEligibility,
  filterRequestedWebsiteBlocks,
  getPublicationPolicy,
  isSelectionValidated,
  publicationActionFor,
  validatedBlockIds,
  type PublicationAction,
  type PublicationDecision,
  type PublicationDestination,
  type PublicationEligibility,
  type PublicationPolicyResult,
  type PublishedBlockId,
} from './domain/publication';
import {
  AUDIENCE_STORAGE_KEY,
  INTERFACE_LANGUAGE_STORAGE_KEY,
  adjacentCartularyPage,
  cartularyPageFromHash,
  normalizeAudience,
  normalizeInterfaceLanguage,
  type CartularyPage,
  type InterfaceLanguage,
} from './utils/interfaceState';
import { useDialogFocus } from './hooks/useDialogFocus';
import { removeItemById, restoreItemAtIndex } from './utils/undoableDeletion';
import { horizontalNavigationDirection, targetConsumesHorizontalNavigation } from './utils/horizontalNavigation';
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatMoney,
  formatPercent,
} from './utils/formatting';
import {
  AccessRestricted,
  BlockMarkers,
  ComparableTable,
  EditableParagraphs,
  PageIntroduction,
  SectionTitle,
  VideoPoster,
  type BlockMarkerState,
} from './features/cartulary/components/CartularyPresentation';
import {
  DeletionDialog,
  MarketHistoryDialog,
  MediaViewerModal,
  SpinViewerModal,
  UndoToast,
  type PendingDeletion,
  type UndoNotice,
} from './features/cartulary/modals/CartularyModals';
import {
  ConditionPage,
  CoverPage,
  MediaPage,
  ReferencePage,
  ValuePage,
} from './features/cartulary/pages/CartularyPages';
import { useCartularyMediaState } from './features/cartulary/state/useCartularyMediaState';
import { useCartularyConditionState } from './features/cartulary/state/useCartularyConditionState';
import { useCartularyOwnerState } from './features/cartulary/state/useCartularyOwnerState';
import { useCartularyValuationState } from './features/cartulary/state/useCartularyValuationState';
import { useCartularyPublicationState } from './features/cartulary/state/useCartularyPublicationState';
import type {
  AssetKind,
  ComparableAnalysisEntry,
  ConditionAttachment,
  ConditionEntry,
  DocumentationCategory,
  DocumentationItem,
  DocumentationState,
  IdentificationCheck,
  MarketDepthState,
  OwnerDocument,
  OwnerField,
  OwnerType,
  PublicationSourceBinding,
  PurchaseExpense,
  StorageLocation,
  TransmissionRecipient,
  WatchPatrimonialStatus,
} from './features/cartulary/state/cartularyStateTypes';
import { isRegistryReturnPath } from './features/registry/registryCatalog';
import {
  normalizeOwnershipHistory,
  ownershipHistorySummary,
  ownershipValuationAssessment,
  type OwnershipHistoryEntry,
} from './domain/ownershipHistory';
import {
  calculateXirr,
  hasMinimumSaleHorizon,
  todayIsoDate,
  type DatedCashFlow,
} from './domain/valuationPerformance';

const Spin360 = lazy(() => import('./components/Spin360.tsx').then((module) => ({ default: module.Spin360 })));
const AuditPanel = lazy(() => import('./components/AuditPanel.tsx').then((module) => ({ default: module.AuditPanel })));

interface PublicationIntent {
  requestId: string;
  destination: PublicationDestination;
  blockId: PublishedBlockId;
  blockLabel: string;
  action: PublicationAction;
  eligibility: PublicationEligibility;
  policy: PublicationPolicyResult;
}

type PopularityResourceType = 'Forum officiel' | 'Discussion dédiée' | 'Communauté' | 'Base de données' | 'Revue';

interface PopularityResource {
  id: string;
  name: string;
  type: PopularityResourceType;
  url: string;
}

interface SpecificationDatum {
  id: string;
  label: string;
  value: string;
}

interface SpecificationGroupData {
  id: string;
  title: string;
  items: SpecificationDatum[];
}

interface EditableCopyData {
  heroSummary: string;
  originParagraphs: string[];
  originKnowledge: string;
  watchDescription: string[];
  conditionSummary: string[];
  conditionFacts: {
    lastCondition: string;
    conclusion: string;
    openPoint: string;
  };
}

const journal = new IntegrityJournal({
  cartularyId: mockCartulary.id,
  storage: cartulariaStorage ?? undefined,
  onUpdate: () => {
    void mirrorCartulariaLocalStorage().catch((error: unknown) => console.error('Miroir local du journal impossible', error));
  },
});
const LOCAL_ACCESS_REQUEST_ID = `access-${globalThis.crypto.randomUUID()}`;

const ASSET_KINDS: AssetKind[] = [
  'Montre',
  'Voiture',
  'Vin',
  'Sculpture',
  'Peinture',
  'Photographie',
  'Meuble',
  'Autre art',
  'Bien immobilier',
  'Autre',
];

const MEDIA_TAGS: Array<{ id: MediaTag; label: string }> = [
  { id: 'main-photo', label: 'Photo principale' },
  { id: 'main-video', label: 'Vidéo principale' },
  { id: 'spin-3d', label: 'Séquence 3D' },
  { id: 'slideshow', label: 'Diaporama' },
  { id: 'accessories', label: 'Accessoires' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'other', label: 'Autres' },
];
const LOCAL_MEDIA_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const creationBrand = activeCreationProfile?.brand || mockCartulary.watchInstance.reference.brand || 'Marque à documenter';
const creationModel = activeCreationProfile?.model || mockCartulary.watchInstance.reference.model || 'Modèle à documenter';
const creationReference = activeCreationProfile?.reference || mockCartulary.watchInstance.reference.reference || 'Référence à documenter';
const creationYear = activeCreationProfile?.manufactureYear ? String(activeCreationProfile.manufactureYear) : 'À documenter';
const creationCaliber = activeCreationProfile?.caliber || 'Calibre à documenter';

const DEFAULT_CHECKS: IdentificationCheck[] = isIwcCartulary ? [
  {
    id: 'dial-tzc',
    title: 'Cadran noir IW3251-001',
    note: 'Mention « TZC » au-dessus de 6 h, chiffres arabes peints et typographie cohérente avec le millésime 2002.',
    checked: true,
  },
  {
    id: 'utc-date',
    title: 'Disque UTC et date',
    note: 'Disque 24 heures visible dans le secteur à 12 h, guichet de date à 3 h et alignement fonctionnel des deux indications.',
    checked: true,
  },
  {
    id: 'case-geometry',
    title: 'Boîtier acier de 39 mm',
    note: 'Diamètre 39 mm, épaisseur 12,2 mm, brossage longitudinal et conservation des fins chanfreins polis des cornes.',
    checked: true,
  },
  {
    id: 'fish-crown',
    title: 'Couronne « poisson »',
    note: 'Gravure poisson attendue sur un exemplaire de 2002 ; une couronne Probus Scafusia signalerait un remplacement ultérieur.',
    checked: true,
  },
  {
    id: 'caliber-tzc',
    title: 'Calibre IWC 37526 et module TZC',
    note: 'Architecture, rotor, numéro de mouvement et fonctionnement du correcteur de fuseau conformes à la génération concernée.',
    checked: false,
  },
  {
    id: 'serial-paperwork',
    title: 'Série et facture du 08.03.2002',
    note: 'Numéro 2715537 cohérent avec la référence IW3251-001, la facture d’origine et la carte de garantie.',
    checked: true,
  },
] : isRolexCartulary ? [
  {
    id: 'dial-long-e',
    title: 'Cadran mat Mark I « Long E »',
    note: 'Typographie du E de ROLEX, couronne fine et marquage SWISS – T < 25 à contrôler sur les vues macro.',
    checked: false,
  },
  {
    id: 'serial-period',
    title: 'Série et millésime 1969',
    note: `Numéro ${mockCartulary.watchInstance.serialNumber || 'à documenter'} à rapprocher de la période de production de la référence 1675.`,
    checked: false,
  },
  {
    id: 'case-geometry',
    title: 'Boîtier et protège-couronne',
    note: 'Géométrie du boîtier, épaisseur des cornes, arêtes et éventuelles reprises de polissage à examiner.',
    checked: false,
  },
  {
    id: 'fuchsia-insert',
    title: 'Insert Pepsi fuchsia',
    note: 'Insert déclaré d’époque ; teinte, typographie, usure et cohérence avec le millésime doivent être revues.',
    checked: false,
  },
  {
    id: 'caliber-1575',
    title: 'Calibre Rolex 1575',
    note: 'Mouvement, pont marqué 1570 le cas échéant, numéro et fonctionnement GMT à confirmer montre ouverte.',
    checked: false,
  },
  {
    id: 'bracelet-jubilee',
    title: 'Bracelet Jubilee',
    note: 'Références de bracelet et d’end-links, date de fermoir, allongement et cohérence avec la montre à documenter.',
    checked: false,
  },
] : [
  {
    id: 'identity-reference',
    title: 'Marque, modèle et référence',
    note: `${creationBrand} ${creationModel} · référence ${creationReference}. À rapprocher des marquages et des documents versés.`,
    checked: false,
  },
  {
    id: 'serial-period',
    title: 'Numéro de série et période',
    note: `Numéro ${mockCartulary.watchInstance.serialNumber || 'à documenter'} et année ${creationYear} à vérifier sur pièces.`,
    checked: false,
  },
  {
    id: 'case-condition',
    title: 'Boîtier et état de conservation',
    note: 'Matériau, dimensions, géométrie et éventuelles reprises de polissage à documenter.',
    checked: false,
  },
  {
    id: 'dial-hands',
    title: 'Cadran, aiguilles et affichages',
    note: 'Configuration, marquages, matière lumineuse et cohérence avec la référence à contrôler.',
    checked: false,
  },
  {
    id: 'movement-caliber',
    title: 'Mouvement et calibre',
    note: `${creationCaliber}. Identification, numéro, état et fonctionnement à confirmer lors d’un contrôle adapté.`,
    checked: false,
  },
  {
    id: 'bracelet-accessories',
    title: 'Bracelet et accessoires',
    note: 'Type, matière, références, état et cohérence avec la montre à documenter.',
    checked: false,
  },
];

const DEFAULT_CONDITION_ENTRIES: ConditionEntry[] = mockCartulary.conditionReports.map((report, index) => ({
  id: report.id,
  date: report.date,
  title: report.title,
  note: report.summary,
  attachments: isIwcCartulary && index === 0
    ? [{ name: 'Rapport_etat_2026-08-08.pdf' }, { name: 'Fiche_controle_fonctionnel.pdf' }]
    : isIwcCartulary
      ? [{ name: 'Revue_visuelle_2024-02-15.pdf' }]
      : [],
}));

const DEFAULT_DOCUMENTATION_ITEMS: DocumentationItem[] = isIwcCartulary ? [
  { id: 'doc-invoice', category: 'Facture', description: 'Facture originale nominative du 08.03.2002, boutique Aldebert à Paris.', state: 'Présent' },
  { id: 'doc-warranty', category: 'Garantie', description: 'Carte de garantie IWC portant la référence et le numéro de série de l’exemplaire.', state: 'Présent' },
  { id: 'doc-box', category: 'Boîte', description: 'Boîte extérieure et écrin IWC associés à la montre.', state: 'Complet' },
  { id: 'doc-manual', category: 'Manuel', description: 'Livret utilisateur et documentation de la fonction UTC.', state: 'À vérifier' },
] : isRolexCartulary ? [
  { id: 'doc-purchase', category: 'Facture', description: `Acquisition du ${activeCreationProfile?.purchaseDate || '23.07.2026'} auprès de ${activeCreationProfile?.seller || 'L’Atelier du Temps'}. Pièce à identifier dans les documents importés.`, state: 'À vérifier' },
  { id: 'doc-seller', category: 'Garantie', description: 'Garantie vendeur de cinq ans déclarée dans le dossier. Étendue et conditions à confirmer.', state: 'À vérifier' },
  { id: 'doc-box', category: 'Boîte', description: 'Boîte et accessoires non confirmés à ce stade.', state: 'À vérifier' },
  { id: 'doc-expertise', category: 'Certificat', description: 'Notes d’expertise et sources de marché importées ; revue humaine requise avant validation.', state: 'À vérifier' },
] : [
  {
    id: 'doc-purchase',
    category: 'Facture',
    description: activeCreationProfile?.purchaseDate || activeCreationProfile?.seller
      ? `Acquisition${activeCreationProfile.purchaseDate ? ` du ${activeCreationProfile.purchaseDate}` : ''}${activeCreationProfile.seller ? ` auprès de ${activeCreationProfile.seller}` : ''}. Pièce justificative à identifier.`
      : 'Facture ou preuve d’acquisition à documenter.',
    state: 'À vérifier',
  },
  { id: 'doc-warranty', category: 'Garantie', description: 'Garantie de la montre à documenter si elle existe.', state: 'À vérifier' },
  { id: 'doc-box', category: 'Boîte', description: 'Boîte et accessoires à inventorier.', state: 'À vérifier' },
  { id: 'doc-expertise', category: 'Certificat', description: 'Certificat, expertise ou rapport de contrôle à documenter.', state: 'À vérifier' },
];

const DEFAULT_OWNER_FIELDS: OwnerField[] = [
  { id: 'owner-last-name', label: 'Nom', value: '' },
  { id: 'owner-first-name', label: 'Prénom', value: '' },
  { id: 'owner-address', label: 'Adresse', value: '' },
  { id: 'owner-email', label: 'Email', value: '' },
  { id: 'owner-phone', label: 'Téléphone', value: '' },
];

const OWNER_DOCUMENT_CATEGORIES: Record<OwnerType, string[]> = {
  'Personne physique': [
    'Carte nationale d’identité',
    'Passeport',
    'Permis de conduire',
    'Titre de séjour',
    'Justificatif de domicile',
    'Acte de naissance',
    'Justificatif d’identifiant fiscal',
    'Autre document d’identification',
  ],
  Entreprise: [
    'Extrait Kbis / registre du commerce',
    'Statuts à jour',
    'Certificat d’immatriculation / d’incorporation',
    'Avis de situation SIRENE',
    'Attestation de TVA / identifiant fiscal',
    'Registre des bénéficiaires effectifs',
    'Pouvoir du représentant légal',
    'Pièce d’identité du représentant légal',
    'Justificatif du siège social',
    'Autre document d’identification de l’entreprise',
  ],
};

const DEFAULT_STORAGE_DESCRIPTION = isIwcCartulary
  ? `${mockCartulary.location.storageType} — ${mockCartulary.location.city}, ${mockCartulary.location.country}. Accès contrôlé et conditions de conservation à documenter.`
  : 'Emplacement, sécurité et conditions de conservation à renseigner par le propriétaire.';

const DEFAULT_RETAINED_VALUE_EXPLANATION = 'Valeur retenue à partir de la valeur actuelle du marché, sous réserve de l’état de la montre, de la complétude de son dossier et du canal de cession.';

const DEFAULT_POPULARITY_RESOURCES: PopularityResource[] = isIwcCartulary ? [
  { id: 'pop-iwc-forum', name: 'IWC Collectors Forum', type: 'Forum officiel', url: 'https://forum.iwc.com/' },
  { id: 'pop-iwc-3251-thread', name: 'IWC Die Fliegeruhr UTC Ref. 3251', type: 'Discussion dédiée', url: 'https://forum.iwc.com/t/iwc-die-fliegeruhr-utc-ref3251/30513/' },
  { id: 'pop-watchbase', name: 'WatchBase · IW3251-01', type: 'Base de données', url: 'https://watchbase.com/iwc/pilot/iw3251-01' },
  { id: 'pop-reddit', name: 'r/IWCschaffhausen', type: 'Communauté', url: 'https://www.reddit.com/r/IWCschaffhausen/' },
  { id: 'pop-timezone', name: 'TimeZone · IWC 3251 Review', type: 'Revue', url: 'https://forums.timezone.com/index.php?goto=594&rid=0&t=tree' },
] : [];

const DEFAULT_EXPENSES: PurchaseExpense[] = isIwcCartulary ? [
  { id: 'revision-2008', kind: 'Révision', date: '2008-05-16', label: 'Révision complète IWC', amount: 620 },
  { id: 'insurance-2026', kind: 'Assurance', date: '2026-08-01', label: 'Prime collection 2026–2027', amount: 180 },
] : [];

const DEFAULT_COMPARABLE_ANALYSIS: ComparableAnalysisEntry[] = isIwcCartulary ? [
  { id: 'analysis-listings', angle: 'Prix affichés', finding: '4 150 €', reading: 'Deux annonces observées ; ce niveau reste un prix demandé et non un prix encaissé.' },
  { id: 'analysis-transactions', angle: 'Prix réalisés', finding: '3 450 €', reading: 'Une transaction observée ; ce point dispose d’une valeur probante supérieure mais l’échantillon reste limité.' },
  { id: 'analysis-gap', angle: 'Écart annonce / transaction', finding: '20,3 %', reading: 'L’écart mesure la prime d’affichage observée. Il doit couvrir la négociation, le délai et les frais de cession.' },
  { id: 'analysis-price-channel', angle: 'Canal de prix', finding: 'Annonce spécialisée', reading: 'Canal à privilégier pour défendre le prix d’un exemplaire complet, avec un délai de commercialisation plus long.' },
  { id: 'analysis-liquidity-channel', angle: 'Canal de liquidité', finding: 'Enchère', reading: 'Exécution plus rapide et prix public, mais résultat plus volatil et frais généralement plus élevés.' },
] : isRolexCartulary ? [
  { id: 'analysis-listings', angle: 'Prix affichés', finding: '16 958 € à 21 774 €', reading: 'Trois annonces 1969 relevées dans le dossier. Ce sont des prix demandés, non des transactions réalisées.' },
  { id: 'analysis-pivot', angle: 'Niveau de travail', finding: '21 000 € à 25 000 €', reading: 'Fourchette de travail pour l’exemplaire déclaré, à revalider après contrôle du cadran, de l’insert, du boîtier et du bracelet.' },
  { id: 'analysis-liquidity', angle: 'Liquidité', finding: 'Marché international', reading: 'La profondeur observée facilite la comparaison, mais la dispersion des configurations vintage impose une sélection stricte.' },
  { id: 'analysis-premium', angle: 'Facteurs de prime', finding: 'Long E · fuchsia · patine', reading: 'Ces caractéristiques ne justifient une prime qu’après confirmation de leur authenticité et de leur cohérence.' },
] : [];

const DEFAULT_SPECIFICATION_GROUPS: SpecificationGroupData[] = [
  {
    id: 'basic', title: 'Données de base', items: [
      ['ad-code', 'Code annonce', `Non applicable · dossier ${mockCartulary.publicCode}`],
      ['brand', 'Marque', mockCartulary.watchInstance.reference.brand],
      ['collection', 'Collection', isRolexCartulary ? 'GMT-Master' : isIwcCartulary ? 'Pilot’s Watches' : 'Collection à documenter'],
      ['model', 'Modèle', mockCartulary.watchInstance.reference.model],
      ['reference', 'Numéro de référence', mockCartulary.watchInstance.reference.reference],
      ['movement', 'Mouvement', isIwcCartulary || isRolexCartulary ? 'Remontage automatique' : 'Type de mouvement à documenter'],
      ['case', 'Boîtier', mockCartulary.watchInstance.reference.material],
      ['bracelet', 'Matière du bracelet', isRolexCartulary ? 'Acier' : isIwcCartulary ? 'Cuir' : 'À documenter'],
      ['year', 'Année de fabrication', activeCreationProfile?.manufactureYear ? String(activeCreationProfile.manufactureYear) : isIwcCartulary ? '2002' : 'À documenter'],
      ['condition', 'État', 'Voir 03 · État de la montre'],
      ['delivered', 'Contenu livré', isRolexCartulary ? 'Montre et bracelet Jubilee · accessoires à documenter' : isIwcCartulary ? 'Montre, boîte, écrin, facture et carte de garantie' : 'Montre et accessoires à inventorier'],
      ['gender', 'Sexe', 'Montre homme / Unisexe'],
      ['location', 'Emplacement', 'Accès restreint'],
      ['price', 'Prix', 'Voir 04 · Valorisation'],
      ['availability', 'Disponibilité', 'Collection privée · non proposée à la vente'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'caliber', title: 'Calibre', items: [
      ['cal-movement', 'Mouvement', isIwcCartulary || isRolexCartulary ? 'Remontage automatique' : 'À documenter'],
      ['caliber', 'Calibre', mockCartulary.watchInstance.reference.caliber],
      ['base-caliber', 'Calibre de base', isRolexCartulary ? 'Rolex 1570 · pont pouvant être marqué 1570' : 'À documenter'],
      ['power-reserve', 'Réserve de marche', mockCartulary.watchInstance.reference.powerReserve],
      ['jewels', 'Nombre de pierres', isRolexCartulary ? '26' : 'À documenter'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'case', title: 'Boîtier', items: [
      ['case-material', 'Boîtier', mockCartulary.watchInstance.reference.material],
      ['diameter', 'Diamètre', isIwcCartulary || isRolexCartulary ? `${mockCartulary.watchInstance.reference.diameter.toFixed(1)} mm` : 'À documenter'],
      ['height', 'Hauteur', isIwcCartulary || isRolexCartulary ? `${mockCartulary.watchInstance.reference.thickness.toFixed(1)} mm` : 'À documenter'],
      ['water', 'Étanche', isIwcCartulary || isRolexCartulary ? mockCartulary.watchInstance.reference.waterResistance : 'À documenter'],
      ['bezel', 'Matériau de la lunette', isRolexCartulary ? 'Insert aluminium Pepsi fuchsia déclaré' : isIwcCartulary ? 'Acier' : 'À documenter'],
      ['crystal', 'Verre', isRolexCartulary ? 'Plexiglas' : isIwcCartulary ? 'Saphir' : 'À documenter'],
      ['dial', 'Cadran', isIwcCartulary || isRolexCartulary ? 'Noir' : 'Couleur et finition à documenter'],
      ['numerals', 'Chiffres du cadran', isRolexCartulary ? 'Index appliqués au tritium' : isIwcCartulary ? 'Arabes' : 'À documenter'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'bracelet', title: 'Bracelet', items: [
      ['strap-material', 'Matière du bracelet', isRolexCartulary ? 'Acier' : isIwcCartulary ? 'Cuir' : 'À documenter'],
      ['strap-color', 'Couleur du bracelet', isRolexCartulary ? 'Acier' : isIwcCartulary ? 'Noir' : 'À documenter'],
      ['clasp', 'Boucle', isRolexCartulary ? 'Boucle déployante Rolex · référence à documenter' : isIwcCartulary ? 'Ardillon IWC' : 'À documenter'],
      ['clasp-material', 'Matière de la boucle', 'Acier'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'functions', title: 'Fonctions', items: [
      ['date', 'Date', isRolexCartulary ? 'Guichet à 3 heures · réglage non rapide' : isIwcCartulary ? 'Guichet à 3 heures' : 'À documenter'],
      ['gmt', 'GMT', isRolexCartulary ? 'Aiguille GMT 24 heures' : isIwcCartulary ? 'Disque UTC 24 heures' : 'À documenter'],
      ['timezone', 'Second fuseau horaire', isRolexCartulary ? 'Lunette bidirectionnelle 24 heures' : isIwcCartulary ? 'Réglage par module TZC' : 'À documenter'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'other', title: 'Autres', items: [
      ['seconds', 'Seconde', isIwcCartulary || isRolexCartulary ? 'Seconde centrale' : 'À documenter'],
      ['crown', 'Couronne', isRolexCartulary ? 'Couronne Rolex déclarée d’origine' : isIwcCartulary ? 'Couronne « poisson »' : 'À documenter'],
      ['caseback', 'Fond', isIwcCartulary || isRolexCartulary ? 'Fond plein vissé' : 'À documenter'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
];

const DEFAULT_EDITABLE_COPY: EditableCopyData = isIwcCartulary ? {
  heroSummary: 'Flieger UTC en acier de 39 mm, acquise neuve en 2002. L’exemplaire conserve son cadran TZC, sa couronne poisson et son ensemble documentaire d’origine.',
  originParagraphs: [
    'La Flieger UTC associe la lisibilité des montres d’aviateur IWC à un disque 24 heures qui conserve l’heure du domicile pendant les déplacements. La génération IW3251 a été introduite en 1998 et sa production s’est poursuivie jusqu’en 2005 environ.',
    'La famille comprend plusieurs variantes documentées : les références 3251-001 et 3251-002 à cadran noir, les versions Spitfire 3251-005 et 3251-007, la rare 3251-009 en platine et la 3251-010 à cadran clair. Le présent exemplaire correspond à la 3251-001, livrée sur cuir et identifiable par la mention « TZC » au-dessus de 6 heures.',
    'IWC n’a pas publié le nombre total de montres produites pour cette génération. L’estimation du volume reste donc à documenter et doit être considérée comme non vérifiée tant qu’une archive de manufacture ou une source de référence n’est pas disponible.',
  ],
  originKnowledge: 'Sur un exemplaire de 2002, la couronne « poisson » est cohérente avec la période. Une couronne « Probus Scafusia » indique généralement un remplacement en service.',
  watchDescription: [
    'Cette IWC Flieger UTC IW3251-001 est une montre d’aviateur automatique en acier de 39 mm, produite en 2002. Son cadran noir à chiffres arabes associe un guichet de date à 3 heures à un disque UTC 24 heures disposé à 12 heures.',
    'L’exemplaire est présenté sur bracelet cuir noir avec boucle ardillon IWC. Sa couronne « poisson », son cadran portant la mention « TZC » et sa configuration générale correspondent à la génération documentée.',
  ],
  conditionSummary: [
    'L’exemplaire est cohérent avec une IWC Flieger UTC IW3251-001 de 2002 et présente un bon niveau de conservation. Le boîtier conserve ses finitions et ses fins chanfreins, sans signe de sur-polissage observé. Le cadran TZC, le disque UTC, le guichet de date et la couronne poisson sont compatibles avec la période.',
    'Les fonctions accessibles ont été contrôlées et sont opérationnelles. Des micro-rayures d’usage sont visibles sur la boucle. La confirmation complète du calibre, du numéro de mouvement et de l’historique de service reste subordonnée à l’examen du mouvement et aux pièces d’atelier disponibles.',
  ],
  conditionFacts: {
    lastCondition: '08/08/2026',
    conclusion: 'Bon état cohérent',
    openPoint: 'Mouvement et service',
  },
} : isRolexCartulary ? {
  heroSummary: activeCreationProfile?.description || 'GMT-Master 1675 de 1969, cadran mat Mark I « Long E », insert Pepsi fuchsia et bracelet Jubilee.',
  originParagraphs: [
    'La GMT-Master référence 1675 appartient à la génération vintage produite par Rolex de la fin des années 1950 au début des années 1980. Son aiguille 24 heures et sa lunette graduée permettent la lecture d’un second fuseau horaire.',
    'Le présent dossier décrit un exemplaire de 1969 avec cadran mat Mark I dit « Long E ». Cette qualification repose sur la typographie du mot ROLEX et doit être confirmée sur les vues macro versées au Cartulaire.',
    'L’insert Pepsi à décoloration fuchsia, le tritium à patine coquille d’œuf et le bracelet Jubilee sont déclarés dans les pièces sources. Leur période, leur authenticité et leur association à l’exemplaire restent soumises à revue.',
  ],
  originKnowledge: 'Sur une 1675 vintage, la valeur dépend fortement du cadran, de l’insert, de la géométrie du boîtier, du mouvement et de la cohérence du bracelet. Toute conclusion doit être rattachée à une preuve datée.',
  watchDescription: [
    activeCreationProfile?.description || 'Rolex GMT-Master réf. 1675 de 1969 en acier, cadran mat Mark I « Long E », aiguille GMT et insert Pepsi fuchsia déclaré.',
    'L’exemplaire porte le numéro de série 1 982 530 et est présenté sur bracelet Jubilee déclaré d’origine. Le calibre indiqué au dossier est le Rolex 1575.',
  ],
  conditionSummary: [
    activeCreationProfile?.conditionSummary || 'L’état a été déclaré lors de la création du Cartulaire et n’a pas encore été confirmé par une revue indépendante.',
    'Points ouverts : authenticité et période du cadran et de l’insert, niveau de polissage du boîtier, références du bracelet, inspection du mouvement et contrôle d’étanchéité.',
  ],
  conditionFacts: {
    lastCondition: 'À revoir',
    conclusion: 'État déclaré · non validé',
    openPoint: 'Authenticité et configuration',
  },
} : {
  heroSummary: activeCreationProfile?.description
    || `${creationBrand} ${creationModel}, référence ${creationReference}. Dossier créé depuis le Registre et à compléter sur pièces.`,
  originParagraphs: [
    `Ce Cartulaire concerne une ${creationBrand} ${creationModel}, référence ${creationReference}. L’historique du modèle reste à documenter à partir de sources identifiées.`,
    `Les caractéristiques de la référence et de l’exemplaire ne sont pas présumées. Chaque information doit être rapprochée d’une photographie, d’un document, d’une expertise ou d’une source datée.`,
  ],
  originKnowledge: 'Les données saisies lors de la création sont déclaratives. Elles doivent être confirmées avant toute diffusion ou conclusion sur l’authenticité, l’état ou la valeur.',
  watchDescription: [
    activeCreationProfile?.description
      || `${creationBrand} ${creationModel}, référence ${creationReference}, année ${creationYear}.`,
    `Calibre indiqué : ${creationCaliber}. Numéro de série : ${mockCartulary.watchInstance.serialNumber || 'à documenter'}. Configuration et accessoires à inventorier.`,
  ],
  conditionSummary: [
    activeCreationProfile?.conditionSummary || 'L’état de la montre est à documenter par une revue visuelle et, si nécessaire, un contrôle technique.',
    'Points ouverts : identité de l’exemplaire, configuration, état du boîtier et du bracelet, mouvement, fonctionnement et étanchéité.',
  ],
  conditionFacts: {
    lastCondition: 'À documenter',
    conclusion: 'Revue requise',
    openPoint: 'Identification et état',
  },
};

const DEFAULT_SENSITIVITY_PRICES = isIwcCartulary
  ? [3200, 3600, 4000, 4400, 4800]
  : [
      mockCartulary.marketSnapshot.lowValue,
      Math.round((mockCartulary.marketSnapshot.lowValue + mockCartulary.marketSnapshot.midValue) / 2),
      mockCartulary.marketSnapshot.midValue,
      Math.round((mockCartulary.marketSnapshot.midValue + mockCartulary.marketSnapshot.highValue) / 2),
      mockCartulary.marketSnapshot.highValue,
    ];
const DEFAULT_SENSITIVITY_COSTS = [0, 5, 10, 15, 20];

const pageFromHash = (): CartularyPage => {
  return cartularyPageFromHash(window.location.hash);
};

const publishedBlocksFromUrl = (): PublishedBlockId[] | null => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('blocks')) return null;
  const requested = params.get('blocks')?.split(',').filter(Boolean) || [];
  return requested.filter((block): block is PublishedBlockId => PUBLISHED_BLOCK_IDS.includes(block as PublishedBlockId));
};

const publicCodeFromUrl = (): string | null => {
  const value = new URLSearchParams(window.location.search).get('publicCode');
  return value && /^[A-Za-z0-9_-]{6,64}$/.test(value) ? value : null;
};

const readStored = <T,>(key: string, fallback: T): T => {
  return readValidatedStoredJson({
    storage: cartulariaStorage,
    key,
    fallback,
    onRepair: ({ reason }) => console.warn(`État persistant réparé pour ${key} (${reason}).`),
  });
};

const loadMarketDepth = (): MarketDepthState => ({
  analysisDate: mockCartulary.marketSnapshot.date,
  activeListings: mockCartulary.marketSnapshot.activeListings,
  transactions12m: mockCartulary.marketSnapshot.observedTransactions90d,
  medianDaysOnMarket: mockCartulary.marketSnapshot.medianDaysOnMarket,
  lowValue: mockCartulary.marketSnapshot.lowValue,
  midValue: mockCartulary.marketSnapshot.midValue,
  highValue: mockCartulary.marketSnapshot.highValue,
  ...readStored<Partial<MarketDepthState>>('cartularia-market-depth', {}),
});

const loadStorageLocations = (): StorageLocation[] => {
  const stored = readStored<StorageLocation[] | null>('cartularia-storage-locations', null);
  if (stored) return stored;

  const legacyDescription = readStored('cartularia-storage-description', DEFAULT_STORAGE_DESCRIPTION);
  return [{
    id: 'storage-main',
    name: isIwcCartulary
      ? `${mockCartulary.location.storageType} — ${mockCartulary.location.city}, ${mockCartulary.location.country}`
      : 'Emplacement privé à documenter',
    contents: 'Montre',
    description: legacyDescription,
  }];
};

const loadConditionEntries = (): ConditionEntry[] => readStored(
  'cartularia-condition-entries',
  DEFAULT_CONDITION_ENTRIES,
).map((entry) => ({
  ...entry,
  title: entry.title === 'Revue visuelle antérieure' ? 'Revues antérieures' : entry.title,
  attachments: entry.attachments.map((attachment) => ({
    ...attachment,
    url: attachment.url?.startsWith('blob:') ? undefined : attachment.url,
  })),
}));

const loadPublishedBlocks = (): PublishedBlockId[] => {
  const stored = readStored<string[]>(
    'cartularia-published-blocks',
    ['media-hero', 'media-slideshow', 'reference-history', 'reference-specs'],
  );
  const migrated = stored.flatMap((blockId) => {
    if (blockId === 'condition-reports') return ['condition-reference-report', 'condition-prior-reviews'];
    if (blockId === 'value-comparables') return ['value-comparables-listings', 'value-comparables-transactions', 'value-comparables-analysis'];
    return [blockId];
  });
  return [...new Set(migrated.filter((blockId): blockId is PublishedBlockId =>
    PUBLISHED_BLOCK_IDS.includes(blockId as PublishedBlockId)))];
};

const loadReportBlocks = (): PublishedBlockId[] => {
  const stored = readStored<string[]>('cartularia-report-blocks', []);
  return [...new Set(stored.flatMap((blockId) => blockId === 'value-comparables'
    ? ['value-comparables-listings', 'value-comparables-transactions', 'value-comparables-analysis']
    : [blockId]).filter((blockId): blockId is PublishedBlockId =>
    PUBLISHED_BLOCK_IDS.includes(blockId as PublishedBlockId)))];
};

const loadCommunityBlocks = (): PublishedBlockId[] => {
  const stored = readStored<string[]>('cartularia-community-blocks', []);
  return [...new Set(stored.flatMap((blockId) => {
    if (blockId === 'condition-reports') return ['condition-reference-report', 'condition-prior-reviews'];
    if (blockId === 'value-comparables') return ['value-comparables-listings', 'value-comparables-transactions', 'value-comparables-analysis'];
    return [blockId];
  }).filter((blockId): blockId is PublishedBlockId =>
    PUBLISHED_BLOCK_IDS.includes(blockId as PublishedBlockId)))];
};

const loadPublicationDecisions = (): PublicationDecision[] => {
  const stored = readStored<PublicationDecision[]>('cartularia-publication-decisions-v1', []);
  return stored.filter((decision) => (
    decision
    && typeof decision.requestId === 'string'
    && ['website', 'report', 'community'].includes(decision.destination)
    && PUBLISHED_BLOCK_IDS.includes(decision.blockId)
    && ['activate', 'validate', 'revoke'].includes(decision.action)
    && decision.status === 'confirmed'
    && decision.decisionSource === 'human_confirmed'
    && typeof decision.sourceDigest === 'string'
    && Array.isArray(decision.prerequisites)
  ));
};

const loadPublicationSourceBinding = (): PublicationSourceBinding => {
  const stored = readStored<Partial<PublicationSourceBinding>>('cartularia-publication-source-v1', {});
  return {
    revision: Number.isInteger(stored.revision) && Number(stored.revision) >= 0 ? Number(stored.revision) : 0,
    digest: typeof stored.digest === 'string' ? stored.digest : '',
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : '',
  };
};

const loadSpecificationGroups = (): SpecificationGroupData[] => {
  const stored = readStored<SpecificationGroupData[] | null>('cartularia-specification-groups', null);
  if (stored?.length) {
    if (!isIwcCartulary) {
      const storedValues = new Map(stored.flatMap((group) => group.items || []).map((item) => [item.id, item.value]));
      return DEFAULT_SPECIFICATION_GROUPS.map((group) => ({
        ...group,
        items: group.items.map((item) => ({ ...item, value: storedValues.get(item.id) || item.value })),
      }));
    }
    return stored.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ ...item, value: item.value === 'Voir 04 · Valeur' ? 'Voir 04 · Valorisation' : item.value })),
    }));
  }
  const legacy = readStored<Record<string, string> | null>('cartularia-basic-watch-data', null);
  if (!legacy) return DEFAULT_SPECIFICATION_GROUPS;
  const legacyMap: Record<string, string> = {
    'ad-code': legacy.adCode, brand: legacy.brand, collection: legacy.collection, model: legacy.model,
    reference: legacy.reference, movement: legacy.movement, case: legacy.caseMaterial,
    bracelet: legacy.braceletMaterial, year: legacy.productionYear, condition: legacy.condition,
    delivered: legacy.deliveredContent, gender: legacy.gender, location: legacy.location,
    price: legacy.price, availability: legacy.availability,
  };
  return DEFAULT_SPECIFICATION_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, value: legacyMap[item.id] ?? item.value })),
  }));
};

const loadEditableCopy = (): EditableCopyData => {
  const stored = readStored<Partial<EditableCopyData> | null>('cartularia-editable-copy', null);
  if (!stored) return DEFAULT_EDITABLE_COPY;

  return {
    ...DEFAULT_EDITABLE_COPY,
    ...stored,
    originParagraphs: stored.originParagraphs ?? DEFAULT_EDITABLE_COPY.originParagraphs,
    watchDescription: stored.watchDescription ?? DEFAULT_EDITABLE_COPY.watchDescription,
    conditionSummary: stored.conditionSummary ?? DEFAULT_EDITABLE_COPY.conditionSummary,
    conditionFacts: {
      ...DEFAULT_EDITABLE_COPY.conditionFacts,
      ...(stored.conditionFacts ?? {}),
    },
  };
};

const loadOwnerDocuments = (): OwnerDocument[] => readStored<OwnerDocument[]>(
  'cartularia-owner-documents',
  [],
).map((document) => ({
  ...document,
  url: document.url?.startsWith('blob:') ? undefined : document.url,
}));

const LEGACY_TAGS: Record<string, MediaTag> = {
  '1-main-photo': 'main-photo',
  '2-main-video': 'main-video',
  '3-spin-3d': 'spin-3d',
  '4-presentation': 'slideshow',
  '5-technical-photo': 'slideshow',
  '6-technical-video': 'slideshow',
  '7-accessories': 'accessories',
  '8-documentation': 'documentation',
};

const normalizeMediaTags = (tags: unknown): MediaTag[] => {
  if (!Array.isArray(tags)) return [];
  const currentIds = new Set(MEDIA_TAGS.map((tag) => tag.id));
  return [...new Set(tags.map((tag) => currentIds.has(tag as MediaTag)
    ? tag as MediaTag
    : LEGACY_TAGS[String(tag)]).filter((tag): tag is MediaTag => Boolean(tag)))];
};

const loadMediaAssets = (): Asset[] => {
  const current = readStored<Asset[] | null>('cartularia-media-assets-v3', null);
  if (current) return current.map((asset) => ({
    ...asset,
    name: asset.name || asset.originalFileName || 'Média importé',
    url: asset.binaryId && (!asset.url || asset.url.startsWith('blob:')) ? LOCAL_MEDIA_PLACEHOLDER : asset.url,
    hash: asset.hash || '',
    status: asset.status || 'Archived',
    visibility: asset.visibility || 'Secret',
    tags: normalizeMediaTags(asset.tags),
    metadataTimestamp: asset.metadataTimestamp ?? asset.capturedAt,
    localAvailability: asset.binaryId ? 'missing' : asset.localAvailability,
    derivativeStatus: asset.derivativeStatus || 'not-required',
  }));
  const saved = readStored<Array<{ id: string; tags: unknown }>>('cartularia-media-tags-v2', []);
  return mockCartulary.assets.map((asset) => {
    const storedTags = saved.find((item) => item.id === asset.id)?.tags;
    const capturedAt = asset.capturedAt || '2026-08-08';
    return {
      ...asset,
      tags: normalizeMediaTags(storedTags ?? asset.tags),
      metadataTimestamp: asset.metadataTimestamp ?? (/^\d{4}-\d{2}-\d{2}$/.test(capturedAt)
        ? `${capturedAt}T12:00:00+02:00`
        : capturedAt),
      timestampSource: asset.timestampSource ?? 'catalogue',
    };
  });
};

const digestFile = async (file: File) => {
  const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const persistJson = (key: string, value: unknown) => {
  void persistCartulariaJson(key, value).catch((error: unknown) => console.error(`Persistance impossible pour ${key}`, error));
};

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
function App() {
  const isWatchWebsite = window.location.pathname.replace(/\/$/, '') === '/watch-website';
  const routeParameters = new URLSearchParams(window.location.search);
  const hasPublicCodeParameter = routeParameters.has('publicCode');
  const requestedRegistryReturn = routeParameters.get('returnTo');
  const registryReturnHref = isRegistryReturnPath(requestedRegistryReturn) ? requestedRegistryReturn : null;
  const requestedPublicCode = publicCodeFromUrl();
  const invalidPublicCode = hasPublicCodeParameter && !requestedPublicCode;
  useEffect(() => {
    if (!isWatchWebsite) {
      const reference = mockCartulary.watchInstance.reference;
      document.title = `Cartulaire ${reference.brand} ${reference.model} · Cartularia`;
    }
  }, [isWatchWebsite]);
  const [language, setLanguage] = useState<InterfaceLanguage>(() => normalizeInterfaceLanguage(
    readStored<unknown>(INTERFACE_LANGUAGE_STORAGE_KEY, 'FR'),
  ));
  const [audience, setAudience] = useState<VisibilityLevel>(() => normalizeAudience(
    readStored<unknown>(AUDIENCE_STORAGE_KEY, 'Secret'),
  ));
  const [activePage, setActivePage] = useState<CartularyPage>(pageFromHash);
  const [eventTrigger, setEventTrigger] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSpinOpen, setIsSpinOpen] = useState(false);
  const [isMarketHistoryEditorOpen, setIsMarketHistoryEditorOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [undoNotice, setUndoNotice] = useState<UndoNotice | null>(null);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [fileImportError, setFileImportError] = useState<string | null>(null);
  const [isDeletingItem, setIsDeletingItem] = useState(false);
  const [editingBlock, setEditingBlock] = useState<PublishedBlockId | null>(null);
  const mediaState = useCartularyMediaState({ loadAssets: loadMediaAssets });
  const { mediaAssets, reloadMediaState, commands: mediaCommands } = mediaState;
  const setMediaAssets = mediaCommands.replaceAssets;
  const [mediaUploadTags, setMediaUploadTags] = useState<MediaTag[]>([]);
  const [isEditingChecks, setIsEditingChecks] = useState(false);
  const conditionState = useCartularyConditionState({
    loadChecks: () => readStored('cartularia-identification-checks', DEFAULT_CHECKS),
    loadEntries: loadConditionEntries,
    loadDocumentation: () => readStored('cartularia-documentation-items', DEFAULT_DOCUMENTATION_ITEMS),
  });
  const { identificationChecks, conditionEntries, documentationItems, reloadConditionState, commands: conditionCommands } = conditionState;
  const setIdentificationChecks = conditionCommands.replaceChecks;
  const setConditionEntries = conditionCommands.replaceEntries;
  const setDocumentationItems = conditionCommands.replaceDocumentation;
  const ownerState = useCartularyOwnerState({
    loadFields: () => readStored('cartularia-owner-fields', DEFAULT_OWNER_FIELDS),
    loadType: () => readStored<OwnerType>('cartularia-owner-type', 'Personne physique'),
    loadDocuments: loadOwnerDocuments,
    loadHistory: () => normalizeOwnershipHistory(readStored<unknown>('cartularia-ownership-history', [])),
    loadAssetKind: () => readStored<AssetKind>('cartularia-asset-kind', 'Montre'),
    loadWatchStatus: () => readStored<WatchPatrimonialStatus>('cartularia-watch-status', 'Patrimonial'),
    loadRecipients: () => readStored<TransmissionRecipient[]>('cartularia-transmission-recipients', []),
    loadLocations: loadStorageLocations,
  });
  const {
    ownerFields, ownerType, ownerDocuments, ownershipHistory, assetKind, watchStatus,
    transmissionRecipients, storageLocations, reloadOwnerState, commands: ownerCommands,
  } = ownerState;
  const setOwnerFields = ownerCommands.replaceFields;
  const setOwnerType = ownerCommands.setOwnerType;
  const setOwnerDocuments = ownerCommands.replaceDocuments;
  const setOwnershipHistory = ownerCommands.replaceHistory;
  const setAssetKind = ownerCommands.setAssetKind;
  const setWatchStatus = ownerCommands.setWatchStatus;
  const setTransmissionRecipients = ownerCommands.replaceRecipients;
  const setStorageLocations = ownerCommands.replaceLocations;
  const valuationState = useCartularyValuationState({
    loadMarketHistory: () => readStored('cartularia-market-history', mockCartulary.watchInstance.valuations),
    loadMarketDepth,
    loadComparables: () => readStored('cartularia-comparables', mockCartulary.comparables),
    loadComparableAnalysis: () => readStored('cartularia-comparable-analysis', DEFAULT_COMPARABLE_ANALYSIS),
    loadSensitivityPrices: () => readStored('cartularia-sensitivity-prices', DEFAULT_SENSITIVITY_PRICES),
    loadSensitivityCosts: () => readStored('cartularia-sensitivity-costs', DEFAULT_SENSITIVITY_COSTS),
    loadRetainedValuation: () => readStored('cartularia-retained-valuation', {
      amount: mockCartulary.marketSnapshot.midValue,
      explanation: DEFAULT_RETAINED_VALUE_EXPLANATION,
    }),
    loadPurchase: () => readStored('cartularia-purchase', {
      date: mockCartulary.watchInstance.acquisitionDate,
      purchasePrice: mockCartulary.watchInstance.acquisitionPrice ?? 0,
    }),
    loadPurchaseExpenses: () => readStored('cartularia-purchase-expenses', DEFAULT_EXPENSES),
    loadExitAssumptions: () => readStored('cartularia-exit-assumptions', {
      saleDate: todayIsoDate(),
      salePrice: mockCartulary.marketSnapshot.midValue,
      disposalCostPct: 10,
    }),
  });
  const {
    marketHistory, marketDepth, comparables, comparableAnalysis, sensitivityPrices,
    sensitivityCosts, retainedValuation, purchase, purchaseExpenses, exitAssumptions,
    reloadValuationState, commands: valuationCommands,
  } = valuationState;
  const setMarketHistory = valuationCommands.replaceMarketHistory;
  const setMarketDepth = valuationCommands.setMarketDepth;
  const setComparables = valuationCommands.replaceComparables;
  const setComparableAnalysis = valuationCommands.replaceComparableAnalysis;
  const setSensitivityPrices = valuationCommands.setSensitivityPrices;
  const setSensitivityCosts = valuationCommands.setSensitivityCosts;
  const setRetainedValuation = valuationCommands.setRetainedValuation;
  const setPurchase = valuationCommands.setPurchase;
  const setPurchaseExpenses = valuationCommands.replacePurchaseExpenses;
  const setExitAssumptions = valuationCommands.setExitAssumptions;
  const [popularityResources, setPopularityResources] = useState<PopularityResource[]>(() =>
    readStored('cartularia-popularity-resources', DEFAULT_POPULARITY_RESOURCES),
  );
  const publicationState = useCartularyPublicationState({
    loadWebsiteBlocks: loadPublishedBlocks,
    loadReportBlocks,
    loadCommunityBlocks,
    loadDecisions: loadPublicationDecisions,
    loadSourceBinding: loadPublicationSourceBinding,
  });
  const {
    publishedBlocks, reportBlocks, communityBlocks, publicationDecisions,
    publicationSourceBinding, reloadPublicationState, commands: publicationCommands,
  } = publicationState;
  const setPublishedBlocks = publicationCommands.replaceWebsiteBlocks;
  const setReportBlocks = publicationCommands.replaceReportBlocks;
  const setCommunityBlocks = publicationCommands.replaceCommunityBlocks;
  const setPublicationDecisions = publicationCommands.replaceDecisions;
  const setPublicationSourceBinding = publicationCommands.setSourceBinding;
  const [publicationIntent, setPublicationIntent] = useState<PublicationIntent | null>(null);
  const [publicationAcknowledged, setPublicationAcknowledged] = useState(false);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [isPublicationSubmitting, setIsPublicationSubmitting] = useState(false);
  const [publicationSourceDigest, setPublicationSourceDigest] = useState('');
  const publicationSourceSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const publicationSubmissionRef = useRef(false);
  const publicationDialogOpenedAtRef = useRef(0);
  const [specificationGroups, setSpecificationGroups] = useState<SpecificationGroupData[]>(loadSpecificationGroups);
  const [editableCopy, setEditableCopy] = useState<EditableCopyData>(loadEditableCopy);
  const [cloudRefreshVersion, setCloudRefreshVersion] = useState(0);
  const [publicProjection, setPublicProjection] = useState<LoadedPublicProjection | null>(null);
  const [publicProjectionLoading, setPublicProjectionLoading] = useState(Boolean(isWatchWebsite && requestedPublicCode));
  const [publicProjectionError, setPublicProjectionError] = useState<string | null>(null);
  const persistence = useHybridPersistence(mockCartulary.id);
  const drawerRef = useRef<HTMLElement>(null);
  const publicationDialogRef = useRef<HTMLDivElement>(null);
  const deletionDialogRef = useRef<HTMLDivElement>(null);
  const marketHistoryDialogRef = useRef<HTMLDivElement>(null);
  const spinDialogRef = useRef<HTMLDivElement>(null);
  const mediaDialogRef = useRef<HTMLDivElement>(null);

  useDialogFocus(isDrawerOpen, drawerRef, () => setIsDrawerOpen(false));
  useDialogFocus(Boolean(publicationIntent), publicationDialogRef, () => {
    if (isPublicationSubmitting) return;
    setPublicationIntent(null);
    setPublicationAcknowledged(false);
    setPublicationError(null);
  });
  useDialogFocus(Boolean(pendingDeletion), deletionDialogRef, () => {
    if (!isDeletingItem) setPendingDeletion(null);
  });
  useDialogFocus(isMarketHistoryEditorOpen, marketHistoryDialogRef, () => setIsMarketHistoryEditorOpen(false));
  useDialogFocus(isSpinOpen, spinDialogRef, () => setIsSpinOpen(false));
  useDialogFocus(Boolean(selectedAsset), mediaDialogRef, () => setSelectedAsset(null));

  useEffect(() => {
    const handleCloudPull = (event: Event) => {
      const detail = (event as CustomEvent<CloudPullAppliedDetail>).detail;
      if (!detail || detail.cartularyId !== mockCartulary.id) return;
      const keys = new Set(detail.stateKeys);
      if (keys.has(INTERFACE_LANGUAGE_STORAGE_KEY)) setLanguage(normalizeInterfaceLanguage(readStored(INTERFACE_LANGUAGE_STORAGE_KEY, 'FR')));
      if (keys.has(AUDIENCE_STORAGE_KEY)) setAudience(normalizeAudience(readStored(AUDIENCE_STORAGE_KEY, 'Secret')));
      reloadMediaState(keys);
      reloadConditionState(keys);
      reloadOwnerState(keys);
      reloadValuationState(keys);
      reloadPublicationState(keys);
      if (keys.has('cartularia-popularity-resources')) setPopularityResources(readStored('cartularia-popularity-resources', DEFAULT_POPULARITY_RESOURCES));
      if (keys.has('cartularia-specification-groups')) setSpecificationGroups(loadSpecificationGroups());
      if (keys.has('cartularia-editable-copy')) setEditableCopy(loadEditableCopy());
      if (detail.binaryIds.length > 0 || keys.has('cartularia-media-assets-v3') || keys.has('cartularia-owner-documents') || keys.has('cartularia-condition-entries')) {
        setCloudRefreshVersion((current) => current + 1);
      }
    };
    window.addEventListener(CLOUD_PULL_APPLIED_EVENT, handleCloudPull);
    return () => window.removeEventListener(CLOUD_PULL_APPLIED_EVENT, handleCloudPull);
  }, [reloadConditionState, reloadMediaState, reloadOwnerState, reloadPublicationState, reloadValuationState]);
  const publicationSourceSnapshot = useMemo<Record<string, unknown>>(() => ({
    identity: {
      assetKind,
      watchStatus,
      ownerType,
      ownerFields,
      ownerDocuments: ownerDocuments.map(({ id, category, fileName, size, type, binaryId, sha256 }) => ({ id, category, fileName, size, type, binaryId: binaryId ?? null, sha256: sha256 ?? null })),
      ownershipHistory,
      transmissionRecipients,
      storageLocations,
    },
    media: mediaAssets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      originalFileName: asset.originalFileName ?? null,
      type: asset.type,
      hash: asset.hash,
      status: asset.status,
      visibility: asset.visibility,
      tags: asset.tags,
      category: asset.category ?? null,
      description: asset.description ?? null,
      capturedAt: asset.capturedAt ?? null,
      metadataTimestamp: asset.metadataTimestamp ?? null,
      timestampSource: asset.timestampSource ?? null,
      fileSize: asset.fileSize ?? null,
      mimeType: asset.mimeType ?? null,
      binaryId: asset.binaryId ?? null,
      derivativeStatus: asset.derivativeStatus ?? null,
    })),
    reference: { specificationGroups, identificationChecks, popularityResources, editableCopy },
    condition: {
      conditionEntries: conditionEntries.map((entry) => ({
        ...entry,
        attachments: entry.attachments.map(({ url: _url, ...attachment }) => attachment),
      })),
      documentationItems,
    },
    value: {
      marketHistory,
      marketDepth,
      comparables,
      comparableAnalysis,
      sensitivityPrices,
      sensitivityCosts,
      retainedValuation,
      purchase,
      purchaseExpenses,
      exitAssumptions,
    },
  }), [
    assetKind,
    watchStatus,
    ownerType,
    ownerFields,
    ownerDocuments,
    ownershipHistory,
    transmissionRecipients,
    storageLocations,
    mediaAssets,
    specificationGroups,
    identificationChecks,
    popularityResources,
    editableCopy,
    conditionEntries,
    documentationItems,
    marketHistory,
    marketDepth,
    comparables,
    comparableAnalysis,
    sensitivityPrices,
    sensitivityCosts,
    retainedValuation,
    purchase,
    purchaseExpenses,
    exitAssumptions,
  ]);
  const effectivePublicationSourceDigest = publicationSourceSnapshotRef.current === publicationSourceSnapshot
    && publicationSourceBinding.digest === publicationSourceDigest
    ? publicationSourceDigest
    : '';
  const effectivePublicationSourceRevision = effectivePublicationSourceDigest ? publicationSourceBinding.revision : 0;
  const integritySnapshot = useMemo<Record<string, unknown>>(() => ({
    ...publicationSourceSnapshot,
    publication: {
      selected: {
        website: [...publishedBlocks].sort(),
        report: [...reportBlocks].sort(),
        community: [...communityBlocks].sort(),
      },
      sourceBinding: publicationSourceBinding,
      decisions: [...publicationDecisions].sort((left, right) => left.requestId.localeCompare(right.requestId)),
    },
  }), [publicationSourceSnapshot, publishedBlocks, reportBlocks, communityBlocks, publicationDecisions, publicationSourceBinding]);

  useEffect(() => {
    let active = true;
    setPublicationSourceDigest('');
    void computeHash(publicationSourceSnapshot).then((digest) => {
      if (!active) return;
      publicationSourceSnapshotRef.current = publicationSourceSnapshot;
      setPublicationSourceBinding((current) => current.digest === digest ? current : {
        revision: current.revision + 1,
        digest,
        updatedAt: new Date().toISOString(),
      });
      setPublicationSourceDigest(digest);
    }).catch((error: unknown) => console.error('Empreinte de publication impossible', error));
    return () => {
      active = false;
    };
  }, [publicationSourceSnapshot, setPublicationSourceBinding]);

  useEffect(() => {
    if (window.location.pathname.replace(/\/$/, '') === '/watch-website') return;
    const handleHash = () => {
      const page = pageFromHash();
      if (window.location.hash !== `#${page}`) window.history.replaceState(null, '', `#${page}`);
      setActivePage(page);
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === 'FR' ? 'fr' : 'en';
    persistJson(INTERFACE_LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    persistJson(AUDIENCE_STORAGE_KEY, audience);
    if (audience !== 'Secret') {
      setEditingBlock(null);
      setIsEditingChecks(false);
      setIsMarketHistoryEditorOpen(false);
    }
  }, [audience]);

  useEffect(() => {
    if (!isWatchWebsite || !requestedPublicCode) return;
    let active = true;
    setPublicProjectionLoading(true);
    setPublicProjectionError(null);
    loadPublicProjection(requestedPublicCode)
      .then((projection) => {
        if (!active) return;
        setPublicProjection(projection);
        if (!projection) setPublicProjectionError('Publication absente ou révoquée.');
      })
      .catch(() => {
        if (!active) return;
        setPublicProjection(null);
        setPublicProjectionError('Publication indisponible.');
      })
      .finally(() => {
        if (active) setPublicProjectionLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isWatchWebsite, requestedPublicCode]);

  useEffect(() => () => {
    publicProjection?.blocks.forEach((block) => block.assets.forEach((asset) => {
      if (asset.downloadUrl?.startsWith('blob:')) URL.revokeObjectURL(asset.downloadUrl);
    }));
  }, [publicProjection]);

  useEffect(() => {
    journal
      .logEvent(
        'ACCESS_CARTULARY',
        audience === 'Secret' ? 'Propriétaire' : `Visiteur_${audience}`,
        `Consultation du Cartulaire avec le filtre d'audience: ${audience}`,
        {
          requestId: `${LOCAL_ACCESS_REQUEST_ID}-${audience}`,
          resource: { type: 'cartulary_access', id: mockCartulary.id },
        },
      )
      .then(() => setEventTrigger((previous) => previous + 1));
  }, [audience]);

  useEffect(() => {
    if (!undoNotice) return;
    const timeout = window.setTimeout(() => {
      setUndoNotice((current) => {
        if (current?.id !== undoNotice.id) return current;
        void current.onExpire?.();
        return null;
      });
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [undoNotice]);

  useEffect(() => {
    const resizeTextarea = (textarea: HTMLTextAreaElement) => {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(44, textarea.scrollHeight)}px`;
    };
    const resizeAll = () => document.querySelectorAll('textarea').forEach((textarea) => resizeTextarea(textarea));
    const frame = window.requestAnimationFrame(resizeAll);
    const handleInput = (event: Event) => {
      if (event.target instanceof HTMLTextAreaElement) resizeTextarea(event.target);
    };
    document.addEventListener('input', handleInput);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('input', handleInput);
    };
  });

  useEffect(() => {
    if (!cartulariaLocalVault) return;
    const vault = cartulariaLocalVault;
    let active = true;
    const createdUrls = new Set<string>();
    const hydrateBinary = async (binaryId?: string) => {
      if (!binaryId) return undefined;
      const record = await vault.getBinary(binaryId);
      if (!record?.blob || record.deleted) return undefined;
      const url = URL.createObjectURL(record.blob);
      if (!active) {
        URL.revokeObjectURL(url);
        return undefined;
      }
      createdUrls.add(url);
      return { record, url };
    };

    void Promise.all(mediaAssets.map(async (asset) => {
      if (!asset.binaryId || (asset.url && asset.url !== LOCAL_MEDIA_PLACEHOLDER)) return asset;
      const hydrated = await hydrateBinary(asset.binaryId);
      return {
        ...asset,
        url: hydrated?.url ?? '',
        hash: asset.hash || hydrated?.record.sha256 || '',
        mimeType: asset.mimeType || hydrated?.record.mimeType,
        fileSize: asset.fileSize || (hydrated ? formatFileSize(hydrated.record.size) : undefined),
        localAvailability: hydrated ? 'available' as const : 'missing' as const,
      };
    })).then((hydrated) => active && setMediaAssets(hydrated));

    void Promise.all(ownerDocuments.map(async (document) => {
      if (!document.binaryId || document.url) return document;
      return { ...document, url: (await hydrateBinary(document.binaryId))?.url };
    })).then((hydrated) => active && setOwnerDocuments(hydrated));

    void Promise.all(conditionEntries.map(async (entry) => ({
      ...entry,
      attachments: await Promise.all(entry.attachments.map(async (attachment) => (
        !attachment.binaryId || attachment.url
          ? attachment
          : { ...attachment, url: (await hydrateBinary(attachment.binaryId))?.url }
      ))),
    }))).then((hydrated) => active && setConditionEntries(hydrated));

    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
    // A remote pull increments cloudRefreshVersion so only media object URLs are rehydrated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudRefreshVersion]);

  useEffect(() => {
    setSelectedAsset((current) => current ? mediaAssets.find((asset) => asset.id === current.id) ?? null : null);
  }, [mediaAssets]);

  useEffect(() => {
    persistJson('cartularia-popularity-resources', popularityResources);
  }, [popularityResources]);

  useEffect(() => {
    persistJson('cartularia-specification-groups', specificationGroups);
  }, [specificationGroups]);

  useEffect(() => {
    persistJson('cartularia-editable-copy', editableCopy);
  }, [editableCopy]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void journal.reconcileSnapshot(integritySnapshot).then((event) => {
        if (event) setEventTrigger((previous) => previous + 1);
      }).catch((error: unknown) => console.error("Échec de la révision d’intégrité", error));
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [integritySnapshot]);

  const watch = mockCartulary.watchInstance;
  const isVisible = (required: VisibilityLevel) => {
    if (audience === 'Secret') return true;
    if (audience === 'Communauté') return required !== 'Secret';
    return required === 'Tous';
  };

  const visibleAssets = mediaAssets.filter((asset) => isVisible(asset.visibility));
  const localWebsiteAssets = mediaAssets.filter((asset) => asset.visibility === 'Tous');
  const renderedAssets = isWatchWebsite && !requestedPublicCode ? localWebsiteAssets : visibleAssets;
  const mainPhoto = renderedAssets.find((asset) => asset.tags.includes('main-photo'));
  const mainVideo = renderedAssets.find((asset) => asset.tags.includes('main-video'));
  const spinAssets = renderedAssets.filter((asset) => asset.tags.includes('spin-3d') && asset.type === 'image');
  const presentationAssets = renderedAssets.filter((asset) => asset.tags.includes('slideshow'));
  const documentationAssets = renderedAssets.filter((asset) => asset.tags.includes('documentation') || asset.tags.includes('accessories'));
  const selectedAssetPosition = selectedAsset
    ? renderedAssets.findIndex((asset) => asset.id === selectedAsset.id)
    : -1;
  const moveSelectedAsset = useCallback((direction: -1 | 1) => {
    setSelectedAsset((current) => {
      if (!current || renderedAssets.length < 2) return current;
      const currentIndex = renderedAssets.findIndex((asset) => asset.id === current.id);
      const nextIndex = (Math.max(0, currentIndex) + direction + renderedAssets.length) % renderedAssets.length;
      return renderedAssets[nextIndex];
    });
  }, [renderedAssets]);

  useEffect(() => {
    if (!selectedAsset || renderedAssets.length < 2) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = horizontalNavigationDirection(event.key);
      if (!direction || targetConsumesHorizontalNavigation(event.target)) return;
      event.preventDefault();
      moveSelectedAsset(direction);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moveSelectedAsset, renderedAssets.length, selectedAsset]);
  const publicationMainPhoto = mediaAssets.find((asset) => asset.tags.includes('main-photo'));
  const referenceConditionReport = conditionEntries.find((entry) => entry.id === 'report-2026-08-08') ?? conditionEntries[0];
  const priorConditionReviews = conditionEntries.filter((entry) => entry.id !== referenceConditionReport?.id);
  const rawSpecificationValue = (label: string) =>
    specificationGroups.flatMap((group) => group.items).find((item) => item.label === label)?.value ?? '';
  const specificationValue = (label: string, fallback: string) =>
    rawSpecificationValue(label) || fallback;
  const publicationEligibilityFor = (destination: PublicationDestination) => evaluatePublicationEligibility({
    brand: rawSpecificationValue('Marque'),
    model: rawSpecificationValue('Modèle'),
    mainPhoto: publicationMainPhoto,
    destination,
  });
  const selectedBlocksFor = (destination: PublicationDestination) => (
    destination === 'website' ? publishedBlocks : destination === 'report' ? reportBlocks : communityBlocks
  );
  const selectionIsValidated = (destination: PublicationDestination, blockId: PublishedBlockId) => isSelectionValidated({
    selected: selectedBlocksFor(destination).includes(blockId),
    destination,
    blockId,
    decisions: publicationDecisions,
    sourceDigest: effectivePublicationSourceDigest,
    sourceRevision: effectivePublicationSourceRevision,
  });
  const approvedWebsiteBlocks = validatedBlockIds(
    publishedBlocks,
    'website',
    publicationDecisions,
    effectivePublicationSourceDigest,
    effectivePublicationSourceRevision,
  );
  const approvedReportBlocks = validatedBlockIds(
    reportBlocks,
    'report',
    publicationDecisions,
    effectivePublicationSourceDigest,
    effectivePublicationSourceRevision,
  );
  const approvedCommunityBlocks = validatedBlockIds(
    communityBlocks,
    'community',
    publicationDecisions,
    effectivePublicationSourceDigest,
    effectivePublicationSourceRevision,
  );
  const requestedPublishedBlocks = publishedBlocksFromUrl();
  const firestorePublishedBlocks = publicProjection?.blocks
    .map((block) => block.blockId)
    .filter((blockId): blockId is PublishedBlockId => PUBLISHED_BLOCK_IDS.includes(blockId as PublishedBlockId)) ?? [];
  const watchWebsiteBlocks = isWatchWebsite
    ? (requestedPublicCode
        ? firestorePublishedBlocks
        : requestedPublishedBlocks
          ? filterRequestedWebsiteBlocks(requestedPublishedBlocks, approvedWebsiteBlocks)
          : approvedWebsiteBlocks)
    : approvedWebsiteBlocks;
  const watchWebsiteUrl = `${window.location.origin}/watch-website?blocks=${approvedWebsiteBlocks.join(',')}`;
  const publicShareUrl = `${window.location.origin}/watch-website?publicCode=${encodeURIComponent(mockCartulary.publicCode)}`;
  const orderedReportBlocks = PUBLISHED_BLOCK_IDS.filter((blockId) => approvedReportBlocks.includes(blockId));
  const reportProofState = journal.getProofState();
  const reportTimestampReceipt = [...journal.getReceipts()].reverse().find(isRfc3161Receipt);
  const reportTimestampCoversContent = reportTimestampReceipt?.anchoredContentDigest === reportProofState.contentDigest;

  const closePublicationDialog = () => {
    setPublicationIntent(null);
    setPublicationAcknowledged(false);
    setPublicationError(null);
  };

  const requestPublicationChange = (
    destination: PublicationDestination,
    blockId: PublishedBlockId,
    blockLabel: string,
  ) => {
    if (audience !== 'Secret') return;
    publicationDialogOpenedAtRef.current = performance.now();
    const selected = selectedBlocksFor(destination).includes(blockId);
    const validated = selectionIsValidated(destination, blockId);
    setPublicationIntent({
      requestId: `publication-${globalThis.crypto.randomUUID()}`,
      destination,
      blockId,
      blockLabel,
      action: publicationActionFor({ selected, validated }),
      eligibility: publicationEligibilityFor(destination),
      policy: getPublicationPolicy(destination, blockId),
    });
    setPublicationAcknowledged(false);
    setPublicationError(null);
  };

  const confirmPublicationIntent = async (overrideAction?: PublicationAction) => {
    if (!publicationIntent || publicationSubmissionRef.current) return;
    const action = overrideAction ?? publicationIntent.action;
    const removalOfLegacySelection = publicationIntent.action === 'validate' && action === 'revoke';
    if (!publicationAcknowledged && !removalOfLegacySelection) return;
    publicationSubmissionRef.current = true;
    setIsPublicationSubmitting(true);
    setPublicationError(null);
    try {
      const [currentDigest, currentEligibility] = await Promise.all([
        computeHash(publicationSourceSnapshot),
        Promise.resolve(publicationEligibilityFor(publicationIntent.destination)),
      ]);
      const currentPolicy = getPublicationPolicy(publicationIntent.destination, publicationIntent.blockId);
      if (action !== 'revoke' && (
        !currentEligibility.isEligible
        || !currentPolicy.allowed
        || currentDigest !== effectivePublicationSourceDigest
        || effectivePublicationSourceRevision === 0
      )) {
        setPublicationIntent((current) => current ? {
          ...current,
          eligibility: currentEligibility,
          policy: currentPolicy,
        } : current);
        setPublicationAcknowledged(false);
        setPublicationError(tx(
          'Le dossier, sa révision ou la politique a changé. Les contrôles ont été recalculés ; corrigez les points bloquants puis relancez la décision.',
          'The record, its revision or the policy changed. Checks were recalculated; resolve the blocking items and start the decision again.',
        ));
        return;
      }

      const reconciliation = await journal.reconcileSnapshot(integritySnapshot);
      if (reconciliation) setEventTrigger((previous) => previous + 1);
      const decision: PublicationDecision = {
        requestId: publicationIntent.requestId,
        destination: publicationIntent.destination,
        blockId: publicationIntent.blockId,
        blockLabel: publicationIntent.blockLabel,
        action,
        status: 'confirmed',
        decisionSource: 'human_confirmed',
        decidedAt: new Date().toISOString(),
        sourceRevision: effectivePublicationSourceRevision,
        sourceDigest: currentDigest,
        policyVersion: 'publication-policy-v1',
        prerequisites: currentEligibility.prerequisites,
      };
      const marker = destinationMarker(decision.destination);
      await journal.logEvent(
        action === 'revoke' ? 'PUBLICATION_SELECTION_REVOKED' : 'PUBLICATION_SELECTION_CONFIRMED',
        'Propriétaire',
        `${marker} · ${decision.blockId} · ${action} · prérequis ${currentEligibility.prerequisites.filter((item) => item.satisfied).length}/3 · source ${currentDigest.slice(0, 23)}`,
        {
          requestId: decision.requestId,
          resource: { type: 'publication_selection', id: `${decision.destination}:${decision.blockId}` },
        },
      );

      setPublicationDecisions((current) => current.some((item) => item.requestId === decision.requestId)
        ? current
        : [...current, decision]);
      if (decision.destination === 'website') {
        setPublishedBlocks((current) => applyPublicationDecision(current, decision));
      } else if (decision.destination === 'report') {
        setReportBlocks((current) => applyPublicationDecision(current, decision));
      } else {
        setCommunityBlocks((current) => applyPublicationDecision(current, decision));
      }
      setEventTrigger((previous) => previous + 1);
      closePublicationDialog();
    } catch (error) {
      setPublicationError(error instanceof Error ? error.message : tx('La décision n’a pas pu être enregistrée.', 'The decision could not be saved.'));
    } finally {
      publicationSubmissionRef.current = false;
      setIsPublicationSubmitting(false);
    }
  };

  const publishProps = (blockId: PublishedBlockId, editable = false): BlockMarkerState => ({
    blockId,
    language,
    website: {
      active: publishedBlocks.includes(blockId),
      pendingValidation: publishedBlocks.includes(blockId) && !selectionIsValidated('website', blockId),
      onToggle: (label) => requestPublicationChange('website', blockId, label),
      disabled: audience !== 'Secret',
    },
    report: {
      active: reportBlocks.includes(blockId),
      pendingValidation: reportBlocks.includes(blockId) && !selectionIsValidated('report', blockId),
      onToggle: (label) => requestPublicationChange('report', blockId, label),
      disabled: audience !== 'Secret',
    },
    community: {
      active: communityBlocks.includes(blockId),
      pendingValidation: communityBlocks.includes(blockId) && !selectionIsValidated('community', blockId),
      onToggle: (label) => requestPublicationChange('community', blockId, label),
      disabled: audience !== 'Secret',
    },
    ...(editable ? {
      edit: {
        active: editingBlock === blockId,
        onToggle: () => setEditingBlock((current) => current === blockId ? null : blockId),
        disabled: audience !== 'Secret',
      },
    } : {}),
  });

  const marketValues = [...marketHistory].sort((a, b) => a.date.localeCompare(b.date));
  const maxMarketValue = Math.max(1, ...marketValues.map((valuation) => valuation.highValue));
  const costBasis = useMemo(
    () => purchase.purchasePrice + purchaseExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    [purchase.purchasePrice, purchaseExpenses],
  );
  const listingComparables = comparables.filter((comparable) => comparable.sourceType === 'Annonce');
  const transactionComparables = comparables.filter((comparable) => comparable.sourceType === 'Transaction');

  const datedAcquisitionCashFlows = useMemo<DatedCashFlow[]>(() => [
    { date: purchase.date, amount: -Number(purchase.purchasePrice || 0) },
    ...purchaseExpenses.map((expense) => ({
      date: expense.date || purchase.date,
      amount: -Number(expense.amount || 0),
    })),
  ], [purchase, purchaseExpenses]);
  const disposalCost = exitAssumptions.salePrice * (exitAssumptions.disposalCostPct / 100);
  const netSaleProceeds = exitAssumptions.salePrice - disposalCost;
  const capitalGainLoss = netSaleProceeds - costBasis;
  const capitalGainLossPct = costBasis > 0 ? capitalGainLoss / costBasis : 0;
  const holdingIrr = useMemo(() => hasMinimumSaleHorizon(purchase.date, exitAssumptions.saleDate)
    ? calculateXirr([
        ...datedAcquisitionCashFlows,
        { date: exitAssumptions.saleDate, amount: netSaleProceeds },
      ])
    : null, [datedAcquisitionCashFlows, exitAssumptions.saleDate, netSaleProceeds, purchase.date]);
  const scenarioPerformance = (salePrice: number, disposalCostPct: number) => {
    const netProceeds = salePrice * (1 - disposalCostPct / 100);
    return {
      gainLoss: netProceeds - costBasis,
      irr: hasMinimumSaleHorizon(purchase.date, exitAssumptions.saleDate)
        ? calculateXirr([
            ...datedAcquisitionCashFlows,
            { date: exitAssumptions.saleDate, amount: netProceeds },
          ])
        : null,
    };
  };

  const tx = (french: string, english: string) => language === 'FR' ? french : english;
  const ownershipSummary = ownershipHistorySummary(ownershipHistory, language);
  const ownershipAssessment = ownershipValuationAssessment(ownershipHistory, language);
  const interfaceLocale = language === 'FR' ? 'fr-FR' : 'en-GB';
  const mediaTagLabel = (tag: { id: MediaTag; label: string }) => language === 'FR' ? tag.label : ({
    'main-photo': 'Main photo',
    'main-video': 'Main video',
    'spin-3d': '3D sequence',
    slideshow: 'Slideshow',
    accessories: 'Accessories',
    documentation: 'Documentation',
    other: 'Other',
  } satisfies Record<MediaTag, string>)[tag.id];
  const ownerDocumentCategoryLabel = (category: string) => language === 'FR' ? category : ({
    'Carte nationale d’identité': 'National identity card', Passeport: 'Passport', 'Permis de conduire': 'Driving licence', 'Titre de séjour': 'Residence permit',
    'Justificatif de domicile': 'Proof of address', 'Acte de naissance': 'Birth certificate', 'Justificatif d’identifiant fiscal': 'Proof of tax identifier',
    'Autre document d’identification': 'Other identification document', 'Extrait Kbis / registre du commerce': 'Company register extract',
    'Statuts à jour': 'Current articles of association', 'Certificat d’immatriculation / d’incorporation': 'Registration / incorporation certificate',
    'Avis de situation SIRENE': 'SIRENE status notice', 'Attestation de TVA / identifiant fiscal': 'VAT / tax identifier certificate',
    'Registre des bénéficiaires effectifs': 'Beneficial ownership register', 'Pouvoir du représentant légal': 'Legal representative authorization',
    'Pièce d’identité du représentant légal': 'Legal representative identity document', 'Justificatif du siège social': 'Registered office proof',
    'Autre document d’identification de l’entreprise': 'Other company identification document',
  } satisfies Record<string, string>)[category] ?? category;
  const documentationCategoryLabel = (category: DocumentationCategory) => language === 'FR' ? category : ({
    Facture: 'Invoice', Garantie: 'Warranty', Assurances: 'Insurance', Boîte: 'Box', Écrin: 'Presentation case', Manuel: 'Manual', Certificat: 'Certificate', Accessoire: 'Accessory', Autre: 'Other',
  } satisfies Record<DocumentationCategory, string>)[category];
  const documentationStateLabel = (state: DocumentationState) => language === 'FR' ? state : ({
    Présent: 'Present', Complet: 'Complete', Incomplet: 'Incomplete', Manquant: 'Missing', 'À vérifier': 'To be checked',
  } satisfies Record<DocumentationState, string>)[state];
  const popularityTypeLabel = (type: PopularityResourceType) => language === 'FR' ? type : ({
    'Forum officiel': 'Official forum', 'Discussion dédiée': 'Dedicated discussion', Communauté: 'Community', 'Base de données': 'Database', Revue: 'Review',
  } satisfies Record<PopularityResourceType, string>)[type];
  const expenseKindLabel = (kind: PurchaseExpense['kind']) => language === 'FR' ? kind : ({
    Révision: 'Service', Assurance: 'Insurance', 'Coûts de conservation': 'Safekeeping costs', Autre: 'Other',
  } satisfies Record<PurchaseExpense['kind'], string>)[kind];
  const watchStatusLabel = (status: WatchPatrimonialStatus) => language === 'FR' ? status : ({
    Patrimonial: 'Collection asset', 'À vendre': 'For sale', 'Ouvert à proposition': 'Open to offers',
  } satisfies Record<WatchPatrimonialStatus, string>)[status];
  const assetKindLabel = (kind: AssetKind) => language === 'FR' ? kind : ({
    Montre: 'Watch', Voiture: 'Car', Vin: 'Wine', Sculpture: 'Sculpture', Peinture: 'Painting', Photographie: 'Photography', Meuble: 'Furniture', 'Autre art': 'Other art', 'Bien immobilier': 'Real estate', Autre: 'Other',
  } satisfies Record<AssetKind, string>)[kind];

  const requestDeletion = (intent: PendingDeletion) => {
    setDeletionError(null);
    setPendingDeletion(intent);
  };

  const confirmDeletion = async () => {
    if (!pendingDeletion || isDeletingItem) return;
    setIsDeletingItem(true);
    setDeletionError(null);
    try {
      const notice = await pendingDeletion.onConfirm();
      setPendingDeletion(null);
      setUndoNotice((current) => {
        void current?.onExpire?.();
        return notice;
      });
      void journal.logEvent(
        'ITEM_DELETION_CONFIRMED',
        'Propriétaire',
        'Suppression unitaire confirmée avec fenêtre d’annulation de 10 secondes',
      ).then(() => setEventTrigger((previous) => previous + 1)).catch((error: unknown) => console.error('Journalisation de la suppression impossible', error));
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : tx('Suppression impossible.', 'Deletion failed.'));
    } finally {
      setIsDeletingItem(false);
    }
  };

  const undoDeletion = async () => {
    const notice = undoNotice;
    if (!notice) return;
    setUndoNotice(null);
    try {
      await notice.onUndo();
      void journal.logEvent(
        'ITEM_DELETION_UNDONE',
        'Propriétaire',
        'Suppression unitaire annulée dans la fenêtre de restauration',
      ).then(() => setEventTrigger((previous) => previous + 1)).catch((error: unknown) => console.error("Journalisation de l'annulation impossible", error));
    } catch (error) {
      setDeletionError(error instanceof Error ? error.message : tx('Annulation impossible.', 'Undo failed.'));
    }
  };

  const requestCollectionDeletion = <T extends { id: string },>(options: {
    items: T[];
    setItems: Dispatch<SetStateAction<T[]>>;
    id: string;
    targetLabel: string;
  }) => {
    const removed = removeItemById(options.items, options.id);
    if (!removed) return;
    requestDeletion({
      title: tx('Confirmer la suppression', 'Confirm deletion'),
      description: tx(
        'Cet élément sera retiré du brouillon local et de sa prochaine synchronisation. Vous pourrez encore annuler pendant 10 secondes.',
        'This item will be removed from the local draft and its next sync. You can still undo for 10 seconds.',
      ),
      targetLabel: options.targetLabel,
      onConfirm: () => {
        options.setItems((current) => removeItemById(current, options.id)?.remaining ?? current);
        return {
          id: newId('undo'),
          message: tx(`« ${options.targetLabel} » a été supprimé.`, `“${options.targetLabel}” was deleted.`),
          onUndo: () => options.setItems((current) => restoreItemAtIndex(current, removed.item, removed.index)),
        };
      },
    });
  };

  const pages = [
    { id: 'cover' as const, number: '00', label: language === 'FR' ? 'Accueil' : 'Home' },
    { id: 'media' as const, number: '01', label: language === 'FR' ? 'Médias' : 'Media' },
    { id: 'reference' as const, number: '02', label: language === 'FR' ? 'La référence' : 'Reference' },
    { id: 'condition' as const, number: '03', label: language === 'FR' ? 'État de la montre' : 'Watch condition' },
    { id: 'value' as const, number: '04', label: language === 'FR' ? 'Valorisation' : 'Valuation' },
  ];

  const audienceOptions: Array<{ value: VisibilityLevel; label: string; help: string }> = language === 'FR'
    ? [
        { value: 'Secret', label: 'Secret', help: 'Vue propriétaire complète et modifiable' },
        { value: 'Communauté', label: 'Communauté', help: 'Données accessibles au Cercle' },
        { value: 'Tous', label: 'Tous', help: 'Données accessibles publiquement' },
      ]
    : [
        { value: 'Secret', label: 'Secret', help: 'Complete editable owner view' },
        { value: 'Communauté', label: 'Community', help: 'Data visible to Circle members' },
        { value: 'Tous', label: 'Everyone', help: 'Publicly visible data' },
      ];

  const navigateTo = (page: CartularyPage) => {
    if (activePage === page) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.location.hash = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReportPrint = () => {
    // The print call stays first and synchronous so the browser keeps the
    // original user gesture. Without an R selection, print the current page.
    window.print();

    const scope = orderedReportBlocks.length > 0
      ? `rapport personnalisé · ${orderedReportBlocks.length} blocs`
      : `page actuelle · ${activePage}`;
    void journal
      .logEvent('EXPORT_PDF', 'Propriétaire', `Impression ${scope}`)
      .then(() => setEventTrigger((previous) => previous + 1))
      .catch((error: unknown) => console.error("Échec de la journalisation de l'impression", error));
  };

  const handleDeleteAllData = async () => {
    await journal.logEvent(
      'PRIVATE_DATA_DELETION_REQUESTED',
      'Propriétaire',
      'Suppression explicite du coffre local et de la copie privée cloud du prototype.',
    );
    await persistence.deleteAllData();
    window.location.replace('/?data-deleted=1');
  };

  const toggleMediaTag = (assetId: string, tag: MediaTag) => {
    if (audience !== 'Secret') return;
    mediaCommands.toggleAssetTag(assetId, tag);
  };

  const deleteMediaAsset = (id: string) => {
    const asset = mediaAssets.find((item) => item.id === id);
    const index = mediaAssets.findIndex((item) => item.id === id);
    if (!asset || index < 0) return;
    requestDeletion({
      title: tx('Supprimer ce fichier du coffre ?', 'Delete this file from the vault?'),
      description: tx(
        'Le fichier et ses métadonnées seront retirés. La suppression du binaire est enregistrée comme un tombstone synchronisable.',
        'The file and its metadata will be removed. Binary deletion is recorded as a syncable tombstone.',
      ),
      targetLabel: asset.name,
      onConfirm: async () => {
        const binaryRecord = asset.binaryId ? await cartulariaLocalVault?.getBinary(asset.binaryId) : null;
        if (asset.binaryId) await cartulariaLocalVault?.deleteBinary(asset.binaryId);
        setMediaAssets((current) => removeItemById(current, id)?.remaining ?? current);
        setSelectedAsset(null);
        return {
          id: newId('undo-media'),
          message: tx(`« ${asset.name} » a été supprimé du coffre média.`, `“${asset.name}” was deleted from the media vault.`),
          onUndo: async () => {
            if (binaryRecord?.blob) {
              await cartulariaLocalVault?.putValidatedBinary({
                binaryId: binaryRecord.binaryId,
                kind: binaryRecord.kind,
                fileName: binaryRecord.fileName,
                mimeType: binaryRecord.mimeType,
                sha256: binaryRecord.sha256,
                blob: binaryRecord.blob,
              });
            }
            setMediaAssets((current) => restoreItemAtIndex(current, asset, index));
          },
          onExpire: () => {
            if (asset.url.startsWith('blob:')) URL.revokeObjectURL(asset.url);
          },
        };
      },
    });
  };

  const updateCheck = (id: string, patch: Partial<IdentificationCheck>) => {
    conditionCommands.updateCheck(id, patch);
  };

  const addCheck = () => {
    conditionCommands.addCheck({ id: newId('check'), title: 'Nouveau point de contrôle', note: '', checked: false });
    setIsEditingChecks(true);
  };

  const addConditionEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const date = String(formData.get('date') || '');
    const title = String(formData.get('title') || '').trim();
    const note = String(formData.get('note') || '').trim();
    const files = formData.getAll('documents').filter(
      (value): value is File => value instanceof File && value.size > 0,
    );
    if (!note && files.length === 0) return;
    setFileImportError(null);
    let attachments: ConditionAttachment[];
    try {
      attachments = await Promise.all(files.map(async (file): Promise<ConditionAttachment> => {
      const binaryId = newId('condition-binary');
      const sha256 = await digestFile(file);
      await cartulariaLocalVault?.putValidatedBinary({
        binaryId,
        kind: 'condition_attachment',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sha256,
        blob: file,
      });
        return { id: newId('attachment'), name: file.name, size: file.size, type: file.type, binaryId, sha256, url: URL.createObjectURL(file) };
      }));
    } catch (caught) {
      setFileImportError(caught instanceof Error ? caught.message : tx('Fichier refusé.', 'File rejected.'));
      return;
    }
    const entry: ConditionEntry = {
      id: newId('condition'),
      date,
      title: title || 'Note d’état',
      note,
      attachments,
    };
    conditionCommands.addEntry(entry);
    form.reset();
  };

  const addMediaAssets = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const files = new FormData(form).getAll('media-files').filter(
      (value): value is File => value instanceof File && value.size > 0,
    );
    if (files.length === 0) return;

    setFileImportError(null);
    let importedAssets: Asset[];
    try {
      importedAssets = await Promise.all(files.map(async (file) => {
        const hash = await digestFile(file);
        const binaryId = newId('media-binary');
        const storedBinary = await cartulariaLocalVault?.putValidatedBinary({
          binaryId,
          kind: 'media',
          fileName: file.name,
          mimeType: file.type,
          sha256: hash,
          blob: file,
        });
        const canonicalMimeType = storedBinary?.mimeType || file.type;
        const type: Asset['type'] = canonicalMimeType.startsWith('image/')
          ? 'image'
          : canonicalMimeType.startsWith('video/') ? 'video' : 'document';
        return {
          id: newId('asset'),
          name: file.name.replace(/\.[^/.]+$/, ''),
          originalFileName: file.name,
          url: URL.createObjectURL(file),
          type,
          ratio: type === 'video' ? '16:9' : '4:5',
          hash,
          status: 'Archived',
          visibility: 'Secret',
          tags: mediaUploadTags,
          capturedAt: new Date(file.lastModified || Date.now()).toISOString().slice(0, 10),
          metadataTimestamp: new Date(file.lastModified || Date.now()).toISOString(),
          timestampSource: 'file.lastModified',
          fileSize: formatFileSize(file.size),
          mimeType: canonicalMimeType,
          binaryId,
          localAvailability: 'available',
          derivativeStatus: type === 'video' ? 'pending' : 'not-required',
        };
      }));
    } catch (caught) {
      setFileImportError(caught instanceof Error ? caught.message : tx('Fichier refusé.', 'File rejected.'));
      return;
    }

    mediaCommands.appendAssets(importedAssets);
    form.reset();
    setMediaUploadTags([]);
  };

  const updateDocumentationItem = <K extends keyof DocumentationItem>(
    id: string,
    key: K,
    value: DocumentationItem[K],
  ) => {
    conditionCommands.updateDocumentation(id, key, value);
  };

  const updateOwnerField = (id: string, patch: Partial<OwnerField>) => {
    ownerCommands.updateField(id, patch);
  };

  const updateOwnershipHistory = (id: string, patch: Partial<OwnershipHistoryEntry>) => {
    ownerCommands.updateHistory(id, patch);
  };

  const selectFirstOwner = (id: string, selected: boolean) => {
    setOwnershipHistory((current) => current.map((entry) => ({
      ...entry,
      firstOwner: selected ? entry.id === id : entry.id === id ? false : entry.firstOwner,
    })));
  };

  const addOwnershipHistory = () => {
    setOwnershipHistory((current) => [...current, {
      id: newId('ownership-history'),
      fromYear: '',
      toYear: '',
      description: '',
      firstOwner: false,
    }]);
  };

  const updateTransmissionRecipient = (id: string, patch: Partial<TransmissionRecipient>) => {
    ownerCommands.updateRecipient(id, patch);
  };

  const addTransmissionRecipient = () => {
    setTransmissionRecipients((current) => [...current, {
      id: newId('transmission-recipient'),
      firstName: '',
      lastName: '',
      address: '',
      email: '',
      phone: '',
      percentage: '',
    }]);
  };

  const updateStorageLocation = (id: string, patch: Partial<StorageLocation>) => {
    ownerCommands.updateLocation(id, patch);
  };

  const addStorageLocation = () => {
    setStorageLocations((current) => [...current, {
      id: newId('storage-location'),
      name: '',
      contents: '',
      description: '',
    }]);
  };

  const updateOwnerDocument = (id: string, patch: Partial<OwnerDocument>) => {
    ownerCommands.updateDocument(id, patch);
  };

  const deleteOwnerDocument = (id: string) => {
    const target = ownerDocuments.find((document) => document.id === id);
    const index = ownerDocuments.findIndex((document) => document.id === id);
    if (!target || index < 0) return;
    requestDeletion({
      title: tx('Supprimer ce document confidentiel ?', 'Delete this confidential document?'),
      description: tx(
        'Le document sera retiré du coffre propriétaire et marqué comme supprimé pour la prochaine synchronisation.',
        'The document will be removed from the owner vault and marked as deleted for the next sync.',
      ),
      targetLabel: target.fileName,
      onConfirm: async () => {
        const binaryRecord = target.binaryId ? await cartulariaLocalVault?.getBinary(target.binaryId) : null;
        if (target.binaryId) await cartulariaLocalVault?.deleteBinary(target.binaryId);
        setOwnerDocuments((current) => removeItemById(current, id)?.remaining ?? current);
        return {
          id: newId('undo-owner-document'),
          message: tx(`« ${target.fileName} » a été supprimé.`, `“${target.fileName}” was deleted.`),
          onUndo: async () => {
            if (binaryRecord?.blob) {
              await cartulariaLocalVault?.putValidatedBinary({
                binaryId: binaryRecord.binaryId,
                kind: binaryRecord.kind,
                fileName: binaryRecord.fileName,
                mimeType: binaryRecord.mimeType,
                sha256: binaryRecord.sha256,
                blob: binaryRecord.blob,
              });
            }
            setOwnerDocuments((current) => restoreItemAtIndex(current, target, index));
          },
          onExpire: () => {
            if (target.url?.startsWith('blob:')) URL.revokeObjectURL(target.url);
          },
        };
      },
    });
  };

  const addOwnerDocuments = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const category = String(formData.get('owner-document-category') || '').trim() || 'Document d’identité';
    const files = formData.getAll('owner-documents').filter(
      (value): value is File => value instanceof File && value.size > 0,
    );
    if (files.length === 0) return;
    setFileImportError(null);
    let addedDocuments: OwnerDocument[];
    try {
      addedDocuments = await Promise.all(files.map(async (file): Promise<OwnerDocument> => {
      const binaryId = newId('owner-binary');
      const sha256 = await digestFile(file);
      await cartulariaLocalVault?.putValidatedBinary({
        binaryId,
        kind: 'owner_document',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sha256,
        blob: file,
      });
        return {
        id: newId('owner-document'),
        category,
        fileName: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        url: URL.createObjectURL(file),
        binaryId,
        sha256,
        };
      }));
    } catch (caught) {
      setFileImportError(caught instanceof Error ? caught.message : tx('Fichier refusé.', 'File rejected.'));
      return;
    }
    setOwnerDocuments((current) => [...current, ...addedDocuments]);
    form.reset();
  };

  const deleteConditionEntry = (id: string) => {
    const target = conditionEntries.find((entry) => entry.id === id);
    const index = conditionEntries.findIndex((entry) => entry.id === id);
    if (!target || index < 0) return;
    requestDeletion({
      title: tx('Supprimer ce rapport et ses pièces jointes ?', 'Delete this report and its attachments?'),
      description: tx(
        'Le rapport et chaque original joint seront marqués comme supprimés. Cette action reste annulable pendant 10 secondes.',
        'The report and every attached original will be marked as deleted. This action can be undone for 10 seconds.',
      ),
      targetLabel: target.title,
      onConfirm: async () => {
        const binaryRecords = (await Promise.all(target.attachments.map(async (attachment) => (
          attachment.binaryId ? cartulariaLocalVault?.getBinary(attachment.binaryId) : null
        )))).filter((record) => record?.blob);
        await Promise.all(target.attachments.map((attachment) => (
          attachment.binaryId ? cartulariaLocalVault?.deleteBinary(attachment.binaryId) : Promise.resolve()
        )));
        setConditionEntries((current) => removeItemById(current, id)?.remaining ?? current);
        return {
          id: newId('undo-condition'),
          message: tx(`« ${target.title} » et ses pièces jointes ont été supprimés.`, `“${target.title}” and its attachments were deleted.`),
          onUndo: async () => {
            await Promise.all(binaryRecords.map((record) => record?.blob ? cartulariaLocalVault?.putValidatedBinary({
              binaryId: record.binaryId,
              kind: record.kind,
              fileName: record.fileName,
              mimeType: record.mimeType,
              sha256: record.sha256,
              blob: record.blob,
            }) : Promise.resolve()));
            setConditionEntries((current) => restoreItemAtIndex(current, target, index));
          },
          onExpire: () => target.attachments.forEach((attachment) => {
            if (attachment.url?.startsWith('blob:')) URL.revokeObjectURL(attachment.url);
          }),
        };
      },
    });
  };

  const updatePopularityResource = <K extends keyof PopularityResource>(
    id: string,
    key: K,
    value: PopularityResource[K],
  ) => {
    setPopularityResources((current) => current.map((resource) => resource.id === id ? { ...resource, [key]: value } : resource));
  };

  const updateExpense = <K extends keyof PurchaseExpense>(id: string, key: K, value: PurchaseExpense[K]) => {
    valuationCommands.updateExpense(id, key, value);
  };

  const updateMarketHistory = (id: string, patch: Partial<Valuation>) => {
    valuationCommands.updateMarketHistory(id, patch);
  };

  const addMarketHistoryEntry = () => {
    setMarketHistory((current) => [...current, {
      id: newId('valuation'),
      date: marketDepth.analysisDate,
      lowValue: marketDepth.lowValue,
      midValue: marketDepth.midValue,
      highValue: marketDepth.highValue,
      currency: watch.currency || 'EUR',
      confidence: 'Moyenne',
      source: '',
      visibility: 'Secret',
    }]);
  };

  const updateComparable = (id: string, patch: Partial<ComparableTransaction>) => {
    valuationCommands.updateComparable(id, patch);
  };

  const addComparable = (sourceType: ComparableTransaction['sourceType']) => {
    setComparables((current) => [...current, {
      id: newId('comparable'),
      date: marketDepth.analysisDate,
      channel: '',
      description: '',
      amount: 0,
      currency: watch.currency || 'EUR',
      condition: '',
      sourceType,
      source: '',
      saleChannel: sourceType === 'Transaction' ? 'Enchère' : 'Annonce',
    }]);
  };

  const updateComparableAnalysis = (id: string, patch: Partial<ComparableAnalysisEntry>) => {
    valuationCommands.updateComparableAnalysis(id, patch);
  };

  const updateSpecification = (groupId: string, itemId: string, patch: Partial<SpecificationDatum>) => {
    setSpecificationGroups((current) => current.map((group) => group.id === groupId
      ? { ...group, items: group.items.map((item) => item.id === itemId ? { ...item, ...patch } : item) }
      : group));
  };

  const updateSpecificationValue = (label: string, value: string) => {
    setSpecificationGroups((current) => current.map((group) => ({
      ...group,
      items: group.items.map((item) => item.label === label ? { ...item, value } : item),
    })));
  };

  const deleteSpecification = (groupId: string, itemId: string) => {
    const group = specificationGroups.find((candidate) => candidate.id === groupId);
    const removed = group ? removeItemById(group.items, itemId) : null;
    if (!group || !removed) return;
    requestDeletion({
      title: tx('Supprimer cette donnée de référence ?', 'Delete this reference field?'),
      description: tx(
        'La donnée sera retirée de la fiche de référence et des prochaines projections.',
        'The field will be removed from the reference record and future projections.',
      ),
      targetLabel: removed.item.label,
      onConfirm: () => {
        setSpecificationGroups((current) => current.map((candidate) => candidate.id === groupId
          ? { ...candidate, items: removeItemById(candidate.items, itemId)?.remaining ?? candidate.items }
          : candidate));
        return {
          id: newId('undo-specification'),
          message: tx(`« ${removed.item.label} » a été supprimé.`, `“${removed.item.label}” was deleted.`),
          onUndo: () => setSpecificationGroups((current) => current.map((candidate) => candidate.id === groupId
            ? { ...candidate, items: restoreItemAtIndex(candidate.items, removed.item, removed.index) }
            : candidate)),
        };
      },
    });
  };

  const addSpecification = (groupId: string) => {
    setSpecificationGroups((current) => current.map((group) => group.id === groupId
      ? { ...group, items: [...group.items, { id: newId('spec'), label: 'Nouvelle donnée', value: '' }] }
      : group));
  };

  const renderWatchWebsiteBlock = (blockId: PublishedBlockId) => {
    const projectedBlock = publicProjection?.blocks.find((block) => block.blockId === blockId);
    if (projectedBlock) return <ProjectedPublicBlock block={projectedBlock} />;
    switch (blockId) {
      case 'cover-watch':
        return (
          <section className="cover-sheet cover-sheet--published">
            <div className="cover-sheet__identity">
              <span className="eyebrow">Cartulaire · {mockCartulary.publicCode}</span>
              <div className="cover-sheet__published-title">
                <p>{specificationValue('Marque', watch.reference.brand)}</p>
                <h1>{specificationValue('Modèle', watch.reference.model)}</h1>
              </div>
              <div className="cover-sheet__identity-meta">
                <span className="asset-kind-badge">{assetKindLabel(assetKind)}</span>
                <span className="watch-status-badge">{watchStatusLabel(watchStatus)}</span>
                <small>{specificationValue('Numéro de référence', watch.reference.reference)}</small>
              </div>
            </div>
            <div className="cover-sheet__photo">
              {mainPhoto
                ? <PrivateMediaImage asset={mainPhoto} alt={`${specificationValue('Marque', watch.reference.brand)} ${specificationValue('Modèle', watch.reference.model)}`} eager />
                : <span className="empty-media">{tx('PHOTO PRINCIPALE NON AFFECTÉE', 'NO MAIN PHOTO ASSIGNED')}</span>}
            </div>
          </section>
        );
      case 'cover-owner':
        return (
          <section>
            <SectionTitle eyebrow={tx('Dossier privé', 'Private record')} title={tx('Propriétaire de la montre', 'Watch owner')} />
            <article className="owner-card owner-card--published">
              <div className="owner-type-badge">{ownerType}</div>
              <dl className="owner-fields owner-fields--published">
                {ownerFields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{field.value || tx('Non renseigné', 'Not provided')}</dd></div>)}
              </dl>
              {ownerDocuments.length > 0 && (
                <div className="owner-documents owner-documents--published">
                  <h3>{tx('Documents associés', 'Associated documents')}</h3>
                  {ownerDocuments.map((document) => <div key={document.id}><FileText size={16} /><span>{ownerDocumentCategoryLabel(document.category)}</span><strong>{document.fileName}</strong></div>)}
                </div>
              )}
            </article>
          </section>
        );
      case 'cover-ownership-history':
        return (
          <section>
            <SectionTitle eyebrow={tx('Provenance privée', 'Private provenance')} title={tx("Historique de l'objet - Propriétaires précédents", 'Object history - Previous owners')} />
            <article className="ownership-history-card ownership-history-card--published">
              {ownershipHistory.length > 0 ? (
                <div className="ownership-history-list">
                  {ownershipHistory.map((entry) => (
                    <article className="ownership-period ownership-period--published" key={entry.id}>
                      <header><strong>{tx('De', 'From')} {entry.fromYear || '—'} {tx('à', 'to')} {entry.toYear || '—'}</strong>{entry.firstOwner && <span>{tx('Premier propriétaire', 'First owner')}</span>}</header>
                      <p>{entry.description || tx('Description non renseignée.', 'Description not provided.')}</p>
                    </article>
                  ))}
                </div>
              ) : <p className="ownership-history-empty">{tx('Aucun propriétaire précédent renseigné.', 'No previous owner entered.')}</p>}
              <div className="ownership-history-summary" {...aiFieldProps('cover.ownershipHistory.summary')}><strong>{tx('Synthèse de provenance', 'Provenance summary')}</strong><p>{ownershipSummary}</p></div>
            </article>
          </section>
        );
      case 'cover-transmission':
        return (
          <section>
            <SectionTitle eyebrow={tx('Projet patrimonial', 'Estate planning')} title={tx('Transmission', 'Transfer')} />
            <article className="transmission-card transmission-card--published">
              {transmissionRecipients.length > 0 ? (
                <div className="transmission-published-grid">
                  {transmissionRecipients.map((recipient, index) => (
                    <article key={recipient.id}>
                      <span className="eyebrow">{tx('Personne', 'Person')} {String(index + 1).padStart(2, '0')}</span>
                      <h3>{[recipient.firstName, recipient.lastName].filter(Boolean).join(' ') || tx('Identité non renseignée', 'Identity not provided')}</h3>
                      <dl>
                        <div><dt>{tx('Adresse', 'Address')}</dt><dd>{recipient.address || tx('Non renseignée', 'Not provided')}</dd></div>
                        <div><dt>Email</dt><dd>{recipient.email || tx('Non renseigné', 'Not provided')}</dd></div>
                        <div><dt>{tx('Téléphone', 'Phone')}</dt><dd>{recipient.phone || tx('Non renseigné', 'Not provided')}</dd></div>
                        <div><dt>{tx('Part donnée', 'Share transferred')}</dt><dd>{recipient.percentage === '' ? tx('Non renseignée', 'Not provided') : `${recipient.percentage} %`}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : <p className="transmission-empty">{tx('Aucune personne renseignée pour la transmission.', 'No person entered for the transfer.')}</p>}
            </article>
          </section>
        );
      case 'cover-storage':
        return (
          <section>
            <SectionTitle eyebrow={tx('Conservation', 'Safekeeping')} title={tx('Stockage', 'Storage')} />
            <article className="storage-card storage-card--published">
              {storageLocations.length > 0 ? (
                <div className="storage-published-grid">
                  {storageLocations.map((location, index) => (
                    <article key={location.id}>
                      <span className="eyebrow">{tx('Lieu', 'Location')} {String(index + 1).padStart(2, '0')}</span>
                      <h3>{location.name || tx('Lieu non renseigné', 'Location not provided')}</h3>
                      <dl>
                        <div><dt>{tx('Contenu stocké', 'Stored contents')}</dt><dd>{location.contents || tx('Non renseigné', 'Not provided')}</dd></div>
                        <div><dt>Description</dt><dd>{location.description || tx('Aucune précision', 'No details')}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              ) : <p className="storage-empty">{tx('Aucun lieu de stockage renseigné.', 'No storage location provided.')}</p>}
            </article>
          </section>
        );
      case 'media-hero':
        return (
          <section className="watch-website__hero">
            {mainPhoto && <PrivateMediaImage asset={mainPhoto} alt={`${watch.reference.brand} ${watch.reference.model}`} eager />}
            <div>
              <span className="eyebrow">{watch.reference.reference}</span>
              <h2>{watch.reference.brand}<br />{watch.reference.model}</h2>
              <p>{editableCopy.heroSummary}</p>
              <dl className="hero-facts">
                <div><dt>{tx('Statut', 'Status')}</dt><dd>{watchStatusLabel(watchStatus)}</dd></div>
                <div><dt>{tx('Dernier contrôle', 'Last inspection')}</dt><dd>{formatDate(watch.lastVerificationDate)}</dd></div>
                <div><dt>{tx('Référence', 'Reference')}</dt><dd>{watch.reference.reference}</dd></div>
                <div><dt>{tx('Dossier', 'Record')}</dt><dd>{mockCartulary.publicCode}</dd></div>
              </dl>
            </div>
          </section>
        );
      case 'media-motion':
        return (
          <section>
            <SectionTitle eyebrow={tx('Vidéo principale', 'Main video')} title={tx('La montre en mouvement', 'The watch in motion')} />
            {mainVideo ? (
              <a className="video-poster watch-website__media-link" href={mainVideo.url} target="_blank" rel="noreferrer">
                {mainVideo.posterUrl || mainVideo.thumbnailUrl
                  ? <PrivateMediaImage asset={mainVideo} alt={tx('La montre en mouvement', 'The watch in motion')} />
                  : <span className="video-poster__placeholder"><Video size={38} /><small>{mainVideo.name}</small></span>}
                <span className="video-poster__play" aria-hidden="true"><Play size={24} fill="currentColor" /></span>
              </a>
            ) : <p className="watch-website__empty">{tx('Vidéo non disponible.', 'Video unavailable.')}</p>}
          </section>
        );
      case 'media-spin':
        return (
          <section>
            <SectionTitle eyebrow={tx('Séquence 3D', '3D sequence')} title={tx('Revue à 360°', '360° review')} />
            {spinAssets.length > 0
              ? <Suspense fallback={<div className="media-empty" role="status">{tx('Chargement de la séquence 360°…', 'Loading 360° sequence…')}</div>}><Spin360 images={spinAssets} posterImageUrl={spinAssets[0].url} language={language} /></Suspense>
              : <p className="watch-website__empty">{tx('Séquence non disponible.', 'Sequence unavailable.')}</p>}
          </section>
        );
      case 'media-slideshow':
        return (
          <section>
            <SectionTitle eyebrow={tx('Présentation', 'Presentation')} title={tx('Diaporama', 'Slideshow')} />
            <MediaCarousel assets={presentationAssets} language={language} onOpen={(asset) => window.open(asset.url, '_blank', 'noopener,noreferrer')} />
          </section>
        );
      case 'media-library':
        return (
          <section>
            <SectionTitle eyebrow={tx('Fichiers publiés', 'Published files')} title={tx('Bibliothèque média', 'Media library')} />
            <div className="media-library watch-website__library">
              {renderedAssets.map((asset) => (
                <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer">
                  <span className="media-library__preview">
                    {asset.type === 'document'
                      ? <FileText size={28} />
                      : asset.type === 'video'
                        ? <><Video size={28} /><small>VIDEO</small></>
                        : <PrivateMediaImage asset={asset} alt="" />}
                  </span>
                  <strong>{asset.name}</strong>
                  <time dateTime={asset.metadataTimestamp}>{asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : tx('Horodatage indisponible', 'Timestamp unavailable')}</time>
                </a>
              ))}
            </div>
          </section>
        );
      case 'reference-history':
        return (
          <section>
            <SectionTitle eyebrow={tx('La référence', 'The reference')} title={tx('Origines', 'Origins')} />
            <div className="watch-website__two-columns">
              <div className="history-text"><h3>{tx('Historique du modèle', 'Model history')}</h3>{editableCopy.originParagraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
              <aside className="quote-card"><span className="eyebrow">{tx('À savoir', 'Good to know')}</span><p>{editableCopy.originKnowledge}</p></aside>
            </div>
          </section>
        );
      case 'reference-specs':
        return (
          <section>
            <SectionTitle eyebrow={tx('Fiche d’identité', 'Identity sheet')} title={tx('Spécifications de la référence', 'Reference specifications')} />
            <div className="specification-groups">
              {specificationGroups.map((group) => (
                <section className="specification-group" key={group.title}>
                  <h3>{group.title}</h3>
                  <dl>{group.items.map((item) => <div key={item.id}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
                </section>
              ))}
            </div>
          </section>
        );
      case 'reference-checks':
        return (
          <section>
            <SectionTitle eyebrow={tx('Identification', 'Identification')} title={tx('Points à contrôler', 'Inspection points')} />
            <div className="identification-list watch-website__checks">
              {identificationChecks.map((item, index) => (
                <article key={item.id}><span>{String(index + 1).padStart(2, '0')}</span><strong className="watch-website__tick">{item.checked ? '✓' : '—'}</strong><div><h3>{item.title}</h3><p>{item.note}</p></div></article>
              ))}
            </div>
          </section>
        );
      case 'reference-popularity':
        return (
          <section>
            <SectionTitle eyebrow={tx('Communauté et ressources', 'Community and resources')} title={tx('Popularité du modèle', 'Model popularity')} />
            <div className="watch-website__resource-list">
              {popularityResources.map((resource) => <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer"><span>{popularityTypeLabel(resource.type)}</span><strong>{resource.name}</strong><ExternalLink size={15} /></a>)}
            </div>
          </section>
        );
      case 'condition-description':
        return (
          <section>
            <SectionTitle eyebrow={tx('Synthèse', 'Summary')} title={tx('Description de la montre', 'Watch description')} />
            <article className="watch-description-card">
              {editableCopy.watchDescription.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </article>
          </section>
        );
      case 'condition-summary':
        return (
          <section>
            <SectionTitle eyebrow={tx('Synthèse', 'Summary')} title={tx('État actuel', 'Current condition')} />
            <article className="current-condition-summary">
              {editableCopy.conditionSummary.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              <dl><div><dt>{tx('Dernier état', 'Latest condition')}</dt><dd>{editableCopy.conditionFacts.lastCondition}</dd></div><div><dt>Conclusion</dt><dd>{editableCopy.conditionFacts.conclusion}</dd></div><div><dt>{tx('Point ouvert', 'Open point')}</dt><dd>{editableCopy.conditionFacts.openPoint}</dd></div></dl>
            </article>
          </section>
        );
      case 'condition-documentation':
        return (
          <section>
            <SectionTitle eyebrow={tx('Ensemble associé', 'Associated set')} title={tx('Papiers, documentation et accessoires', 'Papers, documentation and accessories')} />
            <div className="watch-website__document-list">
              {documentationItems.map((item) => <div key={item.id}><span>{documentationCategoryLabel(item.category)}</span><p>{item.description}</p><strong>{documentationStateLabel(item.state)}</strong></div>)}
            </div>
            <div className="documentation-media__grid watch-website__document-media">
              {documentationAssets.map((asset) => (
                <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer">
                  <span className="documentation-media__preview">{asset.type === 'document'
                    ? <FileText size={28} />
                    : asset.type === 'video'
                      ? <Video size={28} />
                      : <PrivateMediaImage asset={asset} alt="" />}</span>
                  <strong>{asset.name}</strong><small>{asset.tags.includes('documentation') ? 'Documentation' : tx('Accessoires', 'Accessories')}</small>
                  <time dateTime={asset.metadataTimestamp}>{asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : tx('Horodatage indisponible', 'Timestamp unavailable')}</time>
                </a>
              ))}
            </div>
          </section>
        );
      case 'condition-reference-report':
        return (
          <section>
            <SectionTitle eyebrow={tx('Rapport de référence', 'Reference report')} title={tx('Rapport d’état de référence', 'Reference condition report')} />
            <div className="condition-entry-list">
              {referenceConditionReport && <article className="condition-entry"><header><time>{formatDate(referenceConditionReport.date)}</time><h3>{referenceConditionReport.title}</h3></header>{referenceConditionReport.note && <p>{referenceConditionReport.note}</p>}{referenceConditionReport.attachments.length > 0 && <ul className="attachment-list">{referenceConditionReport.attachments.map((attachment, index) => <li key={`${referenceConditionReport.id}-${index}`}><Paperclip size={13} /><span>{attachment.name}</span></li>)}</ul>}</article>}
            </div>
          </section>
        );
      case 'condition-prior-reviews':
        return (
          <section>
            <SectionTitle eyebrow={tx('Historique', 'History')} title={tx('Revues antérieures', 'Previous reviews')} />
            <div className="condition-entry-list">
              {priorConditionReviews.map((entry) => <article key={entry.id} className="condition-entry"><header><time>{formatDate(entry.date)}</time><h3>{entry.title}</h3></header>{entry.note && <p>{entry.note}</p>}{entry.attachments.length > 0 && <ul className="attachment-list">{entry.attachments.map((attachment, index) => <li key={`${entry.id}-${index}`}><Paperclip size={13} /><span>{attachment.name}</span></li>)}</ul>}</article>)}
            </div>
          </section>
        );
      case 'value-market':
        return (
          <section>
            <SectionTitle eyebrow={tx('Évaluation de marché', 'Market valuation')} title={tx('Données de marché', 'Market data')} />
            <div className="market-grid">
              <article className="market-chart-card"><span className="eyebrow">{tx('Évolution du marché', 'Market trend')}</span><div className="market-bars">{marketValues.map((valuation) => <div key={valuation.id}><span style={{ height: `${Math.max(18, (valuation.midValue / maxMarketValue) * 100)}%` }} /><strong>{formatMoney(valuation.midValue, valuation.currency)}</strong><time>{formatDate(valuation.date)}</time></div>)}</div><small>{tx('Source : évaluations datées du dossier', 'Source: dated valuations from the record')}</small></article>
              <article className="market-depth-card"><div className="market-depth-card__heading"><span className="eyebrow">{tx('Profondeur de marché', 'Market depth')}</span><time dateTime={marketDepth.analysisDate}>{marketDepth.analysisDate ? tx(`Analyse du ${formatDate(marketDepth.analysisDate)}`, `Analysis dated ${formatDate(marketDepth.analysisDate)}`) : tx('Date non renseignée', 'Date not provided')}</time></div><div className="metric-grid"><div><strong>{marketDepth.activeListings}</strong><span>{tx('Annonces actives', 'Active listings')}</span></div><div><strong>{marketDepth.transactions12m}</strong><span>{tx('Transactions identifiées · 12 mois', 'Transactions identified · 12 months')}</span></div><div><strong>{marketDepth.medianDaysOnMarket} {tx('j', 'd')}</strong><span>{tx('Délai médian estimé', 'Estimated median time')}</span></div></div><div className="valuation-range"><span>{tx('Fourchette actuelle', 'Current range')}</span><strong>{formatMoney(marketDepth.lowValue)} — {formatMoney(marketDepth.highValue)}</strong><small>{tx('VALEUR MÉDIANE', 'MEDIAN VALUE')} {formatMoney(marketDepth.midValue)}</small></div></article>
              <article className="retained-value-card retained-value-card--published">
                <div><span className="eyebrow">{tx('Décision du propriétaire', 'Owner decision')}</span><h3>{tx('Valeur retenue', 'Retained value')}</h3></div>
                <strong>{formatMoney(retainedValuation.amount, watch.currency)}</strong>
                <p>{retainedValuation.explanation || tx('Aucune explication renseignée.', 'No explanation provided.')}</p>
              </article>
            </div>
          </section>
        );
      case 'value-comparables-listings':
        return (
          <section>
            <SectionTitle eyebrow={tx('Comparables', 'Comparable items')} title={tx('Annonces en cours', 'Current listings')} />
            <ComparableTable title={tx('Annonces en cours', 'Current listings')} items={listingComparables} hideHeading language={language} />
          </section>
        );
      case 'value-comparables-transactions':
        return (
          <section>
            <SectionTitle eyebrow={tx('Comparables', 'Comparable items')} title={tx('Transactions réalisées', 'Completed transactions')} />
            <ComparableTable title={tx('Transactions réalisées', 'Completed transactions')} items={transactionComparables} hideHeading language={language} />
          </section>
        );
      case 'value-comparables-analysis':
        return (
          <section>
            <SectionTitle eyebrow={tx('Comparables', 'Comparable items')} title={tx('Synthèse de l’analyse', 'Analysis summary')} />
            <div className="comparables-analysis"><div className="comparables-analysis-table">{comparableAnalysis.map((entry) => <div key={entry.id}><strong>{entry.angle}</strong><span>{entry.finding}</span><p>{entry.reading}</p></div>)}</div></div>
          </section>
        );
      case 'value-cost-basis':
        return (
          <section>
            <SectionTitle eyebrow={tx('Acquisition', 'Acquisition')} title={tx('Prix de revient', 'Cost basis')} />
            <div className="watch-website__financial-table"><div><span>{tx('Achat', 'Purchase')} · {formatDate(purchase.date)}</span><strong>{formatMoney(purchase.purchasePrice, watch.currency)}</strong></div>{purchaseExpenses.map((expense) => <div key={expense.id}><span>{expenseKindLabel(expense.kind)} · {expense.label} · {formatDate(expense.date)}</span><strong>{formatMoney(expense.amount, watch.currency)}</strong></div>)}<div className="is-total"><span>{tx('Prix de revient', 'Cost basis')}</span><strong>{formatMoney(costBasis, watch.currency)}</strong></div></div>
          </section>
        );
      case 'value-performance':
        return (
          <section>
            <SectionTitle eyebrow={tx('Performance de détention', 'Holding performance')} title={tx('Plus-value, moins-value et TRI', 'Capital gain, loss and IRR')} />
            <div className="performance-results watch-website__performance"><div><span>{tx('Prix de revient', 'Cost basis')}</span><strong>{formatMoney(costBasis, watch.currency)}</strong></div><div><span>{tx('Prix de vente', 'Sale price')}</span><strong>{formatMoney(exitAssumptions.salePrice, watch.currency)}</strong></div><div><span>{tx('Coût de cession', 'Disposal cost')}</span><strong>− {formatMoney(disposalCost, watch.currency)}</strong></div><div className={capitalGainLoss >= 0 ? 'is-positive' : 'is-negative'}><span>{tx('Plus / moins-value nette', 'Net capital gain / loss')}</span><strong>{formatMoney(capitalGainLoss, watch.currency)}</strong><small>{formatPercent(capitalGainLossPct)}</small></div><div className={holdingIrr !== null && holdingIrr >= 0 ? 'is-positive' : 'is-negative'}><span>{tx('TRI annualisé', 'Annualized IRR')}</span><strong>{formatPercent(holdingIrr)}</strong><small>{tx('Flux datés', 'Dated cash flows')}</small></div></div>
          </section>
        );
      case 'value-sensitivity':
        return (
          <section>
            <SectionTitle eyebrow={tx('Sensibilité', 'Sensitivity')} title={tx('Prix de vente et coût de cession', 'Sale price and disposal cost')} />
            <div className="sensitivity-stack"><div><h3>{tx('Plus-value ou moins-value nette', 'Net capital gain or loss')}</h3><div className="sensitivity-table"><div className="sensitivity-table__head"><span>{tx('Coût \\ Prix', 'Cost \\ Price')}</span>{sensitivityPrices.map((price, index) => <strong key={`${price}-${index}`}>{formatMoney(price, watch.currency)}</strong>)}</div>{sensitivityCosts.map((costPct, costIndex) => <div key={`${costPct}-${costIndex}`}><strong>{costPct} %</strong>{sensitivityPrices.map((price, priceIndex) => { const scenario = scenarioPerformance(price, costPct); return <span key={`${price}-${priceIndex}`} className={scenario.gainLoss >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatMoney(scenario.gainLoss, watch.currency)}</strong></span>; })}</div>)}</div></div><div><h3>{tx('TRI annualisé', 'Annualized IRR')}</h3><div className="sensitivity-table sensitivity-table--irr"><div className="sensitivity-table__head"><span>{tx('Coût \\ Prix', 'Cost \\ Price')}</span>{sensitivityPrices.map((price, index) => <strong key={`${price}-${index}`}>{formatMoney(price, watch.currency)}</strong>)}</div>{sensitivityCosts.map((costPct, costIndex) => <div key={`${costPct}-${costIndex}`}><strong>{costPct} %</strong>{sensitivityPrices.map((price, priceIndex) => { const scenario = scenarioPerformance(price, costPct); return <span key={`${price}-${priceIndex}`} className={scenario.irr !== null && scenario.irr >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatPercent(scenario.irr)}</strong></span>; })}</div>)}</div></div></div>
          </section>
        );
      default:
        return null;
    }
  };

  if (isWatchWebsite && requestedPublicCode && (publicProjectionLoading || !publicProjection)) {
    return (
      <div className="watch-website" data-ai-schema-version={AI_SCHEMA_VERSION}>
        <header className="watch-website__masthead">
          <div className="container"><BrandLogo className="watch-website__wordmark" /></div>
        </header>
        <main className="container watch-website__main">
          <div className="watch-website__empty-state">
            {publicProjectionLoading ? <RotateCw className="is-spinning" size={26} /> : <Lock size={26} />}
            <h1>{publicProjectionLoading ? tx('Chargement de la publication', 'Loading publication') : tx('Aucun contenu publié', 'No published content')}</h1>
            <p>{publicProjectionLoading ? tx('Lecture de la projection Firestore…', 'Reading the Firestore projection…') : publicProjectionError}</p>
          </div>
        </main>
      </div>
    );
  }

  if (isWatchWebsite && invalidPublicCode) {
    return (
      <div className="watch-website" data-ai-schema-version={AI_SCHEMA_VERSION}>
        <header className="watch-website__masthead">
          <div className="container"><BrandLogo className="watch-website__wordmark" /></div>
        </header>
        <main className="container watch-website__main">
          <div className="watch-website__empty-state">
            <Lock size={26} />
            <h1>{tx('Lien de publication invalide', 'Invalid publication link')}</h1>
            <p>{tx('Le code public est absent ou mal formé. Aucun aperçu local et aucune donnée du Cartulaire ne sont affichés en remplacement.', 'The public code is missing or malformed. No local preview or Cartulary data is shown as a fallback.')}</p>
          </div>
        </main>
      </div>
    );
  }

  if (isWatchWebsite) {
    const orderedBlocks = PUBLISHED_BLOCK_IDS.filter((blockId) => watchWebsiteBlocks.includes(blockId));
    const websiteCode = publicProjection?.publication.publicCode ?? mockCartulary.publicCode;
    const websiteBrand = publicProjection?.publication.makerName ?? watch.reference.brand;
    const websiteModel = publicProjection?.publication.modelName ?? watch.reference.model;
    return (
      <div className="watch-website" data-ai-schema-version={AI_SCHEMA_VERSION}>
        <header className="watch-website__masthead">
          <div className="container">
            <BrandLogo className="watch-website__wordmark" />
            <div><span className="eyebrow">{publicProjection ? tx('Watch website publié', 'Published Watch website') : tx('Aperçu local Watch website', 'Local Watch website preview')} · {websiteCode}</span><strong>{websiteBrand} · {websiteModel}</strong></div>
          </div>
        </header>
        <main className="container watch-website__main">
          {orderedBlocks.length > 0
            ? orderedBlocks.map((blockId) => <div className="watch-website__block" id={blockId} key={blockId}>{renderWatchWebsiteBlock(blockId)}</div>)
            : <div className="watch-website__empty-state"><Globe2 size={26} /><h1>{tx('Aucun contenu validé', 'No validated content')}</h1><p>{publicProjection ? tx('Cette publication ne contient actuellement aucun bloc.', 'This publication currently contains no blocks.') : tx('Validez au moins une sélection W depuis le Cartulaire pour composer cet aperçu local.', 'Validate at least one W selection from the Cartulary to compose this local preview.')}</p></div>}
        </main>
        <footer className="watch-website__footer"><div className="container"><span className="brand-signature"><BrandLogo variant="symbol" decorative /><span>{tx('Dossier numérique indépendant', 'Independent digital record')}</span></span><span>{websiteCode} · {publicProjection?.seal?.supportCode ?? 'projection'}</span></div></footer>
      </div>
    );
  }

  return (
    <div className="app-shell" data-ai-schema-version={AI_SCHEMA_VERSION}>
      <a className="skip-link" href="#cartulary-content">{language === 'FR' ? 'Aller au contenu' : 'Skip to content'}</a>
      <BarreDossier
        publicCode={mockCartulary.publicCode}
        brand={watch.reference.brand}
        model={watch.reference.model}
        language={language}
        setLanguage={setLanguage}
      />

      {registryReturnHref && (
        <a className="cartulary-registry-return no-print" href={registryReturnHref}>
          <ArrowLeft size={14} aria-hidden="true" />
          {language === 'FR' ? 'Retour au Registre' : 'Back to Registry'}
        </a>
      )}

      <nav className="page-tabs no-print" aria-label={language === 'FR' ? 'Pages du Cartulaire' : 'Cartulary pages'}>
        <div className="container page-tabs__inner">
          {pages.map((page) => (
            <button
              type="button"
              key={page.id}
              className={activePage === page.id ? 'is-active' : ''}
              onClick={() => navigateTo(page.id)}
              aria-current={activePage === page.id ? 'page' : undefined}
            >
              <span>{page.number}</span>
              {page.label}
            </button>
          ))}
          <a
            className="page-tabs__website"
            href={watchWebsiteUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={language === 'FR' ? `Ouvrir l’aperçu Watch website avec ${approvedWebsiteBlocks.length} bloc${approvedWebsiteBlocks.length > 1 ? 's' : ''} validé${approvedWebsiteBlocks.length > 1 ? 's' : ''}` : `Open the Watch website preview with ${approvedWebsiteBlocks.length} validated block${approvedWebsiteBlocks.length === 1 ? '' : 's'}`}
            title={publishedBlocks.length > approvedWebsiteBlocks.length
              ? tx(`${publishedBlocks.length - approvedWebsiteBlocks.length} sélection(s) W attendent une validation`, `${publishedBlocks.length - approvedWebsiteBlocks.length} W selection(s) await validation`)
              : tx('Aperçu local ; la publication autoritaire utilise un code public', 'Local preview; the authoritative publication uses a public code')}
          >
            <Globe2 size={14} />
            {tx('Aperçu W', 'W preview')}
            <span>{approvedWebsiteBlocks.length}</span>
          </a>
          <a
            className="page-tabs__community"
            href="/community"
            target="_blank"
            rel="noreferrer"
            aria-label={language === 'FR'
              ? `Ouvrir le Cercle avec ${approvedCommunityBlocks.length} sélection${approvedCommunityBlocks.length > 1 ? 's' : ''} C validée${approvedCommunityBlocks.length > 1 ? 's' : ''}`
              : `Open the Circle with ${approvedCommunityBlocks.length} validated C selection${approvedCommunityBlocks.length === 1 ? '' : 's'}`}
            title={language === 'FR'
              ? 'Les sélections C locales ne sont pas envoyées au Cercle sans acte serveur distinct'
              : 'Local C selections are not sent to the Circle without a separate server-side act'}
          >
            <Users size={14} />
            {language === 'FR' ? 'Cercle' : 'Circle'}
            <span>{approvedCommunityBlocks.length}</span>
          </a>
          <button
            type="button"
            className="page-tabs__report"
            onClick={handleReportPrint}
            aria-label={orderedReportBlocks.length > 0
              ? tx(`Imprimer le rapport PDF (${orderedReportBlocks.length} blocs sélectionnés)`, `Print the PDF report (${orderedReportBlocks.length} selected blocks)`)
              : tx('Imprimer la page actuelle', 'Print the current page')}
            title={orderedReportBlocks.length > 0
              ? tx('Imprimer le rapport ou l’enregistrer au format PDF', 'Print the report or save it as a PDF')
              : tx('Imprimer la page actuelle ; sélectionnez des blocs R pour composer un rapport personnalisé', 'Print the current page; select R blocks to compose a custom report')}
          >
            <Printer size={14} />
            {language === 'FR' ? 'Rapport PDF' : 'PDF report'}
            <span>{orderedReportBlocks.length}</span>
          </button>
          <button type="button" className="page-tabs__audit" onClick={() => setIsDrawerOpen(true)}>
            <ShieldCheck size={14} />
            {language === 'FR' ? 'Preuves' : 'Proofs'}
          </button>
        </div>
      </nav>

      <section className="audience-toolbar no-print" aria-label={language === 'FR' ? 'Filtre de visibilité' : 'Visibility filter'}>
        <div className="container audience-toolbar__inner">
          <div className="audience-toolbar__summary" aria-live="polite">
            <Eye size={15} aria-hidden="true" />
            <span>{language === 'FR' ? 'Mode de consultation' : 'Viewing mode'}</span>
            <strong>{audienceOptions.find((option) => option.value === audience)?.label}</strong>
            <small>{language === 'FR' ? 'Ce filtre ne publie rien.' : 'This filter does not publish anything.'}</small>
          </div>
          <div className="audience-toolbar__options" role="group" aria-label={language === 'FR' ? 'Choisir les données visibles' : 'Choose visible data'}>
            {audienceOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className={audience === option.value ? 'is-active' : ''}
                onClick={() => setAudience(option.value)}
                aria-pressed={audience === option.value}
                title={option.help}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <main id="cartulary-content" className="container cartulary-main" tabIndex={-1}>
        <CoverPage active={activePage === 'cover'}>
            <section className="cover-sheet publishable-block">
              <BlockMarkers selection={publishProps('cover-watch', true)} label={tx('Accueil de la montre', 'Watch cover')} />
              <div className="cover-sheet__identity">
                <span className="eyebrow">Cartulaire · {mockCartulary.publicCode}</span>
                {editingBlock === 'cover-watch' ? (
                  <><h1 className="sr-only">{specificationValue('Marque', watch.reference.brand)} {specificationValue('Modèle', watch.reference.model)}</h1><div className="cover-sheet__identity-editor">
                    <label>{tx('Marque', 'Brand')}<input {...aiFieldProps('cover.watch.brand')} type="text" value={specificationValue('Marque', watch.reference.brand)} onChange={(event) => updateSpecificationValue('Marque', event.target.value)} /></label>
                    <label>{tx('Nom de la montre', 'Watch name')}<input {...aiFieldProps('cover.watch.model')} type="text" value={specificationValue('Modèle', watch.reference.model)} onChange={(event) => updateSpecificationValue('Modèle', event.target.value)} /></label>
                  </div></>
                ) : (
                  <h1 className="cover-sheet__editable-heading"><button type="button" className="cover-sheet__editable-title editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('cover-watch')} title={audience === 'Secret' ? tx('Cliquer pour modifier', 'Click to edit') : undefined}>
                      <span>{specificationValue('Marque', watch.reference.brand)}</span>
                      <strong>{specificationValue('Modèle', watch.reference.model)}</strong>
                    </button></h1>
                )}
                <div className="cover-sheet__identity-meta">
                  <label className="asset-kind-control">{tx('Type de bien', 'Asset type')}
                    <select {...aiFieldProps('cover.asset.type')} value={assetKind} onChange={(event) => setAssetKind(event.target.value as AssetKind)} disabled={audience !== 'Secret'}>
                      {ASSET_KINDS.map((kind) => <option key={kind} value={kind}>{assetKindLabel(kind)}</option>)}
                    </select>
                  </label>
                  <label className="watch-status-control">{tx('Statut', 'Status')}
                    <select {...aiFieldProps('cover.watch.status')} value={watchStatus} onChange={(event) => setWatchStatus(event.target.value as WatchPatrimonialStatus)} disabled={audience !== 'Secret'}>
                      <option value="Patrimonial">{tx('Patrimonial', 'Collection asset')}</option>
                      <option value="À vendre">{tx('À vendre', 'For sale')}</option>
                      <option value="Ouvert à proposition">{tx('Ouvert à proposition', 'Open to offers')}</option>
                    </select>
                  </label>
                  <small {...aiFieldProps('cover.watch.reference')}>{specificationValue('Numéro de référence', watch.reference.reference)}</small>
                </div>
              </div>
              <button
                type="button"
                className="cover-sheet__photo"
                onClick={() => mainPhoto && setSelectedAsset(mainPhoto)}
                aria-label={tx('Agrandir la photo principale', 'Enlarge main photo')}
              >
                {mainPhoto
                  ? <PrivateMediaImage asset={mainPhoto} alt={`${specificationValue('Marque', watch.reference.brand)} ${specificationValue('Modèle', watch.reference.model)}`} eager />
                  : <span className="empty-media">{tx('PHOTO PRINCIPALE NON AFFECTÉE', 'NO MAIN PHOTO ASSIGNED')}</span>}
              </button>
            </section>

            {isVisible('Secret') ? (
              <>
              <section>
                <SectionTitle eyebrow={tx('Dossier privé', 'Private record')} title={tx('Propriétaire de la montre', 'Watch owner')} publish={publishProps('cover-owner')} />
                <article className="owner-card">
                  <div className="owner-type-selector">
                    <label>{tx('Type de propriétaire', 'Owner type')}
                      <select {...aiFieldProps('cover.owner.type')} value={ownerType} onChange={(event) => setOwnerType(event.target.value as OwnerType)}>
                        <option value="Personne physique">{tx('Personne physique', 'Individual')}</option>
                        <option value="Entreprise">{tx('Entreprise', 'Company')}</option>
                      </select>
                    </label>
                    <p>{tx('Les catégories d’identification ci-dessous restent entièrement personnalisables.', 'The identification categories below remain fully customizable.')}</p>
                  </div>
                  <div className="owner-fields">
                    {ownerFields.map((field) => (
                      <div className="owner-field" key={field.id} data-ai-scope="cover.owner.customFields[]" data-ai-instance={field.id}>
                        <input {...aiFieldProps('cover.owner.customFields[].label', field.id)} type="text" value={field.label} onChange={(event) => updateOwnerField(field.id, { label: event.target.value })} aria-label={tx('Catégorie de donnée propriétaire', 'Owner data category')} />
                        <textarea {...aiFieldProps('cover.owner.customFields[].value', field.id)} value={field.value} rows={field.id === 'owner-address' ? 3 : 2} onChange={(event) => updateOwnerField(field.id, { value: event.target.value })} aria-label={field.label || tx('Donnée propriétaire', 'Owner data')} placeholder={tx('À renseigner', 'To be completed')} />
                        <button type="button" className="icon-button no-print" onClick={() => requestCollectionDeletion({ items: ownerFields, setItems: setOwnerFields, id: field.id, targetLabel: field.label || tx('cette catégorie', 'this category') })} aria-label={tx(`Supprimer ${field.label || 'cette catégorie'}`, `Delete ${field.label || 'this category'}`)}><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="button button--quiet no-print" onClick={() => setOwnerFields((current) => [...current, { id: newId('owner-field'), label: tx('Nouvelle catégorie', 'New category'), value: '' }])}><Plus size={14} /> {tx('Ajouter une catégorie', 'Add category')}</button>

                  <div className="owner-documents">
                    <div className="owner-documents__heading"><div><span className="eyebrow">{tx('Pièces confidentielles', 'Confidential files')}</span><h3>{tx('Documents du propriétaire', 'Owner documents')}</h3></div><span>{ownerDocuments.length} {language === 'FR' ? `fichier${ownerDocuments.length > 1 ? 's' : ''}` : `file${ownerDocuments.length === 1 ? '' : 's'}`}</span></div>
                    {ownerDocuments.length > 0 ? (
                      <div className="owner-document-list">
                        {ownerDocuments.map((document) => (
                          <div className="owner-document" key={document.id} data-ai-scope="cover.owner.documents[]" data-ai-instance={document.id}>
                            <FileText size={20} aria-hidden="true" />
                            <input {...aiFieldProps('cover.owner.documents[].category', document.id)} type="text" value={document.category} onChange={(event) => updateOwnerDocument(document.id, { category: event.target.value })} aria-label={tx('Catégorie du document', 'Document category')} />
                            <div><input {...aiFieldProps('cover.owner.documents[].fileName', document.id)} type="text" value={document.fileName} onChange={(event) => updateOwnerDocument(document.id, { fileName: event.target.value })} aria-label={tx('Nom du fichier', 'File name')} /><small>{formatFileSize(document.size)} · {document.type || tx('fichier', 'file')}</small></div>
                            {document.url && <a className="icon-button no-print" href={document.url} download={document.fileName} aria-label={tx(`Télécharger ${document.fileName}`, `Download ${document.fileName}`)}><ExternalLink size={15} /></a>}
                            <button type="button" className="icon-button no-print" onClick={() => deleteOwnerDocument(document.id)} aria-label={tx(`Supprimer ${document.fileName}`, `Delete ${document.fileName}`)}><Trash2 size={15} /></button>
                          </div>
                        ))}
                      </div>
                    ) : <p className="owner-documents__empty">{tx('Aucun document d’identification ajouté.', 'No identification document added.')}</p>}

                    <form className="owner-document-upload no-print" onSubmit={addOwnerDocuments}>
                      <label>{tx('Catégorie', 'Category')}
                        <select
                          key={ownerType}
                          {...aiFieldProps('cover.owner.documents[].category', 'new')}
                          name="owner-document-category"
                          defaultValue={OWNER_DOCUMENT_CATEGORIES[ownerType][0]}
                          aria-label={tx(`Catégorie de document pour ${ownerType.toLowerCase()}`, 'Owner document category')}
                        >
                          {OWNER_DOCUMENT_CATEGORIES[ownerType].map((category) => <option key={category} value={category}>{ownerDocumentCategoryLabel(category)}</option>)}
                        </select>
                      </label>
                      <label className="file-drop"><Upload size={18} /><span>{tx('Ajouter un ou plusieurs documents', 'Add one or more documents')}</span><small>{tx('PDF, JPG, PNG, WEBP ou HEIC', 'PDF, JPG, PNG, WEBP or HEIC')}</small><input {...aiFieldProps('cover.owner.documents[].file', 'new')} type="file" name="owner-documents" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" multiple /></label>
                      <button type="submit" className="button button--primary">{tx('Ajouter les documents', 'Add documents')}</button>
                    </form>
                  </div>
                </article>
              </section>

              <section>
                <SectionTitle eyebrow={tx('Provenance privée', 'Private provenance')} title={tx("Historique de l'objet - Propriétaires précédents", 'Object history - Previous owners')} publish={publishProps('cover-ownership-history')} />
                <article className="ownership-history-card">
                  <header className="ownership-history-card__heading">
                    <div>
                      <span className="eyebrow">{tx('Chaîne de propriété', 'Ownership chain')}</span>
                      <p>{tx("Documentez chaque période connue. Cette rubrique reste déclarative et distincte du journal serveur de cession ; elle n’en remplace jamais les événements vérifiés. L’identification du premier propriétaire alimente les résumés et l’appréciation de la valeur.", 'Document each known period. This section remains declared provenance and is separate from the server transfer journal; it never replaces verified transfer events. Identifying the first owner feeds summaries and the valuation assessment.')}</p>
                    </div>
                    <span>{ownershipHistory.length} {language === 'FR' ? `période${ownershipHistory.length > 1 ? 's' : ''}` : `period${ownershipHistory.length === 1 ? '' : 's'}`}</span>
                  </header>

                  {ownershipHistory.length > 0 ? (
                    <div className="ownership-history-list">
                      {ownershipHistory.map((entry, index) => {
                        const yearsAreInvalid = Boolean(entry.fromYear && entry.toYear && Number(entry.fromYear) > Number(entry.toYear));
                        return (
                          <article className="ownership-period" key={entry.id} data-ai-scope="cover.ownershipHistory[]" data-ai-instance={entry.id}>
                            <header>
                              <span className="eyebrow">{tx('Période', 'Period')} {String(index + 1).padStart(2, '0')}</span>
                              <label className="ownership-first-owner-selector">
                                <input {...aiFieldProps('cover.ownershipHistory[].firstOwner', entry.id)} type="checkbox" checked={entry.firstOwner} onChange={(event) => selectFirstOwner(entry.id, event.target.checked)} />
                                <span>{tx('Premier propriétaire', 'First owner')}</span>
                              </label>
                              <button type="button" className="icon-button no-print" onClick={() => requestCollectionDeletion({ items: ownershipHistory, setItems: setOwnershipHistory, id: entry.id, targetLabel: tx(`la période ${entry.fromYear || '—'} à ${entry.toYear || '—'}`, `period ${entry.fromYear || '—'} to ${entry.toYear || '—'}`) })} aria-label={tx('Supprimer cette période de propriété', 'Delete this ownership period')}><Trash2 size={15} /></button>
                            </header>
                            <div className="ownership-period__years">
                              <label>{tx('De (année)', 'From (year)')}<input {...aiFieldProps('cover.ownershipHistory[].fromYear', entry.id)} type="number" min="1000" max="2200" step="1" value={entry.fromYear} onChange={(event) => updateOwnershipHistory(entry.id, { fromYear: event.target.value })} aria-invalid={yearsAreInvalid} placeholder="YYYY" /></label>
                              <span aria-hidden="true">→</span>
                              <label>{tx('À (année)', 'To (year)')}<input {...aiFieldProps('cover.ownershipHistory[].toYear', entry.id)} type="number" min="1000" max="2200" step="1" value={entry.toYear} onChange={(event) => updateOwnershipHistory(entry.id, { toYear: event.target.value })} aria-invalid={yearsAreInvalid} placeholder="YYYY" /></label>
                            </div>
                            <label className="ownership-period__description">{tx('Description', 'Description')}<textarea {...aiFieldProps('cover.ownershipHistory[].description', entry.id)} value={entry.description} rows={4} onChange={(event) => updateOwnershipHistory(entry.id, { description: event.target.value })} placeholder={tx('Propriétaire, contexte de détention, documents et éléments de provenance disponibles…', 'Owner, holding context, documents and available provenance evidence…')} /></label>
                            {yearsAreInvalid && <p className="ownership-period__error" role="alert">{tx("L’année de fin doit être postérieure ou égale à l’année de début.", 'The end year must be greater than or equal to the start year.')}</p>}
                          </article>
                        );
                      })}
                    </div>
                  ) : <p className="ownership-history-empty">{tx("Aucun propriétaire précédent renseigné. La provenance antérieure sera signalée comme non documentée dans les résumés et l’évaluation.", 'No previous owner entered. Earlier provenance will be flagged as undocumented in summaries and valuation.')}</p>}

                  <button type="button" className="button button--quiet no-print" onClick={addOwnershipHistory}><Plus size={14} /> {tx('Ajouter une période', 'Add period')}</button>
                  <div className="ownership-history-summary" {...aiFieldProps('cover.ownershipHistory.summary')}>
                    <strong>{tx('Synthèse de provenance', 'Provenance summary')}</strong>
                    <p>{ownershipSummary}</p>
                  </div>
                </article>
              </section>

              <section>
                <SectionTitle eyebrow={tx('Projet patrimonial', 'Estate planning')} title={tx('Transmission', 'Transfer')} publish={publishProps('cover-transmission')} />
                <article className="transmission-card">
                  <header className="transmission-card__heading">
                    <div>
                      <span className="eyebrow">{tx('Personnes désignées', 'Designated people')}</span>
                      <p>{tx('Renseignez les personnes auxquelles vous souhaitez transmettre tout ou partie du bien.', 'Enter the people to whom you intend to transfer all or part of the asset.')}</p>
                    </div>
                    <span>{transmissionRecipients.length} {language === 'FR' ? `personne${transmissionRecipients.length > 1 ? 's' : ''}` : `person${transmissionRecipients.length === 1 ? '' : 's'}`}</span>
                  </header>

                  {transmissionRecipients.length > 0 ? (
                    <div className="transmission-list">
                      {transmissionRecipients.map((recipient, index) => (
                        <article className="transmission-person" key={recipient.id} data-ai-scope="cover.transmission.recipients[]" data-ai-instance={recipient.id}>
                          <header>
                            <span className="eyebrow">{tx('Personne', 'Person')} {String(index + 1).padStart(2, '0')}</span>
                            <button type="button" className="icon-button no-print" onClick={() => requestCollectionDeletion({ items: transmissionRecipients, setItems: setTransmissionRecipients, id: recipient.id, targetLabel: recipient.firstName || recipient.lastName || tx(`la personne ${index + 1}`, `person ${index + 1}`) })} aria-label={tx(`Supprimer ${recipient.firstName || recipient.lastName || `la personne ${index + 1}`}`, `Delete ${recipient.firstName || recipient.lastName || `person ${index + 1}`}`)}><Trash2 size={15} /></button>
                          </header>
                          <div className="transmission-person__fields">
                            <label>{tx('Prénom', 'First name')}<input {...aiFieldProps('cover.transmission.recipients[].firstName', recipient.id)} type="text" value={recipient.firstName} onChange={(event) => updateTransmissionRecipient(recipient.id, { firstName: event.target.value })} placeholder={tx('Prénom', 'First name')} /></label>
                            <label>{tx('Nom', 'Last name')}<input {...aiFieldProps('cover.transmission.recipients[].lastName', recipient.id)} type="text" value={recipient.lastName} onChange={(event) => updateTransmissionRecipient(recipient.id, { lastName: event.target.value })} placeholder={tx('Nom', 'Last name')} /></label>
                            <label className="transmission-person__address">{tx('Adresse', 'Address')}<textarea {...aiFieldProps('cover.transmission.recipients[].address', recipient.id)} value={recipient.address} rows={3} onChange={(event) => updateTransmissionRecipient(recipient.id, { address: event.target.value })} placeholder={tx('Adresse complète', 'Full address')} /></label>
                            <label>Email<input {...aiFieldProps('cover.transmission.recipients[].email', recipient.id)} type="email" value={recipient.email} onChange={(event) => updateTransmissionRecipient(recipient.id, { email: event.target.value })} placeholder={tx('nom@exemple.com', 'name@example.com')} /></label>
                            <label>{tx('Téléphone', 'Phone')}<input {...aiFieldProps('cover.transmission.recipients[].phone', recipient.id)} type="tel" value={recipient.phone} onChange={(event) => updateTransmissionRecipient(recipient.id, { phone: event.target.value })} placeholder="+33…" /></label>
                            <label>{tx('Part donnée', 'Share transferred')}<span className="percentage-input"><input {...aiFieldProps('cover.transmission.recipients[].percentage', recipient.id)} type="number" min="0" max="100" step="0.1" value={recipient.percentage} onChange={(event) => updateTransmissionRecipient(recipient.id, { percentage: event.target.value === '' ? '' : Math.min(100, Math.max(0, Number(event.target.value))) })} placeholder="0" /><span>%</span></span></label>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : <p className="transmission-empty">{tx('Aucune personne renseignée. Ajoutez une personne pour préparer votre projet de transmission.', 'No person entered. Add someone to prepare your transfer plan.')}</p>}

                  <button type="button" className="button button--quiet no-print" onClick={addTransmissionRecipient}><Plus size={14} /> {tx('Ajouter une personne', 'Add person')}</button>
                </article>
              </section>

              <section>
                <SectionTitle eyebrow={tx('Conservation', 'Safekeeping')} title={tx('Stockage', 'Storage')} publish={publishProps('cover-storage')} />
                <article className="storage-card">
                  <header className="storage-card__heading">
                    <div>
                      <span className="eyebrow">{tx('Lieux et contenus', 'Locations and contents')}</span>
                      <p>{tx('Chaque emplacement distingue le lieu, ce qui y est conservé et les conditions de stockage.', 'Each location identifies the place, its stored contents and storage conditions.')}</p>
                    </div>
                    <span>{storageLocations.length} {language === 'FR' ? `lieu${storageLocations.length > 1 ? 'x' : ''}` : `location${storageLocations.length === 1 ? '' : 's'}`}</span>
                  </header>

                  {storageLocations.length > 0 ? (
                    <div className="storage-list">
                      {storageLocations.map((location, index) => (
                        <article className="storage-location" key={location.id} data-ai-scope="cover.storage.locations[]" data-ai-instance={location.id}>
                          <header>
                            <span className="eyebrow">{tx('Lieu', 'Location')} {String(index + 1).padStart(2, '0')}</span>
                            <button type="button" className="icon-button no-print" onClick={() => requestCollectionDeletion({ items: storageLocations, setItems: setStorageLocations, id: location.id, targetLabel: location.name || tx(`le lieu ${index + 1}`, `location ${index + 1}`) })} aria-label={tx(`Supprimer ${location.name || `le lieu ${index + 1}`}`, `Delete ${location.name || `location ${index + 1}`}`)}><Trash2 size={15} /></button>
                          </header>
                          <div className="storage-location__fields">
                            <label>{tx('Lieu de stockage', 'Storage location')}<input {...aiFieldProps('cover.storage.locations[].name', location.id)} type="text" value={location.name} onChange={(event) => updateStorageLocation(location.id, { name: event.target.value })} placeholder={tx('Coffre, cave, domicile…', 'Vault, cellar, home…')} /></label>
                            <label>{tx('Ce qui est stocké', 'Stored contents')}<textarea {...aiFieldProps('cover.storage.locations[].contents', location.id)} value={location.contents} rows={3} onChange={(event) => updateStorageLocation(location.id, { contents: event.target.value })} placeholder={tx('Montre, boîte, papiers, accessoires…', 'Watch, box, papers, accessories…')} /></label>
                            <label>{tx('Description et conditions', 'Description and conditions')}<textarea {...aiFieldProps('cover.storage.locations[].description', location.id)} value={location.description} rows={3} onChange={(event) => updateStorageLocation(location.id, { description: event.target.value })} placeholder={tx('Sécurité, accès, température, humidité ou autres précisions…', 'Security, access, temperature, humidity or other details…')} /></label>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : <p className="storage-empty">{tx('Aucun lieu renseigné. Ajoutez un lieu pour décrire où chaque élément est conservé.', 'No location entered. Add a location to describe where each item is kept.')}</p>}

                  <button type="button" className="button button--quiet no-print" onClick={addStorageLocation}><Plus size={14} /> {tx('Ajouter un lieu de stockage', 'Add storage location')}</button>
                </article>
              </section>
              </>
            ) : <AccessRestricted title={tx('Informations du propriétaire', 'Owner information')} language={language} />}
        </CoverPage>

        <MediaPage active={activePage === 'media'}>
            <section className="watch-hero publishable-block">
              <BlockMarkers selection={publishProps('media-hero', true)} label={tx('Présentation principale', 'Main presentation')} />
              <button
                type="button"
                className="watch-hero__image"
                onClick={() => mainPhoto && setSelectedAsset(mainPhoto)}
                aria-label={language === 'FR' ? 'Agrandir la photo principale' : 'Enlarge main photo'}
              >
                {mainPhoto ? (
                  <span className="watch-hero__image-visual">
                    <PrivateMediaImage asset={mainPhoto} alt={`${watch.reference.brand} ${watch.reference.model}`} eager />
                  </span>
                ) : (
                  <span className="watch-hero__image-visual empty-media">{tx('PHOTO PRINCIPALE NON AFFECTÉE', 'NO MAIN PHOTO ASSIGNED')}</span>
                )}
                <span className="watch-hero__image-label">01 · {tx('Photo principale', 'Main photo')}</span>
                <strong className="watch-hero__image-brand">{watch.reference.brand}</strong>
              </button>

              <div className="watch-hero__card">
                <span className="eyebrow">{watch.reference.reference}</span>
                <h1>{watch.reference.model}</h1>
                {editingBlock === 'media-hero' ? (
                  <textarea {...aiFieldProps('media.hero.summary')} className="editable-copy-single" value={editableCopy.heroSummary} rows={5} onChange={(event) => setEditableCopy((current) => ({ ...current, heroSummary: event.target.value }))} aria-label={tx('Modifier la présentation principale', 'Edit main presentation')} />
                ) : <p {...aiFieldProps('media.hero.summary')} className="watch-hero__summary editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('media-hero')} tabIndex={audience === 'Secret' ? 0 : undefined} onKeyDown={(event) => { if (event.key === 'Enter' && audience === 'Secret') setEditingBlock('media-hero'); }} title={audience === 'Secret' ? tx('Cliquer pour modifier', 'Click to edit') : undefined}>{editableCopy.heroSummary}</p>}
                {audience === 'Secret' && <aside className="ownership-context-note" {...aiFieldProps('cover.ownershipHistory.summary')}><strong>{tx('Provenance propriétaire', 'Ownership provenance')}</strong><p>{ownershipSummary}</p></aside>}
                <dl className="hero-facts">
                  <div><dt>{tx('Statut', 'Status')}</dt><dd>{watchStatusLabel(watchStatus)}</dd></div>
                  <div><dt>{tx('Dernier contrôle', 'Last inspection')}</dt><dd>{formatDate(watch.lastVerificationDate)}</dd></div>
                  <div><dt>{tx('Valeur retenue', 'Retained value')}</dt><dd>{isVisible('Secret') ? formatMoney(retainedValuation.amount, watch.currency) : tx('ACCÈS RESTREINT', 'RESTRICTED ACCESS')}</dd></div>
                  <div><dt>{tx('Dossier', 'Record')}</dt><dd>{mockCartulary.publicCode}</dd></div>
                </dl>
              </div>
            </section>

            <section className="media-wide-section">
              <SectionTitle eyebrow={tx('02 · Vidéo principale', '02 · Main video')} title={tx('La montre en mouvement', 'The watch in motion')} publish={publishProps('media-motion')} />
              {mainVideo ? (
                <VideoPoster asset={mainVideo} onOpen={setSelectedAsset} />
              ) : (
                <AccessRestricted title={tx('Vidéo principale non disponible', 'Main video unavailable')} language={language} />
              )}
            </section>

            <section className="media-wide-section">
              <SectionTitle eyebrow={tx('03 · Séquence 3D', '03 · 3D sequence')} title={tx('Revue à 360°', '360° review')} publish={publishProps('media-spin')} />
              {spinAssets.length > 0 ? (
                <button type="button" className="spin-callout" onClick={() => setIsSpinOpen(true)}>
                  <PrivateMediaImage asset={spinAssets[0]} alt={tx('Aperçu de la séquence 360°', '360° sequence preview')} />
                  <span className="spin-callout__icon"><RotateCw size={23} /></span>
                  <span><strong>{spinAssets.length} {tx('vues ordonnées', 'ordered views')}</strong></span>
                </button>
              ) : (
                <AccessRestricted title={tx('Séquence 3D non affectée', 'No 3D sequence assigned')} language={language} />
              )}
            </section>

            <section>
              <SectionTitle eyebrow={tx('04 · Présentation', '04 · Presentation')} title={tx('Diaporama', 'Slideshow')} publish={publishProps('media-slideshow')} />
              <MediaCarousel assets={presentationAssets} language={language} onOpen={setSelectedAsset} />
            </section>

            {audience === 'Secret' && (
              <section>
                <SectionTitle eyebrow={tx('Gestion des actifs', 'Asset management')} title={tx('Bibliothèque média', 'Media library')} publish={publishProps('media-library')} />
                <div className="media-library-layout">
                  <div className="media-library">
                    {visibleAssets.map((asset) => (
                      <button type="button" key={asset.id} onClick={() => setSelectedAsset(asset)} data-ai-scope="media.assets[]" data-ai-instance={asset.id}>
                        <span className="media-library__preview">
                          {asset.type === 'document' ? (
                            <><FileText size={28} /><small>{asset.mimeType?.split('/').pop()?.toUpperCase() || tx('FICHIER', 'FILE')}</small></>
                          ) : asset.type === 'video' ? (
                            <><Video size={28} /><small>VIDEO</small></>
                          ) : (
                            <PrivateMediaImage asset={asset} alt="" />
                          )}
                        </span>
                        <strong {...aiFieldProps('media.assets[].name', asset.id)}>{asset.name}</strong>
                        <small>{asset.type} · {asset.fileSize || tx('fichier indexé', 'indexed file')}</small>
                        <time {...aiFieldProps('media.assets[].metadataTimestamp', asset.id)} className="media-library__timestamp" dateTime={asset.metadataTimestamp}>
                          {asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : tx('Horodatage indisponible', 'Timestamp unavailable')}
                        </time>
                        <span {...aiFieldProps('media.assets[].tags', asset.id)} className="media-library__tags">
                          {asset.tags.map((tag) => { const definition = MEDIA_TAGS.find((item) => item.id === tag); return <span key={tag}>{definition ? mediaTagLabel(definition) : tag}</span>; })}
                        </span>
                      </button>
                    ))}
                  </div>

                  <form className="media-upload-form no-print" onSubmit={addMediaAssets}>
                    <span className="eyebrow">{tx('Nouvel actif', 'New asset')}</span>
                    <label className="file-drop file-drop--media">
                      <Upload size={18} />
                      <span>{tx('Importer des fichiers vérifiables', 'Import verifiable files')}</span>
                      <small>{tx('JPG, PNG, WEBP, HEIC, MP4, MOV et PDF', 'JPG, PNG, WEBP, HEIC, MP4, MOV and PDF')}</small>
                      <input {...aiFieldProps('media.assets[].file', 'new')} type="file" name="media-files" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.m4v,.mov,.pdf" multiple />
                    </label>
                    <fieldset>
                      <legend>{tx('Tags initiaux', 'Initial tags')}</legend>
                      <div className="upload-tag-options">
                        {MEDIA_TAGS.map((tag) => (
                          <label key={tag.id}>
                            <input
                              {...aiFieldProps('media.assets[].tags', `new:${tag.id}`)}
                              type="checkbox"
                              checked={mediaUploadTags.includes(tag.id)}
                              onChange={() => setMediaUploadTags((current) => current.includes(tag.id)
                                ? current.filter((item) => item !== tag.id)
                                : [...current, tag.id])}
                            />
                            <span>{mediaTagLabel(tag)}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <button type="submit" className="button button--primary">{tx('Ajouter à la bibliothèque', 'Add to library')}</button>
                  </form>
                </div>
              </section>
            )}
        </MediaPage>

        <ReferencePage active={activePage === 'reference'}>
            <PageIntroduction number="02" title={tx('Caractéristiques générales', 'General characteristics')} />

            <section>
              <SectionTitle eyebrow={tx('La référence', 'The reference')} title={tx('Origines', 'Origins')} publish={publishProps('reference-history', true)} />
              <div className="reference-story-grid">
                <article className="editorial-card editorial-card--large">
                <span className="eyebrow">{tx('Historique du modèle', 'Model history')}</span>
                <h2>{isRolexCartulary
                  ? 'La référence qui a défini la GMT vintage'
                  : isIwcCartulary
                    ? 'Une montre de pilote pensée pour voyager'
                    : `Histoire de la référence ${creationReference}`}</h2>
                <EditableParagraphs aiField="reference.origins.history[]" values={editableCopy.originParagraphs} editing={editingBlock === 'reference-history'} onActivate={() => audience === 'Secret' && setEditingBlock('reference-history')} onChange={(index, value) => setEditableCopy((current) => ({ ...current, originParagraphs: current.originParagraphs.map((paragraph, paragraphIndex) => paragraphIndex === index ? value : paragraph) }))} className="history-text" language={language} />
                </article>
                <aside className="quote-card">
                <span className="eyebrow">{tx('À savoir', 'Good to know')}</span>
                {editingBlock === 'reference-history' ? <textarea {...aiFieldProps('reference.origins.knowledge')} value={editableCopy.originKnowledge} rows={7} onChange={(event) => setEditableCopy((current) => ({ ...current, originKnowledge: event.target.value }))} aria-label={tx('Modifier À savoir', 'Edit Good to know')} /> : <p {...aiFieldProps('reference.origins.knowledge')} className="editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('reference-history')} title={audience === 'Secret' ? tx('Cliquer pour modifier', 'Click to edit') : undefined}>{editableCopy.originKnowledge}</p>}
                </aside>
              </div>
            </section>

            <section>
              <SectionTitle eyebrow={tx('Fiche d’identité', 'Identity sheet')} title={tx('Spécifications de la référence', 'Reference specifications')} publish={publishProps('reference-specs')} />
              <div className="specification-groups">
                {specificationGroups.map((group) => (
                  <section className="specification-group" key={group.title}>
                    <h3>{group.title}</h3>
                    <dl>
                      {group.items.map((item) => (
                        <div className="specification-row" key={item.id} data-ai-scope="reference.specifications[]" data-ai-instance={item.id}>
                          {audience === 'Secret' ? (
                            <>
                              <dt><input {...aiFieldProps('reference.specifications[].label', item.id)} type="text" value={item.label} onChange={(event) => updateSpecification(group.id, item.id, { label: event.target.value })} aria-label={tx(`Modifier le nom de ${item.label}`, `Edit the name of ${item.label}`)} /></dt>
                              <dd><input {...aiFieldProps('reference.specifications[].value', item.id)} type="text" value={item.value} onChange={(event) => updateSpecification(group.id, item.id, { value: event.target.value })} aria-label={tx(`Modifier ${item.label}`, `Edit ${item.label}`)} /></dd>
                              <button type="button" className="icon-button no-print" onClick={() => deleteSpecification(group.id, item.id)} aria-label={tx(`Supprimer ${item.label}`, `Delete ${item.label}`)}><Trash2 size={15} /></button>
                            </>
                          ) : <><dt>{item.label}</dt><dd>{item.value}</dd></>}
                        </div>
                      ))}
                    </dl>
                    {audience === 'Secret' && <button type="button" className="specification-add button button--quiet no-print" onClick={() => addSpecification(group.id)}><Plus size={14} /> {tx('Ajouter une donnée', 'Add data')}</button>}
                  </section>
                ))}
              </div>
            </section>

            <section>
              <div className="section-heading-row">
                <SectionTitle eyebrow={tx('Identification', 'Identification')} title={tx('Points à contrôler', 'Inspection points')} />
                <div className="section-heading-actions">
                  <BlockMarkers selection={publishProps('reference-checks')} label={tx('Points à contrôler', 'Inspection points')} />
                  {audience === 'Secret' && (
                    <button type="button" className={`content-marker content-marker--edit no-print ${isEditingChecks ? 'is-active' : ''}`} onClick={() => setIsEditingChecks((value) => !value)} aria-pressed={isEditingChecks} aria-label={isEditingChecks ? tx('Terminer la modification de la liste', 'Finish editing the list') : tx('Modifier la liste', 'Edit the list')} title={tx('Modifier la liste', 'Edit the list')}><Pencil size={15} /></button>
                  )}
                </div>
              </div>
              <div className="identification-list">
                {identificationChecks.map((item, index) => (
                  <article key={item.id} className={item.checked ? 'is-checked' : ''} data-ai-scope="reference.checks[]" data-ai-instance={item.id}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <label className="control-check">
                      <input
                        {...aiFieldProps('reference.checks[].checked', item.id)}
                        type="checkbox"
                        checked={item.checked}
                        disabled={audience !== 'Secret'}
                        onChange={(event) => updateCheck(item.id, { checked: event.target.checked })}
                      />
                      <span aria-hidden="true">✓</span>
                    </label>
                    <div>
                      {isEditingChecks ? (
                        <>
                          <input {...aiFieldProps('reference.checks[].title', item.id)} value={item.title} onChange={(event) => updateCheck(item.id, { title: event.target.value })} aria-label={tx('Point de contrôle', 'Inspection point')} />
                          <textarea {...aiFieldProps('reference.checks[].note', item.id)} value={item.note} onChange={(event) => updateCheck(item.id, { note: event.target.value })} aria-label={tx('Détail du contrôle', 'Inspection details')} rows={2} />
                        </>
                      ) : (
                        <><h3>{item.title}</h3><p>{item.note}</p></>
                      )}
                    </div>
                    {isEditingChecks && (
                      <button
                        type="button"
                        className="icon-button no-print"
                        onClick={() => requestCollectionDeletion({ items: identificationChecks, setItems: setIdentificationChecks, id: item.id, targetLabel: item.title })}
                        aria-label={tx(`Supprimer ${item.title}`, `Delete ${item.title}`)}
                      ><Trash2 size={15} /></button>
                    )}
                  </article>
                ))}
              </div>
              {audience === 'Secret' && (
                <button type="button" className="button button--quiet no-print" onClick={addCheck}><Plus size={14} /> {tx('Ajouter un point', 'Add point')}</button>
              )}
              <p className="method-note">{tx('Le Sceau public identifie une projection W émise par le serveur. La chaîne serveur se vérifie dans « Preuves ». Aucun de ces indicateurs ne remplace l’examen physique ni la conclusion d’un expert.', 'The public Seal identifies a server-issued W projection. The server chain is checked under “Proofs”. Neither indicator replaces a physical examination or an expert opinion.')}</p>
            </section>

            <section>
              <SectionTitle eyebrow={tx('Communauté et ressources', 'Community and resources')} title={tx('Popularité du modèle', 'Model popularity')} publish={publishProps('reference-popularity')} />
              <div className="popularity-resources">
                <div className="popularity-resources__head"><span>{tx('Site ou forum', 'Website or forum')}</span><span>Type</span><span>URL</span><span /></div>
                {popularityResources.map((resource) => {
                  const hasValidUrl = /^https?:\/\//i.test(resource.url);
                  return (
                    <div key={resource.id} data-ai-scope="reference.popularity[]" data-ai-instance={resource.id}>
                      {audience === 'Secret' ? (
                        <input {...aiFieldProps('reference.popularity[].name', resource.id)} type="text" value={resource.name} onChange={(event) => updatePopularityResource(resource.id, 'name', event.target.value)} aria-label={tx('Nom du site ou forum', 'Website or forum name')} />
                      ) : (
                        <strong>{resource.name}</strong>
                      )}
                      {audience === 'Secret' ? (
                        <select {...aiFieldProps('reference.popularity[].type', resource.id)} value={resource.type} onChange={(event) => updatePopularityResource(resource.id, 'type', event.target.value as PopularityResourceType)} aria-label={`Type ${resource.name}`}>
                          {(['Forum officiel', 'Discussion dédiée', 'Communauté', 'Base de données', 'Revue'] as PopularityResourceType[]).map((type) => <option key={type} value={type}>{popularityTypeLabel(type)}</option>)}
                        </select>
                      ) : (
                        <span>{popularityTypeLabel(resource.type)}</span>
                      )}
                      <div className="popularity-url-cell">
                        {audience === 'Secret' ? (
                          <input {...aiFieldProps('reference.popularity[].url', resource.id)} type="url" value={resource.url} onChange={(event) => updatePopularityResource(resource.id, 'url', event.target.value)} aria-label={`URL ${resource.name}`} placeholder="https://" />
                        ) : (
                          <span>{resource.url}</span>
                        )}
                        {hasValidUrl && <a href={resource.url} target="_blank" rel="noreferrer" aria-label={tx(`Ouvrir ${resource.name}`, `Open ${resource.name}`)}><ExternalLink size={15} /></a>}
                      </div>
                      {audience === 'Secret' && <button type="button" className="icon-button no-print" onClick={() => requestCollectionDeletion({ items: popularityResources, setItems: setPopularityResources, id: resource.id, targetLabel: resource.name })} aria-label={tx(`Supprimer ${resource.name}`, `Delete ${resource.name}`)}><Trash2 size={15} /></button>}
                    </div>
                  );
                })}
              </div>
              {audience === 'Secret' && (
                <button type="button" className="button button--quiet no-print" onClick={() => setPopularityResources((current) => [...current, { id: newId('popularity'), name: '', type: 'Communauté', url: '' }])}><Plus size={14} /> {tx('Ajouter un site ou forum', 'Add a website or forum')}</button>
              )}
            </section>
        </ReferencePage>

        <ConditionPage active={activePage === 'condition'}>
            <PageIntroduction number="03" title={tx('État de la montre', 'Watch condition')} />

            {isVisible('Communauté') ? (
              <>
                <section>
                  <SectionTitle eyebrow={tx('Synthèse', 'Summary')} title={tx('Description de la montre', 'Watch description')} publish={publishProps('condition-description', true)} />
                  <article className="watch-description-card">
                    <EditableParagraphs aiField="condition.description.paragraphs[]" values={editableCopy.watchDescription} editing={editingBlock === 'condition-description'} onActivate={() => audience === 'Secret' && setEditingBlock('condition-description')} onChange={(index, value) => setEditableCopy((current) => ({ ...current, watchDescription: current.watchDescription.map((paragraph, paragraphIndex) => paragraphIndex === index ? value : paragraph) }))} language={language} />
                    <aside className="ownership-context-note" {...aiFieldProps('cover.ownershipHistory.summary')}><strong>{tx('Provenance prise en compte', 'Provenance considered')}</strong><p>{ownershipSummary}</p></aside>
                  </article>
                </section>

                <section>
                  <SectionTitle eyebrow={tx('Synthèse', 'Summary')} title={tx('État actuel', 'Current condition')} publish={publishProps('condition-summary', true)} />
                  <article className="current-condition-summary">
                    <EditableParagraphs aiField="condition.summary.paragraphs[]" values={editableCopy.conditionSummary} editing={editingBlock === 'condition-summary'} onActivate={() => audience === 'Secret' && setEditingBlock('condition-summary')} onChange={(index, value) => setEditableCopy((current) => ({ ...current, conditionSummary: current.conditionSummary.map((paragraph, paragraphIndex) => paragraphIndex === index ? value : paragraph) }))} language={language} />
                    <dl>
                      <div><dt>{tx('Dernier état', 'Latest condition')}</dt><dd>{editingBlock === 'condition-summary' ? <input {...aiFieldProps('condition.summary.lastCondition')} value={editableCopy.conditionFacts.lastCondition} onChange={(event) => setEditableCopy((current) => ({ ...current, conditionFacts: { ...current.conditionFacts, lastCondition: event.target.value } }))} aria-label={tx('Dernier état', 'Latest condition')} /> : <button {...aiFieldProps('condition.summary.lastCondition')} type="button" className="editable-fact" onClick={() => audience === 'Secret' && setEditingBlock('condition-summary')}>{editableCopy.conditionFacts.lastCondition}</button>}</dd></div>
                      <div><dt>Conclusion</dt><dd>{editingBlock === 'condition-summary' ? <input {...aiFieldProps('condition.summary.conclusion')} value={editableCopy.conditionFacts.conclusion} onChange={(event) => setEditableCopy((current) => ({ ...current, conditionFacts: { ...current.conditionFacts, conclusion: event.target.value } }))} aria-label="Conclusion" /> : <button {...aiFieldProps('condition.summary.conclusion')} type="button" className="editable-fact" onClick={() => audience === 'Secret' && setEditingBlock('condition-summary')}>{editableCopy.conditionFacts.conclusion}</button>}</dd></div>
                      <div><dt>{tx('Point ouvert', 'Open point')}</dt><dd>{editingBlock === 'condition-summary' ? <input {...aiFieldProps('condition.summary.openPoint')} value={editableCopy.conditionFacts.openPoint} onChange={(event) => setEditableCopy((current) => ({ ...current, conditionFacts: { ...current.conditionFacts, openPoint: event.target.value } }))} aria-label={tx('Point ouvert', 'Open point')} /> : <button {...aiFieldProps('condition.summary.openPoint')} type="button" className="editable-fact" onClick={() => audience === 'Secret' && setEditingBlock('condition-summary')}>{editableCopy.conditionFacts.openPoint}</button>}</dd></div>
                    </dl>
                  </article>
                </section>

                <section>
                  <SectionTitle eyebrow={tx('Ensemble associé', 'Associated set')} title={tx('Papiers, documentation et accessoires', 'Papers, documentation and accessories')} publish={publishProps('condition-documentation')} />
                  <div className="documentation-register">
                    <div className="documentation-register__head"><span>{tx('Catégorie', 'Category')}</span><span>Description</span><span>{tx('État', 'Condition')}</span><span /></div>
                    {documentationItems.map((item) => (
                      <div key={item.id} data-ai-scope="condition.documentation[]" data-ai-instance={item.id}>
                        <select {...aiFieldProps('condition.documentation[].category', item.id)} value={item.category} disabled={audience !== 'Secret'} onChange={(event) => updateDocumentationItem(item.id, 'category', event.target.value as DocumentationCategory)} aria-label={tx('Catégorie documentaire', 'Document category')}>
                          {(['Facture', 'Garantie', 'Assurances', 'Boîte', 'Écrin', 'Manuel', 'Certificat', 'Accessoire', 'Autre'] as DocumentationCategory[]).map((category) => <option key={category} value={category}>{documentationCategoryLabel(category)}</option>)}
                        </select>
                        <textarea {...aiFieldProps('condition.documentation[].description', item.id)} value={item.description} disabled={audience !== 'Secret'} onChange={(event) => updateDocumentationItem(item.id, 'description', event.target.value)} aria-label={`Description ${item.category}`} rows={2} />
                        <select {...aiFieldProps('condition.documentation[].state', item.id)} value={item.state} disabled={audience !== 'Secret'} onChange={(event) => updateDocumentationItem(item.id, 'state', event.target.value as DocumentationState)} aria-label={tx(`État ${item.category}`, `${item.category} condition`)}>
                          {(['Présent', 'Complet', 'Incomplet', 'Manquant', 'À vérifier'] as DocumentationState[]).map((state) => <option key={state} value={state}>{documentationStateLabel(state)}</option>)}
                        </select>
                        {audience === 'Secret' && <button type="button" className="icon-button no-print" onClick={() => requestCollectionDeletion({ items: documentationItems, setItems: setDocumentationItems, id: item.id, targetLabel: item.category })} aria-label={tx(`Supprimer ${item.category}`, `Delete ${item.category}`)}><Trash2 size={15} /></button>}
                      </div>
                    ))}
                  </div>
                  {audience === 'Secret' && (
                    <button type="button" className="button button--quiet no-print" onClick={() => setDocumentationItems((current) => [...current, { id: newId('documentation'), category: 'Autre', description: '', state: 'À vérifier' }])}><Plus size={14} /> {tx('Ajouter un élément', 'Add item')}</button>
                  )}
                  <div className="documentation-media">
                    <div className="documentation-media__heading">
                      <h3>{tx('Fichiers liés', 'Linked files')}</h3>
                      <span>{documentationAssets.length} {language === 'FR' ? `média${documentationAssets.length > 1 ? 's' : ''}` : `media item${documentationAssets.length === 1 ? '' : 's'}`}</span>
                    </div>
                    {documentationAssets.length > 0 ? (
                      <div className="documentation-media__grid">
                        {documentationAssets.map((asset) => (
                          <button type="button" key={asset.id} onClick={() => setSelectedAsset(asset)}>
                            <span className="documentation-media__preview">
                              {asset.type === 'document'
                                ? <FileText size={28} aria-hidden="true" />
                                : asset.type === 'video'
                                  ? <Video size={28} aria-hidden="true" />
                                : <PrivateMediaImage asset={asset} alt="" />}
                              {asset.type === 'video' && <Play size={13} fill="currentColor" aria-hidden="true" />}
                            </span>
                            <strong>{asset.name}</strong>
                            <small>{asset.tags.includes('documentation') ? 'Documentation' : 'Accessoires'}</small>
                            <time dateTime={asset.metadataTimestamp}>{asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : tx('Horodatage indisponible', 'Timestamp unavailable')}</time>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="documentation-media__empty">{tx('Aucun fichier n’est encore marqué « Documentation » ou « Accessoires ».', 'No file is currently tagged “Documentation” or “Accessories”.')}</p>
                    )}
                  </div>
                </section>

                <section>
                  <SectionTitle eyebrow={tx('Rapports et notes', 'Reports and notes')} title={tx("Rapport sur l'état de la montre", 'Watch condition report')} />
                  <div className="condition-layout">
                    <div className="condition-entry-list">
                      {referenceConditionReport && (
                        <article className="condition-entry condition-entry--publishable" data-ai-scope="condition.reports[]" data-ai-instance={referenceConditionReport.id}>
                          <header>
                            <time {...aiFieldProps('condition.reports[].date', referenceConditionReport.id)}>{formatDate(referenceConditionReport.date)}</time>
                            {editingBlock === 'condition-reference-report'
                              ? <input {...aiFieldProps('condition.reports[].title', referenceConditionReport.id)} className="condition-entry__title-input" value={referenceConditionReport.title} onChange={(event) => setConditionEntries((current) => current.map((entry) => entry.id === referenceConditionReport.id ? { ...entry, title: event.target.value } : entry))} aria-label={tx('Modifier le titre du rapport de référence', 'Edit reference report title')} />
                              : <h3 {...aiFieldProps('condition.reports[].title', referenceConditionReport.id)}>{referenceConditionReport.title}</h3>}
                            <div className="condition-entry__actions">
                              <BlockMarkers selection={publishProps('condition-reference-report', true)} label={tx('Rapport d’état de référence', 'Reference condition report')} />
                              {audience === 'Secret' && <button type="button" className="icon-button no-print" onClick={() => deleteConditionEntry(referenceConditionReport.id)} aria-label={tx(`Supprimer ${referenceConditionReport.title}`, `Delete ${referenceConditionReport.title}`)}><Trash2 size={15} /></button>}
                            </div>
                          </header>
                          {editingBlock === 'condition-reference-report'
                            ? <textarea {...aiFieldProps('condition.reports[].note', referenceConditionReport.id)} className="condition-entry__note-input" value={referenceConditionReport.note} rows={5} onChange={(event) => setConditionEntries((current) => current.map((entry) => entry.id === referenceConditionReport.id ? { ...entry, note: event.target.value } : entry))} aria-label={tx('Modifier le rapport de référence', 'Edit reference report')} />
                            : referenceConditionReport.note && <p {...aiFieldProps('condition.reports[].note', referenceConditionReport.id)} className="editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('condition-reference-report')} title={audience === 'Secret' ? tx('Cliquer pour modifier', 'Click to edit') : undefined}>{referenceConditionReport.note}</p>}
                          {referenceConditionReport.attachments.length > 0 && (
                            <ul className="attachment-list">
                              {referenceConditionReport.attachments.map((attachment, index) => <li key={`${referenceConditionReport.id}-${attachment.name}-${index}`}><Paperclip size={13} />{attachment.url ? <a href={attachment.url} download={attachment.name}>{attachment.name}</a> : <span>{attachment.name}</span>}{attachment.size && <small>{Math.ceil(attachment.size / 1024)} ko</small>}</li>)}
                            </ul>
                          )}
                        </article>
                      )}

                      <div className="prior-reviews-group">
                        <header className="prior-reviews-group__heading">
                          <div><span className="eyebrow">{tx('Historique', 'History')}</span><h3>{tx('Revues antérieures', 'Previous reviews')}</h3></div>
                          <BlockMarkers selection={publishProps('condition-prior-reviews', true)} label={tx('Revues antérieures', 'Previous reviews')} />
                        </header>
                        {priorConditionReviews.length > 0 ? priorConditionReviews.map((entry) => (
                          <article key={entry.id} className="condition-entry" data-ai-scope="condition.reports[]" data-ai-instance={entry.id}>
                            <header>
                              <time {...aiFieldProps('condition.reports[].date', entry.id)}>{formatDate(entry.date)}</time>
                              {editingBlock === 'condition-prior-reviews'
                                ? <input {...aiFieldProps('condition.reports[].title', entry.id)} className="condition-entry__title-input" value={entry.title} onChange={(event) => setConditionEntries((current) => current.map((item) => item.id === entry.id ? { ...item, title: event.target.value } : item))} aria-label={tx('Modifier le titre de la revue', 'Edit review title')} />
                                : <h3 {...aiFieldProps('condition.reports[].title', entry.id)}>{entry.title === 'Revues antérieures' ? tx(`Revue du ${formatDate(entry.date)}`, `Review dated ${formatDate(entry.date)}`) : entry.title}</h3>}
                              {audience === 'Secret' && <button type="button" className="icon-button no-print" onClick={() => deleteConditionEntry(entry.id)} aria-label={tx(`Supprimer ${entry.title}`, `Delete ${entry.title}`)}><Trash2 size={15} /></button>}
                            </header>
                            {editingBlock === 'condition-prior-reviews'
                              ? <textarea {...aiFieldProps('condition.reports[].note', entry.id)} className="condition-entry__note-input" value={entry.note} rows={4} onChange={(event) => setConditionEntries((current) => current.map((item) => item.id === entry.id ? { ...item, note: event.target.value } : item))} aria-label={tx('Modifier la revue antérieure', 'Edit previous review')} />
                              : entry.note && <p {...aiFieldProps('condition.reports[].note', entry.id)} className="editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('condition-prior-reviews')} title={audience === 'Secret' ? tx('Cliquer pour modifier', 'Click to edit') : undefined}>{entry.note}</p>}
                            {entry.attachments.length > 0 && (
                              <ul className="attachment-list">
                                {entry.attachments.map((attachment, index) => <li key={`${entry.id}-${attachment.name}-${index}`}><Paperclip size={13} />{attachment.url ? <a href={attachment.url} download={attachment.name}>{attachment.name}</a> : <span>{attachment.name}</span>}{attachment.size && <small>{Math.ceil(attachment.size / 1024)} ko</small>}</li>)}
                              </ul>
                            )}
                          </article>
                        )) : <p className="prior-reviews-group__empty">{tx('Aucune revue antérieure enregistrée.', 'No previous review recorded.')}</p>}
                      </div>
                    </div>

                    {audience === 'Secret' && (
                      <form className="condition-form no-print" onSubmit={addConditionEntry}>
                        <span className="eyebrow">{tx('Nouvelle entrée', 'New entry')}</span>
                        <label>Date<input {...aiFieldProps('condition.reports[].date', 'new')} type="date" name="date" defaultValue="2026-08-13" required /></label>
                        <label>{tx('Titre', 'Title')}<input {...aiFieldProps('condition.reports[].title', 'new')} type="text" name="title" placeholder={tx('Rapport, constat, note…', 'Report, observation, note…')} /></label>
                        <label>Note<textarea {...aiFieldProps('condition.reports[].note', 'new')} name="note" rows={7} placeholder={tx('Saisir un texte libre', 'Enter free text')} /></label>
                        <label className="file-drop"><Upload size={18} /><span>{tx('Ajouter des documents', 'Add documents')}</span><input {...aiFieldProps('condition.reports[].documents', 'new')} type="file" name="documents" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif" multiple /></label>
                        <button type="submit" className="button button--primary">{tx('Enregistrer', 'Save')}</button>
                      </form>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <AccessRestricted title={tx('Rapports et notes de la montre', 'Watch reports and notes')} language={language} />
            )}
        </ConditionPage>

        <ValuePage active={activePage === 'value'}>
            <PageIntroduction number="04" title={tx('Valorisation', 'Valuation')} />

            {isVisible('Secret') ? (
              <section>
                <SectionTitle eyebrow={tx('Évaluation de marché', 'Market valuation')} title={tx('Données de marché', 'Market data')} publish={publishProps('value-market')} />
                <div className="market-grid">
                  <article className="market-chart-card">
                    <div className="market-chart-card__heading"><span className="eyebrow">{tx('Évolution du marché', 'Market trend')}</span><button type="button" className="button button--quiet no-print" onClick={() => setIsMarketHistoryEditorOpen(true)}><Plus size={14} /> {tx('Ajouter une évaluation', 'Add valuation')}</button></div>
                    <div className="market-bars" aria-label={tx('Évolution des évaluations médianes', 'Median valuation trend')}>
                      {marketValues.map((valuation) => (
                        <div key={valuation.id} data-ai-scope="value.market.valuations[]" data-ai-instance={valuation.id}>
                          <span style={{ height: `${Math.max(18, (valuation.midValue / maxMarketValue) * 100)}%` }} />
                          <strong {...aiFieldProps('value.market.valuations[].midValue', valuation.id)} data-ai-currency={valuation.currency}>{formatMoney(valuation.midValue, valuation.currency)}</strong>
                          <time {...aiFieldProps('value.market.valuations[].date', valuation.id)}>{formatDate(valuation.date)}</time>
                        </div>
                      ))}
                    </div>
                    <small>{tx('Source : évaluations datées du dossier · échantillon interne', 'Source: dated valuations from the record · internal sample')}</small>
                  </article>

                  <article className="market-depth-card">
                  <div className="market-depth-card__heading">
                    <span className="eyebrow">{tx('Profondeur de marché', 'Market depth')}</span>
                    <label>{tx('Date de l’analyse', 'Analysis date')}<input {...aiFieldProps('value.market.analysisDate')} type="date" value={marketDepth.analysisDate} onChange={(event) => setMarketDepth((current) => ({ ...current, analysisDate: event.target.value }))} /></label>
                  </div>
                  <div className="metric-grid">
                    <div className="metric-grid__editable"><input {...aiFieldProps('value.market.activeListings')} type="number" min="0" value={marketDepth.activeListings} onChange={(event) => setMarketDepth((current) => ({ ...current, activeListings: Math.max(0, Number(event.target.value)) }))} aria-label={tx('Annonces actives', 'Active listings')} /><span>{tx('Annonces actives', 'Active listings')}</span></div>
                    <div className="metric-grid__editable"><input {...aiFieldProps('value.market.transactions12m')} type="number" min="0" value={marketDepth.transactions12m} onChange={(event) => setMarketDepth((current) => ({ ...current, transactions12m: Number(event.target.value) }))} aria-label={tx('Transactions identifiées sur les douze derniers mois', 'Transactions identified over the last twelve months')} /><span>{tx('Transactions identifiées · 12 mois', 'Transactions identified · 12 months')}</span></div>
                    <div className="metric-grid__editable"><input {...aiFieldProps('value.market.medianDaysOnMarket')} type="number" min="0" value={marketDepth.medianDaysOnMarket} onChange={(event) => setMarketDepth((current) => ({ ...current, medianDaysOnMarket: Math.max(0, Number(event.target.value)) }))} aria-label={tx('Délai médian estimé en jours', 'Estimated median time in days')} /><span>{tx('Délai médian estimé · jours', 'Estimated median time · days')}</span></div>
                  </div>
                  <div className="valuation-range valuation-range--editable">
                    <span>{tx('Fourchette actuelle', 'Current range')}</span>
                    <div>
                      <label>{tx('Valeur basse', 'Low value')}<input {...aiFieldProps('value.market.lowValue')} type="number" min="0" step="100" value={marketDepth.lowValue} onChange={(event) => setMarketDepth((current) => ({ ...current, lowValue: Math.max(0, Number(event.target.value)) }))} /></label>
                      <label>{tx('Valeur médiane', 'Median value')}<input {...aiFieldProps('value.market.midValue')} type="number" min="0" step="100" value={marketDepth.midValue} onChange={(event) => setMarketDepth((current) => ({ ...current, midValue: Math.max(0, Number(event.target.value)) }))} /></label>
                      <label>{tx('Valeur haute', 'High value')}<input {...aiFieldProps('value.market.highValue')} type="number" min="0" step="100" value={marketDepth.highValue} onChange={(event) => setMarketDepth((current) => ({ ...current, highValue: Math.max(0, Number(event.target.value)) }))} /></label>
                    </div>
                  </div>
                  </article>

                  <article className="retained-value-card">
                    <div className="retained-value-card__intro">
                      <span className="eyebrow">{tx('Décision du propriétaire', 'Owner decision')}</span>
                      <h3>{tx('Valeur retenue', 'Retained value')}</h3>
                      <p>{tx('Le montant est initialisé avec la valeur actuelle, puis peut être ajusté manuellement sans modifier les données de marché.', 'The amount starts with the current value and can then be adjusted manually without changing market data.')}</p>
                    </div>
                    <label className="retained-value-card__amount">{tx('Montant retenu', 'Retained amount')}
                      <span>
                        <input {...aiFieldProps('value.retained.amount')} type="number" min="0" step="100" value={retainedValuation.amount} onChange={(event) => setRetainedValuation((current) => ({ ...current, amount: Math.max(0, Number(event.target.value)) }))} />
                        <strong>{watch.currency || 'EUR'}</strong>
                      </span>
                      <small>{tx('Valeur actuelle', 'Current value')} : {formatMoney(marketDepth.midValue, watch.currency)}</small>
                    </label>
                    <label className="retained-value-card__explanation">{tx('Explication de la valeur retenue', 'Retained value explanation')}
                      <textarea {...aiFieldProps('value.retained.explanation')} value={retainedValuation.explanation} rows={4} onChange={(event) => setRetainedValuation((current) => ({ ...current, explanation: event.target.value }))} placeholder={tx('Expliquez le montant retenu, les ajustements et les réserves éventuelles.', 'Explain the retained amount, adjustments and any reservations.')} />
                    </label>
                    <aside className="ownership-valuation-note" {...aiFieldProps('value.provenance.ownershipAssessment')}>
                      <strong>{tx('Critère de provenance', 'Provenance criterion')}</strong>
                      <p>{ownershipAssessment}</p>
                    </aside>
                  </article>
                </div>
              </section>
            ) : (
              <AccessRestricted title={tx('Analyse de marché', 'Market analysis')} language={language} />
            )}

            {isVisible('Secret') && (
              <section>
                <SectionTitle eyebrow={tx('Analyse de marché', 'Market analysis')} title={tx('Comparables', 'Comparable items')} />
                <div className="comparable-groups">
                  <ComparableTable title={tx('Annonces en cours', 'Current listings')} items={listingComparables} selection={publishProps('value-comparables-listings')} onUpdate={updateComparable} onDelete={(id) => { const item = comparables.find((candidate) => candidate.id === id); if (item) requestCollectionDeletion({ items: comparables, setItems: setComparables, id, targetLabel: item.description || tx('Comparable sans titre', 'Untitled comparable') }); }} onAdd={() => addComparable('Annonce')} language={language} />
                  <ComparableTable title={tx('Transactions réalisées', 'Completed transactions')} items={transactionComparables} selection={publishProps('value-comparables-transactions')} onUpdate={updateComparable} onDelete={(id) => { const item = comparables.find((candidate) => candidate.id === id); if (item) requestCollectionDeletion({ items: comparables, setItems: setComparables, id, targetLabel: item.description || tx('Comparable sans titre', 'Untitled comparable') }); }} onAdd={() => addComparable('Transaction')} language={language} />
                </div>

                <div className="comparables-analysis">
                  <div className="comparables-analysis__heading"><h3>{tx('Synthèse de l’analyse', 'Analysis summary')}</h3><BlockMarkers selection={publishProps('value-comparables-analysis')} label={tx('Synthèse de l’analyse des comparables', 'Comparable analysis summary')} /></div>
                  <div className="comparables-analysis-table" role="table" aria-label={tx('Synthèse de l’analyse des comparables', 'Comparable analysis summary')}>
                    <div className="comparables-analysis-table__head" role="row">
                      <span>{tx('Angle d’analyse', 'Analysis angle')}</span><span>{tx('Constat', 'Finding')}</span><span>{tx('Lecture', 'Interpretation')}</span>
                    </div>
                    {comparableAnalysis.map((entry) => (
                      <div {...aiFieldProps('value.comparables.analysis[]', entry.id)} role="row" key={entry.id} data-ai-scope="value.comparables.analysis[]" data-ai-instance={entry.id}>
                        <input {...aiFieldProps('value.comparables.analysis[].angle', entry.id)} type="text" value={entry.angle} onChange={(event) => updateComparableAnalysis(entry.id, { angle: event.target.value })} aria-label={tx('Angle d’analyse', 'Analysis angle')} />
                        <input {...aiFieldProps('value.comparables.analysis[].finding', entry.id)} type="text" value={entry.finding} onChange={(event) => updateComparableAnalysis(entry.id, { finding: event.target.value })} aria-label={tx('Constat d’analyse', 'Analysis finding')} />
                        <textarea {...aiFieldProps('value.comparables.analysis[].reading', entry.id)} value={entry.reading} rows={2} onChange={(event) => updateComparableAnalysis(entry.id, { reading: event.target.value })} aria-label={tx('Lecture de l’analyse', 'Analysis interpretation')} />
                        <button type="button" className="icon-button no-print" onClick={() => requestCollectionDeletion({ items: comparableAnalysis, setItems: setComparableAnalysis, id: entry.id, targetLabel: entry.angle })} aria-label={tx(`Supprimer ${entry.angle}`, `Delete ${entry.angle}`)}><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="button button--quiet no-print" onClick={() => setComparableAnalysis((current) => [...current, { id: newId('analysis'), angle: '', finding: '', reading: '' }])}><Plus size={14} /> {tx('Ajouter une ligne d’analyse', 'Add analysis row')}</button>
                  <small>{language === 'FR' ? `ÉCHANTILLON INTERNE · ${comparables.length} OBSERVATION${comparables.length > 1 ? 'S' : ''} · CONCLUSIONS À CONFIRMER PAR UN ÉCHANTILLON ÉLARGI` : `INTERNAL SAMPLE · ${comparables.length} OBSERVATION${comparables.length === 1 ? '' : 'S'} · CONCLUSIONS TO BE CONFIRMED USING A LARGER SAMPLE`}</small>
                </div>
              </section>
            )}

            {isVisible('Secret') && (
              <section>
                <SectionTitle eyebrow={tx('Acquisition', 'Acquisition')} title={tx('Prix de revient', 'Cost basis')} publish={publishProps('value-cost-basis')} />
                <div className="cost-basis-card">
                  <div className="purchase-fields">
                    <label>{tx('Date d’achat', 'Purchase date')}<input {...aiFieldProps('value.purchase.date')} type="date" value={purchase.date} onChange={(event) => setPurchase({ ...purchase, date: event.target.value })} /></label>
                    <label>{tx('Valeur d’achat', 'Purchase value')}<input {...aiFieldProps('value.purchase.price')} type="number" min="0" step="1" value={purchase.purchasePrice} onChange={(event) => setPurchase({ ...purchase, purchasePrice: Number(event.target.value) })} /></label>
                  </div>
                  <div className="expense-table">
                    <div className="expense-table__head"><span>Type</span><span>Date</span><span>{tx('Libellé', 'Label')}</span><span>{tx('Montant', 'Amount')}</span><span /></div>
                    {purchaseExpenses.map((expense) => (
                      <div key={expense.id} data-ai-scope="value.expenses[]" data-ai-instance={expense.id}>
                        <select {...aiFieldProps('value.expenses[].kind', expense.id)} value={expense.kind} onChange={(event) => updateExpense(expense.id, 'kind', event.target.value as PurchaseExpense['kind'])}>
                          <option value="Révision">{expenseKindLabel('Révision')}</option><option value="Assurance">{expenseKindLabel('Assurance')}</option><option value="Coûts de conservation">{expenseKindLabel('Coûts de conservation')}</option><option value="Autre">{expenseKindLabel('Autre')}</option>
                        </select>
                        <input {...aiFieldProps('value.expenses[].date', expense.id)} type="date" value={expense.date} onChange={(event) => updateExpense(expense.id, 'date', event.target.value)} />
                        <input {...aiFieldProps('value.expenses[].label', expense.id)} type="text" value={expense.label} onChange={(event) => updateExpense(expense.id, 'label', event.target.value)} aria-label={tx('Libellé de dépense', 'Expense label')} />
                        <input {...aiFieldProps('value.expenses[].amount', expense.id)} type="number" min="0" step="1" value={expense.amount} onChange={(event) => updateExpense(expense.id, 'amount', Number(event.target.value))} aria-label={tx('Montant de dépense', 'Expense amount')} />
                        <button type="button" className="icon-button no-print" onClick={() => requestCollectionDeletion({ items: purchaseExpenses, setItems: setPurchaseExpenses, id: expense.id, targetLabel: expense.label || tx('Dépense sans libellé', 'Untitled expense') })} aria-label={tx('Supprimer la dépense', 'Delete expense')}><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="button button--quiet no-print"
                    onClick={() => setPurchaseExpenses((current) => [...current, { id: newId('expense'), kind: 'Autre', date: '', label: '', amount: 0 }])}
                  ><Plus size={14} /> {tx('Ajouter une dépense', 'Add expense')}</button>
                  <div {...aiFieldProps('value.computed.costBasis')} className="cost-basis-total">
                    <Calculator size={20} />
                    <span>{tx('Prix de revient', 'Cost basis')}</span>
                    <strong>{formatMoney(costBasis, watch.currency)}</strong>
                  </div>
                </div>
              </section>
            )}

            {isVisible('Secret') && (
              <section>
                <SectionTitle eyebrow={tx('Performance de détention', 'Holding performance')} title={tx('Plus-value, moins-value et TRI', 'Capital gain, loss and IRR')} publish={publishProps('value-performance')} />
                <div className="performance-card">
                  <div className="exit-fields">
                    <label>{tx('Date de vente', 'Sale date')}<input {...aiFieldProps('value.exit.saleDate')} type="date" min={purchase.date} value={exitAssumptions.saleDate} onChange={(event) => setExitAssumptions({ ...exitAssumptions, saleDate: event.target.value })} /></label>
                    <label>{tx('Prix de vente', 'Sale price')}<input {...aiFieldProps('value.exit.salePrice')} type="number" min="0" step="100" value={exitAssumptions.salePrice} onChange={(event) => setExitAssumptions({ ...exitAssumptions, salePrice: Number(event.target.value) })} /></label>
                    <label>{tx('Coût de cession', 'Disposal cost')}<input {...aiFieldProps('value.exit.disposalCostPct')} type="number" min="0" max="100" step="0.5" value={exitAssumptions.disposalCostPct} onChange={(event) => setExitAssumptions({ ...exitAssumptions, disposalCostPct: Number(event.target.value) })} /><span>%</span></label>
                  </div>
                  <div className="performance-results">
                    <div><span>{tx('Prix de revient', 'Cost basis')}</span><strong>{formatMoney(costBasis, watch.currency)}</strong></div>
                    <div><span>{tx('Coût de cession', 'Disposal cost')}</span><strong>− {formatMoney(disposalCost, watch.currency)}</strong></div>
                    <div><span>{tx('Produit net de vente', 'Net sale proceeds')}</span><strong>{formatMoney(netSaleProceeds, watch.currency)}</strong></div>
                    <div {...aiFieldProps('value.computed.capitalGainLoss')} className={capitalGainLoss >= 0 ? 'is-positive' : 'is-negative'}>
                      <span>{capitalGainLoss >= 0 ? tx('Plus-value nette', 'Net capital gain') : tx('Moins-value nette', 'Net capital loss')}</span>
                      <strong>{formatMoney(capitalGainLoss, watch.currency)}</strong>
                      <small>{formatPercent(capitalGainLossPct)}</small>
                    </div>
                    <div {...aiFieldProps('value.computed.irr')} className={holdingIrr !== null && holdingIrr >= 0 ? 'is-positive' : 'is-negative'}>
                      <span>{tx('TRI annualisé', 'Annualized IRR')}</span>
                      <strong>{formatPercent(holdingIrr)}</strong>
                      <small>{tx('Flux datés', 'Dated cash flows')}</small>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {isVisible('Secret') && (
              <section>
                <SectionTitle eyebrow={tx('Sensibilité', 'Sensitivity')} title={tx('Prix de vente et coût de cession', 'Sale price and disposal cost')} publish={publishProps('value-sensitivity')} />
                <div {...aiFieldProps('value.computed.sensitivity')} className="sensitivity-stack">
                  <div className="sensitivity-parameters no-print">
                    <div><span>{tx('Prix de vente testés', 'Tested sale prices')}</span>{sensitivityPrices.map((price, index) => <label key={`price-input-${index}`}>{tx('Scénario', 'Scenario')} {index + 1}<input {...aiFieldProps('value.sensitivity.prices[]', index)} type="number" min="0" step="100" value={price} onChange={(event) => setSensitivityPrices((current) => current.map((item, itemIndex) => itemIndex === index ? Math.max(0, Number(event.target.value)) : item))} /></label>)}</div>
                    <div><span>{tx('Coûts de cession testés', 'Tested disposal costs')}</span>{sensitivityCosts.map((cost, index) => <label key={`cost-input-${index}`}>{tx('Scénario', 'Scenario')} {index + 1}<span><input {...aiFieldProps('value.sensitivity.costs[]', index)} type="number" min="0" max="100" step="0.5" value={cost} onChange={(event) => setSensitivityCosts((current) => current.map((item, itemIndex) => itemIndex === index ? Math.min(100, Math.max(0, Number(event.target.value))) : item))} /><strong>%</strong></span></label>)}</div>
                  </div>
                  <div>
                    <h3>{tx('Plus-value ou moins-value nette', 'Net capital gain or loss')}</h3>
                    <div className="sensitivity-table" role="table" aria-label={tx('Sensibilité de la plus-value ou moins-value', 'Capital gain or loss sensitivity')}>
                      <div className="sensitivity-table__head" role="row"><span>{tx('Coût \\ Prix', 'Cost \\ Price')}</span>{sensitivityPrices.map((price, index) => <strong key={`${price}-${index}`}>{formatMoney(price, watch.currency)}</strong>)}</div>
                      {sensitivityCosts.map((costPct, costIndex) => (
                        <div role="row" key={`${costPct}-${costIndex}`}>
                          <strong>{costPct} %</strong>
                          {sensitivityPrices.map((price, priceIndex) => {
                            const scenario = scenarioPerformance(price, costPct);
                            return <span key={`${costPct}-${price}-${priceIndex}`} className={scenario.gainLoss >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatMoney(scenario.gainLoss, watch.currency)}</strong></span>;
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3>{tx('TRI annualisé', 'Annualized IRR')}</h3>
                    <div className="sensitivity-table sensitivity-table--irr" role="table" aria-label={tx('Sensibilité du TRI annualisé', 'Annualized IRR sensitivity')}>
                      <div className="sensitivity-table__head" role="row"><span>{tx('Coût \\ Prix', 'Cost \\ Price')}</span>{sensitivityPrices.map((price, index) => <strong key={`${price}-${index}`}>{formatMoney(price, watch.currency)}</strong>)}</div>
                      {sensitivityCosts.map((costPct, costIndex) => (
                        <div role="row" key={`${costPct}-${costIndex}`}>
                          <strong>{costPct} %</strong>
                          {sensitivityPrices.map((price, priceIndex) => {
                            const scenario = scenarioPerformance(price, costPct);
                            return <span key={`${costPct}-${price}-${priceIndex}`} className={scenario.irr !== null && scenario.irr >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatPercent(scenario.irr)}</strong></span>;
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}
        </ValuePage>

        <nav className="page-turner no-print" aria-label={language === 'FR' ? 'Navigation entre les pages' : 'Page navigation'}>
          {adjacentCartularyPage(activePage, 'previous') ? (
            <button type="button" onClick={() => {
              const previousPage = adjacentCartularyPage(activePage, 'previous');
              if (previousPage) navigateTo(previousPage);
            }}>
              <ArrowLeft size={16} /> {language === 'FR' ? 'Page précédente' : 'Previous page'}
            </button>
          ) : <span />}
          {adjacentCartularyPage(activePage, 'next') && (
            <button type="button" onClick={() => {
              const nextPage = adjacentCartularyPage(activePage, 'next');
              if (nextPage) navigateTo(nextPage);
            }}>
              {language === 'FR' ? 'Page suivante' : 'Next page'} <ArrowRight size={16} />
            </button>
          )}
        </nav>
      </main>

      <footer className="editorial-footer">
        <div className="container"><span className="brand-signature"><BrandLogo variant="symbol" decorative /><span>Cartulaire {mockCartulary.publicCode}</span></span><span>Prototype v2.1 · 2026</span></div>
      </footer>

      {orderedReportBlocks.length > 0 && (
        <div className="report-print-view">
          <header className="report-print-view__header">
            <BrandLogo className="report-print-view__logo" variant="monochrome" />
            <span className="eyebrow">{tx('Rapport Cartularia', 'Cartularia report')} · {mockCartulary.publicCode}</span>
            <h1>{specificationValue('Marque', watch.reference.brand)}<br />{specificationValue('Modèle', watch.reference.model)}</h1>
            <dl>
              <div><dt>{tx('Référence', 'Reference')}</dt><dd>{specificationValue('Numéro de référence', watch.reference.reference)}</dd></div>
              <div><dt>{tx('Date du rapport', 'Report date')}</dt><dd>{new Intl.DateTimeFormat(interfaceLocale, { dateStyle: 'long' }).format(new Date())}</dd></div>
              <div><dt>{tx('Blocs sélectionnés', 'Selected blocks')}</dt><dd>{orderedReportBlocks.length}</dd></div>
            </dl>
          </header>
          <section className="report-print-view__integrity" aria-label={tx('Trace locale du rapport', 'Local report trace')}>
            <span className="eyebrow">{tx('Trace locale exportée', 'Exported local trace')}</span>
            <h2>{reportTimestampCoversContent ? tx('Instantané local couvert par un horodatage tiers', 'Local snapshot covered by a third-party timestamp') : tx('Instantané local non encore horodaté par un tiers', 'Local snapshot not yet third-party timestamped')}</h2>
            <dl>
              <div><dt>{tx('Révision du dossier', 'Record revision')}</dt><dd>{reportProofState.revision}</dd></div>
              <div><dt>{tx('Empreinte du contenu', 'Content digest')}</dt><dd>{reportProofState.contentDigest}</dd></div>
              <div><dt>{tx('Tête de chaîne', 'Chain head')}</dt><dd>{reportProofState.integrityHead}</dd></div>
              {reportTimestampReceipt ? <>
                <div><dt>{tx('Date signée par l’autorité (UTC)', 'Authority-signed date (UTC)')}</dt><dd>{new Intl.DateTimeFormat(interfaceLocale, { dateStyle: 'long', timeStyle: 'long', timeZone: 'UTC' }).format(new Date(reportTimestampReceipt.timestamp))}</dd></div>
                <div><dt>{tx('Autorité / protocole', 'Authority / protocol')}</dt><dd>{reportTimestampReceipt.provider} · RFC 3161</dd></div>
                <div><dt>{tx('Racine Merkle horodatée', 'Timestamped Merkle root')}</dt><dd>{reportTimestampReceipt.merkleRoot}</dd></div>
                <div><dt>{tx('Empreinte du jeton', 'Token digest')}</dt><dd>{reportTimestampReceipt.tokenSha256}</dd></div>
                <div><dt>{tx('Qualification eIDAS', 'eIDAS qualification')}</dt><dd>{reportTimestampReceipt.qualified ? tx('QTSA validée', 'Validated QTSA') : tx('Non évaluée — aucune présomption qualifiée revendiquée', 'Not assessed — no qualified presumption claimed')}</dd></div>
              </> : <div><dt>{tx('Horodatage externe', 'External timestamp')}</dt><dd>{tx('Absent — cette trace reste locale et ne remplace pas la chaîne serveur du Cartulaire.', 'Absent — this trace remains local and does not replace the Cartulary server chain.')}</dd></div>}
            </dl>
            <p>{tx('Cette trace locale détecte une altération de l’export et, lorsqu’un jeton est présent, date son empreinte. L’autorité partagée demeure la chaîne serveur ; aucune de ces preuves ne certifie l’authenticité de l’objet, la vérité des informations ou la propriété juridique.', 'This local trace detects changes to the export and, when a token is present, dates its digest. The shared authority remains the server chain; neither proof certifies object authenticity, factual truth or legal ownership.')}</p>
          </section>
          <main>
            {orderedReportBlocks.map((blockId) => (
              <div className="report-print-view__block" key={blockId}>{renderWatchWebsiteBlock(blockId)}</div>
            ))}
          </main>
          <footer><span className="brand-signature"><BrandLogo variant="symbol" decorative /><span>{tx('Rapport généré depuis le Cartulaire', 'Report generated from the Cartulary')}</span></span><span>{mockCartulary.publicCode}</span></footer>
        </div>
      )}

      {isDrawerOpen && <>
        <div className="drawer-overlay active" onClick={() => setIsDrawerOpen(false)} />
        <aside
          ref={drawerRef}
          className="drawer-panel active"
          role="dialog"
          aria-modal="true"
          aria-labelledby="integrity-drawer-title"
          data-focus-layer="true"
          tabIndex={-1}
        >
          <div className="drawer-header">
            <span id="integrity-drawer-title">{tx('Preuves du Cartulaire', 'Cartulary proofs')}</span>
            <button type="button" onClick={() => setIsDrawerOpen(false)} aria-label={tx('Fermer', 'Close')}><X size={18} /></button>
          </div>
          <Suspense fallback={<div className="audit-panel" role="status">{tx('Chargement des preuves…', 'Loading proofs…')}</div>}>
            <AuditPanel
              journal={journal}
              cartularyId={mockCartulary.id}
              language={language}
              publicShareCode={mockCartulary.seal?.supportCode}
              snapshot={integritySnapshot}
              publicShareUrl={publicShareUrl}
              refreshToken={eventTrigger}
              persistence={persistence}
              onDeleteAllData={handleDeleteAllData}
              onJournalUpdate={() => setEventTrigger((previous) => previous + 1)}
            />
          </Suspense>
        </aside>
      </>}

      {publicationIntent && (
        <div className="modal-overlay" onClick={() => {
          if (!isPublicationSubmitting && performance.now() - publicationDialogOpenedAtRef.current > 350) {
            closePublicationDialog();
          }
        }}>
          <div
            ref={publicationDialogRef}
            className="modal-content modal-content--publication"
            role="dialog"
            aria-modal="true"
            aria-labelledby="publication-dialog-title"
            aria-describedby="publication-dialog-description"
            data-focus-layer="true"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">{tx('Acte de publication', 'Publication act')} · {destinationMarker(publicationIntent.destination)}</span>
                <strong id="publication-dialog-title">
                  {publicationIntent.action === 'revoke'
                    ? tx('Révoquer la sélection', 'Revoke selection')
                    : publicationIntent.action === 'validate' ? tx('Valider une sélection existante', 'Validate existing selection') : tx('Valider avant sélection', 'Validate before selection')}
                </strong>
              </div>
              <button type="button" onClick={closePublicationDialog} disabled={isPublicationSubmitting} aria-label={tx('Fermer la validation de publication', 'Close publication validation')}><X size={18} /></button>
            </div>
            <div className="publication-dialog__body">
              <div className="publication-dialog__summary">
                <span className={`publication-destination publication-destination--${publicationIntent.destination}`}>{destinationMarker(publicationIntent.destination)}</span>
                <div>
                  <span className="eyebrow">{language === 'FR' ? destinationLabel(publicationIntent.destination) : publicationIntent.destination === 'website' ? 'Watch website' : publicationIntent.destination === 'report' ? 'R report' : 'Circle'}</span>
                  <h3>{publicationIntent.blockLabel}</h3>
                  <code>{publicationIntent.blockId}</code>
                </div>
              </div>

              <p id="publication-dialog-description" className="publication-dialog__explanation">
                {publicationIntent.destination === 'website'
                  ? tx('Cette décision autorise le bloc dans l’aperçu W local. La publication publique réelle reste une commande serveur distincte, liée à la révision, limitée à quatre blocs et contrôlée par liste blanche.', 'This decision authorizes the block in the local W preview. Actual public publication remains a separate server command, tied to the revision, limited to four blocks and controlled by an allowlist.')
                  : publicationIntent.destination === 'report'
                    ? tx('Cette décision autorise le bloc dans le prochain rapport R imprimé. Le rapport reste une projection privée du propriétaire.', 'This decision authorizes the block in the next printed R report. The report remains a private owner projection.')
                    : tx('Cette décision prépare le bloc pour une projection Cercle. Aucun contenu n’est envoyé à la communauté tant que la commande serveur C n’est pas reliée.', 'This decision prepares the block for a Circle projection. No content is sent to the community until the C server command is connected.')}
              </p>

              {publicationIntent.action !== 'revoke' && (
                <section className="publication-dialog__checks" aria-labelledby="publication-prerequisites-title">
                  <div className="publication-dialog__section-heading">
                    <h4 id="publication-prerequisites-title">{tx('Informations minimales de l’objet', 'Minimum object information')}</h4>
                    <span>{publicationIntent.eligibility.prerequisites.filter((item) => item.satisfied).length}/3</span>
                  </div>
                  <ul>
                    {publicationIntent.eligibility.prerequisites.map((item) => (
                      <li className={item.satisfied ? 'is-valid' : 'is-blocking'} key={item.id}>
                        <span aria-hidden="true">{item.satisfied ? '✓' : '×'}</span>
                        <div><strong>{language === 'FR' ? item.label : item.id === 'brand' ? 'Brand' : item.id === 'model' ? 'Model' : 'Main photo'}</strong><small>{language === 'FR' ? item.detail : item.satisfied ? item.detail : item.id === 'brand' ? 'Not provided' : item.id === 'model' ? 'Not provided' : 'An archived main image with visibility compatible with this destination is required'}</small></div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <div className={`publication-dialog__policy ${publicationIntent.policy.allowed ? 'is-valid' : 'is-blocking'}`} role={publicationIntent.policy.allowed ? undefined : 'alert'}>
                <strong>{publicationIntent.policy.allowed ? tx('Politique de destination conforme', 'Destination policy satisfied') : tx('Destination interdite pour ce bloc', 'Destination forbidden for this block')}</strong>
                <p>{language === 'FR' ? publicationIntent.policy.reason : publicationIntent.destination === 'report'
                  ? 'The R report remains a private owner projection.'
                  : publicationIntent.destination === 'website'
                    ? (publicationIntent.policy.allowed ? 'Block allowed by the W allowlist; content remains server-controlled.' : 'This block is excluded from the public W allowlist.')
                    : (publicationIntent.policy.allowed ? 'Block allowed for a server-filtered Circle projection.' : 'This block contains private data incompatible with a Circle projection.')}</p>
              </div>

              <dl className="publication-dialog__proof">
                <div><dt>{tx('Révision source', 'Source revision')}</dt><dd>{effectivePublicationSourceRevision || '—'}</dd></div>
                <div><dt>{tx('Empreinte source', 'Source digest')}</dt><dd><code>{effectivePublicationSourceDigest ? `${effectivePublicationSourceDigest.slice(0, 23)}…` : tx('Calcul en cours…', 'Computing…')}</code></dd></div>
                <div><dt>{tx('Identifiant de décision', 'Decision identifier')}</dt><dd><code>{publicationIntent.requestId.slice(0, 27)}…</code></dd></div>
              </dl>

              {publicationError && <p className="publication-dialog__error" role="alert">{publicationError}</p>}

              <label className="publication-dialog__acknowledgement">
                <input
                  type="checkbox"
                  checked={publicationAcknowledged}
                  onChange={(event) => setPublicationAcknowledged(event.target.checked)}
                  disabled={isPublicationSubmitting}
                />
                <span>{tx('Je confirme être le propriétaire à l’origine de cette décision et avoir contrôlé la destination', 'I confirm that I am the owner making this decision and that I have checked destination')} {destinationMarker(publicationIntent.destination)}.</span>
              </label>

              <div className="publication-dialog__actions">
                {publicationIntent.action === 'validate' && (
                  <button type="button" className="button button--quiet" onClick={() => void confirmPublicationIntent('revoke')} disabled={isPublicationSubmitting}>
                    {tx('Retirer la sélection historique', 'Remove previous selection')}
                  </button>
                )}
                <button type="button" className="button button--quiet" onClick={closePublicationDialog} disabled={isPublicationSubmitting}>{tx('Annuler', 'Cancel')}</button>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void confirmPublicationIntent()}
                  disabled={isPublicationSubmitting
                    || !publicationAcknowledged
                    || !effectivePublicationSourceDigest
                    || (publicationIntent.action !== 'revoke' && (!publicationIntent.eligibility.isEligible || !publicationIntent.policy.allowed))}
                >
                  {isPublicationSubmitting
                    ? tx('Enregistrement…', 'Saving…')
                    : publicationIntent.action === 'revoke' ? tx('Confirmer la révocation', 'Confirm revocation') : tx('Confirmer la décision', 'Confirm decision')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isMarketHistoryEditorOpen && <MarketHistoryDialog
        values={marketValues}
        language={language}
        dialogRef={marketHistoryDialogRef}
        onClose={() => setIsMarketHistoryEditorOpen(false)}
        onAdd={addMarketHistoryEntry}
        onUpdate={updateMarketHistory}
        onDelete={(valuation) => requestCollectionDeletion({ items: marketHistory, setItems: setMarketHistory, id: valuation.id, targetLabel: tx(`Évaluation du ${formatDate(valuation.date)}`, `Valuation dated ${formatDate(valuation.date)}`) })}
      />}

      {isSpinOpen && spinAssets.length > 0 && <SpinViewerModal assets={spinAssets} language={language} dialogRef={spinDialogRef} onClose={() => setIsSpinOpen(false)} />}

      {selectedAsset && <MediaViewerModal
        asset={selectedAsset}
        assetCount={renderedAssets.length}
        position={selectedAssetPosition}
        audience={audience}
        language={language}
        mediaTags={MEDIA_TAGS.map((tag) => ({ id: tag.id, label: mediaTagLabel(tag) }))}
        dialogRef={mediaDialogRef}
        onClose={() => setSelectedAsset(null)}
        onMove={moveSelectedAsset}
        onToggleTag={toggleMediaTag}
        onDelete={deleteMediaAsset}
      />}

      {pendingDeletion && <DeletionDialog
        deletion={pendingDeletion}
        error={deletionError}
        submitting={isDeletingItem}
        language={language}
        dialogRef={deletionDialogRef}
        onCancel={() => setPendingDeletion(null)}
        onConfirm={confirmDeletion}
      />}

      {undoNotice && <UndoToast
        notice={undoNotice}
        language={language}
        onUndo={undoDeletion}
        onDismiss={async () => { await undoNotice.onExpire?.(); setUndoNotice(null); }}
      />}
      {deletionError && !pendingDeletion && <div className="deletion-error-toast no-print" role="alert">{deletionError}</div>}
      {fileImportError && <div className="deletion-error-toast no-print" role="alert">{fileImportError}</div>}
    </div>
  );
}

export default App;
