import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GenericCartularyPrintSummary } from '../../src/components/GenericCartularyPrintSummary';
import { CAR_SCHEMA } from '../../src/schema/carSchema';
import type { PrivateCartularySnapshot } from '../../src/services/cartularies';

const value = (content: string) => ({ value: content, visibility: 'secret', proofStatus: 'declared' });
const snapshot = { envelope: { publicCode: 'OBJ-00001', displayTitle: 'Voiture de test', revision: 3, integrityHead: 'sha256:trace' }, sections: [
  { id: 'cover', schemaSectionId: 'cover.car', title: 'Identité', fields: { 'cover.car.maker': value('Constructeur test') } },
  { id: 'private', schemaSectionId: 'identity.private', title: 'Identité confidentielle', fields: { 'identity.car.vin': value('VIN-PRIVE-TEST') } },
] } as unknown as PrivateCartularySnapshot;
it('la synthèse exige pages et confirmation ; elle ne promet jamais un PDF enregistré', () => {
  window.print = vi.fn();
  render(<GenericCartularyPrintSummary snapshot={snapshot} schema={CAR_SCHEMA} assets={[]} />);
  const button = screen.getByRole('button', { name: 'Imprimer / Enregistrer en PDF' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('00 · Accueil'));
  expect(button.disabled).toBe(true);
  expect(document.querySelector('.generic-print-summary')?.textContent).toContain('Constructeur test');
  expect(document.querySelector('.generic-print-summary')?.textContent).not.toContain('VIN-PRIVE-TEST');
  fireEvent.click(screen.getByLabelText(/Je confirme que cette synthèse/));
  fireEvent.click(button);
  expect(window.print).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toContain('ne peut pas confirmer l’enregistrement');
  fireEvent.click(screen.getByLabelText('03 · L’objet'));
  expect(button.disabled).toBe(true);
  expect(document.querySelector('.generic-print-summary')?.textContent).toContain('VIN-PRIVE-TEST');
});
