import { describe, expect, it } from 'vitest';
import {
  allowedCount,
  cellState,
  communityPublicationNote,
  DESTINATIONS,
  destinationLabelFor,
  joinNames,
  privateBlocks,
  selectedCount,
  summaryGroups,
} from '../../src/features/cartulary/components/publicationSummaryModel.ts';
import {
  getPublicationPolicy,
  PUBLICATION_BLOCK_CATALOG,
  PUBLISHED_BLOCK_IDS,
  type PublicationDestination,
} from '../../src/domain/publication.ts';

const ALL_DESTINATIONS: readonly PublicationDestination[] = ['website', 'collection', 'community', 'report'];

const definitionOf = (id: string) => {
  const definition = PUBLICATION_BLOCK_CATALOG.find((entry) => entry.id === id);
  if (!definition) throw new Error(`définition ${id} introuvable`);
  return definition;
};

describe('modèle partagé de la page Publication', () => {
  it('les colonnes sont les destinations à sélection de contenus, dans l’ordre (D4-B : sans la Collection)', () => {
    expect(DESTINATIONS).toEqual(['website', 'community', 'report']);
    expect(DESTINATIONS.map((destination) => destinationLabelFor(destination, 'FR'))).toEqual(['Mini-site', 'Le Cercle', 'Rapport PDF']);
    expect(DESTINATIONS.map((destination) => destinationLabelFor(destination, 'EN'))).toEqual(['Website', 'The Circle', 'PDF report']);
    // Le libellé Collection reste disponible pour un retour à quatre colonnes, sans rien recoder.
    expect(destinationLabelFor('collection', 'FR')).toBe('Collection');
  });

  it('23 contenus en 5 groupes, 3 blocs privés, dans l’ordre du catalogue', () => {
    const groups = summaryGroups();
    expect(groups.map((group) => group.pageNumber)).toEqual(['00', '01', '02', '03', '04']);
    expect(groups.map((group) => group.pageLabel)).toEqual(['Accueil', 'Médias', 'La référence', 'L’objet', 'Valorisation']);
    expect(groups.reduce((total, group) => total + group.rows.length, 0)).toBe(23);
    const listed = groups.flatMap((group) => group.rows.map((row) => row.id));
    expect(privateBlocks().map((definition) => definition.id)).toEqual(['cover-owner', 'cover-transmission', 'cover-storage']);
    for (const privateId of privateBlocks().map((definition) => definition.id)) expect(listed).not.toContain(privateId);
    expect(listed).toEqual(PUBLISHED_BLOCK_IDS.filter((id) => !['cover-owner', 'cover-transmission', 'cover-storage'].includes(id)));
  });

  it('une cellule interdite n’est jamais incluse, même si l’identifiant figure dans la sélection', () => {
    for (const definition of PUBLICATION_BLOCK_CATALOG) {
      for (const destination of ALL_DESTINATIONS) {
        const state = cellState(destination, definition, PUBLISHED_BLOCK_IDS);
        const allowed = getPublicationPolicy(destination, definition.id).allowed;
        expect(state === 'unavailable').toBe(!allowed);
        if (allowed) expect(state).toBe('included');
        expect(cellState(destination, definition, [])).toBe(allowed ? 'excluded' : 'unavailable');
      }
    }
    const costBasis = definitionOf('value-cost-basis');
    expect(cellState('website', costBasis, ['value-cost-basis'])).toBe('unavailable');
    expect(cellState('community', costBasis, ['value-cost-basis'])).toBe('unavailable');
    expect(cellState('report', costBasis, ['value-cost-basis'])).toBe('included');
    expect(cellState('report', costBasis, ['media-hero'])).toBe('excluded');
  });

  it('les comptes autorisés valent 14 / 20 / 23 et le compte sélectionné ignore les identifiants hors politique', () => {
    expect(allowedCount('website')).toBe(14);
    expect(allowedCount('community')).toBe(20);
    expect(allowedCount('report')).toBe(23);
    expect(allowedCount('collection')).toBe(14);
    expect(selectedCount('website', PUBLISHED_BLOCK_IDS)).toBe(14);
    expect(selectedCount('website', ['media-hero', 'cover-owner', 'value-cost-basis'])).toBe(1);
    expect(selectedCount('report', ['media-hero', 'cover-owner', 'value-cost-basis'])).toBe(2);
    expect(selectedCount('community', [])).toBe(0);
  });

  it('joinNames en FR et EN', () => {
    expect(joinNames(['A', 'B', 'C'], 'FR')).toBe('A, B et C');
    expect(joinNames(['A', 'B', 'C'], 'EN')).toBe('A, B and C');
    expect(joinNames(['A', 'B'], 'FR')).toBe('A et B');
    expect(joinNames(['A'], 'FR')).toBe('A');
    expect(joinNames([], 'EN')).toBe('');
  });

  it('la note du Cercle (D6) dit la même chose en FR et en EN : aucune commande serveur, sélection pour l’aperçu local', () => {
    expect(communityPublicationNote('FR')).toBe('Publication dans Le Cercle non disponible : aucune commande serveur reliée ; la sélection sert à l’aperçu local.');
    expect(communityPublicationNote('EN')).toBe('Publication in The Circle is not available: no server command is connected; the selection serves the local preview.');
  });
});
