import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CalendarCheck,
  CalendarClock,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import type { FollowUpCategory, RegistryFollowUpItem } from '../../domain/followUp.ts';
import type { RegistryDocument } from '../../domain/foundations.ts';
import { loadRegistryFollowUps, observeRegistryFollowUpsFromItems } from '../../services/followUp.ts';
import { loadRegistryItems } from '../../services/projections.ts';
import type { RegistryItemProjection } from '../../domain/projections.ts';
import { RegistryTodoBoard } from './RegistryTodoBoard.tsx';
import { useRegistryCollections } from './useRegistryCollections.ts';
import {
  buildRegistryFollowUpSummary,
  filterAndSortRegistryFollowUps,
  type FollowUpTimeStatus,
} from './registryFollowUp.ts';
import { RegistryFilterPanel } from './RegistryFilterPanel.tsx';

type FollowUpLoadState = 'loading' | 'ready' | 'error';

const CATEGORY_LABELS: Record<FollowUpCategory, string> = {
  insurance: 'Assurance',
  visual_evidence: 'Preuves visuelles',
  maintenance: 'Entretien',
  custom: 'Action personnalisée',
};

const TIME_STATUS_LABELS: Record<FollowUpTimeStatus, string> = {
  overdue: 'En retard',
  due_soon: 'Dans les 30 jours',
  scheduled: 'Planifié',
  completed: 'Terminé',
};

const readInitialParameter = (name: string, fallback: string) =>
  new URLSearchParams(window.location.search).get(name) || fallback;

