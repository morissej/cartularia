import type {
  DocumentationAssessmentProjection,
  DocumentationCriterionResult,
  DocumentationTier,
} from '../domain/projections.ts';
import { DEMO_ACCOUNT, DEMO_SUBMARINER_CARTULARY_ID } from './demoCartularies.ts';

const EVALUATED_AT = '2026-09-22T10:00:00.000Z';

const DEFINITIONS: Array<{
  id: string;
  tier: DocumentationTier;
  label: string;
  expectedProof: string;
  dependencies: string[];
}> = [
  { id: 'piece_identity', tier: 'P0', label: 'Identité de la pièce', expectedProof: 'Identité renseignée et reliée à une preuve du Cartulaire.', dependencies: [] },
  { id: 'reference_photo', tier: 'P0', label: 'Photographie de référence', expectedProof: 'Photographie de référence horodatée et référencée.', dependencies: [] },
  { id: 'acquisition_proof', tier: 'P0', label: 'Preuve d’acquisition', expectedProof: 'Facture, acte ou justificatif d’acquisition référencé.', dependencies: [] },
  { id: 'serials_concordant', tier: 'P1', label: 'Numéros lus et concordants', expectedProof: 'Relevé des numéros et contrôle de concordance référencés.', dependencies: [] },
  { id: 'technical_sheet', tier: 'P1', label: 'Fiche technique', expectedProof: 'Fiche technique reliée à ses sources.', dependencies: [] },
  { id: 'photo_series_level_1', tier: 'P1', label: 'Série photo de niveau 1', expectedProof: 'Série photo qualifiée niveau 1 par le profil horloger.', dependencies: [] },
  { id: 'photo_series_level_2', tier: 'P2', label: 'Série photo de niveau 2', expectedProof: 'Série photo qualifiée niveau 2 par le profil horloger.', dependencies: [] },
  { id: 'associated_set_inventory', tier: 'P2', label: 'Ensemble associé inventorié', expectedProof: 'Inventaire complet ou manques explicitement déclarés.', dependencies: [] },
  { id: 'maintenance_history', tier: 'P2', label: 'Historique d’entretien', expectedProof: 'Interventions datées, décrites et reliées à leurs justificatifs.', dependencies: [] },
  { id: 'documented_cost_basis', tier: 'P2', label: 'Prix de revient documenté', expectedProof: 'Acquisition et dépenses datées reliées à leurs justificatifs.', dependencies: [] },
  { id: 'dated_condition_report_dev03', tier: 'P3', label: 'Constat d’état daté issu de DEV-03', expectedProof: 'Constat d’état daté, référencé et attribué à DEV-03.', dependencies: ['DEV-03'] },
  { id: 'dated_sourced_valuation_dev04', tier: 'P3', label: 'Évaluation datée et sourcée issue de DEV-04', expectedProof: 'Évaluation datée, sourcée et attribuée à DEV-04.', dependencies: ['DEV-04'] },
  { id: 'issued_seal', tier: 'P3', label: 'Sceau émis', expectedProof: 'Sceau émis, non révoqué et relié à la révision évaluée.', dependencies: [] },
  { id: 'independent_physical_control', tier: 'P4', label: 'Contrôle physique par un tiers indépendant sous mandat', expectedProof: 'Rapport de contrôle physique, mandat et identité du tiers indépendant.', dependencies: ['tiers indépendant'] },
  { id: 'professional_valuation', tier: 'P4', label: 'Évaluation établie par un professionnel', expectedProof: 'Évaluation professionnelle datée, sourcée et attribuée.', dependencies: ['professionnel'] },
];

const satisfiedIds = new Set(DEFINITIONS.filter(({ tier }) => ['P0', 'P1', 'P2'].includes(tier)).map(({ id }) => id));

const criteria: DocumentationCriterionResult[] = DEFINITIONS.map((definition, index) => {
  const satisfied = satisfiedIds.has(definition.id);
  return {
    criterionId: definition.id,
    tier: definition.tier,
    label: definition.label,
    status: satisfied ? 'proven' : definition.tier === 'P3' && definition.dependencies.length > 0 ? 'unavailable' : 'missing',
    satisfied,
    evidenceRefs: satisfied ? [{
      kind: 'fictitious_demo_evidence',
      reference: `demo:${DEMO_SUBMARINER_CARTULARY_ID}:${definition.id}`,
      revision: 1,
      observedAt: EVALUATED_AT,
      sourceLabel: 'Preuve fictive de démonstration',
    }] : [],
    expectedProof: definition.expectedProof,
    dependencies: definition.dependencies,
    criterionOrder: index,
    note: satisfied ? 'Donnée entièrement fictive réservée à la démonstration.' : 'Manque fictif de démonstration.',
  };
});

