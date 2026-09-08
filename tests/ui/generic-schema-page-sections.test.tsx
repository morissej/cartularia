import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GenericSchemaPageSections } from '../../src/components/GenericSchemaPageSections';
import { useGenericSectionEdits } from '../../src/features/cartulary/state/useGenericSectionEdits';
import { CAR_SCHEMA } from '../../src/schema/carSchema';
import { WATCH_SCHEMA } from '../../src/schema/watchSchema';
import type { CartularySectionDocument } from '../../src/domain/cartulary';
import type { VerticalSchema } from '../../src/schema/schemaTypes';
import type { CartularyPage } from '../../src/utils/interfaceState';

const powertrain = { id: 'technical.powertrain', schemaSectionId: 'technical.powertrain', schemaVersion: 'car@1.2.0', title: 'Moteur', visibility: 'secret', status: 'imported_unreviewed', revision: 1, fields: { 'technical.engine.architecture': { value: 'V8', proofStatus: 'declared', visibility: 'secret' } } } as unknown as CartularySectionDocument;
const specifications = { id: 'watch.reference', schemaSectionId: 'reference.specifications', schemaVersion: 'watch@1.6.0', title: 'Spécifications', visibility: 'secret', status: 'imported_unreviewed', revision: 1, fields: {} } as unknown as CartularySectionDocument;

function Harness({ page, sections, schema, canManage = false, onSave }: { page: CartularyPage; sections: CartularySectionDocument[]; schema: VerticalSchema; canManage?: boolean; onSave?: (edits: Array<{ fieldId: string; value: unknown }>) => Promise<void> }) {
  const edits = useGenericSectionEdits({ schema, onSave, canManage });
  return <GenericSchemaPageSections page={page} sections={sections} schema={schema} edits={edits} canManage={canManage} />;
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
