import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  ExternalLink,
  FileText,
  Globe2,
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
  Video,
  X,
} from 'lucide-react';
import { mockCartulary } from './data/mockData';
import type { Asset, ComparableTransaction, MediaTag, VisibilityLevel } from './types';
import { BarreDossier } from './components/BarreDossier';
import { MediaCarousel } from './components/MediaCarousel';
import { Spin360 } from './components/Spin360';
import { AuditPanel } from './components/AuditPanel';
import { IntegrityJournal } from './utils/integrityJournal';
import { AI_SCHEMA_VERSION, aiFieldProps, type AIFieldId } from './ai/fieldCatalog';

type CartularyPage = 'cover' | 'media' | 'reference' | 'condition' | 'value';
type PublishedBlockId =
  | 'cover-watch'
  | 'cover-owner'
  | 'cover-storage'
  | 'media-hero'
  | 'media-motion'
  | 'media-spin'
  | 'media-slideshow'
  | 'media-library'
  | 'reference-history'
  | 'reference-specs'
  | 'reference-checks'
  | 'reference-popularity'
  | 'condition-description'
  | 'condition-summary'
  | 'condition-documentation'
  | 'condition-reference-report'
  | 'condition-prior-reviews'
  | 'value-market'
  | 'value-comparables-listings'
  | 'value-comparables-transactions'
  | 'value-comparables-analysis'
  | 'value-cost-basis'
  | 'value-performance'
  | 'value-sensitivity';

interface IdentificationCheck {
  id: string;
  title: string;
  note: string;
  checked: boolean;
}

interface ConditionAttachment {
  name: string;
  size?: number;
  type?: string;
}

interface ConditionEntry {
  id: string;
  date: string;
  title: string;
  note: string;
  attachments: ConditionAttachment[];
}

type DocumentationCategory = 'Facture' | 'Garantie' | 'Assurances' | 'Boîte' | 'Écrin' | 'Manuel' | 'Certificat' | 'Accessoire' | 'Autre';
type DocumentationState = 'Présent' | 'Complet' | 'Incomplet' | 'Manquant' | 'À vérifier';

interface DocumentationItem {
  id: string;
  category: DocumentationCategory;
  description: string;
  state: DocumentationState;
}

interface OwnerField {
  id: string;
  label: string;
  value: string;
}

type OwnerType = 'Personne physique' | 'Entreprise';

interface OwnerDocument {
  id: string;
  category: string;
  fileName: string;
  size: number;
  type: string;
  url?: string;
}

interface MarketDepthState {
  analysisDate: string;
  transactions12m: number;
}

type PopularityResourceType = 'Forum officiel' | 'Discussion dédiée' | 'Communauté' | 'Base de données' | 'Revue';

interface PopularityResource {
  id: string;
  name: string;
  type: PopularityResourceType;
  url: string;
}

interface PurchaseState {
  date: string;
  purchasePrice: number;
}

interface PurchaseExpense {
  id: string;
  kind: 'Révision' | 'Assurance' | 'Coûts de conservation' | 'Autre';
  date: string;
  label: string;
  amount: number;
}

interface ExitAssumptions {
  saleDate: string;
  salePrice: number;
  disposalCostPct: number;
}

