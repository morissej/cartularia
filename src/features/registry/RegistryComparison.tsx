import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CarFront,
  ExternalLink,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Watch,
  X,
} from 'lucide-react';
import type { RegistryDocument } from '../../domain/foundations.ts';
import type { RegistryItemProjection } from '../../domain/projections.ts';
import { loadRegistryItems, observeRegistryItems } from '../../services/projections.ts';
import {
  buildRegistryComparisonRows,
  REGISTRY_COMPARISON_MAX,
  REGISTRY_COMPARISON_MIN,
  sanitizeComparisonIds,
  selectRegistryComparisonItems,
  toggleRegistryComparisonId,
} from './registryComparison.ts';
import { buildCartularyHref, isRegistryReturnPath } from './registryCatalog.ts';
import { assetTypeLabel } from './registryPresentation.ts';

type ComparisonLoadState = 'loading' | 'ready' | 'error';

const AssetIcon = ({ assetType }: { assetType: string }) => {
  if (assetType === 'watch') return <Watch aria-hidden="true" />;
  if (assetType === 'car') return <CarFront aria-hidden="true" />;
  return <Package aria-hidden="true" />;
};

const requestedIds = () => sanitizeComparisonIds(new URLSearchParams(window.location.search).get('items'));

export function RegistryComparison({ registry }: { registry: RegistryDocument }) {
  const [items, setItems] = useState<RegistryItemProjection[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(requestedIds);
  const [candidateId, setCandidateId] = useState('');
  const [loadState, setLoadState] = useState<ComparisonLoadState>('loading');
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);

  const fallbackReturnTo = `/registry/${encodeURIComponent(registry.id)}/items`;
  const rawReturnTo = new URLSearchParams(window.location.search).get('returnTo');
  const returnTo = isRegistryReturnPath(rawReturnTo) ? rawReturnTo : fallbackReturnTo;

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

  const activeItems = useMemo(() => items.filter((item) => item.projectionStatus === 'active'), [items]);
  const selectedItems = useMemo(() => selectRegistryComparisonItems(activeItems, selectedIds), [activeItems, selectedIds]);
  const rows = useMemo(() => buildRegistryComparisonRows(selectedItems), [selectedItems]);
  const availableItems = useMemo(() => activeItems
    .filter((item) => !selectedIds.includes(item.cartularyId))
    .sort((left, right) => left.displayTitle.localeCompare(right.displayTitle, 'fr', { sensitivity: 'base' })), [activeItems, selectedIds]);

  useEffect(() => {
    if (loadState !== 'ready') return;
    const allowedIds = selectedItems.map((item) => item.cartularyId);
    if (allowedIds.length === selectedIds.length) return;
    setSelectedIds(allowedIds);
    setSelectionNotice('Les références absentes ou non autorisées ont été retirées de la comparaison.');
  }, [loadState, selectedIds, selectedItems]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedIds.length > 0) params.set('items', selectedIds.join(','));
    if (returnTo !== fallbackReturnTo) params.set('returnTo', returnTo);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [fallbackReturnTo, returnTo, selectedIds]);

  useEffect(() => {
    if (!candidateId && availableItems.length > 0) setCandidateId(availableItems[0].cartularyId);
    if (candidateId && !availableItems.some((item) => item.cartularyId === candidateId)) {
      setCandidateId(availableItems[0]?.cartularyId || '');
    }
  }, [availableItems, candidateId]);

  const addCandidate = () => {
    if (!candidateId) return;
    const next = toggleRegistryComparisonId(selectedIds, candidateId);
    if (next.length === selectedIds.length) {
      setSelectionNotice(`La comparaison est limitée à ${REGISTRY_COMPARISON_MAX} Cartulaires.`);
      return;
    }
    setSelectedIds(next);
    setSelectionNotice(null);
  };

  const removeItem = (cartularyId: string) => {
    setSelectedIds(toggleRegistryComparisonId(selectedIds, cartularyId));
    setSelectionNotice(null);
  };

  const comparisonReady = selectedItems.length >= REGISTRY_COMPARISON_MIN;

  return (
    <section className="registry-comparison" aria-labelledby="registry-comparison-title">
      <header className="registry-page-heading registry-comparison__heading">
        <div>
          <p className="registry-kicker">Outil ponctuel du Catalogue</p>
          <h1 id="registry-comparison-title">Comparer les Cartulaires</h1>
          <p>Deux à quatre dossiers rapprochés sur leur noyau commun autorisé, sans ouvrir ni recopier leur contenu patrimonial.</p>
        </div>
        <div className="registry-comparison__security"><ShieldCheck aria-hidden="true" /><span>Liste blanche projetée</span></div>
      </header>

      <div className="registry-comparison-toolbar">
        <a href={returnTo}><ArrowLeft aria-hidden="true" />Retour au catalogue</a>
        <div className="registry-comparison-picker">
          <label htmlFor="registry-comparison-candidate">Ajouter un Cartulaire</label>
          <select id="registry-comparison-candidate" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={availableItems.length === 0 || selectedIds.length >= REGISTRY_COMPARISON_MAX}>
            {availableItems.length === 0 && <option value="">Aucun autre Cartulaire disponible</option>}
            {availableItems.map((item) => <option value={item.cartularyId} key={item.cartularyId}>{item.displayTitle}</option>)}
          </select>
          <button type="button" onClick={addCandidate} disabled={!candidateId || selectedIds.length >= REGISTRY_COMPARISON_MAX}><Plus aria-hidden="true" />Ajouter</button>
        </div>
        <button type="button" className="registry-refresh registry-comparison__refresh" onClick={() => void reload()} disabled={loadState === 'loading'}><RefreshCw className={loadState === 'loading' ? 'registry-spinner' : undefined} aria-hidden="true" /><span>Actualiser</span></button>
      </div>

      <div className="registry-comparison-selection" aria-label="Cartulaires sélectionnés">
        <div><Scale aria-hidden="true" /><span>Sélection</span><strong>{selectedItems.length} / {REGISTRY_COMPARISON_MAX}</strong></div>
        {selectedItems.map((item) => <button type="button" onClick={() => removeItem(item.cartularyId)} key={item.cartularyId}><span>{item.displayTitle}</span><X aria-hidden="true" /><span className="sr-only">Retirer de la comparaison</span></button>)}
        {selectedItems.length === 0 && <p>Sélectionnez au moins deux Cartulaires dans le catalogue ou avec la liste ci-dessus.</p>}
      </div>

      {selectionNotice && <div className="registry-comparison-notice" role="status"><AlertTriangle aria-hidden="true" /><p>{selectionNotice}</p></div>}

      {loadState === 'loading' && <div className="registry-comparison-state" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><h2>Chargement de la comparaison</h2><p>Lecture des projections privées autorisées…</p></div>}
      {loadState === 'error' && <div className="registry-comparison-state registry-comparison-state--error" role="alert"><AlertTriangle aria-hidden="true" /><h2>Comparaison indisponible</h2><p>Les Cartulaires autorisés n’ont pas pu être chargés.</p><button type="button" onClick={() => void reload()}>Réessayer</button></div>}
      {loadState === 'ready' && activeItems.length === 0 && <div className="registry-comparison-state"><Scale aria-hidden="true" /><h2>Aucun Cartulaire à comparer</h2><p>Le catalogue doit contenir au moins deux projections privées actives.</p><a href={returnTo}>Ouvrir le catalogue</a></div>}
      {loadState === 'ready' && activeItems.length > 0 && !comparisonReady && <div className="registry-comparison-state"><Scale aria-hidden="true" /><h2>Ajoutez {REGISTRY_COMPARISON_MIN - selectedItems.length} Cartulaire{REGISTRY_COMPARISON_MIN - selectedItems.length > 1 ? 's' : ''}</h2><p>La matrice apparaît dès que deux dossiers autorisés sont sélectionnés.</p></div>}

      {loadState === 'ready' && comparisonReady && (
        <div className="registry-comparison-table-wrap" tabIndex={0} aria-label="Matrice de comparaison, défilement horizontal possible">
          <table className="registry-comparison-table">
            <thead>
              <tr>
                <th scope="col">Critère</th>
                {selectedItems.map((item) => <th scope="col" key={item.cartularyId}><span><AssetIcon assetType={item.assetType} />{assetTypeLabel(item.assetType)}</span><strong>{item.displayTitle}</strong><a href={buildCartularyHref(item.cartularyId, window.location.pathname + window.location.search, item.assetType)}>Ouvrir <ExternalLink aria-hidden="true" /></a></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => <tr className={row.allEqual ? 'is-equal' : 'is-different'} key={row.id}><th scope="row">{row.label}{!row.allEqual && <small>Différence</small>}</th>{row.values.map((value, index) => <td key={`${row.id}:${selectedItems[index].cartularyId}`}>{value}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )}

      <aside className="registry-comparison-boundary"><ShieldCheck aria-hidden="true" /><div><h2>Comparer n’accorde aucun droit supplémentaire</h2><p>La matrice réutilise uniquement les champs déjà visibles dans le catalogue du Registre. Pour les valeurs, preuves, médias, documents et détails, chaque Cartulaire applique séparément ses propres autorisations.</p></div><span>2 à 4 projections</span></aside>
    </section>
  );
}
