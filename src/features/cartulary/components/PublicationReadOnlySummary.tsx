import { Fragment } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import type { PublicationDestination } from '../../../domain/publication.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';
import {
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
 * Rendu « lecture » des quatre structures communes de la page Publication
 * (mini-site, Collection, Le Cercle, rapport PDF) pour tout lecteur qui ne peut
 * ni éditer ni publier. Composant pur : aucun réseau, aucun état persistant, aucune
 * connaissance du mode démonstration au-delà des textes contextuels.
 *
 * Le lien vers le mini-site publié n'apparaît que si `publishedWebsiteUrl` est fourni,
 * c'est-à-dire si la publication réelle a été constatée à l'exécution ; sinon le résumé
 * décrit « ce qui serait publié ». Quand la publication est constatée, la destination Mini-site
 * (compte, statut, colonne de la table) reflète les blocs réellement en ligne
 * (`publishedWebsiteBlockIds`, lus dans publications/{code}) et non la sélection locale :
 * une seule vérité par destination.
 *
 * Colonnes, lignes, groupes, blocs privés et état de cellule viennent du modèle partagé
 * avec l'éditeur (`publicationSummaryModel.ts`) : les deux tables lisent la même vérité.
 * D4-B : la Collection renvoie au mini-site de l'objet et n'a aucune sélection propre.
 */

export type PublicationSummarySelections = Record<PublicationDestination, readonly string[]>;

export interface PublicationReportState {
  phase: 'idle' | 'loading' | 'ready' | 'error';
  message?: string | null;
}

export interface PublicationReadOnlySummaryProps {
  language: InterfaceLanguage;
  selections: PublicationSummarySelections;
  /** Aperçu local du mini-site (jamais présenté comme une publication). */
  previewUrl: string;
  collectionName: string;
  /** Adresse publique du mini-site, uniquement si la publication réelle est constatée. */
  publishedWebsiteUrl: string | null;
  /** Blocs réellement en ligne, lus avec le statut ; null si la publication n'est pas constatée ou si la liste est inconnue. */
  publishedWebsiteBlockIds?: readonly string[] | null;
  /** Textes contextuels de la démonstration ; la structure reste identique pour tout lecteur. */
  demonstration?: boolean;
  onPrintReport?: () => void;
  reportState?: PublicationReportState;
}

export function PublicationReadOnlySummary({
  language,
  selections,
  previewUrl,
  collectionName,
  publishedWebsiteUrl,
  publishedWebsiteBlockIds = null,
  demonstration = false,
  onPrintReport,
  reportState,
}: PublicationReadOnlySummaryProps) {
  const tx = (french: string, english: string) => (language === 'FR' ? french : english);
  const websitePublished = Boolean(publishedWebsiteUrl);
  const onlineBlocksKnown = websitePublished && Array.isArray(publishedWebsiteBlockIds);
  // Publication constatée : la destination Mini-site décrit ce qui est en ligne, pas la sélection locale.
  const effectiveSelections: PublicationSummarySelections = onlineBlocksKnown
    ? { ...selections, website: publishedWebsiteBlockIds ?? [] }
    : selections;
  const counts = Object.fromEntries(
    DESTINATIONS.map((destination) => [destination, selectedCount(destination, effectiveSelections[destination] ?? [])]),
  ) as Record<PublicationDestination, number>;
  const contentWord = (count: number) => tx(count > 1 ? 'contenus' : 'contenu', count === 1 ? 'item' : 'items');
  const contentCount = (count: number) => `${count} ${contentWord(count)}`;
  const wouldBePublished = (count: number) => tx(
    `Ce qui serait publié : ${contentCount(count)}.`,
    `What would be published: ${contentCount(count)}.`,
  );
  const reportPhase = reportState?.phase ?? 'idle';
  const reportButtonLabel = reportPhase === 'loading'
    ? tx('Préparation des images…', 'Preparing images…')
    : reportPhase === 'ready'
      ? tx('Imprimer / Enregistrer en PDF', 'Print / Save as PDF')
      : tx('Préparer le rapport PDF', 'Prepare PDF report');
  const reportHint = reportPhase === 'error'
    ? tx('Une image reste indisponible. Réessayez la préparation ; aucune impression incomplète n’a été lancée.', 'An image is unavailable. Retry preparation; no incomplete print was started.')
    : reportPhase === 'ready'
      ? tx('Images chargées. Vous pouvez maintenant imprimer le rapport.', 'Images loaded. You can now print the report.')
      : tx('La préparation charge les images sélectionnées avant d’ouvrir l’impression.', 'Preparation loads selected images before opening print.');
  const privateNames = joinNames(privateBlocks().map((definition) => definition.title), language);

  return (
    <div className="publication-center publication-center--summary" data-publication-summary="read-only">
      <p className="publication-summary__context" role="note">
        {demonstration
          ? tx(
            'Démonstration en lecture seule : voici ce qui serait publié. Aucune mise en ligne n’est possible depuis ce compte.',
            'Read-only demonstration: this is what would be published. Nothing can be put online from this account.',
          )
          : tx(
            'Lecture seule : voici ce qui serait publié. Votre accès ne permet pas de publier cet objet.',
            'Read-only: this is what would be published. Your access does not allow publishing this object.',
          )}
      </p>

      <div className="publication-summary__destinations">
        <article className="publication-scope publication-scope--cartulary publication-scope--summary">
          <header>
            <div><span className="eyebrow">01</span><h2>{tx('Mini-site de votre objet', 'Your object website')}</h2></div>
            {(!websitePublished || onlineBlocksKnown) && (
              <p className="publication-summary__count"><strong>{counts.website}</strong> <span>{contentWord(counts.website)}</span></p>
            )}
          </header>
          {websitePublished ? (
            <p className="publication-summary__status publication-summary__status--published">
              <strong>{tx('Publié', 'Published')}</strong>
              {onlineBlocksKnown
                ? tx(` : ${contentCount(counts.website)} en ligne.`, `: ${contentCount(counts.website)} online.`)
                : tx(' : ouvrez le mini-site pour consulter les contenus en ligne.', ': open the website to see the content online.')}
            </p>
          ) : (
            <p className="publication-summary__status">{wouldBePublished(counts.website)}</p>
          )}
          {onlineBlocksKnown && (
            <p className="publication-summary__detail">
              {tx('La colonne Mini-site de la table reflète les contenus effectivement en ligne.', 'The Website column of the table reflects the content actually online.')}
            </p>
          )}
          <div className="publication-summary__links">
            {publishedWebsiteUrl && (
              <a className="button button--primary" href={publishedWebsiteUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={15} />{tx('Ouvrir le mini-site public', 'Open public website')}
              </a>
            )}
            <a className="button button--quiet" href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={15} />{tx('Ouvrir l’aperçu local du mini-site', 'Open the local website preview')}
            </a>
          </div>
        </article>

        <article className="publication-scope publication-scope--collection publication-scope--summary">
          <header>
            <div><span className="eyebrow">02</span><h2>{tx('Publiez votre objet dans une Collection', 'Publish your object in a Collection')}</h2></div>
          </header>
          {/* D4-B : aucun compteur ; la Collection lie l'objet à son propre mini-site, sans sélection de contenus propre. */}
          <p className="publication-summary__detail">
            {demonstration
              ? tx(`Collection de démonstration : ${collectionName} — la Collection renvoie au mini-site de l’objet ; aucune sélection de contenus propre.`, `Demonstration collection: ${collectionName} — the Collection links to the object website; it has no content selection of its own.`)
              : tx(`Collection : ${collectionName} — la Collection renvoie au mini-site de l’objet ; aucune sélection de contenus propre.`, `Collection: ${collectionName} — the Collection links to the object website; it has no content selection of its own.`)}
          </p>
        </article>

        <article className="publication-scope publication-scope--community publication-scope--summary">
          <header>
            <div><span className="eyebrow">03</span><h2>{tx('Publiez votre objet dans Le Cercle', 'Publish your object in The Circle')}</h2></div>
            <p className="publication-summary__count"><strong>{counts.community}</strong> <span>{contentWord(counts.community)}</span></p>
          </header>
          <p className="publication-summary__status">{wouldBePublished(counts.community)}</p>
          <p className="publication-summary__detail">{communityPublicationNote(language)}</p>
        </article>

        <article className="publication-scope publication-scope--report publication-scope--summary">
          <header>
            <div><span className="eyebrow">04</span><h2>{tx('Rapport PDF', 'PDF report')}</h2></div>
            <p className="publication-summary__count"><strong>{counts.report}</strong> <span>{contentWord(counts.report)}</span></p>
          </header>
          <p className="publication-summary__status">
            {tx(`Le rapport reprendrait ${contentCount(counts.report)}.`, `The report would include ${contentCount(counts.report)}.`)}
          </p>
          {onPrintReport && (
            <>
              <div className="publication-summary__links">
                <button type="button" className="button button--primary" onClick={onPrintReport} disabled={reportPhase === 'loading'}>
                  <Download size={15} />{reportButtonLabel}
                </button>
              </div>
              {reportState?.message && <p className="publication-report-message" role="status">{reportState.message}</p>}
              <p className="publication-report-message" role="status">{reportHint}</p>
            </>
          )}
        </article>
      </div>

      {/* role="region" : un conteneur générique ne peut pas porter aria-label (ARIA 1.2) ; la région nommée est un arrêt de tabulation qui défile au clavier. */}
      <div className="publication-summary__scroll" role="region" style={{ overflowX: 'auto' }} tabIndex={0} aria-label={tx('Contenus par destination, défilement horizontal possible', 'Content by destination, horizontal scrolling available')}>
        <table className="publication-summary">
          <caption className="sr-only">{tx('Contenus inclus par destination', 'Content included by destination')}</caption>
          <thead>
            <tr>
              <th scope="col">{tx('Contenu', 'Content')}</th>
              {DESTINATIONS.map((destination) => (
                <th scope="col" key={destination}>{destinationLabelFor(destination, language)}</th>
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
                    <th scope="row">{definition.title}</th>
                    {DESTINATIONS.map((destination) => {
                      // Même vocabulaire que l'éditeur : une cellule interdite par la politique n'est pas une cellule décochée.
                      const state = cellState(destination, definition, effectiveSelections[destination] ?? []);
                      return (
                        <td key={destination} className={state === 'included' ? 'is-included' : state === 'unavailable' ? 'is-unavailable' : 'is-excluded'}>
                          <span aria-hidden="true">{state === 'included' ? '✓' : '—'}</span>
                          <span className="sr-only">{state === 'included' ? tx('Inclus', 'Included') : state === 'unavailable' ? tx('Non proposé pour cette destination', 'Not offered for this destination') : tx('Exclu', 'Excluded')}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
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
    </div>
  );
}
