import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentationTierPanel } from '../../src/features/cartulary/components/DocumentationTierPanel.tsx';
import { DEMO_SUBMARINER_DOCUMENTATION_ASSESSMENT } from '../../src/data/demoDocumentationAssessment.ts';
import { observeDocumentationAssessment } from '../../src/services/documentationTier.ts';

const mocks = vi.hoisted(() => ({ value: null as any, error: null as Error | null }));

vi.mock('../../src/services/documentationTier.ts', () => ({
  observeDocumentationAssessment: vi.fn((_cartularyId: string, onAssessment: (value: any) => void, onError: (error: Error) => void) => {
    if (mocks.error) onError(mocks.error);
    else onAssessment(mocks.value);
    return () => undefined;
  }),
}));

const evaluated = {
  assessmentStatus: 'evaluated', documentationTier: 'P2', documentationTierName: 'Dossier tenu', nextTier: 'P3', nextTierName: 'Dossier daté',
  methodVersion: 'documentation-tier-watch@1.0.0', evaluatedAt: '2026-09-22T10:00:00.000Z', dataRevision: 7,
  measurement: { label: 'ordre de grandeur non mesuré' },
  satisfiedCriteria: [{ criterionId: 'piece_identity', label: 'Identité de la pièce', evidenceRefs: [{ kind: 'cartulary_field', reference: 'cartularies/cart_watch/sections/identity:brand', sourceLabel: 'Fiche source' }] }],
  missingCriteria: [{ criterionId: 'dated_condition_report_dev03', tier: 'P3', label: 'Constat d’état daté issu de DEV-03', status: 'unavailable' }],
  actions: [{ criterionId: 'issued_seal', costCategory: 'free', action: 'Émettre un Sceau sur le périmètre documenté.', expectedProof: 'Sceau émis et relié à la révision.', dependencies: [], gainMeasurementLabel: 'gain non mesuré' }],
};

beforeEach(() => { mocks.value = evaluated; mocks.error = null; });

describe('palier documentaire du Cartulaire', () => {
  it('rend le palier, la méthode, les preuves, le manque suivant et une action sans gain inventé', async () => {
    render(<DocumentationTierPanel cartularyId="cart_watch" />);
    const region = await screen.findByRole('region', { name: 'Palier de complétude documentaire' });
    expect(region.textContent).toContain('P2');
    expect(region.textContent).toContain('Dossier tenu');
    expect(region.textContent).not.toContain('documentation-tier-watch@1.0.0');
    expect(region.textContent).not.toContain('révision source 7');
    expect(region.textContent).toContain('Constat d’état daté');
    expect(region.textContent).not.toContain('DEV-03');
    expect(region.textContent).toContain('Émettre un Sceau');
    expect(region.textContent).toContain('gain non mesuré');
    const proofSummary = within(region).getByText('1 référence(s)');
    expect(proofSummary.closest('details')?.textContent).toContain('cartularies/cart_watch/sections/identity:brand');
  });

  it('traite l’absence d’ancien document comme non évaluée, jamais comme P0', async () => {
    mocks.value = null;
    render(<DocumentationTierPanel cartularyId="cart_legacy" />);
    expect(await screen.findByText(/n’a pas encore été évalué/)).toBeTruthy();
    expect(screen.queryByText('Dossier minimal viable')).toBeNull();
  });

  it('rend l’évaluation fictive locale sans ouvrir d’écoute Firestore', () => {
    vi.mocked(observeDocumentationAssessment).mockClear();
    render(<DocumentationTierPanel cartularyId="cart_demo_rolex_submariner_124060" isDemo assessmentOverride={DEMO_SUBMARINER_DOCUMENTATION_ASSESSMENT} />);
    expect(screen.getByText('P2')).toBeTruthy();
    expect(screen.getByText('Dossier tenu')).toBeTruthy();
    expect(screen.getByText(/Émettre un Sceau/)).toBeTruthy();
    expect(observeDocumentationAssessment).not.toHaveBeenCalled();
    expect(screen.getByText('Exemple de démonstration')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/DEV-0[34]|cartularies\//);
  });
});