export function RegistryFollowUp({ registry, canReadCartularies, canManage = false }: {
  registry: RegistryDocument;
  canReadCartularies: boolean;
  canManage?: boolean;
}) {
  const { collectionName } = useRegistryCollections(registry.id);
  const [registryItems, setRegistryItems] = useState<RegistryItemProjection[]>([]);
  const [items, setItems] = useState<RegistryFollowUpItem[]>([]);
  const [loadState, setLoadState] = useState<FollowUpLoadState>('loading');
  const [query, setQuery] = useState(() => readInitialParameter('q', ''));
  const [timeStatus, setTimeStatus] = useState<'all' | FollowUpTimeStatus>(() => {
    const candidate = readInitialParameter('status', 'all');
    return ['overdue', 'due_soon', 'scheduled', 'completed'].includes(candidate)
      ? candidate as FollowUpTimeStatus
      : 'all';
  });
  const [category, setCategory] = useState<'all' | FollowUpCategory>(() => {
    const candidate = readInitialParameter('category', 'all');
    return Object.hasOwn(CATEGORY_LABELS, candidate) ? candidate as FollowUpCategory : 'all';
  });
  const [collectionId, setCollectionId] = useState(() => readInitialParameter('collection', 'all'));

  const reload = useCallback(async () => {
    if (!canReadCartularies) {
      setItems([]);
      setLoadState('ready');
      return;
    }
    setLoadState('loading');
    try {
      const [followUps, objects] = await Promise.all([loadRegistryFollowUps(registry.id), loadRegistryItems(registry.id)]);
      setItems(followUps);
      setRegistryItems(objects);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [canReadCartularies, registry.id]);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!canReadCartularies || registryItems.length === 0) return;
    return observeRegistryFollowUpsFromItems(registryItems, setItems, () => setLoadState('error'));
  }, [canReadCartularies, registryItems]);

  const now = useMemo(() => new Date(), []);
  const summary = useMemo(() => buildRegistryFollowUpSummary(items, now), [items, now]);
  const filteredItems = useMemo(() => filterAndSortRegistryFollowUps(items, {
    query,
    timeStatus,
    category,
    collectionId,
  }, now), [category, collectionId, items, now, query, timeStatus]);
  const collections = useMemo(() => [...new Set(items.map((item) => item.collectionId))]
    .sort((left, right) => left.localeCompare(right, 'fr')), [items]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (timeStatus !== 'all') params.set('status', timeStatus);
    if (category !== 'all') params.set('category', category);
    if (collectionId !== 'all') params.set('collection', collectionId);
    return params.toString();
  }, [category, collectionId, query, timeStatus]);

  useEffect(() => {
    const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}`;
    window.history.replaceState(null, '', nextUrl);
  }, [queryString]);

  const activeFilterCount = [query.trim(), timeStatus !== 'all', category !== 'all', collectionId !== 'all']
    .filter(Boolean).length;

  const resetFilters = () => {
    setQuery('');
    setTimeStatus('all');
    setCategory('all');
    setCollectionId('all');
  };

  if (!canReadCartularies) {
    return (
      <section className="registry-follow-up registry-follow-up--denied" aria-labelledby="registry-follow-up-title">
        <ShieldCheck aria-hidden="true" />
        <p className="registry-kicker">Centre de suivi</p>
        <h1 id="registry-follow-up-title">Accès limité</h1>
        <p>Votre qualité permet d’ouvrir le Registre, mais pas les rappels Secrets de ses Cartulaires.</p>
        <a href={`/registry/${encodeURIComponent(registry.id)}`}>Revenir à la vue d’ensemble</a>
      </section>
    );
  }

  return (
    <section className="registry-follow-up" aria-labelledby="registry-follow-up-title">
      <header className="registry-page-heading registry-follow-up__heading">
        <div>
          <p className="registry-kicker">Suivi des objets</p>
          <h1 id="registry-follow-up-title">Échéances et rappels</h1>
          <p>Les actions à venir de vos Cartulaires, réunies sans déplacer leurs preuves, archives ou médias.</p>
        </div>
      </header>

      <div className="registry-follow-up-facts" aria-label="Synthèse des échéances">
        <button type="button" className={timeStatus === 'overdue' ? 'is-active is-alert' : summary.overdue > 0 ? 'is-alert' : undefined} onClick={() => setTimeStatus('overdue')}>
          <AlertTriangle aria-hidden="true" /><span>En retard</span><strong>{summary.overdue}</strong>
        </button>
        <button type="button" className={timeStatus === 'due_soon' ? 'is-active' : undefined} onClick={() => setTimeStatus('due_soon')}>
          <BellRing aria-hidden="true" /><span>Dans les 30 jours</span><strong>{summary.dueSoon}</strong>
        </button>
        <button type="button" className={timeStatus === 'scheduled' ? 'is-active' : undefined} onClick={() => setTimeStatus('scheduled')}>
          <CalendarClock aria-hidden="true" /><span>Plus tard</span><strong>{summary.scheduled}</strong>
        </button>
        <button type="button" className={timeStatus === 'completed' ? 'is-active' : undefined} onClick={() => setTimeStatus('completed')}>
          <CalendarCheck aria-hidden="true" /><span>Terminés</span><strong>{summary.completed}</strong>
        </button>
      </div>

      <div className="registry-catalog-toolbar registry-follow-up-toolbar">
        <label className="registry-search">
          <span className="sr-only">Rechercher une échéance</span>
          <Search aria-hidden="true" />
          <input type="search" placeholder="Rechercher une action ou un Cartulaire…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button type="button" className="registry-refresh" onClick={() => void reload()} disabled={loadState === 'loading'}>
          <RefreshCw className={loadState === 'loading' ? 'registry-spinner' : undefined} aria-hidden="true" />
          <span>Actualiser</span>
        </button>
      </div>

      <RegistryFilterPanel className="registry-follow-up-filters" label="Filtres du suivi" activeFilterCount={activeFilterCount}>
        <label><span>Échéance</span><select value={timeStatus} onChange={(event) => setTimeStatus(event.target.value as 'all' | FollowUpTimeStatus)}>
          <option value="all">Toutes les échéances</option>
          {Object.entries(TIME_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <label><span>Nature</span><select value={category} onChange={(event) => setCategory(event.target.value as 'all' | FollowUpCategory)}>
          <option value="all">Toutes les natures</option>
          {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <label><span>Collection</span><select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
          <option value="all">Toutes les collections</option>
          {collections.map((value) => <option value={value} key={value}>{collectionName(value)}</option>)}
        </select></label>
        {activeFilterCount > 0 && <button type="button" className="registry-filter-reset" onClick={resetFilters}>Effacer</button>}
      </RegistryFilterPanel>

      <div className="registry-follow-up-results">
        <p aria-live="polite"><strong>{filteredItems.length}</strong> rappel{filteredItems.length > 1 ? 's' : ''}{filteredItems.length !== summary.total && <span> sur {summary.total}</span>}</p>
        <span>Les mêmes tâches dans le Registre et leur Cartulaire</span>
      </div>

      {loadState === 'loading' && <div className="registry-follow-up-state" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><h2>Chargement du suivi</h2><p>Lecture des rappels Secrets des Cartulaires autorisés…</p></div>}
      {loadState === 'error' && <div className="registry-follow-up-state registry-follow-up-state--error" role="alert"><AlertTriangle aria-hidden="true" /><h2>Suivi indisponible</h2><p>Les rappels autorisés n’ont pas pu être réunis.</p><button type="button" onClick={() => void reload()}>Réessayer</button></div>}
      {loadState === 'ready' && filteredItems.length === 0 && <div className="registry-follow-up-state"><CalendarCheck aria-hidden="true" /><h2>{items.length === 0 ? 'Aucun rappel actif' : 'Aucun résultat'}</h2><p>{items.length === 0 ? 'Les rappels créés dans les Cartulaires apparaîtront ici automatiquement.' : 'Modifiez les filtres ou affichez l’ensemble du suivi.'}</p>{items.length > 0 && <button type="button" onClick={resetFilters}>Afficher tout le suivi</button>}</div>}

      {loadState !== 'loading' && <RegistryTodoBoard registryId={registry.id} items={registryItems} todos={filteredItems} canManage={canManage && loadState === 'ready'} />}

    </section>
  );
}
