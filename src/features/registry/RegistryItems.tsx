import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Building2,
  CarFront,
  ExternalLink,
  Grid2X2,
  Landmark,
  List,
  LoaderCircle,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Watch,
  Wine,
} from 'lucide-react';
import type { RegistryDocument } from '../../domain/foundations.ts';
import type { RegistryItemProjection } from '../../domain/projections.ts';
import { loadRegistryItems, observeRegistryItems } from '../../services/projections.ts';
import {
  buildRegistryComparisonHref,
  REGISTRY_COMPARISON_MAX,
  sanitizeComparisonIds,
  toggleRegistryComparisonId,
} from './registryComparison.ts';
import {
  buildCartularyHref,
  DEFAULT_REGISTRY_CATALOG_FILTERS,
  filterAndSortRegistryItems,
  type RegistryCatalogSort,
} from './registryCatalog.ts';
import {
  ASSET_TYPE_LABELS,
  COMPLETENESS_LABELS,
  labelFromIdentifier,
  LIFECYCLE_LABELS,
  POSSESSION_LABELS,
} from './registryPresentation.ts';

type CatalogView = 'grid' | 'list';
type CatalogLoadState = 'loading' | 'ready' | 'error';

const AssetIcon = ({ assetType }: { assetType: string }) => {
  if (assetType === 'watch') return <Watch aria-hidden="true" />;
  if (assetType === 'car') return <CarFront aria-hidden="true" />;
  if (assetType === 'wine') return <Wine aria-hidden="true" />;
  if (assetType === 'art') return <Palette aria-hidden="true" />;
  if (assetType === 'real_estate') return <Landmark aria-hidden="true" />;
  return <Package aria-hidden="true" />;
};

const optionValues = (items: RegistryItemProjection[], field: 'assetType' | 'collectionId' | 'lifecycleStatus') =>
  [...new Set(items.map((item) => item[field]).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'fr'));

const readInitialParameter = (name: string, fallback: string) =>
  new URLSearchParams(window.location.search).get(name) || fallback;

