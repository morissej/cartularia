import { AlertTriangle, Landmark, LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { RegistryDocument } from '../../domain/foundations.ts';
import type { RegistryItemProjection } from '../../domain/projections.ts';
import { CURRENT_VALUATION_ISSUE_LABELS } from '../../domain/currentRegistryValuation.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { useCurrentRegistryValuation } from './useCurrentRegistryValuation.ts';

export function RegistryCurrentValuationSummary({ registry, items, inventoryState, allowed }: {
  registry: RegistryDocument;
  items: RegistryItemProjection[];
  inventoryState: 'loading' | 'ready' | 'error';
  allowed: boolean;
}) {
  const [attempt, setAttempt] = useState(0);
  const { state, summary } = useCurrentRegistryValuation(registry.id, registry.referenceCurrency, items, inventoryState, allowed, attempt);
  if (!allowed) return null;
  const money = (amount: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: registry.referenceCurrency, maximumFractionDigits: 0 }).format(amount);
  return (
    <section className="registry-valuation" aria-labelledby="registry-current-valuation-title">
      <header className="registry-valuation__header">
        <div><span className="registry-step">Valeurs courantes · Secret</span><h2 id="registry-current-valuation-title">Valeur patrimoniale</h2><p>Somme des valeurs brutes retenues pour les objets du Registre, avant frais de vente et impôts.</p></div>
        <Landmark aria-hidden="true" />
      </header>
      {state === 'loading' && <p role="status"><LoaderCircle className="registry-spinner" aria-hidden="true" /> Chargement des valeurs courantes…</p>}
      {state === 'error' && <div className="registry-dashboard-error" role="alert"><AlertTriangle aria-hidden="true" /><p>Le total ne peut pas être confirmé. Les objets ou leurs valeurs sont indisponibles.</p><button type="button" onClick={() => setAttempt((current) => current + 1)}><RefreshCw aria-hidden="true" />Réessayer</button></div>}
      {summary && <>
        <div className="registry-current-valuation__facts" aria-label="Total patrimonial courant">
          <article><span>{summary.missingCount ? 'Valeur renseignée · total partiel' : 'Valeur patrimoniale courante'}</span><strong>{summary.total === null ? 'Non renseignée' : money(summary.total)}</strong><small>{summary.includedCount} objet(s) sur {summary.itemCount} inclus</small></article>
        </div>
        {summary.documentationIncompleteCount > 0 && <p className="registry-dashboard-note">{summary.documentationIncompleteCount} objet(s) inclus avec une documentation de valeur à compléter. Le montant connu reste comptabilisé.</p>}
        {summary.missingCount > 0 && <p className="registry-valuation__notice" role="status">{summary.missingCount} objet(s) sans valeur utilisable dans la devise du Registre. Le total est partiel ; ces objets ne sont pas évalués à zéro.</p>}
        {summary.itemCount > 0 && <div className="registry-valuation__table-wrap">
          <table className="registry-valuation__table registry-current-valuation__table">
            <caption className="sr-only">Valeur courante de chaque objet du Registre</caption>
            <thead><tr><th scope="col">Objet</th><th scope="col">Valeur brute retenue</th><th scope="col">État de la valeur</th></tr></thead>
            <tbody>{summary.lines.map((line) => <tr key={line.cartularyId}>
              <th scope="row"><a href={buildCartularyHref(line.cartularyId, window.location.pathname, line.assetType)}>{line.displayTitle}</a></th>
              <td>{line.issue || line.amount === null ? '—' : money(line.amount)}</td>
              <td>{line.issue ? CURRENT_VALUATION_ISSUE_LABELS[line.issue] : line.documentationIncomplete ? 'Incluse · documentation à compléter' : 'Incluse'}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        <p className="registry-dashboard-note">Chaque objet est compté une seule fois dans le Registre, même s’il appartient à plusieurs Collections. Les devises différentes ne sont pas converties.</p>
      </>}
    </section>
  );
}
