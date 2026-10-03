import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, Landmark, LoaderCircle, Plus, ShieldCheck } from 'lucide-react';
import type { MembershipDocument, RegistryDocument } from '../../domain/foundations.ts';
import type { RegistryItemProjection, RegistryValuationLevel, RegistryValuationSnapshot } from '../../domain/projections.ts';
import { observeRegistryValuationSnapshots, requestRegistryValuationSnapshot } from '../../services/registryValuation.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { valuationExclusionLabel } from '../../domain/documentationPresentation.ts';
import { useCurrentRegistryValuation } from './useCurrentRegistryValuation.ts';
import { RegistryCurrentValuationSummary } from './RegistryCurrentValuationSummary.tsx';

const LEVEL_LABELS: Record<RegistryValuationLevel, string> = {
  owner_declared: 'Déclarée par le propriétaire',
  ai_proposed: 'Proposée par IA',
  professional: 'Professionnel mandaté',
  transaction: 'Transaction observée',
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
  const [valuationAttempt, setValuationAttempt] = useState(0);
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

  const current = useCurrentRegistryValuation(registry.id, registry.referenceCurrency, items, inventoryState, canRead, valuationAttempt);

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
  const includedIds = new Set(selected?.lines.map((line) => line.cartularyId));
  const excludedIds = new Set(selected?.excludedLines.map((line) => line.cartularyId));
  const currentLines = current.summary?.lines ?? [];
  const currentIncludedCount = currentLines.filter((line) => includedIds.has(line.cartularyId)).length;
  const unrecordedLines = currentLines.filter((line) => !includedIds.has(line.cartularyId) && !excludedIds.has(line.cartularyId));

  if (!canRead) return null;

  const createSnapshot = async () => {
    setCreating(true);
    setNotice(null);
    try {
      const snapshot = await requestRegistryValuationSnapshot(registry.id, asOfDate);
      setSelectedId(snapshot.snapshotId);
      setNotice(`Arrêté du ${formatDate(snapshot.asOfDate)} créé et figé.`);
    } catch {
      setNotice("L’arrêté n’a pas été créé. Vérifiez les droits, la date et la disponibilité des valeurs.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
    <RegistryCurrentValuationSummary registry={registry} state={current.state} summary={current.summary} onRetry={() => setValuationAttempt((value) => value + 1)} />
    <details className="registry-valuation-history">
      <summary>Arrêtés de valeur historiques</summary>
    <section className="registry-valuation" aria-labelledby="registry-valuation-title">
      <header className="registry-valuation__header">
        <div><span className="registry-step">Historique privé</span><h2 id="registry-valuation-title">Arrêté de valeur</h2><p>Montants documentés conservés à une date donnée, en euros.</p></div>
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
      {state === 'error' && <div className="registry-dashboard-error" role="alert"><AlertTriangle aria-hidden="true" /><div><h3>Arrêtés indisponibles</h3><p>Les valeurs privées n’ont pas pu être lues avec les droits actuels.</p></div></div>}
      <p className="registry-dashboard-note">La valeur patrimoniale ci-dessus suit les montants actuels. Un arrêté conserve les montants suffisamment documentés à la date choisie. Les objets absents et les changements de valeur expliquent les différences entre ces deux vues.</p>
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
            <span><ShieldCheck aria-hidden="true" />Arrêté conservé sans modification</span>
          </div>

          {current.summary && <section className="registry-valuation__comparison" aria-label="Couverture de l’arrêté par rapport au Registre actuel">
            <h3>Comparer avec le Registre actuel</h3>
            <p><strong>{currentIncludedCount} objet(s) sur {current.summary.itemCount} du Registre actuel inclus dans cet arrêté.</strong> Les objets absents ne sont pas évalués à zéro.</p>
            <dl>
              <div><dt>Valeur courante{current.summary.missingCount > 0 ? ' connue · total partiel' : ''}</dt><dd>{current.summary.total === null ? 'Non renseignée' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: registry.referenceCurrency, maximumFractionDigits: 0 }).format(current.summary.total)}</dd></div>
              <div><dt>Valeur conservée au {formatDate(selected.asOfDate)}</dt><dd>{formatMoney(selected.totalMarketValue)}</dd></div>
              {current.summary.total !== null && registry.referenceCurrency === selected.referenceCurrency && <div><dt>Écart entre les montants connus</dt><dd>{formatMoney(Math.round((current.summary.total - selected.totalMarketValue) * 100) / 100)}</dd></div>}
            </dl>
            <p className="registry-dashboard-note">Cet écart peut venir de la date, des objets inclus ou des justificatifs disponibles. Il ne mesure pas un gain ou une perte. L’arrêté historique reste inchangé.</p>
            {registry.referenceCurrency !== selected.referenceCurrency && <p>Les devises diffèrent : aucun écart monétaire n’est calculé.</p>}
            {unrecordedLines.length > 0 && <div className="registry-valuation__excluded"><h3>Objets actuels absents de cet arrêté</h3><ul>{unrecordedLines.map((line) => <li key={line.cartularyId}><a href={buildCartularyHref(line.cartularyId, window.location.pathname, line.assetType)}>{line.displayTitle}</a><span>Raison de l’absence non renseignée dans cet arrêté.</span></li>)}</ul></div>}
          </section>}
          {current.state !== 'ready' && <p className="registry-valuation__notice">La couverture par rapport au Registre actuel n’est pas confirmée : {current.state === 'loading' ? 'chargement des valeurs en cours.' : 'les valeurs courantes sont indisponibles.'}</p>}

          <div className="registry-valuation__facts" aria-label="Totaux de l’arrêté">
            <article><span>Valeur de marché</span><strong>{formatMoney(selected.totalMarketValue)}</strong><small>{selected.lines.length} objet(s) inclus dans cet arrêté</small></article>
            <article><span>Capital assuré</span><strong>{formatMoney(selected.totalInsuredCapital)}</strong><small>Contrats applicables à la date</small></article>
            <article className={selected.coverageGap > 0 ? 'is-alert' : undefined}><span>{selected.coverageGap >= 0 ? 'Écart de couverture' : 'Excédent de couverture'}</span><strong>{formatMoney(Math.abs(selected.coverageGap))}</strong><small>{selected.uninsuredLineCount} objet(s) sans assurance renseignée</small></article>
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

          {selected.excludedLines.length > 0 && <div className="registry-valuation__excluded"><h3>Objets exclus lors de la création de l’arrêté</h3><ul>{selected.excludedLines.map((line) => <li key={line.cartularyId}><strong>{line.displayTitle}</strong><span>{line.reasons.map(valuationExclusionLabel).join(' · ')}</span></li>)}</ul></div>}
          <p className="registry-dashboard-note">Une ligne en devise différente, postérieure à l’arrêté ou privée de niveau, date, source, confiance ou devise est exclue et signalée. Aucun taux de change n’est appliqué.</p>
        </>
      )}
    </section>
    </details>
    </>
  );
}
