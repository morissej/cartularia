import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, LoaderCircle } from 'lucide-react';
import type { DocumentationAssessmentProjection, DocumentationCriterionStatus } from '../../../domain/projections.ts';
import { DOCUMENTATION_CRITERION_COPY as CRITERION_COPY, documentationLevelLabel } from '../../../domain/documentationPresentation.ts';
import { observeDocumentationAssessment } from '../../../services/documentationTier.ts';

const STATUS_LABELS: Record<DocumentationCriterionStatus, string> = {
  proven: 'Prouvé', missing: 'Manquant', unknown: 'Inconnu', unverified: 'Non vérifié', unavailable: 'Évaluation non disponible',
};
const COST_LABELS = { free: 'Gratuit', time: 'Temps', service: 'Prestation' } as const;
const formatAssessmentDate = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short' }).format(date) : value;
};

export function DocumentationTierPanel({
  cartularyId,
  assessmentOverride,
  isDemo = false,
}: {
  cartularyId: string;
  assessmentOverride?: DocumentationAssessmentProjection;
  isDemo?: boolean;
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
        <div><span className="eyebrow">{isDemo ? 'Exemple de démonstration' : 'Documents privés'}</span><h2 id="documentation-tier-title">Documents à compléter</h2><p>Consultez les justificatifs réunis et les prochaines pièces à ajouter à votre dossier.</p></div>
        <ClipboardCheck aria-hidden="true" />
      </header>
      {state === 'loading' && <p className="documentation-tier__state" role="status"><LoaderCircle className="documentation-tier__spinner" aria-hidden="true" />Évaluation documentaire en cours de chargement…</p>}
      {state === 'error' && <p className="documentation-tier__state documentation-tier__state--alert" role="alert"><AlertTriangle aria-hidden="true" />L’évaluation des documents n’est pas accessible avec vos droits actuels.</p>}
      {state === 'ready' && !assessment && <p className="documentation-tier__state">Votre dossier n’a pas encore été évalué. Aucun palier ne lui est attribué.</p>}
      {assessment?.assessmentStatus === 'not_configured' && <p className="documentation-tier__state">L’évaluation documentaire n’est pas encore disponible pour ce type d’objet.</p>}
      {assessment?.assessmentStatus === 'not_evaluated' && <p className="documentation-tier__state">Les documents de votre dossier n’ont pas encore été analysés. Aucun palier n’est attribué.</p>}
      {assessment?.assessmentStatus === 'evaluated' && (
        <>
          <p className="documentation-tier__method">{isDemo ? 'Exemple fictif : les documents essentiels sont réunis. Les actions ci-dessous montrent comment obtenir un dossier daté.' : `Évaluation du ${formatAssessmentDate(assessment.evaluatedAt)}`}</p>
          <div className="documentation-tier__facts">
            <article><span>Niveau actuel</span><strong>{documentationLevelLabel(assessment.documentationTier)}</strong><small>Selon les justificatifs disponibles</small></article>
            <article><span>Prochaine étape</span><strong>{assessment.nextTier ? documentationLevelLabel(assessment.nextTier) : 'Niveau maximal atteint'}</strong><small>Compléter les pièces indiquées ci-dessous</small></article>
            <article><span>Effet sur la valeur</span><strong>Non mesuré</strong><small>{assessment.measurement.label}</small></article>
          </div>
          <div className="documentation-tier__columns">
            <div><h3><CheckCircle2 aria-hidden="true" />Preuves retenues</h3><ul>{assessment.satisfiedCriteria.map((criterion) => <li key={criterion.criterionId}><span>{CRITERION_COPY[criterion.criterionId]?.label ?? criterion.label}</span><details><summary>{criterion.evidenceRefs.length} référence(s)</summary><ul className="documentation-tier__evidence">{criterion.evidenceRefs.map((reference) => <li key={`${reference.kind}:${reference.reference}`}><span>{reference.sourceLabel || reference.kind}</span>{!isDemo && <code>{reference.reference}</code>}</li>)}</ul></details></li>)}</ul>{assessment.satisfiedCriteria.length === 0 && <p>Aucun critère prouvé.</p>}</div>
            <div><h3>Pièces à ajouter{assessment.nextTier ? ` · ${documentationLevelLabel(assessment.nextTier)}` : ''}</h3><ul>{assessment.missingCriteria.filter((criterion) => !assessment.nextTier || criterion.tier === assessment.nextTier).map((criterion) => <li key={criterion.criterionId}><span>{CRITERION_COPY[criterion.criterionId]?.label ?? criterion.label}</span><small>{STATUS_LABELS[criterion.status]}</small></li>)}</ul>{assessment.nextTier === null && <p>Aucun manque vers un palier supérieur.</p>}</div>
          </div>
          {assessment.actions.length > 0 && <div className="documentation-tier__actions"><h3>À compléter en priorité</h3><ol>{assessment.actions.map((action) => <li key={action.criterionId}><span className={`documentation-tier__cost documentation-tier__cost--${action.costCategory}`}>{COST_LABELS[action.costCategory]}</span><div><strong>{CRITERION_COPY[action.criterionId]?.action ?? action.action}</strong><p>Preuve attendue : {CRITERION_COPY[action.criterionId]?.expectedProof ?? action.expectedProof}</p><small>{action.gainMeasurementLabel}</small></div></li>)}</ol></div>}
          <p className="documentation-tier__note">Ces niveaux décrivent les justificatifs réunis. Leur effet sur la valeur n’est pas mesuré ; ils ne garantissent aucun gain financier.</p>
        </>
      )}
    </section>
  );
}
