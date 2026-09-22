import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GenericSchemaPageSections } from '../../src/components/GenericSchemaPageSections';
import { useGenericSectionEdits } from '../../src/features/cartulary/state/useGenericSectionEdits';
import { CAR_SCHEMA } from '../../src/schema/carSchema';
import { WATCH_SCHEMA } from '../../src/schema/watchSchema';
import type { CartularySectionDocument } from '../../src/domain/cartulary';
import type { VerticalSchema } from '../../src/schema/schemaTypes';
import type { CartularyPage } from '../../src/utils/interfaceState';
import type { CartularyReviewState } from '../../scripts/lib/cartulary-review-policy.mjs';

const powertrain = { id: 'technical.powertrain', schemaSectionId: 'technical.powertrain', schemaVersion: 'car@1.2.0', title: 'Moteur', visibility: 'secret', status: 'imported_unreviewed', revision: 1, fields: { 'technical.engine.architecture': { value: 'V8', proofStatus: 'declared', visibility: 'secret' } } } as unknown as CartularySectionDocument;
const specifications = { id: 'watch.reference', schemaSectionId: 'reference.specifications', schemaVersion: 'watch@1.6.0', title: 'Spécifications', visibility: 'secret', status: 'imported_unreviewed', revision: 1, fields: {} } as unknown as CartularySectionDocument;

function Harness({ page, sections, schema, canManage = false, onSave, review }: { page: CartularyPage; sections: CartularySectionDocument[]; schema: VerticalSchema; canManage?: boolean; onSave?: (edits: Array<{ fieldId: string; value: unknown }>) => Promise<void>; review?: CartularyReviewState | null }) {
  const edits = useGenericSectionEdits({ schema, onSave, canManage });
  return <GenericSchemaPageSections page={page} sections={sections} schema={schema} edits={edits} canManage={canManage} review={review} />;
}

it('une section d’une autre verticale est rendue sur la page que le contrat lui attribue', () => {
  const { container } = render(<Harness page="reference" sections={[powertrain]} schema={CAR_SCHEMA} />);
  expect(screen.getByRole('heading', { name: 'Moteur et transmission' })).toBeTruthy();
  expect(container.textContent).toContain('V8');
  expect(screen.queryByRole('button', { name: 'Modifier les informations' })).toBeNull();
});

it('les sections déjà rendues par un bloc spécialisé ne sont pas répétées : un Cartulaire montre garde sa présentation', () => {
  const { container } = render(<Harness page="reference" sections={[specifications]} schema={WATCH_SCHEMA} />);
  expect(container.innerHTML).toBe('');
});

it('rien ne s’affiche sans schéma chargé', () => {
  const { container } = render(<GenericSchemaPageSections page="value" sections={[powertrain]} schema={null} edits={{ editing: false, edits: {}, saving: false, notice: '', error: '', hasEdits: false, start: () => {}, change: () => {}, reset: () => {}, save: async () => {}, clearMessages: () => {} }} canManage />);
  expect(container.innerHTML).toBe('');
});

it('le propriétaire édite une section générique et n’envoie que les champs changés', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<Harness page="reference" sections={[powertrain]} schema={CAR_SCHEMA} canManage onSave={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier les informations' }));
  fireEvent.change(screen.getByLabelText(/Architecture moteur/), { target: { value: 'V12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith([{ fieldId: 'technical.engine.architecture', value: 'V12' }]));
  await screen.findByText(/Modifications enregistrées/);
});

// V5 point 4 (P-C5, lot B, § 5.11) : le badge « Déclarations à vérifier » dérive de l'état réel de revue ;
// il n'apparaît jamais sans état (démonstration, chargement) et disparaît une fois le Cartulaire revu.
it('sans état de revue, aucune section ne porte de badge', () => {
  const { container } = render(<Harness page="reference" sections={[powertrain]} schema={CAR_SCHEMA} />);
  expect(container.querySelector('.generic-section')).toBeTruthy();
  expect(container.querySelector('.generic-section__status')).toBeNull();
  expect(container.textContent).not.toContain('Déclarations à vérifier');
});

it('un Cartulaire non revu porte le badge « Déclarations à vérifier » sur chaque section générique', () => {
  const { container } = render(<Harness page="reference" sections={[powertrain]} schema={CAR_SCHEMA} review={{ kind: 'pending', actionable: true }} />);
  const badges = container.querySelectorAll('.generic-section__status');
  expect(badges.length).toBe(1);
  expect(badges[0].textContent).toBe('Déclarations à vérifier');
});

it('une fois revu, le badge disparaît sans changer le reste de la section', () => {
  const { container } = render(<Harness page="reference" sections={[powertrain]} schema={CAR_SCHEMA} review={{ kind: 'reviewed', reviewedAt: '2026-09-15T10:00:00.000Z', level: 'partial', actionable: true }} />);
  expect(container.querySelector('.generic-section__status')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Moteur et transmission' })).toBeTruthy();
  expect(container.textContent).toContain('V8');
});
