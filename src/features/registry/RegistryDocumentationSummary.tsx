import { useEffect, useState } from 'react';
import { AlertTriangle, BookCheck, LoaderCircle } from 'lucide-react';
import type { MembershipDocument, RegistryDocument } from '../../domain/foundations.ts';
import type { DocumentationTier, RegistryDocumentationSummary as Summary } from '../../domain/projections.ts';
import { requestRegistryDocumentationSummary } from '../../services/documentationTier.ts';
import { buildCartularyHref } from './registryCatalog.ts';

const TIERS: DocumentationTier[] = ['P0', 'P1', 'P2', 'P3', 'P4'];
const COST_LABELS = { free: 'Gratuit', time: 'Temps', service: 'Prestation' } as const;
const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);

export function RegistryDocumentationSummary({ registry, membership }: { registry: RegistryDocument; membership: MembershipDocument }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const canRead = membership.permissions.includes('registry.read') && membership.permissions.includes('valuation.read');

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    setState('loading');
    void requestRegistryDocumentationSummary(registry.id, today()).then((result) => {
      if (!active) return;
      setSummary(result);
      setState('ready');
    }).catch(() => {
      if (!active) return;
      setSummary(null);
      setState('error');
    });
    return () => { active = false; };
  }, [canRead, registry.id]);

  if (!canRead) return null;
  return (
    <section className="registry-documentation" aria-labelledby="registry-documentation-title">
      <header className="registry-documentation__header"><div><span className="registry-step">DEV‑10</span><h2 id="registry-documentation-title">Exposition documentaire</h2><p>Agrégat Secret fondé sur les lignes DEV‑08 éligibles et les paliers serveur P0–P4.</p></div><BookCheck aria-hidden="true" /></header>
      {state === 'loading' && <div className="registry-dashboard-loading" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><span>Calcul autoritaire de l’exposition…</span></div>}
      {state === 'error' && <div className="registry-dashboard-error" role="alert"><AlertTriangle aria-hidden="true" /><div><h3>Synthèse indisponible</h3><p>Les valeurs et paliers Secrets n’ont pas pu être agrégés.</p></div></div>}
      {state === 'ready' && summary && <>
        <div className="registry-documentation__facts">
          <article><span>Valeur sécurisée · P2+</span><strong>{euro.format(summary.securedValue)}</strong><small>Documentation tenue, datée ou certifiée</small></article>
          <article className={summary.exposedValue > 0 ? 'is-alert' : undefined}><span>Valeur exposée · sous P2</span><strong>{euro.format(summary.exposedValue)}</strong><small>Décote documentaire possible, non mesurée</small></article>
          <article><span>Lignes éligibles</span><strong>{summary.eligibleLineCount}</strong><small>{summary.excludedLines.length} ligne(s) exclue(s) et signalée(s)</small></article>
        </div>
        <div className="registry-documentation__distribution" aria-label="Répartition des Cartulaires par palier">{TIERS.map((tier) => <div key={tier}><span>{tier}</span><strong>{summary.distributionByTier[tier]}</strong></div>)}<div><span>Sous P0</span><strong>{summary.belowP0Count}</strong></div></div>
        <div className="registry-documentation__actions"><h3>Top actions · gratuit et décisif d’abord</h3>{summary.priorityActions.length > 0 ? <ol>{summary.priorityActions.map((action, index) => <li key={`${action.cartularyId}:${action.criterionId}`}><span>{String(index + 1).padStart(2, '0')}</span><div><a href={buildCartularyHref(action.cartularyId, window.location.pathname, 'watch')}>{action.displayTitle}</a><strong>{action.action}</strong><small>{COST_LABELS[action.costCategory]} · preuve attendue : {action.expectedProof} · {action.gainMeasurementLabel}</small></div></li>)}</ol> : <p>Aucune action de palier prioritaire sur les lignes éligibles.</p>}</div>
        {summary.excludedLines.length > 0 && <details className="registry-documentation__excluded"><summary>Lignes exclues ({summary.excludedLines.length})</summary><ul>{summary.excludedLines.map((line) => <li key={line.cartularyId}><strong>{line.displayTitle}</strong><span>{line.reasons.join(' · ')}</span></li>)}</ul></details>}
        <p className="registry-dashboard-note">Historique : indisponible tant qu’aucune série de snapshots documentaires fiable n’existe. Effet sur la valeur : {summary.measurement.label}. Aucun gain monétaire n’est calculé.</p>
      </>}
    </section>
  );
}
