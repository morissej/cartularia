import type { AIFieldId } from '../../../ai/fieldCatalog.ts';
import { aiFieldProps } from '../../../ai/fieldCatalog.ts';
import type { OwnershipHistoryEntry } from '../../../domain/ownershipHistory.ts';
import type { InterfaceLanguage } from '../../../utils/interfaceState.ts';
import { formatDate, formatMoney } from '../../../utils/formatting.ts';
import type {
  ComparableAnalysisEntry,
  DocumentationCategory,
  DocumentationItem,
  DocumentationState,
  ExitAssumptions,
  MarketDepthState,
  PurchaseExpense,
  PurchaseState,
  RetainedValuationState,
} from '../state/cartularyStateTypes.ts';

/**
 * V5 point 1 (V-D1, P-D6) : rendu texte pur des blocs spécialisés des pages 00-04 pour tout lecteur
 * (démonstration, propriétaire hors session, membre sans droit de gérer) et pour le propriétaire hors
 * édition du bloc. Composants purs : aucun contrôle de formulaire, aucune branche démo, aucune donnée
 * distante ; les mêmes ancres IA que les champs d'édition d'`App.tsx`, posées sur l'élément texte
 * (modèle `ComparableTable`). Balisage et classes repris du renderer public (aucune règle CSS propre,
 * sauf `.cover-sheet__facts`, `.storage-code-list > div > p` et la lecture de `.retained-value-card`).
 */

type Translate = (french: string, english: string) => string;
const translator = (language: InterfaceLanguage): Translate => (french, english) => language === 'FR' ? french : english;

/** Page 00 — type de bien, statut et Collection, dans le gabarit des trois sélecteurs d'édition. */
export function CoverFactsReadOnly({ assetKindLabel, statusLabel, collectionName, language }: {
  assetKindLabel: string;
  statusLabel: string;
  collectionName: string;
  language: InterfaceLanguage;
}) {
  const tx = translator(language);
  return (
    <dl className="cover-sheet__facts">
      <div className="asset-kind-control"><dt>{tx('Type de bien', 'Asset type')}</dt><dd {...aiFieldProps('cover.asset.type')}>{assetKindLabel}</dd></div>
      <div className="watch-status-control"><dt>{tx('Statut', 'Status')}</dt><dd {...aiFieldProps('cover.watch.status')}>{statusLabel}</dd></div>
      <div className="asset-kind-control"><dt>{tx('Collection', 'Collection')}</dt><dd>{collectionName}</dd></div>
    </dl>
  );
}

/** Page 03 — périodes de propriété (calqué sur le bloc publié `cover-ownership-history`). */
export function OwnershipHistoryReadOnly({ entries, language }: { entries: OwnershipHistoryEntry[]; language: InterfaceLanguage }) {
  const tx = translator(language);
  if (entries.length === 0) return <p className="ownership-history-empty">{tx('Aucun propriétaire précédent renseigné.', 'No previous owner entered.')}</p>;
  return (
    <div className="ownership-history-list">
      {entries.map((entry) => (
        <article className="ownership-period ownership-period--published" key={entry.id} data-ai-scope="cover.ownershipHistory[]" data-ai-instance={entry.id}>
          <header>
            <strong>{tx('De', 'From')} <time {...aiFieldProps('cover.ownershipHistory[].fromYear', entry.id)}>{entry.fromYear || '—'}</time> {tx('à', 'to')} <time {...aiFieldProps('cover.ownershipHistory[].toYear', entry.id)}>{entry.toYear || '—'}</time></strong>
            {entry.firstOwner && <span {...aiFieldProps('cover.ownershipHistory[].firstOwner', entry.id)}>{tx('Premier propriétaire', 'First owner')}</span>}
          </header>
          <p {...aiFieldProps('cover.ownershipHistory[].description', entry.id)}>{entry.description || tx('Description non renseignée.', 'Description not provided.')}</p>
        </article>
      ))}
    </div>
  );
}

