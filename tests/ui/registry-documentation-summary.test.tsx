import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RegistryDocumentationSummary } from '../../src/features/registry/RegistryDocumentationSummary.tsx';

vi.mock('../../src/services/documentationTier.ts', () => ({
  requestRegistryDocumentationSummary: vi.fn(async () => ({
    securedValue: 20_000, exposedValue: 10_000, eligibleLineCount: 2,
    excludedLines: [{ cartularyId: 'cart_excluded', displayTitle: 'Objet non évalué', reasons: ['documentation_not_evaluated'] }],
    distributionByTier: { P0: 0, P1: 1, P2: 1, P3: 0, P4: 0 }, belowP0Count: 0,
    priorityActions: [{ cartularyId: 'cart_p1', criterionId: 'photo_series_level_2', displayTitle: 'Montre pilote', costCategory: 'time', action: 'Compléter la série photo de niveau 2.', expectedProof: 'Série photo qualifiée niveau 2.', gainMeasurementLabel: 'gain non mesuré' }],
    measurement: { label: 'ordre de grandeur non mesuré' },
  })),
}));

const registry = { id: 'reg_test', organizationId: 'org_test', name: 'Registre test', status: 'active' } as any;
const membership = { permissions: ['registry.read', 'valuation.read'] } as any;

describe('synthèse documentaire du Registre', () => {
  it('rend les libellés compréhensibles, la distribution, les exclusions et le top actions', async () => {
    render(<RegistryDocumentationSummary registry={registry} membership={membership} />);
    const region = await screen.findByRole('region', { name: 'État des documents' });
    expect(region.textContent).toContain('Valeur avec dossier tenu ou plus complet');
    expect(region.textContent).toContain('Valeur à documenter davantage');
    expect(region.textContent).toContain('Dossier certifié');
    expect(region.textContent).toContain('Documents de base à réunir');
    expect(region.textContent).not.toMatch(/DEV|P[0-4]/);
    expect(region.textContent).toContain('Montre pilote');
    expect(region.textContent).toContain('effet non mesuré');
    expect(region.textContent).toContain('Objets non pris en compte (1)');
    expect(region.textContent).toContain('Documents pas encore évalués');
    expect(region.textContent).toContain('Historique indisponible');
    expect(region.textContent).toContain('L’effet sur la valeur n’a pas été mesuré');
  });
});