export function RegistryItems({ registry, canCreateCartularies = false }: { registry: RegistryDocument; canCreateCartularies?: boolean }) {
  const [items, setItems] = useState<RegistryItemProjection[]>([]);
  const [loadState, setLoadState] = useState<CatalogLoadState>('loading');
  const [query, setQuery] = useState(() => readInitialParameter('q', ''));
  const [assetType, setAssetType] = useState(() => readInitialParameter('type', 'all'));
  const [collectionId, setCollectionId] = useState(() => readInitialParameter('collection', 'all'));
  const [lifecycleStatus, setLifecycleStatus] = useState(() => readInitialParameter('status', 'all'));
  const [sort, setSort] = useState<RegistryCatalogSort>(() => {
    const candidate = readInitialParameter('sort', DEFAULT_REGISTRY_CATALOG_FILTERS.sort);
    return candidate === 'title-asc' || candidate === 'year-desc' ? candidate : 'updated-desc';
  });
  const [view, setView] = useState<CatalogView>(() => readInitialParameter('view', 'grid') === 'list' ? 'list' : 'grid');
  const [comparisonIds, setComparisonIds] = useState<string[]>(() => sanitizeComparisonIds(readInitialParameter('compare', '')));

  const reload = useCallback(async () => {
    setLoadState('loading');
    try {
      setItems(await loadRegistryItems(registry.id));
      setLoadState('ready');
    } catch {
      setItems([]);
      setLoadState('error');
    }
  }, [registry.id]);

  useEffect(() => {
    setLoadState('loading');
    return observeRegistryItems(registry.id, (nextItems) => {
      setItems(nextItems);
      setLoadState('ready');
    }, () => {
      setItems([]);
      setLoadState('error');
    });
  }, [registry.id]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (assetType !== 'all') params.set('type', assetType);
    if (collectionId !== 'all') params.set('collection', collectionId);
    if (lifecycleStatus !== 'all') params.set('status', lifecycleStatus);
    if (sort !== 'updated-desc') params.set('sort', sort);
    if (view !== 'grid') params.set('view', view);
    if (comparisonIds.length > 0) params.set('compare', comparisonIds.join(','));
    return params.toString();
  }, [assetType, collectionId, comparisonIds, lifecycleStatus, query, sort, view]);

  useEffect(() => {
    const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, [queryString]);

  const filteredItems = useMemo(() => filterAndSortRegistryItems(items, {
    query,
    assetType,
    collectionId,
    lifecycleStatus,
    sort,
  }), [assetType, collectionId, items, lifecycleStatus, query, sort]);
  const assetTypes = useMemo(() => optionValues(items, 'assetType'), [items]);
  const collections = useMemo(() => optionValues(items, 'collectionId'), [items]);
  const lifecycleStatuses = useMemo(() => optionValues(items, 'lifecycleStatus'), [items]);
  const activeFilterCount = [query.trim(), assetType !== 'all', collectionId !== 'all', lifecycleStatus !== 'all']
    .filter(Boolean).length;
  const returnTo = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
  const comparisonHref = buildRegistryComparisonHref(registry.id, comparisonIds, returnTo);

  const resetFilters = () => {
    setQuery('');
    setAssetType('all');
    setCollectionId('all');
    setLifecycleStatus('all');
    setSort('updated-desc');
  };

  const toggleComparison = (cartularyId: string) => {
    setComparisonIds((current) => toggleRegistryComparisonId(current, cartularyId));
  };

  return (
    <section className="registry-catalog" aria-labelledby="registry-catalog-title">
      <header className="registry-page-heading registry-catalog__heading">
        <div>
          <p className="registry-kicker">Catalogue privé</p>
          <h1 id="registry-catalog-title">Les Cartulaires du Registre</h1>
          <p>Une vue transverse des dossiers autorisés, sans dupliquer leurs preuves, archives ou originaux.</p>
        </div>
        <div className="registry-catalog__heading-actions">
          {canCreateCartularies && <a href={`/registry/${encodeURIComponent(registry.id)}/new`}><Plus aria-hidden="true" /> Nouveau cartulaire</a>}
          <div className="registry-catalog__security">
            <ShieldCheck aria-hidden="true" />
            <span>Projection Registre uniquement</span>
          </div>
        </div>
      </header>

      <div className="registry-catalog-toolbar">
        <label className="registry-search">
          <span className="sr-only">Rechercher un Cartulaire</span>
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Rechercher une marque, un modèle, une référence…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" className="registry-refresh" onClick={() => void reload()} disabled={loadState === 'loading'}>
          <RefreshCw className={loadState === 'loading' ? 'registry-spinner' : undefined} aria-hidden="true" />
          <span>Actualiser</span>
        </button>
      </div>

      <div className="registry-catalog-filters" aria-label="Filtres du catalogue">
        <div className="registry-filter-title">
          <SlidersHorizontal aria-hidden="true" />
          <span>Filtrer</span>
          {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
        </div>
        <label>
          <span>Type d’actif</span>
          <select value={assetType} onChange={(event) => setAssetType(event.target.value)}>
            <option value="all">Tous les types</option>
            {assetTypes.map((value) => <option value={value} key={value}>{ASSET_TYPE_LABELS[value] || labelFromIdentifier(value)}</option>)}
          </select>
        </label>
        <label>
          <span>Collection</span>
          <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
            <option value="all">Toutes les collections</option>
            {collections.map((value) => <option value={value} key={value}>{labelFromIdentifier(value)}</option>)}
          </select>
        </label>
        <label>
          <span>Statut</span>
          <select value={lifecycleStatus} onChange={(event) => setLifecycleStatus(event.target.value)}>
            <option value="all">Tous les statuts</option>
            {lifecycleStatuses.map((value) => <option value={value} key={value}>{LIFECYCLE_LABELS[value] || labelFromIdentifier(value)}</option>)}
          </select>
        </label>
        <label>
          <span>Trier par</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as RegistryCatalogSort)}>
            <option value="updated-desc">Mise à jour récente</option>
            <option value="title-asc">Titre A–Z</option>
            <option value="year-desc">Année décroissante</option>
          </select>
        </label>
        {activeFilterCount > 0 && <button type="button" className="registry-filter-reset" onClick={resetFilters}>Effacer</button>}
      </div>

      <div className="registry-results-heading">
        <p aria-live="polite">
          <strong>{filteredItems.length}</strong> Cartulaire{filteredItems.length > 1 ? 's' : ''}
          {filteredItems.length !== items.length && <span> sur {items.length}</span>}
        </p>
        <div className="registry-view-switch" aria-label="Mode d’affichage">
          <button type="button" aria-label="Vue en grille" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 aria-hidden="true" /></button>
          <button type="button" aria-label="Vue en liste" aria-pressed={view === 'list'} onClick={() => setView('list')}><List aria-hidden="true" /></button>
        </div>
      </div>

      {comparisonIds.length > 0 && (
        <aside className="registry-comparison-tray" aria-live="polite">
          <div><Scale aria-hidden="true" /><span>Comparaison</span><strong>{comparisonIds.length} / {REGISTRY_COMPARISON_MAX}</strong></div>
          <p>{comparisonIds.length < 2
            ? 'Sélectionnez 2 à 4 Cartulaires pour rapprocher leurs données communes.'
            : `${comparisonIds.length} Cartulaires prêts : marque, modèle, année, statut et complétude.`}</p>
          <button type="button" onClick={() => setComparisonIds([])}>Effacer</button>
          {comparisonIds.length >= 2 ? <a href={comparisonHref}>Comparer maintenant <Scale aria-hidden="true" /></a> : <span className="registry-comparison-tray__disabled">Minimum 2</span>}
        </aside>
      )}

      {loadState === 'loading' && (
        <div className="registry-catalog-state" role="status">
          <LoaderCircle className="registry-spinner" aria-hidden="true" />
          <h2>Chargement du catalogue</h2>
          <p>Lecture des projections privées du Registre…</p>
        </div>
      )}

      {loadState === 'error' && (
        <div className="registry-catalog-state registry-catalog-state--error" role="alert">
          <Archive aria-hidden="true" />
          <h2>Catalogue indisponible</h2>
          <p>Les Cartulaires autorisés n’ont pas pu être chargés.</p>
          <button type="button" onClick={() => void reload()}>Réessayer</button>
        </div>
      )}

      {loadState === 'ready' && filteredItems.length === 0 && (
        <div className="registry-catalog-state">
          <Archive aria-hidden="true" />
          <h2>{items.length === 0 ? 'Aucun Cartulaire dans ce Registre' : 'Aucun résultat'}</h2>
          <p>{items.length === 0
            ? 'Le catalogue se remplira lorsque des Cartulaires seront projetés dans ce Registre.'
            : 'Modifiez les critères de recherche ou effacez les filtres actifs.'}</p>
          {items.length > 0 && <button type="button" onClick={resetFilters}>Afficher tout le catalogue</button>}
        </div>
      )}

      {loadState === 'ready' && filteredItems.length > 0 && (
        <div className={`registry-item-grid registry-item-grid--${view}`}>
          {filteredItems.map((item) => (
            <article className={`registry-item${comparisonIds.includes(item.cartularyId) ? ' registry-item--selected' : ''}`} key={item.cartularyId}>
              <div className={`registry-item__visual registry-item__visual--${item.assetType}`}>
                <AssetIcon assetType={item.assetType} />
                <span>{ASSET_TYPE_LABELS[item.assetType] || labelFromIdentifier(item.assetType)}</span>
              </div>
              <div className="registry-item__body">
                <div className="registry-item__context">
                  <span><Building2 aria-hidden="true" />{labelFromIdentifier(item.collectionId)}</span>
                  <span>Révision {item.sourceRevision}</span>
                </div>
                <h2>{item.displayTitle}</h2>
                <p>{[item.makerName, item.modelName].filter(Boolean).join(' · ')}</p>
                <dl>
                  <div><dt>Référence</dt><dd>{item.referenceCode || 'Non renseignée'}</dd></div>
                  <div><dt>Année</dt><dd>{item.manufactureYear || '—'}</dd></div>
                  <div><dt>Situation</dt><dd>{POSSESSION_LABELS[item.possessionStatus] || labelFromIdentifier(item.possessionStatus)}</dd></div>
                </dl>
              </div>
              <footer className="registry-item__footer">
                <div>
                  <span className={`registry-item-status registry-item-status--${item.lifecycleStatus}`}>
                    {LIFECYCLE_LABELS[item.lifecycleStatus] || labelFromIdentifier(item.lifecycleStatus)}
                  </span>
                  <small>{COMPLETENESS_LABELS[item.completenessLevel] || labelFromIdentifier(item.completenessLevel)}</small>
                </div>
                <div className="registry-item__actions">
                  <button
                    type="button"
                    className={comparisonIds.includes(item.cartularyId) ? 'is-selected' : undefined}
                    aria-pressed={comparisonIds.includes(item.cartularyId)}
                    disabled={!comparisonIds.includes(item.cartularyId) && comparisonIds.length >= REGISTRY_COMPARISON_MAX}
                    onClick={() => toggleComparison(item.cartularyId)}
                  >
                    <Scale aria-hidden="true" />{comparisonIds.includes(item.cartularyId) ? 'Sélectionné' : 'Ajouter à la comparaison'}
                  </button>
                  <a href={buildCartularyHref(item.cartularyId, returnTo, item.assetType)}>
                    Ouvrir le Cartulaire <ExternalLink aria-hidden="true" />
                  </a>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
