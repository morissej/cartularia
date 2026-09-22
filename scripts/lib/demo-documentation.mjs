import { buildDocumentationAssessment } from './documentation-tier-command.mjs';
import { sha256Digest } from './canonical-json.mjs';

const CRITERIA_BY_TIER = Object.freeze({
  P0: ['piece_identity', 'reference_photo', 'acquisition_proof'],
  P1: ['serials_concordant', 'technical_sheet', 'photo_series_level_1'],
  P2: ['photo_series_level_2', 'associated_set_inventory', 'maintenance_history', 'documented_cost_basis'],
  P3: ['dated_condition_report_dev03', 'dated_sourced_valuation_dev04', 'issued_seal'],
  P4: ['independent_physical_control', 'professional_valuation'],
});
const ORDERED_TIERS = ['P0', 'P1', 'P2', 'P3', 'P4'];

export const buildFictitiousDemoDocumentationAssessment = ({ cartulary, tier, evaluatedAt, dataRevision = 1 }) => {
  const targetIndex = ORDERED_TIERS.indexOf(tier);
  if (targetIndex < 0) throw new Error(`Palier de démonstration inconnu : ${tier}.`);
  const facts = {};
  for (const [tierId, criterionIds] of Object.entries(CRITERIA_BY_TIER)) {
    const proven = ORDERED_TIERS.indexOf(tierId) <= targetIndex;
    for (const criterionId of criterionIds) {
      facts[criterionId] = proven ? {
        status: 'proven',
        evidenceRefs: [{
          kind: 'fictitious_demo_evidence',
          reference: `demo:${cartulary.id}:${criterionId}`,
          revision: dataRevision,
          observedAt: evaluatedAt,
          sourceLabel: 'Preuve fictive de démonstration',
        }],
        note: 'Donnée entièrement fictive réservée à la démonstration.',
      } : {
        status: ['dated_condition_report_dev03', 'dated_sourced_valuation_dev04'].includes(criterionId) ? 'unavailable' : 'missing',
        evidenceRefs: [],
        note: 'Manque fictif de démonstration.',
      };
    }
  }
  const assessment = buildDocumentationAssessment({ cartulary, facts, evaluatedAt, dataRevision });
  const { contentHash: _contentHash, ...assessmentPayload } = assessment;
  const result = {
    ...assessmentPayload,
    projectionStatus: 'active',
    demo: true,
    demoDisclaimer: 'Palier, preuves et actions entièrement fictifs.',
  };
  return { ...result, contentHash: sha256Digest(result) };
};