const satisfiedCriteria = criteria.filter(({ satisfied }) => satisfied);
const missingCriteria = criteria.filter(({ satisfied }) => !satisfied);

export const DEMO_SUBMARINER_DOCUMENTATION_ASSESSMENT: DocumentationAssessmentProjection = {
  schemaVersion: 'documentation-assessment@1.0.0',
  cartularyId: DEMO_SUBMARINER_CARTULARY_ID,
  organizationId: DEMO_ACCOUNT.organizationId,
  registryId: DEMO_ACCOUNT.registryId,
  collectionId: DEMO_ACCOUNT.collectionId,
  collectionIds: [DEMO_ACCOUNT.collectionId],
  assetType: 'watch',
  displayTitle: 'Rolex Submariner 124060 · démonstration fictive',
  assessmentStatus: 'evaluated',
  methodVersion: 'documentation-tier-watch@1.0.0',
  verticalProfile: 'watch',
  evaluatedAt: EVALUATED_AT,
  dataRevision: 1,
  visibility: 'secret',
  documentationTier: 'P2',
  documentationTierName: 'Dossier tenu',
  nextTier: 'P3',
  nextTierName: 'Dossier daté',
  criteria,
  satisfiedCriteria,
  missingCriteria,
  evidenceUsed: satisfiedCriteria.flatMap((criterion) => criterion.evidenceRefs.map((evidence) => ({ ...evidence, criterionId: criterion.criterionId }))),
  actions: [
    {
      cartularyId: DEMO_SUBMARINER_CARTULARY_ID, displayTitle: 'Rolex Submariner 124060 · démonstration fictive',
      collectionId: DEMO_ACCOUNT.collectionId, collectionIds: [DEMO_ACCOUNT.collectionId], targetTier: 'P3', targetTierName: 'Dossier daté',
      criterionId: 'issued_seal', missingCriterion: 'Sceau émis', action: 'Émettre un Sceau sur le périmètre documenté.',
      expectedProof: 'Sceau émis, non révoqué et relié à la révision évaluée.', costCategory: 'free', dependencies: [],
      priorityReason: 'Action gratuite requise pour le prochain palier.', gainMeasurementStatus: 'unmeasured', gainMeasurementLabel: 'gain non mesuré', priorityOrder: [0, 2, 12],
    },
    {
      cartularyId: DEMO_SUBMARINER_CARTULARY_ID, displayTitle: 'Rolex Submariner 124060 · démonstration fictive',
      collectionId: DEMO_ACCOUNT.collectionId, collectionIds: [DEMO_ACCOUNT.collectionId], targetTier: 'P3', targetTierName: 'Dossier daté',
      criterionId: 'dated_condition_report_dev03', missingCriterion: 'Constat d’état daté issu de DEV-03', action: 'Faire établir le constat d’état daté prévu par DEV-03.',
      expectedProof: 'Constat d’état daté, référencé et attribué à DEV-03.', costCategory: 'time', dependencies: ['DEV-03'],
      priorityReason: 'Dépendance requise pour le prochain palier.', gainMeasurementStatus: 'unmeasured', gainMeasurementLabel: 'gain non mesuré', priorityOrder: [1, 0, 10],
    },
    {
      cartularyId: DEMO_SUBMARINER_CARTULARY_ID, displayTitle: 'Rolex Submariner 124060 · démonstration fictive',
      collectionId: DEMO_ACCOUNT.collectionId, collectionIds: [DEMO_ACCOUNT.collectionId], targetTier: 'P3', targetTierName: 'Dossier daté',
      criterionId: 'dated_sourced_valuation_dev04', missingCriterion: 'Évaluation datée et sourcée issue de DEV-04', action: 'Faire établir l’évaluation datée et sourcée prévue par DEV-04.',
      expectedProof: 'Évaluation datée, sourcée et attribuée à DEV-04.', costCategory: 'time', dependencies: ['DEV-04'],
      priorityReason: 'Dépendance requise pour le prochain palier.', gainMeasurementStatus: 'unmeasured', gainMeasurementLabel: 'gain non mesuré', priorityOrder: [1, 1, 11],
    },
  ],
  warnings: ['Palier, preuves et actions entièrement fictifs.'],
  measurement: {
    status: 'unmeasured', label: 'ordre de grandeur non mesuré', monetaryGain: null, measuredCoefficient: null,
    h3Model: { activationStatus: 'inactive', modelVersion: null, source: null, sourceRightToUse: null, studiedSegment: null, sampleSize: null, coefficient: null, confidenceInterval: null, measuredAt: null },
  },
  contentHash: `sha256:${'d'.repeat(64)}`,
  projectionStatus: 'active',
};