interface DatedCashFlow {
  date: string;
  amount: number;
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

const PAGE_IDS: CartularyPage[] = ['cover', 'media', 'reference', 'condition', 'value'];
const journal = new IntegrityJournal();

const PUBLISHED_BLOCK_IDS: PublishedBlockId[] = [
  'cover-watch', 'cover-owner', 'cover-storage',
  'media-hero', 'media-motion', 'media-spin', 'media-slideshow', 'media-library',
  'reference-history', 'reference-specs', 'reference-checks', 'reference-popularity',
  'condition-description', 'condition-summary', 'condition-documentation',
  'condition-reference-report', 'condition-prior-reviews',
  'value-market', 'value-comparables-listings', 'value-comparables-transactions', 'value-comparables-analysis',
  'value-cost-basis', 'value-performance', 'value-sensitivity',
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

const DEFAULT_CHECKS: IdentificationCheck[] = [
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
];

const DEFAULT_CONDITION_ENTRIES: ConditionEntry[] = mockCartulary.conditionReports.map((report, index) => ({
  id: report.id,
  date: report.date,
  title: report.title,
  note: report.summary,
  attachments: index === 0
    ? [{ name: 'Rapport_etat_2026-08-08.pdf' }, { name: 'Fiche_controle_fonctionnel.pdf' }]
    : [{ name: 'Revue_visuelle_2024-02-15.pdf' }],
}));

const DEFAULT_DOCUMENTATION_ITEMS: DocumentationItem[] = [
  { id: 'doc-invoice', category: 'Facture', description: 'Facture originale nominative du 08.03.2002, boutique Aldebert à Paris.', state: 'Présent' },
  { id: 'doc-warranty', category: 'Garantie', description: 'Carte de garantie IWC portant la référence et le numéro de série de l’exemplaire.', state: 'Présent' },
  { id: 'doc-box', category: 'Boîte', description: 'Boîte extérieure et écrin IWC associés à la montre.', state: 'Complet' },
  { id: 'doc-manual', category: 'Manuel', description: 'Livret utilisateur et documentation de la fonction UTC.', state: 'À vérifier' },
];

const DEFAULT_OWNER_FIELDS: OwnerField[] = [
  { id: 'owner-last-name', label: 'Nom', value: '' },
  { id: 'owner-first-name', label: 'Prénom', value: '' },
  { id: 'owner-address', label: 'Adresse', value: '' },
  { id: 'owner-email', label: 'Email', value: '' },
  { id: 'owner-phone', label: 'Téléphone', value: '' },
];

const DEFAULT_STORAGE_DESCRIPTION = `${mockCartulary.location.storageType} — ${mockCartulary.location.city}, ${mockCartulary.location.country}. Accès contrôlé et conditions de conservation à documenter.`;

const DEFAULT_POPULARITY_RESOURCES: PopularityResource[] = [
  { id: 'pop-iwc-forum', name: 'IWC Collectors Forum', type: 'Forum officiel', url: 'https://forum.iwc.com/' },
  { id: 'pop-iwc-3251-thread', name: 'IWC Die Fliegeruhr UTC Ref. 3251', type: 'Discussion dédiée', url: 'https://forum.iwc.com/t/iwc-die-fliegeruhr-utc-ref3251/30513/' },
  { id: 'pop-watchbase', name: 'WatchBase · IW3251-01', type: 'Base de données', url: 'https://watchbase.com/iwc/pilot/iw3251-01' },
  { id: 'pop-reddit', name: 'r/IWCschaffhausen', type: 'Communauté', url: 'https://www.reddit.com/r/IWCschaffhausen/' },
  { id: 'pop-timezone', name: 'TimeZone · IWC 3251 Review', type: 'Revue', url: 'https://forums.timezone.com/index.php?goto=594&rid=0&t=tree' },
];

const DEFAULT_EXPENSES: PurchaseExpense[] = [
  { id: 'revision-2008', kind: 'Révision', date: '2008-05-16', label: 'Révision complète IWC', amount: 620 },
  { id: 'insurance-2026', kind: 'Assurance', date: '2026-08-01', label: 'Prime collection 2026–2027', amount: 180 },
];

const DEFAULT_SPECIFICATION_GROUPS: SpecificationGroupData[] = [
  {
    id: 'basic', title: 'Données de base', items: [
      ['ad-code', 'Code annonce', `Non applicable · dossier ${mockCartulary.publicCode}`],
      ['brand', 'Marque', mockCartulary.watchInstance.reference.brand],
      ['collection', 'Collection', 'Pilot’s Watches'],
      ['model', 'Modèle', mockCartulary.watchInstance.reference.model],
      ['reference', 'Numéro de référence', mockCartulary.watchInstance.reference.reference],
      ['movement', 'Mouvement', 'Remontage automatique'],
      ['case', 'Boîtier', mockCartulary.watchInstance.reference.material],
      ['bracelet', 'Matière du bracelet', 'Cuir'],
      ['year', 'Année de fabrication', '2002'],
      ['condition', 'État', 'Voir 03 · État de la montre'],
      ['delivered', 'Contenu livré', 'Montre, boîte, écrin, facture et carte de garantie'],
      ['gender', 'Sexe', 'Montre homme / Unisexe'],
      ['location', 'Emplacement', 'Accès restreint'],
      ['price', 'Prix', 'Voir 04 · Valorisation'],
      ['availability', 'Disponibilité', 'Collection privée · non proposée à la vente'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'caliber', title: 'Calibre', items: [
      ['cal-movement', 'Mouvement', 'Remontage automatique'],
      ['caliber', 'Calibre', mockCartulary.watchInstance.reference.caliber],
      ['base-caliber', 'Calibre de base', 'À documenter'],
      ['power-reserve', 'Réserve de marche', mockCartulary.watchInstance.reference.powerReserve],
      ['jewels', 'Nombre de pierres', 'À documenter'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'case', title: 'Boîtier', items: [
      ['case-material', 'Boîtier', mockCartulary.watchInstance.reference.material],
      ['diameter', 'Diamètre', `${mockCartulary.watchInstance.reference.diameter.toFixed(1)} mm`],
      ['height', 'Hauteur', `${mockCartulary.watchInstance.reference.thickness.toFixed(1)} mm`],
      ['water', 'Étanche', mockCartulary.watchInstance.reference.waterResistance],
      ['bezel', 'Matériau de la lunette', 'Acier'],
      ['crystal', 'Verre', 'Saphir'],
      ['dial', 'Cadran', 'Noir'],
      ['numerals', 'Chiffres du cadran', 'Arabes'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'bracelet', title: 'Bracelet', items: [
      ['strap-material', 'Matière du bracelet', 'Cuir'],
      ['strap-color', 'Couleur du bracelet', 'Noir'],
      ['clasp', 'Boucle', 'Ardillon IWC'],
      ['clasp-material', 'Matière de la boucle', 'Acier'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'functions', title: 'Fonctions', items: [
      ['date', 'Date', 'Guichet à 3 heures'],
      ['gmt', 'GMT', 'Disque UTC 24 heures'],
      ['timezone', 'Second fuseau horaire', 'Réglage par module TZC'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
  {
    id: 'other', title: 'Autres', items: [
      ['seconds', 'Seconde', 'Seconde centrale'],
      ['crown', 'Couronne', 'Couronne « poisson »'],
      ['caseback', 'Fond', 'Fond plein vissé'],
    ].map(([id, label, value]) => ({ id, label, value })),
  },
];

const DEFAULT_EDITABLE_COPY: EditableCopyData = {
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
};

const SENSITIVITY_PRICES = [3200, 3600, 4000, 4400, 4800];
const SENSITIVITY_COSTS = [0, 5, 10, 15, 20];

const pageFromHash = (): CartularyPage => {
  const candidate = window.location.hash.replace('#', '') as CartularyPage;
  return PAGE_IDS.includes(candidate) ? candidate : 'cover';
};

const publishedBlocksFromUrl = (): PublishedBlockId[] | null => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('blocks')) return null;
  const requested = params.get('blocks')?.split(',').filter(Boolean) || [];
  return requested.filter((block): block is PublishedBlockId => PUBLISHED_BLOCK_IDS.includes(block as PublishedBlockId));
};

const readStored = <T,>(key: string, fallback: T): T => {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
};

const loadConditionEntries = (): ConditionEntry[] => readStored(
  'cartularia-condition-entries',
  DEFAULT_CONDITION_ENTRIES,
).map((entry) => entry.title === 'Revue visuelle antérieure'
  ? { ...entry, title: 'Revues antérieures' }
  : entry);

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

const loadSpecificationGroups = (): SpecificationGroupData[] => {
  const stored = readStored<SpecificationGroupData[] | null>('cartularia-specification-groups', null);
  if (stored?.length) return stored.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, value: item.value === 'Voir 04 · Valeur' ? 'Voir 04 · Valorisation' : item.value })),
  }));
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
).map(({ url: _discardedUrl, ...document }) => document);

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

const loadMediaAssets = () => {
  const saved = readStored<Array<{ id: string; tags: unknown }>>('cartularia-media-tags-v2', []);
  return mockCartulary.assets.map((asset) => {
    const storedTags = saved.find((item) => item.id === asset.id)?.tags;
    const capturedAt = asset.capturedAt || '2026-08-08';
    return {
      ...asset,
      tags: normalizeMediaTags(storedTags ?? asset.tags),
      metadataTimestamp: asset.metadataTimestamp ?? `${capturedAt}T12:00:00+02:00`,
      timestampSource: asset.timestampSource ?? 'catalogue',
    };
  });
};

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const formatDate = (value: string) => new Intl.DateTimeFormat('fr-FR').format(new Date(value));
const formatDateTime = (value: string) => new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));
const formatMoney = (value: number, currency = 'EUR') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const formatFileSize = (value: number) => value >= 1024 * 1024
  ? `${(value / (1024 * 1024)).toFixed(1)} Mo`
  : `${Math.ceil(value / 1024)} ko`;
const formatPercent = (value: number | null) => value === null
  ? 'N/A'
  : new Intl.NumberFormat('fr-FR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

const calculateXirr = (cashFlows: DatedCashFlow[]): number | null => {
  const validFlows = cashFlows
    .filter((cashFlow) => cashFlow.date && Number.isFinite(cashFlow.amount))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (validFlows.length < 2 || !validFlows.some((flow) => flow.amount < 0) || !validFlows.some((flow) => flow.amount > 0)) {
    return null;
  }

  const firstDate = new Date(validFlows[0].date).getTime();
  const withYears = validFlows.map((flow) => ({
    amount: flow.amount,
    years: (new Date(flow.date).getTime() - firstDate) / (365.25 * 24 * 60 * 60 * 1000),
  }));
  const npv = (rate: number) => withYears.reduce(
    (sum, flow) => sum + flow.amount / Math.pow(1 + rate, flow.years),
    0,
  );

  let low = -0.9999;
  let high = 10;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (lowValue * highValue > 0 && high < 10000) {
    high *= 2;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;

  for (let iteration = 0; iteration < 160; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (Math.abs(middleValue) < 0.001) return middle;
    if (lowValue * middleValue <= 0) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return (low + high) / 2;
};

function PageIntroduction({ number, title }: { number: string; title: string }) {
  return (
    <header className="page-intro">
      <span className="page-intro__number">{number}</span>
      <h1>{title}</h1>
    </header>
  );
}

interface MarkerState {
  active: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

interface BlockMarkerState {
  blockId: PublishedBlockId;
  website: MarkerState;
  report: MarkerState;
  edit?: MarkerState;
}

function ContentMarker({
  marker,
  active,
  label,
  onToggle,
  instance,
  disabled = false,
}: {
  marker: 'W' | 'R';
  active: boolean;
  label: string;
  onToggle: () => void;
  instance: PublishedBlockId;
  disabled?: boolean;
}) {
  const destination = marker === 'W' ? 'Watch website' : 'rapport PDF';
  return (
    <button
      type="button"
      {...aiFieldProps(marker === 'W' ? 'publishing.blocks.website' : 'publishing.blocks.report', instance)}
      className={`content-marker content-marker--${marker === 'W' ? 'website' : 'report'} no-print ${active ? 'is-active' : ''}`}
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      aria-label={`${active ? 'Retirer' : 'Ajouter'} ${label} ${active ? 'du' : 'au'} ${destination}`}
      title={disabled ? 'Sélection modifiable par le propriétaire' : `${marker} · ${destination}`}
    ><span aria-hidden="true">{marker}</span></button>
  );
}

function BlockMarkers({ selection, label }: { selection: BlockMarkerState; label: string }) {
  return (
    <div className="content-markers">
      <ContentMarker marker="W" active={selection.website.active} label={label} instance={selection.blockId} onToggle={selection.website.onToggle} disabled={selection.website.disabled} />
      <ContentMarker marker="R" active={selection.report.active} label={label} instance={selection.blockId} onToggle={selection.report.onToggle} disabled={selection.report.disabled} />
      {selection.edit && (
        <button
          type="button"
          className={`content-marker content-marker--edit no-print ${selection.edit.active ? 'is-active' : ''}`}
          onClick={selection.edit.onToggle}
          disabled={selection.edit.disabled}
          aria-pressed={selection.edit.active}
          aria-label={`${selection.edit.active ? 'Terminer la modification de' : 'Modifier'} ${label}`}
          title="Modifier le texte"
        ><Pencil size={15} aria-hidden="true" /></button>
      )}
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  publish,
}: {
  eyebrow: string;
  title: string;
  publish?: BlockMarkerState;
}) {
  return (
    <div className="section-title">
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
      {publish && <BlockMarkers selection={publish} label={title} />}
    </div>
  );
}

function EditableParagraphs({
  values,
  editing,
  onChange,
  className,
  onActivate,
  aiField,
}: {
  values: string[];
  editing: boolean;
  onChange: (index: number, value: string) => void;
  className?: string;
  onActivate?: () => void;
  aiField?: AIFieldId;
}) {
  return (
    <div
      {...(aiField ? aiFieldProps(aiField) : {})}
      className={`${className || ''} ${editing ? 'editable-copy-fields' : onActivate ? 'editable-click-target' : ''}`.trim()}
      onClick={!editing ? onActivate : undefined}
      onKeyDown={!editing && onActivate ? (event) => { if (event.key === 'Enter') onActivate(); } : undefined}
      tabIndex={!editing && onActivate ? 0 : undefined}
      role={!editing && onActivate ? 'button' : undefined}
      title={!editing && onActivate ? 'Cliquer pour modifier' : undefined}
    >
      {values.map((value, index) => editing ? (
        <textarea key={index} {...(aiField ? aiFieldProps(aiField, index) : {})} value={value} rows={4} onChange={(event) => onChange(index, event.target.value)} aria-label={`Modifier le paragraphe ${index + 1}`} />
      ) : <p key={index} {...(aiField ? aiFieldProps(aiField, index) : {})}>{value}</p>)}
    </div>
  );
}

function VideoPoster({ asset, onOpen }: { asset: Asset; onOpen: (asset: Asset) => void }) {
  return (
    <button type="button" className="video-poster" onClick={() => onOpen(asset)}>
      <img src={asset.posterUrl || asset.thumbnailUrl || asset.url} alt="" />
      <span className="video-poster__play" aria-hidden="true"><Play size={24} fill="currentColor" /></span>
    </button>
  );
}

function ComparableTable({
  title,
  items,
  selection,
  hideHeading = false,
}: {
  title: string;
  items: ComparableTransaction[];
  selection?: BlockMarkerState;
  hideHeading?: boolean;
}) {
  return (
    <div className="comparable-group">
      {!hideHeading && <div className="comparable-group__heading">
        <div><h3>{title}</h3><span>{items.length} observation{items.length > 1 ? 's' : ''}</span></div>
        {selection && <BlockMarkers selection={selection} label={title} />}
      </div>}
      <div className="comparables-table" role="table" aria-label={title}>
        <div className="comparables-table__head" role="row">
          <span>Date</span><span>Comparable</span><span>Source</span><span>Canal</span><span>État</span><span>Valeur</span>
        </div>
        {items.map((comparable) => (
          <div role="row" key={comparable.id} data-ai-scope="value.comparables[]" data-ai-instance={comparable.id}>
            <span hidden {...aiFieldProps('value.comparables[].sourceType', comparable.id)}>{comparable.sourceType}</span>
            <span hidden {...aiFieldProps('value.comparables[].currency', comparable.id)}>{comparable.currency}</span>
            <time {...aiFieldProps('value.comparables[].date', comparable.id)}>{formatDate(comparable.date)}</time>
            <span {...aiFieldProps('value.comparables[].description', comparable.id)}><strong>{comparable.description}</strong></span>
            <span {...aiFieldProps('value.comparables[].source', comparable.id)}>{comparable.source}</span>
            <span {...aiFieldProps('value.comparables[].channel', comparable.id)}>{comparable.saleChannel}</span>
            <span {...aiFieldProps('value.comparables[].condition', comparable.id)}>{comparable.condition}</span>
            <strong {...aiFieldProps('value.comparables[].amount', comparable.id)} data-ai-currency={comparable.currency}>{formatMoney(comparable.amount, comparable.currency)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccessRestricted({ title }: { title: string }) {
  return (
    <div className="restricted-card">
      <Lock size={18} />
      <span className="eyebrow">Accès restreint</span>
      <h3>{title}</h3>
    </div>
  );
}

function App() {
  const [language, setLanguage] = useState<'FR' | 'EN'>('FR');
  const [audience, setAudience] = useState<VisibilityLevel>('Secret');
  const [activePage, setActivePage] = useState<CartularyPage>(pageFromHash);
  const [eventTrigger, setEventTrigger] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isSpinOpen, setIsSpinOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [editingBlock, setEditingBlock] = useState<PublishedBlockId | null>(null);
  const [mediaAssets, setMediaAssets] = useState<Asset[]>(loadMediaAssets);
  const [mediaUploadTags, setMediaUploadTags] = useState<MediaTag[]>([]);
  const [isEditingChecks, setIsEditingChecks] = useState(false);
  const [identificationChecks, setIdentificationChecks] = useState<IdentificationCheck[]>(() =>
    readStored('cartularia-identification-checks', DEFAULT_CHECKS),
  );
  const [conditionEntries, setConditionEntries] = useState<ConditionEntry[]>(loadConditionEntries);
  const [documentationItems, setDocumentationItems] = useState<DocumentationItem[]>(() =>
    readStored('cartularia-documentation-items', DEFAULT_DOCUMENTATION_ITEMS),
  );
  const [ownerFields, setOwnerFields] = useState<OwnerField[]>(() =>
    readStored('cartularia-owner-fields', DEFAULT_OWNER_FIELDS),
  );
  const [ownerType, setOwnerType] = useState<OwnerType>(() =>
    readStored<OwnerType>('cartularia-owner-type', 'Personne physique'),
  );
  const [ownerDocuments, setOwnerDocuments] = useState<OwnerDocument[]>(loadOwnerDocuments);
  const [storageDescription, setStorageDescription] = useState(() =>
    readStored('cartularia-storage-description', DEFAULT_STORAGE_DESCRIPTION),
  );
  const [marketDepth, setMarketDepth] = useState<MarketDepthState>(() =>
    readStored('cartularia-market-depth', {
      analysisDate: mockCartulary.marketSnapshot.date,
      transactions12m: mockCartulary.marketSnapshot.observedTransactions90d,
    }),
  );
  const [popularityResources, setPopularityResources] = useState<PopularityResource[]>(() =>
    readStored('cartularia-popularity-resources', DEFAULT_POPULARITY_RESOURCES),
  );
  const [publishedBlocks, setPublishedBlocks] = useState<PublishedBlockId[]>(loadPublishedBlocks);
  const [reportBlocks, setReportBlocks] = useState<PublishedBlockId[]>(loadReportBlocks);
  const [specificationGroups, setSpecificationGroups] = useState<SpecificationGroupData[]>(loadSpecificationGroups);
  const [editableCopy, setEditableCopy] = useState<EditableCopyData>(loadEditableCopy);
  const [purchase, setPurchase] = useState<PurchaseState>(() => readStored('cartularia-purchase', {
    date: mockCartulary.watchInstance.acquisitionDate,
    purchasePrice: mockCartulary.watchInstance.acquisitionPrice ?? 0,
  }));
  const [purchaseExpenses, setPurchaseExpenses] = useState<PurchaseExpense[]>(() =>
    readStored('cartularia-purchase-expenses', DEFAULT_EXPENSES),
  );
  const [exitAssumptions, setExitAssumptions] = useState<ExitAssumptions>(() =>
    readStored('cartularia-exit-assumptions', {
      saleDate: '2026-08-13',
      salePrice: mockCartulary.marketSnapshot.midValue,
      disposalCostPct: 10,
    }),
  );

  useEffect(() => {
    if (window.location.pathname.replace(/\/$/, '') === '/watch-website') return;
    if (!window.location.hash) window.history.replaceState(null, '', '#cover');
    const handleHash = () => setActivePage(pageFromHash());
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  useEffect(() => {
    journal
      .logEvent(
        'ACCESS_CARTULARY',
        audience === 'Secret' ? 'Propriétaire' : `Visiteur_${audience}`,
        `Consultation du Cartulaire avec le filtre d'audience: ${audience}`,
      )
      .then(() => setEventTrigger((previous) => previous + 1));
  }, [audience]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedAsset(null);
        setIsSpinOpen(false);
        setIsDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

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
    window.localStorage.setItem(
      'cartularia-media-tags-v2',
      JSON.stringify(mediaAssets.map(({ id, tags }) => ({ id, tags }))),
    );
    setSelectedAsset((current) => current ? mediaAssets.find((asset) => asset.id === current.id) ?? null : null);
  }, [mediaAssets]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-identification-checks', JSON.stringify(identificationChecks));
  }, [identificationChecks]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-condition-entries', JSON.stringify(conditionEntries));
  }, [conditionEntries]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-documentation-items', JSON.stringify(documentationItems));
  }, [documentationItems]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-owner-fields', JSON.stringify(ownerFields));
  }, [ownerFields]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-owner-type', JSON.stringify(ownerType));
  }, [ownerType]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-owner-documents', JSON.stringify(ownerDocuments.map(({ url: _discardedUrl, ...document }) => document)));
  }, [ownerDocuments]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-storage-description', JSON.stringify(storageDescription));
  }, [storageDescription]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-market-depth', JSON.stringify(marketDepth));
  }, [marketDepth]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-popularity-resources', JSON.stringify(popularityResources));
  }, [popularityResources]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-published-blocks', JSON.stringify(publishedBlocks));
  }, [publishedBlocks]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-report-blocks', JSON.stringify(reportBlocks));
  }, [reportBlocks]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-specification-groups', JSON.stringify(specificationGroups));
  }, [specificationGroups]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-editable-copy', JSON.stringify(editableCopy));
  }, [editableCopy]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-purchase', JSON.stringify(purchase));
    window.localStorage.setItem('cartularia-purchase-expenses', JSON.stringify(purchaseExpenses));
  }, [purchase, purchaseExpenses]);

