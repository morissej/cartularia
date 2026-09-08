import type { CartularyPage, InterfaceLanguage } from '../../../utils/interfaceState.ts';

export const CARTULARY_PRESENTATION_CONTRACT_VERSION = 'cartulary-presentation@1.4.0' as const;

export interface CartularyPageDefinition {
  id: CartularyPage;
  number: string;
  label: string;
}

export const cartularyPageDefinitions = (language: InterfaceLanguage): CartularyPageDefinition[] => [
  { id: 'cover', number: '00', label: language === 'FR' ? 'Accueil' : 'Home' },
  { id: 'media', number: '01', label: language === 'FR' ? 'Médias' : 'Media' },
  { id: 'reference', number: '02', label: language === 'FR' ? 'La référence' : 'Reference' },
  { id: 'condition', number: '03', label: language === 'FR' ? "L’objet" : 'The object' },
  { id: 'value', number: '04', label: language === 'FR' ? 'Valorisation' : 'Valuation' },
  { id: 'publication', number: '05', label: 'Publication' },
];

export const COMMON_CARTULARY_STRUCTURE = [
  { id: 'cover.collection', page: 'cover', title: 'Collection' },
  { id: 'cover.todos', page: 'cover', title: 'À Faire' },
  { id: 'condition.storage', page: 'condition', title: 'Stockage' },
  { id: 'condition.transmission', page: 'condition', title: 'Transmission' },
  { id: 'reference.reports', page: 'reference', title: 'Rapports sur la référence' },
  { id: 'publication.cartulary', page: 'publication', title: 'Publiez un mini -site de votre Cartulaire' },
  { id: 'publication.collections', page: 'publication', title: 'Publiez votre objet dans une Collection' },
  { id: 'publication.community', page: 'publication', title: 'Publiez votre objet dans Le Cercle' },
  { id: 'publication.report', page: 'publication', title: 'Rapport PDF' },
] as const satisfies ReadonlyArray<{ id: string; page: CartularyPage; title: string }>;

export const cartularyPageForSchemaSection = (sectionId: string): CartularyPage => {
  const namespace = sectionId.split('.')[0];
  if (namespace === 'media') return 'media';
  if (namespace === 'reference' || namespace === 'technical') return 'reference';
  if (namespace === 'condition' || namespace === 'history' || namespace === 'usage' || namespace === 'identity') return 'condition';
  if (namespace === 'value') return 'value';
  if (namespace === 'publication' || namespace === 'publishing') return 'publication';
  return 'cover';
};

/**
 * Sections de schéma rendues par un bloc spécialisé du lecteur unique (`src/App.tsx`).
 * Toute autre section d'un schéma est rendue par le composant générique piloté par le schéma,
 * sur la page que `cartularyPageForSchemaSection` lui attribue. Un bloc spécialisé ne s'affiche
 * que si le schéma de l'objet contient sa section.
 */
export const SPECIALIZED_CARTULARY_SECTIONS = [
  'cover.asset', 'cover.watch', 'cover.car', 'cover.privacy_link', 'cover.ownership_history',
  'media.hero', 'media.library',
  'reference.origins', 'reference.specifications', 'reference.checks', 'reference.popularity',
  'condition.description', 'condition.summary', 'condition.documentation', 'condition.reports', 'condition.storage',
  'value.market_depth', 'value.market_history', 'value.retained_value', 'value.provenance', 'value.comparables',
  'value.comparables_analysis', 'value.cost_basis', 'value.performance', 'value.sensitivity', 'value.calculations',
  'publishing.selection',
] as const;