/** Page 03 — lieux (Stockage) ou personnes (Transmission) du Coffre personnel : numéro, nom de code, note. */
export function VaultCodeListReadOnly({ items, emptyLabel, language, aiField }: {
  items: Array<{ id: string; correspondenceCode: string; codeName: string; note: string }>;
  emptyLabel: string;
  language: InterfaceLanguage;
  aiField?: AIFieldId;
}) {
  const tx = translator(language);
  if (items.length === 0) return <p className="storage-empty">{emptyLabel}</p>;
  return (
    <div className="storage-code-list">
      {items.map((item, index) => (
        <div key={item.id}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <strong {...(aiField ? aiFieldProps(aiField, item.id) : {})}>{item.codeName || item.correspondenceCode || tx('Non renseigné', 'Not specified')}</strong>
          {item.note && <p>{item.note}</p>}
        </div>
      ))}
    </div>
  );
}

/** Page 03 — papiers, documentation et accessoires : catégorie, description, état (bloc publié `condition-documentation`). */
export function DocumentationRegisterReadOnly({ items, categoryLabel, stateLabel, language }: {
  items: DocumentationItem[];
  categoryLabel: (category: DocumentationCategory) => string;
  stateLabel: (state: DocumentationState) => string;
  language: InterfaceLanguage;
}) {
  const tx = translator(language);
  if (items.length === 0) return <p className="storage-empty">{tx('Aucun élément associé renseigné.', 'No associated item entered.')}</p>;
  // V5 relecture (A4) : même sémantique de tableau qu'`AnalysisRowsReadOnly` — l'en-tête (catégorie, description,
  // état) est lu par le lecteur d'écran et masqué visuellement (`.sr-only`, jamais `display: none`).
  return (
    <div className="watch-website__document-list" role="table" aria-label={tx('Papiers, documentation et accessoires', 'Papers, documentation and accessories')}>
      <div className="sr-only" role="row">
        <span role="columnheader">{tx('Catégorie', 'Category')}</span><span role="columnheader">Description</span><span role="columnheader">{tx('État', 'Condition')}</span>
      </div>
      {items.map((item) => (
        <div key={item.id} role="row" data-ai-scope="condition.documentation[]" data-ai-instance={item.id}>
          <span role="cell" {...aiFieldProps('condition.documentation[].category', item.id)}>{categoryLabel(item.category)}</span>
          <p role="cell" {...aiFieldProps('condition.documentation[].description', item.id)}>{item.description || tx('Description non renseignée.', 'Description not provided.')}</p>
          <strong role="cell" {...aiFieldProps('condition.documentation[].state', item.id)}>{stateLabel(item.state)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Page 04 — profondeur de marché : date d'analyse, trois métriques, fourchette (contenu de `.market-depth-card`). */
export function MarketDepthReadOnly({ marketDepth, currency, language }: { marketDepth: MarketDepthState; currency?: string; language: InterfaceLanguage }) {
  const tx = translator(language);
  return (
    <>
      <div className="market-depth-card__heading">
        <span className="eyebrow">{tx('Profondeur de marché', 'Market depth')}</span>
        <time dateTime={marketDepth.analysisDate || undefined} {...aiFieldProps('value.market.analysisDate')}>{marketDepth.analysisDate ? tx(`Analyse du ${formatDate(marketDepth.analysisDate)}`, `Analysis dated ${formatDate(marketDepth.analysisDate)}`) : tx('Date non renseignée', 'Date not provided')}</time>
      </div>
      <div className="metric-grid">
        <div><strong {...aiFieldProps('value.market.activeListings')}>{marketDepth.activeListings ?? tx('Non renseigné', 'Not provided')}</strong><span>{tx('Annonces actives', 'Active listings')}</span></div>
        <div><strong {...aiFieldProps('value.market.transactions12m')}>{marketDepth.transactions12m ?? tx('Non renseigné', 'Not provided')}</strong><span>{tx('Transactions identifiées · 12 mois', 'Transactions identified · 12 months')}</span></div>
        <div><strong {...aiFieldProps('value.market.medianDaysOnMarket')}>{marketDepth.medianDaysOnMarket == null ? tx('Non renseigné', 'Not provided') : `${marketDepth.medianDaysOnMarket} ${tx('j', 'd')}`}</strong><span>{tx('Délai médian estimé', 'Estimated median time')}</span></div>
      </div>
      {marketDepth.sourceLabel && <p className="market-source">{marketDepth.sourceLabel}</p>}
      <div className="valuation-range">
        <span>{tx('Fourchette documentée', 'Documented range')}</span>
        <strong><span {...aiFieldProps('value.market.lowValue')}>{formatMoney(marketDepth.lowValue, currency)}</span> — <span {...aiFieldProps('value.market.highValue')}>{formatMoney(marketDepth.highValue, currency)}</span></strong>
        <small>{tx('VALEUR CENTRALE', 'CENTRAL VALUE')} <span {...aiFieldProps('value.market.midValue')}>{formatMoney(marketDepth.midValue, currency)}</span></small>
      </div>
    </>
  );
}

/** Page 04 — niveaux de valorisation : brute, frais, net après frais, impôts, net après impôts, explication (contenu de `.retained-value-card`). */
export function ValuationLevelsReadOnly({ retained, currentValue, net, netAfterTax, currency, language }: {
  retained: RetainedValuationState;
  currentValue: number;
  net: number;
  netAfterTax: number;
  currency?: string;
  language: InterfaceLanguage;
}) {
  const tx = translator(language);
  return (
    <>
      <dl className="retained-value-card__amount">
        <dt>{tx('Valorisation brute', 'Gross valuation')}</dt>
        <dd><strong {...aiFieldProps('value.retained.amount')}>{formatMoney(retained.amount, currency)}</strong></dd>
        <dd><small>{tx('Valeur actuelle', 'Current value')} : {formatMoney(currentValue, currency)}</small></dd>
      </dl>
      <div className="retained-value-card__levels">
        <div><span>{tx('Frais de vente estimés', 'Estimated selling costs')}</span><strong>{formatMoney(retained.saleCostAmount, currency)}</strong></div>
        <div><span>{tx('Valorisation nette après frais de vente', 'Net valuation after selling costs')}</span><strong>{formatMoney(net, currency)}</strong></div>
        <div><span>{tx('Impôts estimés', 'Estimated taxes')}</span><strong>{formatMoney(retained.taxAmount, currency)}</strong></div>
        <div><span>{tx('Valorisation nette après impôts', 'Net valuation after taxes')}</span><strong>{formatMoney(netAfterTax, currency)}</strong></div>
      </div>
      <div className="retained-value-card__explanation">
        <span className="eyebrow">{tx('Explication de la valeur retenue', 'Retained value explanation')}</span>
        <p {...aiFieldProps('value.retained.explanation')}>{retained.explanation || tx('Aucune explication renseignée.', 'No explanation provided.')}</p>
      </div>
      <dl className="retained-value-card__metadata retained-value-card__metadata--readonly">
        <div><dt>{tx('Niveau de valeur', 'Value level')}</dt><dd>{({ owner_declared: tx('Déclarée par le propriétaire', 'Declared by owner'), ai_proposed: tx('Proposée par IA', 'AI proposed'), professional: tx('Professionnel mandaté', 'Mandated professional'), transaction: tx('Transaction observée', 'Observed transaction') } as Record<string, string>)[retained.level || ''] || tx('Non renseigné', 'Not provided')}</dd></div>
        <div><dt>{tx('Date', 'Date')}</dt><dd>{retained.observedAt || tx('Non renseignée', 'Not provided')}</dd></div>
        <div><dt>{tx('Source', 'Source')}</dt><dd>{retained.sourceLabel || tx('Non renseignée', 'Not provided')}</dd></div>
        <div><dt>{tx('Confiance', 'Confidence')}</dt><dd>{({ low: tx('Faible', 'Low'), medium: tx('Moyenne', 'Medium'), high: tx('Élevée', 'High') } as Record<string, string>)[retained.confidence || ''] || tx('Non renseignée', 'Not provided')}</dd></div>
        <div><dt>{tx('Devise', 'Currency')}</dt><dd>{retained.currency || tx('Non renseignée', 'Not provided')}</dd></div>
      </dl>
    </>
  );
}

/** Page 04 — synthèse de l'analyse des comparables : angle, constat, lecture. */
export function AnalysisRowsReadOnly({ rows, language }: { rows: ComparableAnalysisEntry[]; language: InterfaceLanguage }) {
  const tx = translator(language);
  if (rows.length === 0) return <p className="storage-empty">{tx('Aucune ligne d’analyse renseignée.', 'No analysis row entered.')}</p>;
  return (
    <div className="comparables-analysis-table" role="table" aria-label={tx('Synthèse de l’analyse des comparables', 'Comparable analysis summary')}>
      <div className="comparables-analysis-table__head" role="row">
        <span role="columnheader">{tx('Angle d’analyse', 'Analysis angle')}</span><span role="columnheader">{tx('Constat', 'Finding')}</span><span role="columnheader">{tx('Lecture', 'Interpretation')}</span>
      </div>
      {rows.map((entry) => (
        <div {...aiFieldProps('value.comparables.analysis[]', entry.id)} role="row" key={entry.id} data-ai-scope="value.comparables.analysis[]" data-ai-instance={entry.id}>
          <strong role="cell" {...aiFieldProps('value.comparables.analysis[].angle', entry.id)}>{entry.angle}</strong>
          <span role="cell" {...aiFieldProps('value.comparables.analysis[].finding', entry.id)}>{entry.finding}</span>
          <p role="cell" {...aiFieldProps('value.comparables.analysis[].reading', entry.id)}>{entry.reading}</p>
        </div>
      ))}
    </div>
  );
}

/** Page 04 — prix de revient : achat daté puis dépenses (type · libellé · date · montant) ; le total reste dans la page. */
export function CostBasisReadOnly({ purchase, expenses, kindLabel, currency, language }: {
  purchase: PurchaseState;
  expenses: PurchaseExpense[];
  kindLabel: (kind: PurchaseExpense['kind']) => string;
  currency?: string;
  language: InterfaceLanguage;
}) {
  const tx = translator(language);
  const dateLabel = (value: string) => value ? formatDate(value) : tx('Date non renseignée', 'Date not provided');
  return (
    <div className="watch-website__financial-table">
      <div>
        <span>{tx('Achat', 'Purchase')} · <time {...aiFieldProps('value.purchase.date')}>{dateLabel(purchase.date)}</time></span>
        <strong {...aiFieldProps('value.purchase.price')}>{formatMoney(purchase.purchasePrice, currency)}</strong>
      </div>
      {expenses.map((expense) => (
        <div key={expense.id} data-ai-scope="value.expenses[]" data-ai-instance={expense.id}>
          <span>
            <span {...aiFieldProps('value.expenses[].kind', expense.id)}>{kindLabel(expense.kind)}</span> · <span {...aiFieldProps('value.expenses[].label', expense.id)}>{expense.label || tx('Dépense sans libellé', 'Untitled expense')}</span> · <time {...aiFieldProps('value.expenses[].date', expense.id)}>{dateLabel(expense.date)}</time>
          </span>
          <strong {...aiFieldProps('value.expenses[].amount', expense.id)}>{formatMoney(Number(expense.amount || 0), currency)}</strong>
        </div>
      ))}
    </div>
  );
}

/** Page 04 — hypothèses de sortie : date de vente, prix de vente, coût de cession ; les résultats restent dans la page. */
export function ExitAssumptionsReadOnly({ exit, currency, language }: { exit: ExitAssumptions; currency?: string; language: InterfaceLanguage }) {
  const tx = translator(language);
  return (
    <div className="metric-grid">
      <div><strong {...aiFieldProps('value.exit.saleDate')}>{exit.saleDate ? formatDate(exit.saleDate) : tx('Non renseignée', 'Not provided')}</strong><span>{tx('Date de vente', 'Sale date')}</span></div>
      <div><strong {...aiFieldProps('value.exit.salePrice')}>{formatMoney(exit.salePrice, currency)}</strong><span>{tx('Prix de vente', 'Sale price')}</span></div>
      <div><strong {...aiFieldProps('value.exit.disposalCostPct')}>{exit.disposalCostPct} %</strong><span>{tx('Coût de cession', 'Disposal cost')}</span></div>
    </div>
  );
}