  useEffect(() => {
    window.localStorage.setItem('cartularia-exit-assumptions', JSON.stringify(exitAssumptions));
  }, [exitAssumptions]);

  const watch = mockCartulary.watchInstance;
  const isWatchWebsite = window.location.pathname.replace(/\/$/, '') === '/watch-website';
  const isVisible = (required: VisibilityLevel) => {
    if (audience === 'Secret') return true;
    if (audience === 'Communauté') return required !== 'Secret';
    return required === 'Tous';
  };

  const visibleAssets = mediaAssets.filter((asset) => isVisible(asset.visibility));
  const mainPhoto = visibleAssets.find((asset) => asset.tags.includes('main-photo'));
  const mainVideo = visibleAssets.find((asset) => asset.tags.includes('main-video'));
  const spinAssets = visibleAssets.filter((asset) => asset.tags.includes('spin-3d') && asset.type === 'image');
  const presentationAssets = visibleAssets.filter((asset) => asset.tags.includes('slideshow'));
  const documentationAssets = visibleAssets.filter((asset) => asset.tags.includes('documentation') || asset.tags.includes('accessories'));
  const referenceConditionReport = conditionEntries.find((entry) => entry.id === 'report-2026-08-08') ?? conditionEntries[0];
  const priorConditionReviews = conditionEntries.filter((entry) => entry.id !== referenceConditionReport?.id);
  const specificationValue = (label: string, fallback: string) =>
    specificationGroups.flatMap((group) => group.items).find((item) => item.label === label)?.value || fallback;
  const requestedPublishedBlocks = publishedBlocksFromUrl();
  const watchWebsiteBlocks = isWatchWebsite
    ? (requestedPublishedBlocks ?? publishedBlocks)
    : publishedBlocks;
  const watchWebsiteUrl = `${window.location.origin}/watch-website?blocks=${publishedBlocks.join(',')}`;
  const orderedReportBlocks = PUBLISHED_BLOCK_IDS.filter((blockId) => reportBlocks.includes(blockId));
  const togglePublishedBlock = (blockId: PublishedBlockId) => {
    if (audience !== 'Secret') return;
    setPublishedBlocks((current) => current.includes(blockId)
      ? current.filter((item) => item !== blockId)
      : [...current, blockId]);
  };
  const toggleReportBlock = (blockId: PublishedBlockId) => {
    if (audience !== 'Secret') return;
    setReportBlocks((current) => current.includes(blockId)
      ? current.filter((item) => item !== blockId)
      : [...current, blockId]);
  };
  const publishProps = (blockId: PublishedBlockId, editable = false): BlockMarkerState => ({
    blockId,
    website: {
      active: publishedBlocks.includes(blockId),
      onToggle: () => togglePublishedBlock(blockId),
      disabled: audience !== 'Secret',
    },
    report: {
      active: reportBlocks.includes(blockId),
      onToggle: () => toggleReportBlock(blockId),
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

  const marketValues = [...watch.valuations].sort((a, b) => a.date.localeCompare(b.date));
  const maxMarketValue = Math.max(...marketValues.map((valuation) => valuation.highValue));
  const costBasis = useMemo(
    () => purchase.purchasePrice + purchaseExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    [purchase.purchasePrice, purchaseExpenses],
  );
  const listingComparables = mockCartulary.comparables.filter((comparable) => comparable.sourceType === 'Annonce');
  const transactionComparables = mockCartulary.comparables.filter((comparable) => comparable.sourceType === 'Transaction');
  const averageAmount = (items: ComparableTransaction[]) => items.length === 0
    ? 0
    : items.reduce((sum, item) => sum + item.amount, 0) / items.length;
  const averageListingPrice = averageAmount(listingComparables);
  const averageTransactionPrice = averageAmount(transactionComparables);
  const listingPremium = averageTransactionPrice > 0
    ? averageListingPrice / averageTransactionPrice - 1
    : 0;

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
  const holdingIrr = useMemo(() => calculateXirr([
    ...datedAcquisitionCashFlows,
    { date: exitAssumptions.saleDate, amount: netSaleProceeds },
  ]), [datedAcquisitionCashFlows, exitAssumptions.saleDate, netSaleProceeds]);
  const scenarioPerformance = (salePrice: number, disposalCostPct: number) => {
    const netProceeds = salePrice * (1 - disposalCostPct / 100);
    return {
      gainLoss: netProceeds - costBasis,
      irr: calculateXirr([
        ...datedAcquisitionCashFlows,
        { date: exitAssumptions.saleDate, amount: netProceeds },
      ]),
    };
  };

  const pages = [
    { id: 'cover' as const, number: '00', label: language === 'FR' ? 'Accueil' : 'Home' },
    { id: 'media' as const, number: '01', label: language === 'FR' ? 'Médias' : 'Media' },
    { id: 'reference' as const, number: '02', label: language === 'FR' ? 'La référence' : 'Reference' },
    { id: 'condition' as const, number: '03', label: language === 'FR' ? 'État de la montre' : 'Watch condition' },
    { id: 'value' as const, number: '04', label: language === 'FR' ? 'Valorisation' : 'Valuation' },
  ];

  const navigateTo = (page: CartularyPage) => {
    if (activePage === page) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    window.location.hash = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleReportPrint = async () => {
    if (orderedReportBlocks.length === 0) return;
    await journal.logEvent('EXPORT_PDF', 'Propriétaire', `Export du rapport personnalisé · ${orderedReportBlocks.length} blocs`);
    setEventTrigger((previous) => previous + 1);
    window.print();
  };

  const toggleMediaTag = (assetId: string, tag: MediaTag) => {
    if (audience !== 'Secret') return;
    setMediaAssets((current) => current.map((asset) => {
      if (asset.id !== assetId) return asset;
      return {
        ...asset,
        tags: asset.tags.includes(tag)
          ? asset.tags.filter((existing) => existing !== tag)
          : [...asset.tags, tag],
      };
    }));
  };

  const updateCheck = (id: string, patch: Partial<IdentificationCheck>) => {
    setIdentificationChecks((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const addCheck = () => {
    setIdentificationChecks((current) => [
      ...current,
      { id: newId('check'), title: 'Nouveau point de contrôle', note: '', checked: false },
    ]);
    setIsEditingChecks(true);
  };

  const addConditionEntry = (event: FormEvent<HTMLFormElement>) => {
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
    const entry: ConditionEntry = {
      id: newId('condition'),
      date,
      title: title || 'Note d’état',
      note,
      attachments: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
    };
    setConditionEntries((current) => [entry, ...current].sort((a, b) => b.date.localeCompare(a.date)));
    form.reset();
  };

  const addMediaAssets = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const files = new FormData(form).getAll('media-files').filter(
      (value): value is File => value instanceof File && value.size > 0,
    );
    if (files.length === 0) return;

    const importedAssets: Asset[] = await Promise.all(files.map(async (file) => {
      const type: Asset['type'] = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/') ? 'video' : 'document';
      const digest = await window.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return {
        id: newId('asset'),
        name: file.name.replace(/\.[^/.]+$/, ''),
        originalFileName: file.name,
        url: URL.createObjectURL(file),
        type,
        ratio: type === 'video' ? '16:9' : '4:5',
        hash,
        status: 'Initiated',
        visibility: 'Secret',
        tags: mediaUploadTags,
        capturedAt: new Date(file.lastModified || Date.now()).toISOString().slice(0, 10),
        metadataTimestamp: new Date(file.lastModified || Date.now()).toISOString(),
        timestampSource: 'file.lastModified',
        fileSize: formatFileSize(file.size),
        mimeType: file.type || 'application/octet-stream',
      };
    }));

    setMediaAssets((current) => [...current, ...importedAssets]);
    form.reset();
    setMediaUploadTags([]);
  };

  const updateDocumentationItem = <K extends keyof DocumentationItem>(
    id: string,
    key: K,
    value: DocumentationItem[K],
  ) => {
    setDocumentationItems((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
  };

  const updateOwnerField = (id: string, patch: Partial<OwnerField>) => {
    setOwnerFields((current) => current.map((field) => field.id === id ? { ...field, ...patch } : field));
  };

  const updateOwnerDocument = (id: string, patch: Partial<OwnerDocument>) => {
    setOwnerDocuments((current) => current.map((document) => document.id === id ? { ...document, ...patch } : document));
  };

  const deleteOwnerDocument = (id: string) => {
    setOwnerDocuments((current) => {
      const document = current.find((item) => item.id === id);
      if (document?.url?.startsWith('blob:')) URL.revokeObjectURL(document.url);
      return current.filter((item) => item.id !== id);
    });
  };

  const addOwnerDocuments = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const category = String(formData.get('owner-document-category') || '').trim() || 'Document d’identité';
    const files = formData.getAll('owner-documents').filter(
      (value): value is File => value instanceof File && value.size > 0,
    );
    if (files.length === 0) return;
    setOwnerDocuments((current) => [...current, ...files.map((file) => ({
      id: newId('owner-document'),
      category,
      fileName: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      url: URL.createObjectURL(file),
    }))]);
    form.reset();
  };

  const updatePopularityResource = <K extends keyof PopularityResource>(
    id: string,
    key: K,
    value: PopularityResource[K],
  ) => {
    setPopularityResources((current) => current.map((resource) => resource.id === id ? { ...resource, [key]: value } : resource));
  };

  const updateExpense = <K extends keyof PurchaseExpense>(id: string, key: K, value: PurchaseExpense[K]) => {
    setPurchaseExpenses((current) => current.map((expense) => expense.id === id ? { ...expense, [key]: value } : expense));
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
    setSpecificationGroups((current) => current.map((group) => group.id === groupId
      ? { ...group, items: group.items.filter((item) => item.id !== itemId) }
      : group));
  };

  const addSpecification = (groupId: string) => {
    setSpecificationGroups((current) => current.map((group) => group.id === groupId
      ? { ...group, items: [...group.items, { id: newId('spec'), label: 'Nouvelle donnée', value: '' }] }
      : group));
  };

  const renderWatchWebsiteBlock = (blockId: PublishedBlockId) => {
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
              <small>{specificationValue('Numéro de référence', watch.reference.reference)}</small>
            </div>
            <div className="cover-sheet__photo">
              {mainPhoto
                ? <img src={mainPhoto.url} alt={`${specificationValue('Marque', watch.reference.brand)} ${specificationValue('Modèle', watch.reference.model)}`} />
                : <span className="empty-media">PHOTO PRINCIPALE NON AFFECTÉE</span>}
            </div>
          </section>
        );
      case 'cover-owner':
        return (
          <section>
            <SectionTitle eyebrow="Dossier privé" title="Propriétaire de la montre" />
            <article className="owner-card owner-card--published">
              <div className="owner-type-badge">{ownerType}</div>
              <dl className="owner-fields owner-fields--published">
                {ownerFields.map((field) => <div key={field.id}><dt>{field.label}</dt><dd>{field.value || 'Non renseigné'}</dd></div>)}
              </dl>
              {ownerDocuments.length > 0 && (
                <div className="owner-documents owner-documents--published">
                  <h3>Documents associés</h3>
                  {ownerDocuments.map((document) => <div key={document.id}><FileText size={16} /><span>{document.category}</span><strong>{document.fileName}</strong></div>)}
                </div>
              )}
            </article>
          </section>
        );
      case 'cover-storage':
        return (
          <section>
            <SectionTitle eyebrow="Conservation" title="Stockage" />
            <article className="storage-card"><p>{storageDescription || 'Lieu de stockage non renseigné.'}</p></article>
          </section>
        );
      case 'media-hero':
        return (
          <section className="watch-website__hero">
            {mainPhoto && <img src={mainPhoto.url} alt={`${watch.reference.brand} ${watch.reference.model}`} />}
            <div>
              <span className="eyebrow">{watch.reference.reference}</span>
              <h2>{watch.reference.brand}<br />{watch.reference.model}</h2>
              <p>{editableCopy.heroSummary}</p>
              <dl className="hero-facts">
                <div><dt>Statut</dt><dd>En possession</dd></div>
                <div><dt>Dernier contrôle</dt><dd>{formatDate(watch.lastVerificationDate)}</dd></div>
                <div><dt>Référence</dt><dd>{watch.reference.reference}</dd></div>
                <div><dt>Dossier</dt><dd>{mockCartulary.publicCode}</dd></div>
              </dl>
            </div>
          </section>
        );
      case 'media-motion':
        return (
          <section>
            <SectionTitle eyebrow="Vidéo principale" title="La montre en mouvement" />
            {mainVideo ? (
              <a className="video-poster watch-website__media-link" href={mainVideo.url} target="_blank" rel="noreferrer">
                <img src={mainVideo.posterUrl || mainVideo.thumbnailUrl || mainVideo.url} alt="La montre en mouvement" />
                <span className="video-poster__play" aria-hidden="true"><Play size={24} fill="currentColor" /></span>
              </a>
            ) : <p className="watch-website__empty">Vidéo non disponible.</p>}
          </section>
        );
      case 'media-spin':
        return (
          <section>
            <SectionTitle eyebrow="Séquence 3D" title="Revue à 360°" />
            {spinAssets.length > 0
              ? <Spin360 images={spinAssets} posterImageUrl={spinAssets[0].url} language={language} />
              : <p className="watch-website__empty">Séquence non disponible.</p>}
          </section>
        );
      case 'media-slideshow':
        return (
          <section>
            <SectionTitle eyebrow="Présentation" title="Diaporama" />
            <MediaCarousel assets={presentationAssets} language={language} onOpen={(asset) => window.open(asset.url, '_blank', 'noopener,noreferrer')} />
          </section>
        );
      case 'media-library':
        return (
          <section>
            <SectionTitle eyebrow="Fichiers publiés" title="Bibliothèque média" />
            <div className="media-library watch-website__library">
              {visibleAssets.map((asset) => (
                <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer">
                  <span className="media-library__preview">
                    {asset.type === 'document' ? <FileText size={28} /> : <img src={asset.posterUrl || asset.thumbnailUrl || asset.url} alt="" />}
                  </span>
                  <strong>{asset.name}</strong>
                  <time dateTime={asset.metadataTimestamp}>{asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : 'Horodatage indisponible'}</time>
                </a>
              ))}
            </div>
          </section>
        );
      case 'reference-history':
        return (
          <section>
            <SectionTitle eyebrow="La référence" title="Origines" />
            <div className="watch-website__two-columns">
              <div className="history-text"><h3>Historique du modèle</h3>{editableCopy.originParagraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
              <aside className="quote-card"><span className="eyebrow">À savoir</span><p>{editableCopy.originKnowledge}</p></aside>
            </div>
          </section>
        );
      case 'reference-specs':
        return (
          <section>
            <SectionTitle eyebrow="Fiche d’identité" title="Spécifications de la référence" />
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
            <SectionTitle eyebrow="Identification" title="Points à contrôler" />
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
            <SectionTitle eyebrow="Communauté et ressources" title="Popularité du modèle" />
            <div className="watch-website__resource-list">
              {popularityResources.map((resource) => <a key={resource.id} href={resource.url} target="_blank" rel="noreferrer"><span>{resource.type}</span><strong>{resource.name}</strong><ExternalLink size={15} /></a>)}
            </div>
          </section>
        );
      case 'condition-description':
        return (
          <section>
            <SectionTitle eyebrow="Synthèse" title="Description de la montre" />
            <article className="watch-description-card">
              {editableCopy.watchDescription.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </article>
          </section>
        );
      case 'condition-summary':
        return (
          <section>
            <SectionTitle eyebrow="Synthèse" title="État actuel" />
            <article className="current-condition-summary">
              {editableCopy.conditionSummary.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
              <dl><div><dt>Dernier état</dt><dd>{editableCopy.conditionFacts.lastCondition}</dd></div><div><dt>Conclusion</dt><dd>{editableCopy.conditionFacts.conclusion}</dd></div><div><dt>Point ouvert</dt><dd>{editableCopy.conditionFacts.openPoint}</dd></div></dl>
            </article>
          </section>
        );
      case 'condition-documentation':
        return (
          <section>
            <SectionTitle eyebrow="Ensemble associé" title="Papiers, documentation et accessoires" />
            <div className="watch-website__document-list">
              {documentationItems.map((item) => <div key={item.id}><span>{item.category}</span><p>{item.description}</p><strong>{item.state}</strong></div>)}
            </div>
            <div className="documentation-media__grid watch-website__document-media">
              {documentationAssets.map((asset) => (
                <a key={asset.id} href={asset.url} target="_blank" rel="noreferrer">
                  <span className="documentation-media__preview">{asset.type === 'document' ? <FileText size={28} /> : <img src={asset.posterUrl || asset.thumbnailUrl || asset.url} alt="" />}</span>
                  <strong>{asset.name}</strong><small>{asset.tags.includes('documentation') ? 'Documentation' : 'Accessoires'}</small>
                  <time dateTime={asset.metadataTimestamp}>{asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : 'Horodatage indisponible'}</time>
                </a>
              ))}
            </div>
          </section>
        );
      case 'condition-reference-report':
        return (
          <section>
            <SectionTitle eyebrow="Rapport de référence" title="Rapport d’état de référence" />
            <div className="condition-entry-list">
              {referenceConditionReport && <article className="condition-entry"><header><time>{formatDate(referenceConditionReport.date)}</time><h3>{referenceConditionReport.title}</h3></header>{referenceConditionReport.note && <p>{referenceConditionReport.note}</p>}{referenceConditionReport.attachments.length > 0 && <ul className="attachment-list">{referenceConditionReport.attachments.map((attachment, index) => <li key={`${referenceConditionReport.id}-${index}`}><Paperclip size={13} /><span>{attachment.name}</span></li>)}</ul>}</article>}
            </div>
          </section>
        );
      case 'condition-prior-reviews':
        return (
          <section>
            <SectionTitle eyebrow="Historique" title="Revues antérieures" />
            <div className="condition-entry-list">
              {priorConditionReviews.map((entry) => <article key={entry.id} className="condition-entry"><header><time>{formatDate(entry.date)}</time><h3>{entry.title}</h3></header>{entry.note && <p>{entry.note}</p>}{entry.attachments.length > 0 && <ul className="attachment-list">{entry.attachments.map((attachment, index) => <li key={`${entry.id}-${index}`}><Paperclip size={13} /><span>{attachment.name}</span></li>)}</ul>}</article>)}
            </div>
          </section>
        );
      case 'value-market':
        return (
          <section>
            <SectionTitle eyebrow="Évaluation de marché" title="Données de marché" />
            <div className="market-grid">
              <article className="market-chart-card"><span className="eyebrow">Évolution du marché</span><div className="market-bars">{marketValues.map((valuation) => <div key={valuation.id}><span style={{ height: `${Math.max(18, (valuation.midValue / maxMarketValue) * 100)}%` }} /><strong>{formatMoney(valuation.midValue, valuation.currency)}</strong><time>{formatDate(valuation.date)}</time></div>)}</div><small>Source : évaluations datées du dossier</small></article>
              <article className="market-depth-card"><div className="market-depth-card__heading"><span className="eyebrow">Profondeur de marché</span><time dateTime={marketDepth.analysisDate}>{marketDepth.analysisDate ? `Analyse du ${formatDate(marketDepth.analysisDate)}` : 'Date non renseignée'}</time></div><div className="metric-grid"><div><strong>{mockCartulary.marketSnapshot.activeListings}</strong><span>Annonces actives</span></div><div><strong>{marketDepth.transactions12m}</strong><span>Transactions identifiées · 12 mois</span></div><div><strong>{mockCartulary.marketSnapshot.medianDaysOnMarket} j</strong><span>Délai médian estimé</span></div></div><div className="valuation-range"><span>Fourchette actuelle</span><strong>{formatMoney(mockCartulary.marketSnapshot.lowValue)} — {formatMoney(mockCartulary.marketSnapshot.highValue)}</strong></div></article>
            </div>
          </section>
        );
      case 'value-comparables-listings':
        return (
          <section>
            <SectionTitle eyebrow="Comparables" title="Annonces en cours" />
            <ComparableTable title="Annonces en cours" items={listingComparables} hideHeading />
          </section>
        );
      case 'value-comparables-transactions':
        return (
          <section>
            <SectionTitle eyebrow="Comparables" title="Transactions réalisées" />
            <ComparableTable title="Transactions réalisées" items={transactionComparables} hideHeading />
          </section>
        );
      case 'value-comparables-analysis':
        return (
          <section>
            <SectionTitle eyebrow="Comparables" title="Synthèse de l’analyse" />
            <div className="comparables-analysis"><p>Prix affiché moyen : {formatMoney(averageListingPrice)}. Prix réalisé moyen : {formatMoney(averageTransactionPrice)}. Écart observé : {formatPercent(listingPremium)}. Les annonces spécialisées défendent mieux le prix ; l’enchère privilégie la liquidité.</p></div>
          </section>
        );
      case 'value-cost-basis':
        return (
          <section>
            <SectionTitle eyebrow="Acquisition" title="Prix de revient" />
            <div className="watch-website__financial-table"><div><span>Achat · {formatDate(purchase.date)}</span><strong>{formatMoney(purchase.purchasePrice, watch.currency)}</strong></div>{purchaseExpenses.map((expense) => <div key={expense.id}><span>{expense.kind} · {expense.label} · {formatDate(expense.date)}</span><strong>{formatMoney(expense.amount, watch.currency)}</strong></div>)}<div className="is-total"><span>Prix de revient</span><strong>{formatMoney(costBasis, watch.currency)}</strong></div></div>
          </section>
        );
      case 'value-performance':
        return (
          <section>
            <SectionTitle eyebrow="Performance de détention" title="Plus-value, moins-value et TRI" />
            <div className="performance-results watch-website__performance"><div><span>Prix de revient</span><strong>{formatMoney(costBasis, watch.currency)}</strong></div><div><span>Prix de vente</span><strong>{formatMoney(exitAssumptions.salePrice, watch.currency)}</strong></div><div><span>Coût de cession</span><strong>− {formatMoney(disposalCost, watch.currency)}</strong></div><div className={capitalGainLoss >= 0 ? 'is-positive' : 'is-negative'}><span>Plus / moins-value nette</span><strong>{formatMoney(capitalGainLoss, watch.currency)}</strong><small>{formatPercent(capitalGainLossPct)}</small></div><div className={holdingIrr !== null && holdingIrr >= 0 ? 'is-positive' : 'is-negative'}><span>TRI annualisé</span><strong>{formatPercent(holdingIrr)}</strong><small>Flux datés</small></div></div>
          </section>
        );
      case 'value-sensitivity':
        return (
          <section>
            <SectionTitle eyebrow="Sensibilité" title="Prix de vente et coût de cession" />
            <div className="sensitivity-stack"><div><h3>Plus-value ou moins-value nette</h3><div className="sensitivity-table"><div className="sensitivity-table__head"><span>Coût \ Prix</span>{SENSITIVITY_PRICES.map((price) => <strong key={price}>{formatMoney(price, watch.currency)}</strong>)}</div>{SENSITIVITY_COSTS.map((costPct) => <div key={costPct}><strong>{costPct} %</strong>{SENSITIVITY_PRICES.map((price) => { const scenario = scenarioPerformance(price, costPct); return <span key={price} className={scenario.gainLoss >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatMoney(scenario.gainLoss, watch.currency)}</strong></span>; })}</div>)}</div></div><div><h3>TRI annualisé</h3><div className="sensitivity-table sensitivity-table--irr"><div className="sensitivity-table__head"><span>Coût \ Prix</span>{SENSITIVITY_PRICES.map((price) => <strong key={price}>{formatMoney(price, watch.currency)}</strong>)}</div>{SENSITIVITY_COSTS.map((costPct) => <div key={costPct}><strong>{costPct} %</strong>{SENSITIVITY_PRICES.map((price) => { const scenario = scenarioPerformance(price, costPct); return <span key={price} className={scenario.irr !== null && scenario.irr >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatPercent(scenario.irr)}</strong></span>; })}</div>)}</div></div></div>
          </section>
        );
      default:
        return null;
    }
  };

  if (isWatchWebsite) {
    const orderedBlocks = PUBLISHED_BLOCK_IDS.filter((blockId) => watchWebsiteBlocks.includes(blockId));
    return (
      <div className="watch-website" data-ai-schema-version={AI_SCHEMA_VERSION}>
        <header className="watch-website__masthead">
          <div className="container">
            <span className="watch-website__wordmark">Cartularia</span>
            <div><span className="eyebrow">Watch website · {mockCartulary.publicCode}</span><strong>{watch.reference.brand} · {watch.reference.model}</strong></div>
          </div>
        </header>
        <main className="container watch-website__main">
          {orderedBlocks.length > 0
            ? orderedBlocks.map((blockId) => <div className="watch-website__block" id={blockId} key={blockId}>{renderWatchWebsiteBlock(blockId)}</div>)
            : <div className="watch-website__empty-state"><Globe2 size={26} /><h1>Aucun contenu publié</h1><p>Cette sélection publique ne contient actuellement aucun bloc.</p></div>}
        </main>
        <footer className="watch-website__footer"><div className="container"><span>Dossier numérique indépendant</span><span>{mockCartulary.publicCode} · 2026</span></div></footer>
      </div>
    );
  }

  return (
    <div className="app-shell" data-ai-schema-version={AI_SCHEMA_VERSION}>
      <BarreDossier
        publicCode={mockCartulary.publicCode}
        brand={watch.reference.brand}
        model={watch.reference.model}
        language={language}
        setLanguage={setLanguage}
        audience={audience}
        setAudience={setAudience}
      />

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
          <a className="page-tabs__website" href={watchWebsiteUrl} target="_blank" rel="noreferrer">
            <Globe2 size={14} />
            Watch website
            <span>{publishedBlocks.length}</span>
          </a>
          <button type="button" className="page-tabs__report" onClick={handleReportPrint} disabled={orderedReportBlocks.length === 0}>
            <Printer size={14} />
            Rapport PDF
            <span>{orderedReportBlocks.length}</span>
          </button>
          <button type="button" className="page-tabs__audit" onClick={() => setIsDrawerOpen(true)}>
            <ShieldCheck size={14} />
            {language === 'FR' ? 'Intégrité' : 'Integrity'}
          </button>
        </div>
      </nav>

      <main className="container cartulary-main">
        {activePage === 'cover' && (
          <div className="page-view cover-page">
            <section className="cover-sheet publishable-block">
              <BlockMarkers selection={publishProps('cover-watch', true)} label="Accueil de la montre" />
              <div className="cover-sheet__identity">
                <span className="eyebrow">Cartulaire · {mockCartulary.publicCode}</span>
                {editingBlock === 'cover-watch' ? (
                  <div className="cover-sheet__identity-editor">
                    <label>Marque<input {...aiFieldProps('cover.watch.brand')} type="text" value={specificationValue('Marque', watch.reference.brand)} onChange={(event) => updateSpecificationValue('Marque', event.target.value)} /></label>
                    <label>Nom de la montre<input {...aiFieldProps('cover.watch.model')} type="text" value={specificationValue('Modèle', watch.reference.model)} onChange={(event) => updateSpecificationValue('Modèle', event.target.value)} /></label>
                  </div>
                ) : (
                  <button type="button" className="cover-sheet__editable-title editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('cover-watch')} title={audience === 'Secret' ? 'Cliquer pour modifier' : undefined}>
                    <span>{specificationValue('Marque', watch.reference.brand)}</span>
                    <strong>{specificationValue('Modèle', watch.reference.model)}</strong>
                  </button>
                )}
                <small {...aiFieldProps('cover.watch.reference')}>{specificationValue('Numéro de référence', watch.reference.reference)}</small>
              </div>
              <button
                type="button"
                className="cover-sheet__photo"
                onClick={() => mainPhoto && setSelectedAsset(mainPhoto)}
                aria-label="Agrandir la photo principale"
              >
                {mainPhoto
                  ? <img src={mainPhoto.url} alt={`${specificationValue('Marque', watch.reference.brand)} ${specificationValue('Modèle', watch.reference.model)}`} />
                  : <span className="empty-media">PHOTO PRINCIPALE NON AFFECTÉE</span>}
              </button>
            </section>

            {isVisible('Secret') ? (
              <>
              <section>
                <SectionTitle eyebrow="Dossier privé" title="Propriétaire de la montre" publish={publishProps('cover-owner')} />
                <article className="owner-card">
                  <div className="owner-type-selector">
                    <label>Type de propriétaire
                      <select {...aiFieldProps('cover.owner.type')} value={ownerType} onChange={(event) => setOwnerType(event.target.value as OwnerType)}>
                        <option>Personne physique</option>
                        <option>Entreprise</option>
                      </select>
                    </label>
                    <p>Les catégories d’identification ci-dessous restent entièrement personnalisables.</p>
                  </div>
                  <div className="owner-fields">
                    {ownerFields.map((field) => (
                      <div className="owner-field" key={field.id} data-ai-scope="cover.owner.customFields[]" data-ai-instance={field.id}>
                        <input {...aiFieldProps('cover.owner.customFields[].label', field.id)} type="text" value={field.label} onChange={(event) => updateOwnerField(field.id, { label: event.target.value })} aria-label="Catégorie de donnée propriétaire" />
                        <textarea {...aiFieldProps('cover.owner.customFields[].value', field.id)} value={field.value} rows={field.id === 'owner-address' ? 3 : 2} onChange={(event) => updateOwnerField(field.id, { value: event.target.value })} aria-label={field.label || 'Donnée propriétaire'} placeholder="À renseigner" />
                        <button type="button" className="icon-button no-print" onClick={() => setOwnerFields((current) => current.filter((item) => item.id !== field.id))} aria-label={`Supprimer ${field.label || 'cette catégorie'}`}><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="button button--quiet no-print" onClick={() => setOwnerFields((current) => [...current, { id: newId('owner-field'), label: 'Nouvelle catégorie', value: '' }])}><Plus size={14} /> Ajouter une catégorie</button>

                  <div className="owner-documents">
                    <div className="owner-documents__heading"><div><span className="eyebrow">Pièces confidentielles</span><h3>Documents du propriétaire</h3></div><span>{ownerDocuments.length} fichier{ownerDocuments.length > 1 ? 's' : ''}</span></div>
                    {ownerDocuments.length > 0 ? (
                      <div className="owner-document-list">
                        {ownerDocuments.map((document) => (
                          <div className="owner-document" key={document.id} data-ai-scope="cover.owner.documents[]" data-ai-instance={document.id}>
                            <FileText size={20} aria-hidden="true" />
                            <input {...aiFieldProps('cover.owner.documents[].category', document.id)} type="text" value={document.category} onChange={(event) => updateOwnerDocument(document.id, { category: event.target.value })} aria-label="Catégorie du document" />
                            <div><input {...aiFieldProps('cover.owner.documents[].fileName', document.id)} type="text" value={document.fileName} onChange={(event) => updateOwnerDocument(document.id, { fileName: event.target.value })} aria-label="Nom du fichier" /><small>{formatFileSize(document.size)} · {document.type || 'fichier'}</small></div>
                            {document.url && <a className="icon-button no-print" href={document.url} download={document.fileName} aria-label={`Télécharger ${document.fileName}`}><ExternalLink size={15} /></a>}
                            <button type="button" className="icon-button no-print" onClick={() => deleteOwnerDocument(document.id)} aria-label={`Supprimer ${document.fileName}`}><Trash2 size={15} /></button>
                          </div>
                        ))}
                      </div>
                    ) : <p className="owner-documents__empty">Aucun document d’identité ajouté.</p>}

                    <form className="owner-document-upload no-print" onSubmit={addOwnerDocuments}>
                      <label>Catégorie<input {...aiFieldProps('cover.owner.documents[].category', 'new')} type="text" name="owner-document-category" list="owner-document-categories" defaultValue="Carte d’identité" placeholder="Carte d’identité, passeport…" /><datalist id="owner-document-categories"><option value="Carte d’identité" /><option value="Passeport" /><option value="Justificatif de domicile" /><option value="Autre" /></datalist></label>
                      <label className="file-drop"><Upload size={18} /><span>Ajouter un ou plusieurs documents</span><small>PDF, images ou autres formats</small><input {...aiFieldProps('cover.owner.documents[].file', 'new')} type="file" name="owner-documents" multiple /></label>
                      <button type="submit" className="button button--primary">Ajouter les documents</button>
                    </form>
                  </div>
                </article>
              </section>

              <section>
                <SectionTitle eyebrow="Conservation" title="Stockage" publish={publishProps('cover-storage', true)} />
                <article className="storage-card">
                  {editingBlock === 'cover-storage'
                    ? <textarea {...aiFieldProps('cover.storage.description')} value={storageDescription} rows={4} onChange={(event) => setStorageDescription(event.target.value)} aria-label="Description du lieu de stockage" placeholder="Décrire le lieu et les conditions de stockage" />
                    : <p {...aiFieldProps('cover.storage.description')} className="editable-click-target" onClick={() => setEditingBlock('cover-storage')} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') setEditingBlock('cover-storage'); }} title="Cliquer pour modifier">{storageDescription || 'Lieu de stockage non renseigné.'}</p>}
                </article>
              </section>
              </>
            ) : <AccessRestricted title="Informations du propriétaire" />}
          </div>
        )}

        {activePage === 'media' && (
          <div className="page-view">
            <section className="watch-hero publishable-block">
              <BlockMarkers selection={publishProps('media-hero', true)} label="Présentation principale" />
              <button
                type="button"
                className="watch-hero__image"
                onClick={() => mainPhoto && setSelectedAsset(mainPhoto)}
                aria-label={language === 'FR' ? 'Agrandir la photo principale' : 'Enlarge main photo'}
              >
                {mainPhoto ? (
                  <span className="watch-hero__image-visual">
                    <img src={mainPhoto.url} alt={`${watch.reference.brand} ${watch.reference.model}`} />
                  </span>
                ) : (
                  <span className="watch-hero__image-visual empty-media">PHOTO PRINCIPALE NON AFFECTÉE</span>
                )}
                <span className="watch-hero__image-label">01 · Photo principale</span>
                <strong className="watch-hero__image-brand">{watch.reference.brand}</strong>
              </button>

              <div className="watch-hero__card">
                <span className="eyebrow">{watch.reference.reference}</span>
                <h1>{watch.reference.model}</h1>
                {editingBlock === 'media-hero' ? (
                  <textarea {...aiFieldProps('media.hero.summary')} className="editable-copy-single" value={editableCopy.heroSummary} rows={5} onChange={(event) => setEditableCopy((current) => ({ ...current, heroSummary: event.target.value }))} aria-label="Modifier la présentation principale" />
                ) : <p {...aiFieldProps('media.hero.summary')} className="watch-hero__summary editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('media-hero')} tabIndex={audience === 'Secret' ? 0 : undefined} onKeyDown={(event) => { if (event.key === 'Enter' && audience === 'Secret') setEditingBlock('media-hero'); }} title={audience === 'Secret' ? 'Cliquer pour modifier' : undefined}>{editableCopy.heroSummary}</p>}
                <dl className="hero-facts">
                  <div><dt>Statut</dt><dd>En possession</dd></div>
                  <div><dt>Dernier contrôle</dt><dd>{formatDate(watch.lastVerificationDate)}</dd></div>
                  <div><dt>Valeur estimée</dt><dd>{isVisible('Secret') ? formatMoney(mockCartulary.marketSnapshot.midValue) : 'ACCÈS RESTREINT'}</dd></div>
                  <div><dt>Dossier</dt><dd>{mockCartulary.publicCode}</dd></div>
                </dl>
              </div>
            </section>

            <section className="media-wide-section">
              <SectionTitle eyebrow="02 · Vidéo principale" title="La montre en mouvement" publish={publishProps('media-motion')} />
              {mainVideo ? (
                <VideoPoster asset={mainVideo} onOpen={setSelectedAsset} />
              ) : (
                <AccessRestricted title="Vidéo principale non disponible" />
              )}
            </section>

            <section className="media-wide-section">
              <SectionTitle eyebrow="03 · Séquence 3D" title="Revue à 360°" publish={publishProps('media-spin')} />
              {spinAssets.length > 0 ? (
                <button type="button" className="spin-callout" onClick={() => setIsSpinOpen(true)}>
                  <img src={spinAssets[0].url} alt="Aperçu de la séquence 360°" />
                  <span className="spin-callout__icon"><RotateCw size={23} /></span>
                  <span><strong>{spinAssets.length} vues ordonnées</strong></span>
                </button>
              ) : (
                <AccessRestricted title="Séquence 3D non affectée" />
              )}
            </section>

            <section>
              <SectionTitle eyebrow="04 · Présentation" title="Diaporama" publish={publishProps('media-slideshow')} />
              <MediaCarousel assets={presentationAssets} language={language} onOpen={setSelectedAsset} />
            </section>

            {audience === 'Secret' && (
              <section>
                <SectionTitle eyebrow="Gestion des actifs" title="Bibliothèque média" publish={publishProps('media-library')} />
                <div className="media-library-layout">
                  <div className="media-library">
                    {visibleAssets.map((asset) => (
                      <button type="button" key={asset.id} onClick={() => setSelectedAsset(asset)} data-ai-scope="media.assets[]" data-ai-instance={asset.id}>
                        <span className="media-library__preview">
                          {asset.type === 'document' ? (
                            <><FileText size={28} /><small>{asset.mimeType?.split('/').pop()?.toUpperCase() || 'FICHIER'}</small></>
                          ) : (
                            <img src={asset.posterUrl || asset.thumbnailUrl || asset.url} alt="" />
                          )}
                        </span>
                        <strong {...aiFieldProps('media.assets[].name', asset.id)}>{asset.name}</strong>
                        <small>{asset.type} · {asset.fileSize || 'fichier indexé'}</small>
                        <time {...aiFieldProps('media.assets[].metadataTimestamp', asset.id)} className="media-library__timestamp" dateTime={asset.metadataTimestamp}>
                          {asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : 'Horodatage indisponible'}
                        </time>
                        <span {...aiFieldProps('media.assets[].tags', asset.id)} className="media-library__tags">
                          {asset.tags.map((tag) => <span key={tag}>{MEDIA_TAGS.find((item) => item.id === tag)?.label || tag}</span>)}
                        </span>
                      </button>
                    ))}
                  </div>

                  <form className="media-upload-form no-print" onSubmit={addMediaAssets}>
                    <span className="eyebrow">Nouvel actif</span>
                    <label className="file-drop file-drop--media">
                      <Upload size={18} />
                      <span>Importer tous types de fichiers</span>
                      <small>Images, vidéos, PDF, documents et archives</small>
                      <input {...aiFieldProps('media.assets[].file', 'new')} type="file" name="media-files" multiple />
                    </label>
                    <fieldset>
                      <legend>Tags initiaux</legend>
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
                            <span>{tag.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <button type="submit" className="button button--primary">Ajouter à la bibliothèque</button>
                  </form>
                </div>
              </section>
            )}
          </div>
        )}

        {activePage === 'reference' && (
          <div className="page-view">
            <PageIntroduction number="02" title="Caractéristiques générales" />

            <section>
              <SectionTitle eyebrow="La référence" title="Origines" publish={publishProps('reference-history', true)} />
              <div className="reference-story-grid">
                <article className="editorial-card editorial-card--large">
                <span className="eyebrow">Historique du modèle</span>
                <h2>Une montre de pilote pensée pour voyager</h2>
                <EditableParagraphs aiField="reference.origins.history[]" values={editableCopy.originParagraphs} editing={editingBlock === 'reference-history'} onActivate={() => audience === 'Secret' && setEditingBlock('reference-history')} onChange={(index, value) => setEditableCopy((current) => ({ ...current, originParagraphs: current.originParagraphs.map((paragraph, paragraphIndex) => paragraphIndex === index ? value : paragraph) }))} className="history-text" />
                </article>
                <aside className="quote-card">
                <span className="eyebrow">A savoir</span>
                {editingBlock === 'reference-history' ? <textarea {...aiFieldProps('reference.origins.knowledge')} value={editableCopy.originKnowledge} rows={7} onChange={(event) => setEditableCopy((current) => ({ ...current, originKnowledge: event.target.value }))} aria-label="Modifier À savoir" /> : <p {...aiFieldProps('reference.origins.knowledge')} className="editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('reference-history')} title={audience === 'Secret' ? 'Cliquer pour modifier' : undefined}>{editableCopy.originKnowledge}</p>}
                </aside>
              </div>
            </section>

            <section>
              <SectionTitle eyebrow="Fiche d’identité" title="Spécifications de la référence" publish={publishProps('reference-specs')} />
              <div className="specification-groups">
                {specificationGroups.map((group) => (
                  <section className="specification-group" key={group.title}>
                    <h3>{group.title}</h3>
                    <dl>
                      {group.items.map((item) => (
                        <div className="specification-row" key={item.id} data-ai-scope="reference.specifications[]" data-ai-instance={item.id}>
                          {audience === 'Secret' ? (
                            <>
                              <dt><input {...aiFieldProps('reference.specifications[].label', item.id)} type="text" value={item.label} onChange={(event) => updateSpecification(group.id, item.id, { label: event.target.value })} aria-label={`Modifier le nom de ${item.label}`} /></dt>
                              <dd><input {...aiFieldProps('reference.specifications[].value', item.id)} type="text" value={item.value} onChange={(event) => updateSpecification(group.id, item.id, { value: event.target.value })} aria-label={`Modifier ${item.label}`} /></dd>
                              <button type="button" className="icon-button no-print" onClick={() => deleteSpecification(group.id, item.id)} aria-label={`Supprimer ${item.label}`}><Trash2 size={15} /></button>
                            </>
                          ) : <><dt>{item.label}</dt><dd>{item.value}</dd></>}
                        </div>
                      ))}
                    </dl>
                    {audience === 'Secret' && <button type="button" className="specification-add button button--quiet no-print" onClick={() => addSpecification(group.id)}><Plus size={14} /> Ajouter une donnée</button>}
                  </section>
                ))}
              </div>
            </section>

            <section>
              <div className="section-heading-row">
                <SectionTitle eyebrow="Identification" title="Points à contrôler" />
                <div className="section-heading-actions">
                  <BlockMarkers selection={publishProps('reference-checks')} label="Points à contrôler" />
                  {audience === 'Secret' && (
                    <button type="button" className={`content-marker content-marker--edit no-print ${isEditingChecks ? 'is-active' : ''}`} onClick={() => setIsEditingChecks((value) => !value)} aria-pressed={isEditingChecks} aria-label={isEditingChecks ? 'Terminer la modification de la liste' : 'Modifier la liste'} title="Modifier la liste"><Pencil size={15} /></button>
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
                          <input {...aiFieldProps('reference.checks[].title', item.id)} value={item.title} onChange={(event) => updateCheck(item.id, { title: event.target.value })} aria-label="Point de contrôle" />
                          <textarea {...aiFieldProps('reference.checks[].note', item.id)} value={item.note} onChange={(event) => updateCheck(item.id, { note: event.target.value })} aria-label="Détail du contrôle" rows={2} />
                        </>
                      ) : (
                        <><h3>{item.title}</h3><p>{item.note}</p></>
                      )}
                    </div>
                    {isEditingChecks && (
                      <button
                        type="button"
                        className="icon-button no-print"
                        onClick={() => setIdentificationChecks((current) => current.filter((check) => check.id !== item.id))}
                        aria-label={`Supprimer ${item.title}`}
                      ><Trash2 size={15} /></button>
                    )}
                  </article>
                ))}
              </div>
              {audience === 'Secret' && (
                <button type="button" className="button button--quiet no-print" onClick={addCheck}><Plus size={14} /> Ajouter un point</button>
              )}
              <p className="method-note">Le Sceau atteste l’intégrité du dossier enregistré. Il ne remplace ni l’examen physique ni la conclusion d’un expert.</p>
            </section>

            <section>
              <SectionTitle eyebrow="Communauté et ressources" title="Popularité du modèle" publish={publishProps('reference-popularity')} />
              <div className="popularity-resources">
                <div className="popularity-resources__head"><span>Site ou forum</span><span>Type</span><span>URL</span><span /></div>
                {popularityResources.map((resource) => {
                  const hasValidUrl = /^https?:\/\//i.test(resource.url);
                  return (
                    <div key={resource.id} data-ai-scope="reference.popularity[]" data-ai-instance={resource.id}>
                      {audience === 'Secret' ? (
                        <input {...aiFieldProps('reference.popularity[].name', resource.id)} type="text" value={resource.name} onChange={(event) => updatePopularityResource(resource.id, 'name', event.target.value)} aria-label="Nom du site ou forum" />
                      ) : (
                        <strong>{resource.name}</strong>
                      )}
                      {audience === 'Secret' ? (
                        <select {...aiFieldProps('reference.popularity[].type', resource.id)} value={resource.type} onChange={(event) => updatePopularityResource(resource.id, 'type', event.target.value as PopularityResourceType)} aria-label={`Type ${resource.name}`}>
                          {(['Forum officiel', 'Discussion dédiée', 'Communauté', 'Base de données', 'Revue'] as PopularityResourceType[]).map((type) => <option key={type}>{type}</option>)}
                        </select>
                      ) : (
                        <span>{resource.type}</span>
                      )}
                      <div className="popularity-url-cell">
                        {audience === 'Secret' ? (
                          <input {...aiFieldProps('reference.popularity[].url', resource.id)} type="url" value={resource.url} onChange={(event) => updatePopularityResource(resource.id, 'url', event.target.value)} aria-label={`URL ${resource.name}`} placeholder="https://" />
                        ) : (
                          <span>{resource.url}</span>
                        )}
                        {hasValidUrl && <a href={resource.url} target="_blank" rel="noreferrer" aria-label={`Ouvrir ${resource.name}`}><ExternalLink size={15} /></a>}
                      </div>
                      {audience === 'Secret' && <button type="button" className="icon-button no-print" onClick={() => setPopularityResources((current) => current.filter((item) => item.id !== resource.id))} aria-label={`Supprimer ${resource.name}`}><Trash2 size={15} /></button>}
                    </div>
                  );
                })}
              </div>
              {audience === 'Secret' && (
                <button type="button" className="button button--quiet no-print" onClick={() => setPopularityResources((current) => [...current, { id: newId('popularity'), name: '', type: 'Communauté', url: '' }])}><Plus size={14} /> Ajouter un site ou forum</button>
              )}
            </section>
          </div>
        )}

        {activePage === 'condition' && (
          <div className="page-view">
            <PageIntroduction number="03" title="État de la montre" />

            {isVisible('Communauté') ? (
              <>
                <section>
                  <SectionTitle eyebrow="Synthèse" title="Description de la montre" publish={publishProps('condition-description', true)} />
                  <article className="watch-description-card">
                    <EditableParagraphs aiField="condition.description.paragraphs[]" values={editableCopy.watchDescription} editing={editingBlock === 'condition-description'} onActivate={() => audience === 'Secret' && setEditingBlock('condition-description')} onChange={(index, value) => setEditableCopy((current) => ({ ...current, watchDescription: current.watchDescription.map((paragraph, paragraphIndex) => paragraphIndex === index ? value : paragraph) }))} />
                  </article>
                </section>

                <section>
                  <SectionTitle eyebrow="Synthèse" title="État actuel" publish={publishProps('condition-summary', true)} />
                  <article className="current-condition-summary">
                    <EditableParagraphs aiField="condition.summary.paragraphs[]" values={editableCopy.conditionSummary} editing={editingBlock === 'condition-summary'} onActivate={() => audience === 'Secret' && setEditingBlock('condition-summary')} onChange={(index, value) => setEditableCopy((current) => ({ ...current, conditionSummary: current.conditionSummary.map((paragraph, paragraphIndex) => paragraphIndex === index ? value : paragraph) }))} />
                    <dl>
                      <div><dt>Dernier état</dt><dd>{editingBlock === 'condition-summary' ? <input {...aiFieldProps('condition.summary.lastCondition')} value={editableCopy.conditionFacts.lastCondition} onChange={(event) => setEditableCopy((current) => ({ ...current, conditionFacts: { ...current.conditionFacts, lastCondition: event.target.value } }))} aria-label="Dernier état" /> : <button {...aiFieldProps('condition.summary.lastCondition')} type="button" className="editable-fact" onClick={() => audience === 'Secret' && setEditingBlock('condition-summary')}>{editableCopy.conditionFacts.lastCondition}</button>}</dd></div>
                      <div><dt>Conclusion</dt><dd>{editingBlock === 'condition-summary' ? <input {...aiFieldProps('condition.summary.conclusion')} value={editableCopy.conditionFacts.conclusion} onChange={(event) => setEditableCopy((current) => ({ ...current, conditionFacts: { ...current.conditionFacts, conclusion: event.target.value } }))} aria-label="Conclusion" /> : <button {...aiFieldProps('condition.summary.conclusion')} type="button" className="editable-fact" onClick={() => audience === 'Secret' && setEditingBlock('condition-summary')}>{editableCopy.conditionFacts.conclusion}</button>}</dd></div>
                      <div><dt>Point ouvert</dt><dd>{editingBlock === 'condition-summary' ? <input {...aiFieldProps('condition.summary.openPoint')} value={editableCopy.conditionFacts.openPoint} onChange={(event) => setEditableCopy((current) => ({ ...current, conditionFacts: { ...current.conditionFacts, openPoint: event.target.value } }))} aria-label="Point ouvert" /> : <button {...aiFieldProps('condition.summary.openPoint')} type="button" className="editable-fact" onClick={() => audience === 'Secret' && setEditingBlock('condition-summary')}>{editableCopy.conditionFacts.openPoint}</button>}</dd></div>
                    </dl>
                  </article>
                </section>

                <section>
                  <SectionTitle eyebrow="Ensemble associé" title="Papiers, documentation et accessoires" publish={publishProps('condition-documentation')} />
                  <div className="documentation-register">
                    <div className="documentation-register__head"><span>Catégorie</span><span>Description</span><span>État</span><span /></div>
                    {documentationItems.map((item) => (
                      <div key={item.id} data-ai-scope="condition.documentation[]" data-ai-instance={item.id}>
                        <select {...aiFieldProps('condition.documentation[].category', item.id)} value={item.category} disabled={audience !== 'Secret'} onChange={(event) => updateDocumentationItem(item.id, 'category', event.target.value as DocumentationCategory)} aria-label="Catégorie documentaire">
                          {(['Facture', 'Garantie', 'Assurances', 'Boîte', 'Écrin', 'Manuel', 'Certificat', 'Accessoire', 'Autre'] as DocumentationCategory[]).map((category) => <option key={category}>{category}</option>)}
                        </select>
                        <textarea {...aiFieldProps('condition.documentation[].description', item.id)} value={item.description} disabled={audience !== 'Secret'} onChange={(event) => updateDocumentationItem(item.id, 'description', event.target.value)} aria-label={`Description ${item.category}`} rows={2} />
                        <select {...aiFieldProps('condition.documentation[].state', item.id)} value={item.state} disabled={audience !== 'Secret'} onChange={(event) => updateDocumentationItem(item.id, 'state', event.target.value as DocumentationState)} aria-label={`État ${item.category}`}>
                          {(['Présent', 'Complet', 'Incomplet', 'Manquant', 'À vérifier'] as DocumentationState[]).map((state) => <option key={state}>{state}</option>)}
                        </select>
                        {audience === 'Secret' && <button type="button" className="icon-button no-print" onClick={() => setDocumentationItems((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Supprimer ${item.category}`}><Trash2 size={15} /></button>}
                      </div>
                    ))}
                  </div>
                  {audience === 'Secret' && (
                    <button type="button" className="button button--quiet no-print" onClick={() => setDocumentationItems((current) => [...current, { id: newId('documentation'), category: 'Autre', description: '', state: 'À vérifier' }])}><Plus size={14} /> Ajouter un élément</button>
                  )}
                  <div className="documentation-media">
                    <div className="documentation-media__heading">
                      <h3>Fichiers liés</h3>
                      <span>{documentationAssets.length} média{documentationAssets.length > 1 ? 's' : ''}</span>
                    </div>
                    {documentationAssets.length > 0 ? (
                      <div className="documentation-media__grid">
                        {documentationAssets.map((asset) => (
                          <button type="button" key={asset.id} onClick={() => setSelectedAsset(asset)}>
                            <span className="documentation-media__preview">
                              {asset.type === 'document'
                                ? <FileText size={28} aria-hidden="true" />
                                : <img src={asset.posterUrl || asset.thumbnailUrl || asset.url} alt="" />}
                              {asset.type === 'video' && <Play size={13} fill="currentColor" aria-hidden="true" />}
                            </span>
                            <strong>{asset.name}</strong>
                            <small>{asset.tags.includes('documentation') ? 'Documentation' : 'Accessoires'}</small>
                            <time dateTime={asset.metadataTimestamp}>{asset.metadataTimestamp ? formatDateTime(asset.metadataTimestamp) : 'Horodatage indisponible'}</time>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="documentation-media__empty">Aucun fichier n’est encore marqué « Documentation » ou « Accessoires ».</p>
                    )}
                  </div>
                </section>

                <section>
                  <SectionTitle eyebrow="Rapports et notes" title="Historique de l’état" />
                  <div className="condition-layout">
                    <div className="condition-entry-list">
                      {referenceConditionReport && (
                        <article className="condition-entry condition-entry--publishable" data-ai-scope="condition.reports[]" data-ai-instance={referenceConditionReport.id}>
                          <header>
                            <time {...aiFieldProps('condition.reports[].date', referenceConditionReport.id)}>{formatDate(referenceConditionReport.date)}</time>
                            {editingBlock === 'condition-reference-report'
                              ? <input {...aiFieldProps('condition.reports[].title', referenceConditionReport.id)} className="condition-entry__title-input" value={referenceConditionReport.title} onChange={(event) => setConditionEntries((current) => current.map((entry) => entry.id === referenceConditionReport.id ? { ...entry, title: event.target.value } : entry))} aria-label="Modifier le titre du rapport de référence" />
                              : <h3 {...aiFieldProps('condition.reports[].title', referenceConditionReport.id)}>{referenceConditionReport.title}</h3>}
                            <div className="condition-entry__actions">
                              <BlockMarkers selection={publishProps('condition-reference-report', true)} label="Rapport d’état de référence" />
                              {audience === 'Secret' && <button type="button" className="icon-button no-print" onClick={() => setConditionEntries((current) => current.filter((item) => item.id !== referenceConditionReport.id))} aria-label={`Supprimer ${referenceConditionReport.title}`}><Trash2 size={15} /></button>}
                            </div>
                          </header>
                          {editingBlock === 'condition-reference-report'
                            ? <textarea {...aiFieldProps('condition.reports[].note', referenceConditionReport.id)} className="condition-entry__note-input" value={referenceConditionReport.note} rows={5} onChange={(event) => setConditionEntries((current) => current.map((entry) => entry.id === referenceConditionReport.id ? { ...entry, note: event.target.value } : entry))} aria-label="Modifier le rapport de référence" />
                            : referenceConditionReport.note && <p {...aiFieldProps('condition.reports[].note', referenceConditionReport.id)} className="editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('condition-reference-report')} title={audience === 'Secret' ? 'Cliquer pour modifier' : undefined}>{referenceConditionReport.note}</p>}
                          {referenceConditionReport.attachments.length > 0 && (
                            <ul className="attachment-list">
                              {referenceConditionReport.attachments.map((attachment, index) => <li key={`${referenceConditionReport.id}-${attachment.name}-${index}`}><Paperclip size={13} /><span>{attachment.name}</span>{attachment.size && <small>{Math.ceil(attachment.size / 1024)} ko</small>}</li>)}
                            </ul>
                          )}
                        </article>
                      )}

                      <div className="prior-reviews-group">
                        <header className="prior-reviews-group__heading">
                          <div><span className="eyebrow">Historique</span><h3>Revues antérieures</h3></div>
                          <BlockMarkers selection={publishProps('condition-prior-reviews', true)} label="Revues antérieures" />
                        </header>
                        {priorConditionReviews.length > 0 ? priorConditionReviews.map((entry) => (
                          <article key={entry.id} className="condition-entry" data-ai-scope="condition.reports[]" data-ai-instance={entry.id}>
                            <header>
                              <time {...aiFieldProps('condition.reports[].date', entry.id)}>{formatDate(entry.date)}</time>
                              {editingBlock === 'condition-prior-reviews'
                                ? <input {...aiFieldProps('condition.reports[].title', entry.id)} className="condition-entry__title-input" value={entry.title} onChange={(event) => setConditionEntries((current) => current.map((item) => item.id === entry.id ? { ...item, title: event.target.value } : item))} aria-label="Modifier le titre de la revue" />
                                : <h3 {...aiFieldProps('condition.reports[].title', entry.id)}>{entry.title === 'Revues antérieures' ? `Revue du ${formatDate(entry.date)}` : entry.title}</h3>}
                              {audience === 'Secret' && <button type="button" className="icon-button no-print" onClick={() => setConditionEntries((current) => current.filter((item) => item.id !== entry.id))} aria-label={`Supprimer ${entry.title}`}><Trash2 size={15} /></button>}
                            </header>
                            {editingBlock === 'condition-prior-reviews'
                              ? <textarea {...aiFieldProps('condition.reports[].note', entry.id)} className="condition-entry__note-input" value={entry.note} rows={4} onChange={(event) => setConditionEntries((current) => current.map((item) => item.id === entry.id ? { ...item, note: event.target.value } : item))} aria-label="Modifier la revue antérieure" />
                              : entry.note && <p {...aiFieldProps('condition.reports[].note', entry.id)} className="editable-click-target" onClick={() => audience === 'Secret' && setEditingBlock('condition-prior-reviews')} title={audience === 'Secret' ? 'Cliquer pour modifier' : undefined}>{entry.note}</p>}
                            {entry.attachments.length > 0 && (
                              <ul className="attachment-list">
                                {entry.attachments.map((attachment, index) => <li key={`${entry.id}-${attachment.name}-${index}`}><Paperclip size={13} /><span>{attachment.name}</span>{attachment.size && <small>{Math.ceil(attachment.size / 1024)} ko</small>}</li>)}
                              </ul>
                            )}
                          </article>
                        )) : <p className="prior-reviews-group__empty">Aucune revue antérieure enregistrée.</p>}
                      </div>
                    </div>

                    {audience === 'Secret' && (
                      <form className="condition-form no-print" onSubmit={addConditionEntry}>
                        <span className="eyebrow">Nouvelle entrée</span>
                        <label>Date<input {...aiFieldProps('condition.reports[].date', 'new')} type="date" name="date" defaultValue="2026-08-13" required /></label>
                        <label>Titre<input {...aiFieldProps('condition.reports[].title', 'new')} type="text" name="title" placeholder="Rapport, constat, note…" /></label>
                        <label>Note<textarea {...aiFieldProps('condition.reports[].note', 'new')} name="note" rows={7} placeholder="Saisir un texte libre" /></label>
                        <label className="file-drop"><Upload size={18} /><span>Ajouter des documents</span><input {...aiFieldProps('condition.reports[].documents', 'new')} type="file" name="documents" multiple /></label>
                        <button type="submit" className="button button--primary">Enregistrer</button>
                      </form>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <AccessRestricted title="Rapports et notes de la montre" />
            )}
          </div>
        )}

        {activePage === 'value' && (
          <div className="page-view">
            <PageIntroduction number="04" title="Valorisation" />

            {isVisible('Secret') ? (
              <section>
                <SectionTitle eyebrow="Évaluation de marché" title="Données de marché" publish={publishProps('value-market')} />
                <div className="market-grid">
                  <article className="market-chart-card">
                  <span className="eyebrow">Évolution du marché</span>
                  <div className="market-bars" aria-label="Évolution des évaluations médianes">
                    {marketValues.map((valuation) => (
                      <div key={valuation.id} data-ai-scope="value.market.valuations[]" data-ai-instance={valuation.id}>
                        <span style={{ height: `${Math.max(18, (valuation.midValue / maxMarketValue) * 100)}%` }} />
                        <strong {...aiFieldProps('value.market.valuations[].midValue', valuation.id)} data-ai-currency={valuation.currency}>{formatMoney(valuation.midValue, valuation.currency)}</strong>
                        <time {...aiFieldProps('value.market.valuations[].date', valuation.id)}>{formatDate(valuation.date)}</time>
                      </div>
                    ))}
                  </div>
                  <small>Source : évaluations datées du dossier · échantillon interne</small>
                  </article>

                  <article className="market-depth-card">
                  <div className="market-depth-card__heading">
                    <span className="eyebrow">Profondeur de marché</span>
                    <label>Date de l’analyse<input {...aiFieldProps('value.market.analysisDate')} type="date" value={marketDepth.analysisDate} onChange={(event) => setMarketDepth((current) => ({ ...current, analysisDate: event.target.value }))} /></label>
                  </div>
                  <div className="metric-grid">
                    <div><strong>{mockCartulary.marketSnapshot.activeListings}</strong><span>Annonces actives</span></div>
                    <div className="metric-grid__editable"><input {...aiFieldProps('value.market.transactions12m')} type="number" min="0" value={marketDepth.transactions12m} onChange={(event) => setMarketDepth((current) => ({ ...current, transactions12m: Number(event.target.value) }))} aria-label="Transactions identifiées sur les douze derniers mois" /><span>Transactions identifiées · 12 mois</span></div>
                    <div><strong>{mockCartulary.marketSnapshot.medianDaysOnMarket} j</strong><span>Délai médian estimé</span></div>
                  </div>
                  <div className="valuation-range">
                    <span>Fourchette actuelle</span>
                    <strong>{formatMoney(mockCartulary.marketSnapshot.lowValue)} — {formatMoney(mockCartulary.marketSnapshot.highValue)}</strong>
                    <small>MÉDIANE {formatMoney(mockCartulary.marketSnapshot.midValue)}</small>
                  </div>
                  </article>
                </div>
              </section>
            ) : (
              <AccessRestricted title="Analyse de marché" />
            )}

            {isVisible('Secret') && (
              <section>
                <SectionTitle eyebrow="Analyse de marché" title="Comparables" />
                <div className="comparable-groups">
                  <ComparableTable title="Annonces en cours" items={listingComparables} selection={publishProps('value-comparables-listings')} />
                  <ComparableTable title="Transactions réalisées" items={transactionComparables} selection={publishProps('value-comparables-transactions')} />
                </div>

                <div className="comparables-analysis">
                  <div className="comparables-analysis__heading"><h3>Synthèse de l’analyse</h3><BlockMarkers selection={publishProps('value-comparables-analysis')} label="Synthèse de l’analyse des comparables" /></div>
                  <div className="comparables-analysis-table" role="table" aria-label="Synthèse de l’analyse des comparables">
                    <div className="comparables-analysis-table__head" role="row">
                      <span>Angle d’analyse</span><span>Constat</span><span>Lecture</span>
                    </div>
                    {[
                      ['Prix affichés', formatMoney(averageListingPrice), `${listingComparables.length} annonces observées ; ce niveau reste un prix demandé et non un prix encaissé.`],
                      ['Prix réalisés', formatMoney(averageTransactionPrice), `${transactionComparables.length} transaction observée ; ce point dispose d’une valeur probante supérieure mais l’échantillon reste limité.`],
                      ['Écart annonce / transaction', formatPercent(listingPremium), 'L’écart mesure la prime d’affichage observée. Il doit couvrir la négociation, le délai et les frais de cession.'],
                      ['Canal de prix', 'Annonce spécialisée', 'Canal à privilégier pour défendre le prix d’un exemplaire complet, avec un délai de commercialisation plus long.'],
                      ['Canal de liquidité', 'Enchère', 'Exécution plus rapide et prix public, mais résultat plus volatil et frais généralement plus élevés.'],
                    ].map(([angle, finding, reading]) => (
                      <div {...aiFieldProps('value.comparables.analysis[]', angle)} role="row" key={angle}><strong>{angle}</strong><span>{finding}</span><p>{reading}</p></div>
                    ))}
                  </div>
                  <small>ÉCHANTILLON INTERNE · 3 OBSERVATIONS · CONCLUSIONS À CONFIRMER PAR UN ÉCHANTILLON ÉLARGI</small>
                </div>
              </section>
            )}

            {isVisible('Secret') && (
              <section>
                <SectionTitle eyebrow="Acquisition" title="Prix de revient" publish={publishProps('value-cost-basis')} />
                <div className="cost-basis-card">
                  <div className="purchase-fields">
                    <label>Date d’achat<input {...aiFieldProps('value.purchase.date')} type="date" value={purchase.date} onChange={(event) => setPurchase({ ...purchase, date: event.target.value })} /></label>
                    <label>Valeur d’achat<input {...aiFieldProps('value.purchase.price')} type="number" min="0" step="1" value={purchase.purchasePrice} onChange={(event) => setPurchase({ ...purchase, purchasePrice: Number(event.target.value) })} /></label>
                  </div>
                  <div className="expense-table">
                    <div className="expense-table__head"><span>Type</span><span>Date</span><span>Libellé</span><span>Montant</span><span /></div>
                    {purchaseExpenses.map((expense) => (
                      <div key={expense.id} data-ai-scope="value.expenses[]" data-ai-instance={expense.id}>
                        <select {...aiFieldProps('value.expenses[].kind', expense.id)} value={expense.kind} onChange={(event) => updateExpense(expense.id, 'kind', event.target.value as PurchaseExpense['kind'])}>
                          <option>Révision</option><option>Assurance</option><option>Coûts de conservation</option><option>Autre</option>
                        </select>
                        <input {...aiFieldProps('value.expenses[].date', expense.id)} type="date" value={expense.date} onChange={(event) => updateExpense(expense.id, 'date', event.target.value)} />
                        <input {...aiFieldProps('value.expenses[].label', expense.id)} type="text" value={expense.label} onChange={(event) => updateExpense(expense.id, 'label', event.target.value)} aria-label="Libellé de dépense" />
                        <input {...aiFieldProps('value.expenses[].amount', expense.id)} type="number" min="0" step="1" value={expense.amount} onChange={(event) => updateExpense(expense.id, 'amount', Number(event.target.value))} aria-label="Montant de dépense" />
                        <button type="button" className="icon-button no-print" onClick={() => setPurchaseExpenses((current) => current.filter((item) => item.id !== expense.id))} aria-label="Supprimer la dépense"><Trash2 size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="button button--quiet no-print"
                    onClick={() => setPurchaseExpenses((current) => [...current, { id: newId('expense'), kind: 'Autre', date: '', label: '', amount: 0 }])}
                  ><Plus size={14} /> Ajouter une dépense</button>
                  <div {...aiFieldProps('value.computed.costBasis')} className="cost-basis-total">
                    <Calculator size={20} />
                    <span>Prix de revient</span>
                    <strong>{formatMoney(costBasis, watch.currency)}</strong>
                  </div>
                </div>
              </section>
            )}

            {isVisible('Secret') && (
              <section>
                <SectionTitle eyebrow="Performance de détention" title="Plus-value, moins-value et TRI" publish={publishProps('value-performance')} />
                <div className="performance-card">
                  <div className="exit-fields">
                    <label>Date de vente<input {...aiFieldProps('value.exit.saleDate')} type="date" min={purchase.date} value={exitAssumptions.saleDate} onChange={(event) => setExitAssumptions({ ...exitAssumptions, saleDate: event.target.value })} /></label>
                    <label>Prix de vente<input {...aiFieldProps('value.exit.salePrice')} type="number" min="0" step="100" value={exitAssumptions.salePrice} onChange={(event) => setExitAssumptions({ ...exitAssumptions, salePrice: Number(event.target.value) })} /></label>
                    <label>Coût de cession<input {...aiFieldProps('value.exit.disposalCostPct')} type="number" min="0" max="100" step="0.5" value={exitAssumptions.disposalCostPct} onChange={(event) => setExitAssumptions({ ...exitAssumptions, disposalCostPct: Number(event.target.value) })} /><span>%</span></label>
                  </div>
                  <div className="performance-results">
                    <div><span>Prix de revient</span><strong>{formatMoney(costBasis, watch.currency)}</strong></div>
                    <div><span>Coût de cession</span><strong>− {formatMoney(disposalCost, watch.currency)}</strong></div>
                    <div><span>Produit net de vente</span><strong>{formatMoney(netSaleProceeds, watch.currency)}</strong></div>
                    <div {...aiFieldProps('value.computed.capitalGainLoss')} className={capitalGainLoss >= 0 ? 'is-positive' : 'is-negative'}>
                      <span>{capitalGainLoss >= 0 ? 'Plus-value nette' : 'Moins-value nette'}</span>
                      <strong>{formatMoney(capitalGainLoss, watch.currency)}</strong>
                      <small>{formatPercent(capitalGainLossPct)}</small>
                    </div>
                    <div {...aiFieldProps('value.computed.irr')} className={holdingIrr !== null && holdingIrr >= 0 ? 'is-positive' : 'is-negative'}>
                      <span>TRI annualisé</span>
                      <strong>{formatPercent(holdingIrr)}</strong>
                      <small>Flux datés</small>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {isVisible('Secret') && (
              <section>
                <SectionTitle eyebrow="Sensibilité" title="Prix de vente et coût de cession" publish={publishProps('value-sensitivity')} />
                <div {...aiFieldProps('value.computed.sensitivity')} className="sensitivity-stack">
                  <div>
                    <h3>Plus-value ou moins-value nette</h3>
                    <div className="sensitivity-table" role="table" aria-label="Sensibilité de la plus-value ou moins-value">
                      <div className="sensitivity-table__head" role="row"><span>Coût \ Prix</span>{SENSITIVITY_PRICES.map((price) => <strong key={price}>{formatMoney(price, watch.currency)}</strong>)}</div>
                      {SENSITIVITY_COSTS.map((costPct) => (
                        <div role="row" key={costPct}>
                          <strong>{costPct} %</strong>
                          {SENSITIVITY_PRICES.map((price) => {
                            const scenario = scenarioPerformance(price, costPct);
                            return <span key={`${costPct}-${price}`} className={scenario.gainLoss >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatMoney(scenario.gainLoss, watch.currency)}</strong></span>;
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3>TRI annualisé</h3>
                    <div className="sensitivity-table sensitivity-table--irr" role="table" aria-label="Sensibilité du TRI annualisé">
                      <div className="sensitivity-table__head" role="row"><span>Coût \ Prix</span>{SENSITIVITY_PRICES.map((price) => <strong key={price}>{formatMoney(price, watch.currency)}</strong>)}</div>
                      {SENSITIVITY_COSTS.map((costPct) => (
                        <div role="row" key={costPct}>
                          <strong>{costPct} %</strong>
                          {SENSITIVITY_PRICES.map((price) => {
                            const scenario = scenarioPerformance(price, costPct);
                            return <span key={`${costPct}-${price}`} className={scenario.irr !== null && scenario.irr >= 0 ? 'is-positive' : 'is-negative'}><strong>{formatPercent(scenario.irr)}</strong></span>;
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        <nav className="page-turner no-print" aria-label="Navigation entre les pages">
          {activePage !== 'media' ? (
            <button type="button" onClick={() => navigateTo(PAGE_IDS[PAGE_IDS.indexOf(activePage) - 1])}>
              <ArrowLeft size={16} /> Page précédente
            </button>
          ) : <span />}
          {activePage !== 'value' && (
            <button type="button" onClick={() => navigateTo(PAGE_IDS[PAGE_IDS.indexOf(activePage) + 1])}>
              Page suivante <ArrowRight size={16} />
            </button>
          )}
        </nav>
      </main>

      <footer className="editorial-footer">
        <div className="container"><span>Cartularia · Cartulaire {mockCartulary.publicCode}</span><span>Prototype v2.1 · 2026</span></div>
      </footer>

      {orderedReportBlocks.length > 0 && (
        <div className="report-print-view">
          <header className="report-print-view__header">
            <span className="eyebrow">Rapport Cartularia · {mockCartulary.publicCode}</span>
            <h1>{specificationValue('Marque', watch.reference.brand)}<br />{specificationValue('Modèle', watch.reference.model)}</h1>
            <dl>
              <div><dt>Référence</dt><dd>{specificationValue('Numéro de référence', watch.reference.reference)}</dd></div>
              <div><dt>Date du rapport</dt><dd>{formatDate(new Date().toISOString())}</dd></div>
              <div><dt>Blocs sélectionnés</dt><dd>{orderedReportBlocks.length}</dd></div>
            </dl>
          </header>
          <main>
            {orderedReportBlocks.map((blockId) => (
              <div className="report-print-view__block" key={blockId}>{renderWatchWebsiteBlock(blockId)}</div>
            ))}
          </main>
          <footer><span>Cartularia · Rapport généré depuis le Cartulaire</span><span>{mockCartulary.publicCode}</span></footer>
        </div>
      )}

      <div className={`drawer-overlay ${isDrawerOpen ? 'active' : ''}`} onClick={() => setIsDrawerOpen(false)} />
      <aside className={`drawer-panel ${isDrawerOpen ? 'active' : ''}`} aria-hidden={!isDrawerOpen}>
        <div className="drawer-header">
          <span>Intégrité et partage</span>
          <button type="button" onClick={() => setIsDrawerOpen(false)} aria-label="Fermer"><X size={18} /></button>
        </div>
        <AuditPanel
          key={eventTrigger}
          journal={journal}
          language={language}
          sealHash={mockCartulary.seal?.hash}
          sealSupportCode={mockCartulary.seal?.supportCode}
        />
      </aside>

      {isSpinOpen && spinAssets.length > 0 && (
        <div className="modal-overlay" onClick={() => setIsSpinOpen(false)}>
          <div className="modal-content modal-content--spin" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div><span className="eyebrow">03 · Séquence 3D</span><strong>Revue à 360°</strong></div>
              <button type="button" onClick={() => setIsSpinOpen(false)} aria-label="Fermer"><X size={18} /></button>
            </div>
            <Spin360 images={spinAssets} posterImageUrl={spinAssets[0].url} language={language} />
          </div>
        </div>
      )}

      {selectedAsset && (
        <div className="modal-overlay" onClick={() => setSelectedAsset(null)}>
          <div className="media-modal" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="media-modal__close" onClick={() => setSelectedAsset(null)} aria-label="Fermer"><X size={18} /></button>
            <div className="media-modal__visual">
              {selectedAsset.type === 'document' ? (
                <div className="media-modal__document">
                  <FileText size={56} />
                  <strong>{selectedAsset.originalFileName || selectedAsset.name}</strong>
                  <small>{selectedAsset.mimeType || 'Document'} · {selectedAsset.fileSize || 'taille non renseignée'}</small>
                  {selectedAsset.mimeType === 'application/pdf' && (
                    <a href={selectedAsset.url} target="_blank" rel="noreferrer">Ouvrir le PDF</a>
                  )}
                </div>
              ) : (
                <>
                  <img src={selectedAsset.posterUrl || selectedAsset.thumbnailUrl || selectedAsset.url} alt={selectedAsset.name} />
                  {selectedAsset.type === 'video' && <span><Play size={27} fill="currentColor" /></span>}
                </>
              )}
            </div>
            <div className="media-modal__caption">
              <div>
                <span className="eyebrow">{selectedAsset.type === 'video' ? 'Vidéo indexée' : selectedAsset.type === 'document' ? 'Document indexé' : 'Photographie indexée'}</span>
                <h2 {...aiFieldProps('media.assets[].name', selectedAsset.id)}>{selectedAsset.name}</h2>
              </div>
              <fieldset className="media-tag-editor">
                <legend>Catégories</legend>
                {MEDIA_TAGS.map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    {...aiFieldProps('media.assets[].tags', `${selectedAsset.id}:${tag.id}`)}
                    className={selectedAsset.tags.includes(tag.id) ? 'is-active' : ''}
                    onClick={() => toggleMediaTag(selectedAsset.id, tag.id)}
                    disabled={audience !== 'Secret'}
                    aria-pressed={selectedAsset.tags.includes(tag.id)}
                  >{tag.label}</button>
                ))}
              </fieldset>
              <dl>
                <div><dt>Horodatage</dt><dd {...aiFieldProps('media.assets[].metadataTimestamp', selectedAsset.id)}>{selectedAsset.metadataTimestamp ? formatDateTime(selectedAsset.metadataTimestamp) : '—'}</dd></div>
                <div><dt>Source</dt><dd>{selectedAsset.timestampSource === 'file.lastModified' ? 'Métadonnée du fichier' : 'Métadonnée du catalogue'}</dd></div>
                <div><dt>Visibilité</dt><dd>{selectedAsset.visibility}</dd></div>
                <div><dt>Format</dt><dd>{selectedAsset.mimeType || selectedAsset.type}</dd></div>
                <div><dt>Empreinte</dt><dd {...aiFieldProps('media.assets[].hash', selectedAsset.id)}>{selectedAsset.hash.slice(0, 16)}…</dd></div>
                {selectedAsset.type === 'video' && <div><dt>Original</dt><dd>{selectedAsset.duration} · {selectedAsset.fileSize}</dd></div>}
              </dl>
              {selectedAsset.type === 'video' && <small className="vault-note"><Video size={14} /> Original haute définition conservé dans le coffre média.</small>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
