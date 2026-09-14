import { Fragment } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import {
  filterPublicationBlockIds,
  getPublicationPolicy,
  PUBLICATION_BLOCK_CATALOG,
  type PublicationBlockDefinition,
  type PublicationDestination,
} from '../../../domain/publication.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';

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

const DESTINATIONS: readonly PublicationDestination[] = ['website', 'collection', 'community', 'report'];

const DESTINATION_LABELS: Record<PublicationDestination, { fr: string; en: string }> = {
  website: { fr: 'Mini-site', en: 'Website' },
  collection: { fr: 'Collection', en: 'Collection' },
  community: { fr: 'Le Cercle', en: 'The Circle' },
  report: { fr: 'Rapport PDF', en: 'PDF report' },
};

const isAllowedSomewhere = (definition: PublicationBlockDefinition) => (
  DESTINATIONS.some((destination) => getPublicationPolicy(destination, definition.id).allowed)
);

interface SummaryGroup {
  pageNumber: PublicationBlockDefinition['pageNumber'];
  pageLabel: string;
  rows: PublicationBlockDefinition[];
}

/** Blocs listés dans la table (admis dans au moins une destination), groupés par page. */
const summaryGroups = (): SummaryGroup[] => PUBLICATION_BLOCK_CATALOG.filter(isAllowedSomewhere).reduce<SummaryGroup[]>((groups, definition) => {
  const last = groups[groups.length - 1];
  if (last && last.pageNumber === definition.pageNumber) last.rows.push(definition);
  else groups.push({ pageNumber: definition.pageNumber, pageLabel: definition.pageLabel, rows: [definition] });
  return groups;
}, []);

/** Blocs privés partout : cités dans la note, jamais dans la table. */
const privateBlocks = () => PUBLICATION_BLOCK_CATALOG.filter((definition) => !isAllowedSomewhere(definition));

const joinNames = (names: string[], language: InterfaceLanguage) => {
  if (names.length <= 1) return names.join('');
  const conjunction = language === 'FR' ? ' et ' : ' and ';
  return `${names.slice(0, -1).join(', ')}${conjunction}${names[names.length - 1]}`;
};

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
    DESTINATIONS.map((destination) => [destination, filterPublicationBlockIds(destination, effectiveSelections[destination] ?? []).length]),
  ) as Record<PublicationDestination, number>;
  const included = (destination: PublicationDestination, definition: PublicationBlockDefinition) => (
    getPublicationPolicy(destination, definition.id).allowed && (effectiveSelections[destination] ?? []).includes(definition.id)
  );
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
                <ExternalLink size={15} />{tx('Ouvrir le mini-site', 'Open the website')}
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
            <p className="publication-summary__count"><strong>{counts.collection}</strong> <span>{contentWord(counts.collection)}</span></p>
          </header>
          <p className="publication-summary__status">{wouldBePublished(counts.collection)}</p>
          <p className="publication-summary__detail">
            {demonstration
              ? tx(`Collection de démonstration : ${collectionName} — publication non simulée.`, `Demonstration collection: ${collectionName} — publication not simulated.`)
              : tx(`Collection : ${collectionName} — publication non simulée.`, `Collection: ${collectionName} — publication not simulated.`)}
          </p>
        </article>

        <article className="publication-scope publication-scope--community publication-scope--summary">
          <header>
            <div><span className="eyebrow">03</span><h2>{tx('Publiez votre objet dans Le Cercle', 'Publish your object in The Circle')}</h2></div>
            <p className="publication-summary__count"><strong>{counts.community}</strong> <span>{contentWord(counts.community)}</span></p>
          </header>
          <p className="publication-summary__status">{wouldBePublished(counts.community)}</p>
          <p className="publication-summary__detail">{tx('Publication dans Le Cercle non simulée.', 'Publication in The Circle not simulated.')}</p>
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

      <div className="publication-summary__scroll" style={{ overflowX: 'auto' }} tabIndex={0} aria-label={tx('Contenus par destination, défilement horizontal possible', 'Content by destination, horizontal scrolling available')}>
        <table className="publication-summary">
          <caption className="sr-only">{tx('Contenus inclus par destination', 'Content included by destination')}</caption>
          <thead>
            <tr>
              <th scope="col">{tx('Contenu', 'Content')}</th>
              {DESTINATIONS.map((destination) => (
                <th scope="col" key={destination}>{language === 'FR' ? DESTINATION_LABELS[destination].fr : DESTINATION_LABELS[destination].en}</th>
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
                      const active = included(destination, definition);
                      return (
                        <td key={destination} className={active ? 'is-included' : 'is-excluded'}>
                          <span aria-hidden="true">{active ? '✓' : '—'}</span>
                          <span className="sr-only">{active ? tx('Inclus', 'Included') : tx('Exclu', 'Excluded')}</span>
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
