import { useEffect, useState } from 'react';
import { AlertTriangle, BookCheck, LoaderCircle } from 'lucide-react';
import type { MembershipDocument, RegistryDocument } from '../../domain/foundations.ts';
import type { RegistryDocumentationSummary as Summary } from '../../domain/projections.ts';
import { requestRegistryDocumentationSummary } from '../../services/documentationTier.ts';
import { DOCUMENTATION_LEVEL_LABELS, DOCUMENTATION_CRITERION_COPY, valuationExclusionLabel } from '../../domain/documentationPresentation.ts';
import { buildCartularyHref } from './registryCatalog.ts';

const COST_LABELS = { free: 'Gratuit', time: 'Temps à prévoir', service: 'Prestation' } as const;
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
      <header className="registry-documentation__header"><div><span className="registry-step">Justificatifs</span><h2 id="registry-documentation-title">État des documents</h2><p>Vue d’ensemble des valeurs et des justificatifs réunis pour les objets du Registre.</p></div><BookCheck aria-hidden="true" /></header>
      {state === 'loading' && <div className="registry-dashboard-loading" role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /><span>Préparation de la synthèse des documents…</span></div>}
      {state === 'error' && <div className="registry-dashboard-error" role="alert"><AlertTriangle aria-hidden="true" /><div><h3>Synthèse indisponible</h3><p>Les valeurs et les documents n’ont pas pu être rapprochés.</p></div></div>}
      {state === 'ready' && summary && <>
        <div className="registry-documentation__facts">
          <article><span>Valeur avec dossier tenu ou plus complet</span><strong>{euro.format(summary.securedValue)}</strong><small>Documents réunis, datés ou certifiés</small></article>
          <article className={summary.exposedValue > 0 ? 'is-alert' : undefined}><span>Valeur à documenter davantage</span><strong>{euro.format(summary.exposedValue)}</strong><small>Une variation est possible ; elle n’est pas mesurée</small></article>
          <article><span>Objets pris en compte</span><strong>{summary.eligibleLineCount}</strong><small>{summary.excludedLines.length} objet(s) non pris en compte</small></article>
        </div>
        <div className="registry-documentation__distribution" aria-label="Répartition des Cartulaires par niveau documentaire">{Object.entries(DOCUMENTATION_LEVEL_LABELS).map(([tier, label]) => <div key={tier}><span>{label}</span><strong>{summary.distributionByTier[tier as keyof typeof DOCUMENTATION_LEVEL_LABELS]}</strong></div>)}<div><span>Documents de base à réunir</span><strong>{summary.belowP0Count}</strong></div></div>
        <div className="registry-documentation__actions"><h3>À compléter en priorité</h3>{summary.priorityActions.length > 0 ? <ol>{summary.priorityActions.map((action, index) => <li key={`${action.cartularyId}:${action.criterionId}`}><span>{String(index + 1).padStart(2, '0')}</span><div><a href={buildCartularyHref(action.cartularyId, window.location.pathname, 'watch')}>{action.displayTitle}</a><strong>{DOCUMENTATION_CRITERION_COPY[action.criterionId]?.action ?? action.action}</strong><small>{COST_LABELS[action.costCategory]} · justificatif attendu : {DOCUMENTATION_CRITERION_COPY[action.criterionId]?.expectedProof ?? action.expectedProof} · effet non mesuré</small></div></li>)}</ol> : <p>Aucune action prioritaire pour les objets pris en compte.</p>}</div>
        {summary.excludedLines.length > 0 && <details className="registry-documentation__excluded"><summary>Objets non pris en compte ({summary.excludedLines.length})</summary><ul>{summary.excludedLines.map((line) => <li key={line.cartularyId}><strong>{line.displayTitle}</strong><span>{line.reasons.map(valuationExclusionLabel).join(' · ')}</span></li>)}</ul></details>}
        <p className="registry-dashboard-note">Historique indisponible tant qu’aucune série fiable de relevés n’existe. L’effet sur la valeur n’a pas été mesuré ; aucun gain monétaire n’est calculé.</p>
      </>}
    </section>
  );
}
