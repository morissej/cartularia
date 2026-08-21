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
  if (namespace === 'publication') return 'publication';
  return 'cover';
};
