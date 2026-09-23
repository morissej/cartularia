import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, LoaderCircle } from 'lucide-react';
import type { DocumentationAssessmentProjection, DocumentationCriterionStatus } from '../../../domain/projections.ts';
import { observeDocumentationAssessment } from '../../../services/documentationTier.ts';

const STATUS_LABELS: Record<DocumentationCriterionStatus, string> = {
  proven: 'Prouvé', missing: 'Manquant', unknown: 'Inconnu', unverified: 'Non vérifié', unavailable: 'Dépendance indisponible',
};
const COST_LABELS = { free: 'Gratuit', time: 'Temps', service: 'Prestation' } as const;
const formatAssessmentDate = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(date) : value;
};

export function DocumentationTierPanel({
  cartularyId,
  assessmentOverride,
}: {
  cartularyId: string;
  assessmentOverride?: DocumentationAssessmentProjection;
}) {
  const [assessment, setAssessment] = useState<DocumentationAssessmentProjection | null>(assessmentOverride ?? null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(assessmentOverride ? 'ready' : 'loading');

  useEffect(() => {
    if (assessmentOverride) {
      setAssessment(assessmentOverride);
      setState('ready');
      return undefined;
    }
    setState('loading');
    return observeDocumentationAssessment(cartularyId, (next) => {
      setAssessment(next);
      setState('ready');
    }, () => {
      setAssessment(null);
      setState('error');
    });
  }, [assessmentOverride, cartularyId]);

  return (
    <section className="documentation-tier" aria-labelledby="documentation-tier-title">
      <header className="documentation-tier__header">
        <div><span className="eyebrow">DEV‑10 · Secret</span><h2 id="documentation-tier-title">Palier de complétude documentaire</h2><p>Une lecture de la preuve disponible, distincte du niveau de revue du Cartulaire.</p></div>
        <ClipboardCheck aria-hidden="true" />
      </header>
      {state === 'loading' && <p className="documentation-tier__state" role="status"><LoaderCircle className="documentation-tier__spinner" aria-hidden="true" />Évaluation documentaire en cours de chargement…</p>}
      {state === 'error' && <p className="documentation-tier__state documentation-tier__state--alert" role="alert"><AlertTriangle aria-hidden="true" />Évaluation Secret indisponible avec les droits actuels.</p>}
      {state === 'ready' && !assessment && <p className="documentation-tier__state">Non évalué : aucune évaluation serveur n’existe encore. L’absence de donnée ne vaut jamais P0.</p>}
      {assessment?.assessmentStatus === 'not_configured' && <p className="documentation-tier__state">Profil vertical non configuré pour ce type d’actif. Le noyau reste multi‑actifs ; seul le profil horloger est actif à ce stade.</p>}
      {assessment?.assessmentStatus === 'not_evaluated' && <p className="documentation-tier__state">Non évalué : les preuves autoritaires n’ont pas encore été analysées. Aucun palier n’est attribué.</p>}
      {assessment?.assessmentStatus === 'evaluated' && (
        <>
          <p className="documentation-tier__method">Méthode {assessment.methodVersion} · calcul serveur du {formatAssessmentDate(assessment.evaluatedAt)} · révision source {assessment.dataRevision}</p>
          <div className="documentation-tier__facts">
            <article><span>Palier atteint</span><strong>{assessment.documentationTier ?? 'Aucun'}</strong><small>{assessment.documentationTierName ?? 'P0 non atteint'}</small></article>
            <article><span>Prochain palier</span><strong>{assessment.nextTier ?? '—'}</strong><small>{assessment.nextTierName ?? 'Dossier au palier maximal'}</small></article>
            <article><span>Effet défendable</span><strong>Non mesuré</strong><small>{assessment.measurement.label}</small></article>
          </div>
          <div className="documentation-tier__columns">
            <div><h3><CheckCircle2 aria-hidden="true" />Preuves retenues</h3><ul>{assessment.satisfiedCriteria.map((criterion) => <li key={criterion.criterionId}><span>{criterion.label}</span><details><summary>{criterion.evidenceRefs.length} référence(s)</summary><ul className="documentation-tier__evidence">{criterion.evidenceRefs.map((reference) => <li key={`${reference.kind}:${reference.reference}`}><span>{reference.sourceLabel || reference.kind}</span><code>{reference.reference}</code></li>)}</ul></details></li>)}</ul>{assessment.satisfiedCriteria.length === 0 && <p>Aucun critère prouvé.</p>}</div>
            <div><h3>Manques vers {assessment.nextTier ?? 'le prochain palier'}</h3><ul>{assessment.missingCriteria.filter((criterion) => !assessment.nextTier || criterion.tier === assessment.nextTier).map((criterion) => <li key={criterion.criterionId}><span>{criterion.label}</span><small>{STATUS_LABELS[criterion.status]}</small></li>)}</ul>{assessment.nextTier === null && <p>Aucun manque vers un palier supérieur.</p>}</div>
          </div>
          {assessment.actions.length > 0 && <div className="documentation-tier__actions"><h3>Actions prioritaires · gratuit et décisif d’abord</h3><ol>{assessment.actions.map((action) => <li key={action.criterionId}><span className={`documentation-tier__cost documentation-tier__cost--${action.costCategory}`}>{COST_LABELS[action.costCategory]}</span><div><strong>{action.action}</strong><p>Preuve attendue : {action.expectedProof}</p><small>{action.gainMeasurementLabel}{action.dependencies.length > 0 ? ` · Dépendance : ${action.dependencies.join(' · ')}` : ''}</small></div></li>)}</ol></div>}
          <p className="documentation-tier__note">Cette lecture rend explicites la valeur défendue et la décote évitée par les preuves réunies. Elle ne promet ni prime ni gain chiffré : {assessment.measurement.label}.</p>
        </>
      )}
    </section>
  );
}
