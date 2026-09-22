import {
  filterPublicationBlockIds,
  getPublicationPolicy,
  PUBLICATION_BLOCK_CATALOG,
  publicationBlockIdsFor,
  type PublicationBlockDefinition,
  type PublicationDestination,
} from '../../../domain/publication.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';

/**
 * Modèle partagé de la page Publication (V4 P-D4) : une seule vérité pour les
 * colonnes, les lignes, les groupes, les blocs privés et l'état d'une cellule,
 * consommée par l'éditeur (`PublicationSelectionTable`) et par le rendu lecture
 * (`PublicationReadOnlySummary`). Pur : aucun React, aucun réseau, aucune
 * politique propre — la politique reste `getPublicationPolicy` du domaine.
 */

/**
 * Colonnes de la page Publication (éditeur et lecture). D4-B : trois destinations
 * à sélection de contenus ; la Collection renvoie au mini-site de l'objet et n'a
 * aucune sélection propre. Revenir à quatre colonnes = insérer 'collection' en 2e position.
 */
export const DESTINATIONS: readonly PublicationDestination[] = ['website', 'community', 'report'];

export const DESTINATION_LABELS: Record<PublicationDestination, { fr: string; en: string }> = {
  website: { fr: 'Mini-site', en: 'Website' },
  collection: { fr: 'Collection', en: 'Collection' },
  community: { fr: 'Le Cercle', en: 'The Circle' },
  report: { fr: 'Rapport PDF', en: 'PDF report' },
};

export const destinationLabelFor = (destination: PublicationDestination, language: InterfaceLanguage) => (
  language === 'FR' ? DESTINATION_LABELS[destination].fr : DESTINATION_LABELS[destination].en
);

/** Un bloc figure dans la table s'il est admis dans au moins une colonne. */
export const isAllowedSomewhere = (definition: PublicationBlockDefinition) => (
  DESTINATIONS.some((destination) => getPublicationPolicy(destination, definition.id).allowed)
);

export interface SummaryGroup {
  pageNumber: PublicationBlockDefinition['pageNumber'];
  pageLabel: string;
  rows: PublicationBlockDefinition[];
}

/** Blocs listés dans la table (admis dans au moins une destination), groupés par page, dans l'ordre du catalogue. */
export const summaryGroups = (): SummaryGroup[] => PUBLICATION_BLOCK_CATALOG.filter(isAllowedSomewhere).reduce<SummaryGroup[]>((groups, definition) => {
  const last = groups[groups.length - 1];
  if (last && last.pageNumber === definition.pageNumber) last.rows.push(definition);
  else groups.push({ pageNumber: definition.pageNumber, pageLabel: definition.pageLabel, rows: [definition] });
  return groups;
}, []);

/** Blocs privés partout : cités dans la note, jamais dans la table. */
export const privateBlocks = () => PUBLICATION_BLOCK_CATALOG.filter((definition) => !isAllowedSomewhere(definition));

export const joinNames = (names: string[], language: InterfaceLanguage) => {
  if (names.length <= 1) return names.join('');
  const conjunction = language === 'FR' ? ' et ' : ' and ';
  return `${names.slice(0, -1).join(', ')}${conjunction}${names[names.length - 1]}`;
};

/** Nombre de contenus que la politique autorise pour une destination (dénominateur du pied « n/{autorisés} »). */
export const allowedCount = (destination: PublicationDestination) => publicationBlockIdsFor(destination).length;

/** Nombre de contenus sélectionnés et autorisés : un identifiant hors politique n'est jamais compté. */
export const selectedCount = (destination: PublicationDestination, selection: readonly string[]) => (
  filterPublicationBlockIds(destination, selection).length
);

/** État d'une cellule : une cellule interdite par la politique n'est jamais 'included'. */
export type PublicationCellState = 'unavailable' | 'included' | 'excluded';

export const cellState = (
  destination: PublicationDestination,
  definition: PublicationBlockDefinition,
  selection: readonly string[],
): PublicationCellState => {
  if (!getPublicationPolicy(destination, definition.id).allowed) return 'unavailable';
  return selection.includes(definition.id) ? 'included' : 'excluded';
};

/** D6 (a) : Le Cercle n'a aucune commande serveur reliée ; l'éditeur et le résumé lecture le disent avec la même phrase. */
export const communityPublicationNote = (language: InterfaceLanguage) => (language === 'FR'
  ? 'Publication dans Le Cercle non disponible : aucune commande serveur reliée ; la sélection sert à l’aperçu local.'
  : 'Publication in The Circle is not available: no server command is connected; the selection serves the local preview.');
