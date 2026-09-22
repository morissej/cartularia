import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentationTierPanel } from '../../src/features/cartulary/components/DocumentationTierPanel.tsx';

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
    expect(region.textContent).toContain('documentation-tier-watch@1.0.0');
    expect(region.textContent).toContain('révision source 7');
    expect(region.textContent).toContain('Constat d’état daté issu de DEV-03');
    expect(region.textContent).toContain('Émettre un Sceau');
    expect(region.textContent).toContain('gain non mesuré');
    const proofSummary = within(region).getByText('1 référence(s)');
    expect(proofSummary.closest('details')?.textContent).toContain('cartularies/cart_watch/sections/identity:brand');
  });

  it('traite l’absence d’ancien document comme non évaluée, jamais comme P0', async () => {
    mocks.value = null;
    render(<DocumentationTierPanel cartularyId="cart_legacy" />);
    expect(await screen.findByText(/L’absence de donnée ne vaut jamais P0/)).toBeTruthy();
    expect(screen.queryByText('Dossier minimal viable')).toBeNull();
  });
});
