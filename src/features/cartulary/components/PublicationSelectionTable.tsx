import { Fragment } from 'react';
import { aiFieldProps } from '../../../ai/fieldCatalog.ts';
import { publicationBlockIdsFor, type PublicationDestination, type PublishedBlockId } from '../../../domain/publication.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';
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
} from './publicationSummaryModel.ts';

/**
 * Table unique « Contenus par destination » de l'éditeur de la page Publication
 * (V4 P-D4) : une ligne par contenu admis quelque part, une colonne par destination
 * à sélection de contenus, une case nommée « {titre} {destination} » dans chaque
 * cellule autorisée. Composant pur : il ne décide rien (politique = `cellState`,
 * écriture = les commandes reçues en props) et ne connaît ni réseau ni démonstration.
 */

export type PublicationSelections = Record<PublicationDestination, readonly PublishedBlockId[]>;

export interface PublicationSelectionTableProps {
  language: InterfaceLanguage;
  /** Les tranches persistées du hook de publication, telles quelles (jamais normalisées ici). */
  selections: PublicationSelections;
  canEdit: boolean;
  onToggle: (destination: PublicationDestination, blockId: PublishedBlockId) => void;
  onReplace: (destination: PublicationDestination, update: (current: PublishedBlockId[]) => PublishedBlockId[]) => void;
  /** Préfixe des identifiants de lignes et de colonnes ; la table n'est rendue qu'une fois par page. */
  idPrefix?: string;
}

const aiBinding = (destination: PublicationDestination, blockId: PublishedBlockId) => {
  if (destination === 'website') return aiFieldProps('publishing.blocks.website', blockId);
  if (destination === 'report') return aiFieldProps('publishing.blocks.report', blockId);
  return {};
};

export function PublicationSelectionTable({
  language,
  selections,
  canEdit,
  onToggle,
  onReplace,
  idPrefix = 'publication-selection',
}: PublicationSelectionTableProps) {
  const tx = (french: string, english: string) => (language === 'FR' ? french : english);
  const privateNames = joinNames(privateBlocks().map((definition) => definition.title), language);

  return (
    <section className="publication-scope publication-scope--selection" data-publication-selection="editable">
      <header>
        <div><h2>{tx('Contenus par destination', 'Content by destination')}</h2></div>
      </header>
      {/* role="region" : un conteneur générique ne peut pas porter aria-label (ARIA 1.2) ; la région nommée est un arrêt de tabulation qui défile au clavier. */}
      <div className="publication-summary__scroll" role="region" style={{ overflowX: 'auto' }} tabIndex={0} aria-label={tx('Contenus par destination, défilement horizontal possible', 'Content by destination, horizontal scrolling available')}>
        <table className="publication-summary publication-summary--editable">
          <caption className="sr-only">{tx('Choisir les contenus inclus dans chaque destination', 'Choose the content included in each destination')}</caption>
          <thead>
            <tr>
              <th scope="col">{tx('Contenu', 'Content')}</th>
              {DESTINATIONS.map((destination) => (
                <th scope="col" key={destination} id={`${idPrefix}-col-${destination}`}>{destinationLabelFor(destination, language)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summaryGroups().map((group) => (
              <Fragment key={group.pageNumber}>
                <tr className="publication-summary__group">
                  <th scope="colgroup" colSpan={DESTINATIONS.length + 1}>{group.pageNumber} · {group.pageLabel}</th>
                </tr>
                {group.rows.map((definition) => (
                  <tr key={definition.id}>
                    <th scope="row" id={`${idPrefix}-row-${definition.id}`}>{definition.title}</th>
                    {DESTINATIONS.map((destination) => {
                      const state = cellState(destination, definition, selections[destination] ?? []);
                      if (state === 'unavailable') {
                        return (
                          <td key={destination} className="is-unavailable">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">{tx('Non proposé pour cette destination', 'Not offered for this destination')}</span>
                          </td>
                        );
                      }
                      const included = state === 'included';
                      // Le label sans texte étend la cible tactile à la cellule (44 px) ; le nom de la case reste porté par aria-labelledby.
                      return (
                        <td key={destination} className={included ? 'is-included' : 'is-excluded'}>
                          <label className="publication-summary__cell">
                            <input
                              {...aiBinding(destination, definition.id)}
                              type="checkbox"
                              checked={included}
                              disabled={!canEdit}
                              aria-labelledby={`${idPrefix}-row-${definition.id} ${idPrefix}-col-${destination}`}
                              onChange={() => onToggle(destination, definition.id)}
                            />
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{tx('Sélection', 'Selection')}</td>
              {DESTINATIONS.map((destination) => {
                const label = destinationLabelFor(destination, language);
                const count = selectedCount(destination, selections[destination] ?? []);
                const complete = count === allowedCount(destination);
                return (
                  <td key={destination}>
                    <span>{count}/{allowedCount(destination)}</span>
                    <button
                      type="button"
                      className="button button--quiet"
                      disabled={!canEdit}
                      aria-label={complete ? tx(`Tout décocher — ${label}`, `Clear all — ${label}`) : tx(`Tout sélectionner — ${label}`, `Select all — ${label}`)}
                      onClick={() => onReplace(destination, () => (complete ? [] : publicationBlockIdsFor(destination)))}
                    >{complete ? tx('Tout décocher', 'Clear all') : tx('Tout sélectionner', 'Select all')}</button>
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      {privateNames && (
        <p className="publication-summary__note">
          {tx(
            `${privateNames} restent privés et ne figurent dans aucune destination.`,
            `${privateNames} remain private and appear in no destination.`,
          )}
        </p>
      )}
      <p className="publication-summary__note">{communityPublicationNote(language)}</p>
    </section>
  );
}
