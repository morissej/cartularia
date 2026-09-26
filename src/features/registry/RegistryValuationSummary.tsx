import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Landmark, LoaderCircle, Plus, ShieldCheck } from 'lucide-react';
import type { MembershipDocument, RegistryDocument } from '../../domain/foundations.ts';
import type { RegistryItemProjection, RegistryValuationLevel, RegistryValuationSnapshot } from '../../domain/projections.ts';
import { observeRegistryValuationSnapshots, requestRegistryValuationSnapshot } from '../../services/registryValuation.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { RegistryCurrentValuationSummary } from './RegistryCurrentValuationSummary.tsx';

const LEVEL_LABELS: Record<RegistryValuationLevel, string> = {
  owner_declared: 'Déclarée par le propriétaire',
  ai_proposed: 'Proposée par IA',
  professional: 'Professionnel mandaté',
  transaction: 'Transaction observée',
};

const EXCLUSION_LABELS: Record<string, string> = {
  missing_amount: 'montant absent',
  missing_currency: 'devise absente',
  missing_level: 'niveau absent',
  missing_date: 'date absente',
  missing_source: 'source absente',
  missing_confidence: 'confiance absente',
  currency_mismatch: 'devise différente de EUR',
  value_after_statement: "valeur postérieure à l’arrêté",
  inactive_projection: 'projection inactive',
};

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const formatMoney = (value: number) => euro.format(value);
const formatDate = (value: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
const today = () => new Date().toISOString().slice(0, 10);

export function RegistryValuationSummary({ registry, membership, items, inventoryState }: {
  registry: RegistryDocument;
  membership: MembershipDocument;
  items: RegistryItemProjection[];
  inventoryState: 'loading' | 'ready' | 'error';
}) {
  const [snapshots, setSnapshots] = useState<RegistryValuationSnapshot[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [asOfDate, setAsOfDate] = useState(today);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadedRegistryId, setLoadedRegistryId] = useState('');
  const canRead = membership.permissions.includes('valuation.read');
  const canCreate = canRead
    && membership.permissions.includes('cartulary.edit')
    && membership.roles.includes('legal_owner')
    && membership.invitationManaged !== true;

  useEffect(() => {
    if (!canRead) return () => undefined;
    let active = true;
    setState('loading');
    const unsubscribe = observeRegistryValuationSnapshots(registry.id, (next) => {
      if (!active) return;
      setSnapshots(next);
      setLoadedRegistryId(registry.id);
      setSelectedId((current) => current && next.some((snapshot) => snapshot.snapshotId === current) ? current : next[0]?.snapshotId || '');
      setState('ready');
    }, () => {
      if (!active) return;
      setSnapshots([]);
      setState('error');
    });
    return () => { active = false; unsubscribe(); };
  }, [canRead, registry.id]);

  const selected = useMemo(
    () => loadedRegistryId === registry.id && state === 'ready' ? snapshots.find((snapshot) => snapshot.snapshotId === selectedId) || snapshots[0] || null : null,
    [selectedId, snapshots, loadedRegistryId, registry.id, state],
  );

  if (!canRead) return null;

  const createSnapshot = async () => {
    setCreating(true);
    setNotice(null);
    try {
      const snapshot = await requestRegistryValuationSnapshot(registry.id, asOfDate);
      setSelectedId(snapshot.snapshotId);
      setNotice(`Arrêté du ${formatDate(snapshot.asOfDate)} créé et figé.`);
    } catch {
      setNotice("L’arrêté n’a pas été créé. Vérifiez les droits, la date et la disponibilité des projections.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
    <RegistryCurrentValuationSummary registry={registry} items={items} inventoryState={inventoryState} allowed={canRead} />
    <details className="registry-valuation-history">
      <summary>Arrêtés de valeur historiques</summary>
    <section className="registry-valuation" aria-labelledby="registry-valuation-title">
      <header className="registry-valuation__header">
        <div><span className="registry-step">DEV‑08</span><h2 id="registry-valuation-title">Arrêté de valeur</h2><p>Photographie Secret figée en EUR, sans conversion automatique.</p></div>
        <Landmark aria-hidden="true" />
      </header>

      {canCreate && (
        <div className="registry-valuation__create">
          <label htmlFor="registry-valuation-date">Date de l’arrêté<input id="registry-valuation-date" type="date" max={today()} value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} /></label>
          <button type="button" onClick={() => void createSnapshot()} disabled={creating || !asOfDate}>
            {creating ? <LoaderCircle className="registry-spinner" aria-hidden="true" /> : <Plus aria-hidden="true" />}Créer et figer
          </button>
        </div>
      )}

      {notice && <p className="registry-valuation__notice" role="status">{notice}</p>}
      {state === 'loading' && <div className="registry-dashboard-loading" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><span>Chargement des arrêtés autorisés…</span></div>}
      {state === 'error' && <div className="registry-dashboard-error" role="alert"><AlertTriangle aria-hidden="true" /><div><h3>Arrêtés indisponibles</h3><p>Les valeurs Secret n’ont pas pu être lues avec les droits actuels.</p></div></div>}
      <p className="registry-dashboard-note">Les arrêtés conservent une photographie datée et appliquent des exigences documentaires supplémentaires. Leur total peut différer de la valeur patrimoniale courante.</p>
      {state === 'ready' && !selected && <div className="registry-valuation__empty"><CalendarDays aria-hidden="true" /><div><h3>Aucun arrêté figé</h3><p>Créez un arrêté daté pour conserver une photographie des valeurs documentées.</p></div></div>}

      {selected && (
        <>
          <div className="registry-valuation__toolbar">
            <div><CalendarDays aria-hidden="true" /><span>Arrêté au</span><strong>{formatDate(selected.asOfDate)}</strong></div>
            <label htmlFor="registry-valuation-history">Historique
              <select id="registry-valuation-history" value={selected.snapshotId} onChange={(event) => setSelectedId(event.target.value)}>
                {snapshots.map((snapshot) => <option value={snapshot.snapshotId} key={snapshot.snapshotId}>{formatDate(snapshot.asOfDate)} · {formatMoney(snapshot.totalMarketValue)}</option>)}
              </select>
            </label>
            <span><ShieldCheck aria-hidden="true" />Snapshot immuable</span>
          </div>

          <div className="registry-valuation__facts" aria-label="Totaux de l’arrêté">
            <article><span>Valeur de marché</span><strong>{formatMoney(selected.totalMarketValue)}</strong><small>{selected.lines.length} ligne(s) incluse(s)</small></article>
            <article><span>Capital assuré</span><strong>{formatMoney(selected.totalInsuredCapital)}</strong><small>Contrats applicables à la date</small></article>
            <article className={selected.coverageGap > 0 ? 'is-alert' : undefined}><span>{selected.coverageGap >= 0 ? 'Écart de couverture' : 'Excédent de couverture'}</span><strong>{formatMoney(Math.abs(selected.coverageGap))}</strong><small>{selected.uninsuredLineCount} ligne(s) non assurée(s)</small></article>
            <article><span>Faible confiance</span><strong>{Math.round(selected.lowConfidenceShare * 100)} %</strong><small>{formatMoney(selected.lowConfidenceValue)} de la valeur totale</small></article>
          </div>

          <div className="registry-valuation__levels">
            {Object.entries(LEVEL_LABELS).map(([level, label]) => <div key={level}><span>{label}</span><strong>{formatMoney(selected.totalsByLevel[level as RegistryValuationLevel] || 0)}</strong></div>)}
          </div>

          <div className="registry-valuation__table-wrap" tabIndex={0} aria-label="Lignes de l’arrêté, défilement horizontal possible">
            <table className="registry-valuation__table">
              <thead><tr><th scope="col">Cartulaire</th><th scope="col">Niveau, date et source</th><th scope="col">Valeur de marché</th><th scope="col">Capital assuré</th><th scope="col">Écart</th></tr></thead>
              <tbody>{selected.lines.map((line) => (
                <tr key={line.cartularyId}>
                  <th scope="row"><a href={buildCartularyHref(line.cartularyId, window.location.pathname, line.assetType)}>{line.displayTitle}</a><small>{line.confidence === 'low' ? 'Confiance faible' : line.confidence === 'medium' ? 'Confiance moyenne' : 'Confiance élevée'}</small></th>
                  <td><strong>{LEVEL_LABELS[line.level]}</strong><span>{line.observedAt} · {line.sourceLabel}</span></td>
                  <td>{formatMoney(line.marketValue)}</td><td>{formatMoney(line.insuredCapital)}<small>{line.insuranceContractCount} contrat(s)</small></td><td className={line.coverageGap > 0 ? 'is-alert' : undefined}>{formatMoney(line.coverageGap)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          {selected.excludedLines.length > 0 && <div className="registry-valuation__excluded"><h3>Lignes exclues de l’arrêté</h3><ul>{selected.excludedLines.map((line) => <li key={line.cartularyId}><strong>{line.displayTitle}</strong><span>{line.reasons.map((reason) => EXCLUSION_LABELS[reason] || reason).join(' · ')}</span></li>)}</ul></div>}
          <p className="registry-dashboard-note">Une ligne en devise différente, postérieure à l’arrêté ou privée de niveau, date, source, confiance ou devise est exclue et signalée. Aucun taux de change n’est appliqué.</p>
        </>
      )}
    </section>
    </details>
    </>
  );
}
