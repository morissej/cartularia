import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BarreDossier } from '../../src/components/BarreDossier.tsx';
import { CartularyTodoBoard } from '../../src/components/CartularyTodoBoard.tsx';
import { useCartularyFollowUp } from '../../src/features/cartulary/state/useCartularyFollowUp.ts';

vi.mock('../../src/persistence/localVault.ts', () => ({
  readCartulariaStorage: vi.fn((key: string) => key === 'cartularia-todos-remote-migrated-v1' ? 'true' : null),
  persistCartulariaJson: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/services/followUp.ts', () => ({
  createCartularyFollowUpTodo: vi.fn(() => Promise.resolve()),
  updateCartularyFollowUpTodo: vi.fn(() => Promise.resolve()),
  deleteCartularyFollowUpTodo: vi.fn(() => Promise.resolve()),
  observeCartularyFollowUpTodos: vi.fn((_cartularyId: string, onData: (todos: unknown[]) => void) => {
    onData([]);
    return () => undefined;
  }),
}));

const Harness = () => {
  const followUp = useCartularyFollowUp({ cartularyId: 'cart_test', language: 'FR' });
  return <>
    <BarreDossier publicCode="TEST-1" brand="Objet" model="Test" language="FR" setLanguage={() => undefined} followUp={followUp} />
    <CartularyTodoBoard followUp={followUp} language="FR" />
  </>;
};

describe('coordination de la liste À Faire', () => {
  it('répercute ajout, modification et suppression entre l’Accueil et le bandeau', async () => {
    render(<Harness />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Nouvelle tâche ou rappel' }), { target: { value: 'Contrôler le dossier' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    expect(screen.getByRole('button', { name: /A Faire.*1 tâche/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Modifier : Contrôler le dossier' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Modifier la tâche' }), { target: { value: 'Contrôler le dossier complet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    fireEvent.click(screen.getByRole('button', { name: /A Faire.*1 tâche/ }));
    const headerPanel = screen.getByLabelText('À Faire du Cartulaire');
    expect(within(headerPanel).getByText('Contrôler le dossier complet')).toBeTruthy();
    fireEvent.click(within(headerPanel).getByRole('button', { name: 'Fermer la liste' }));

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer : Contrôler le dossier complet' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Supprimer : Contrôler le dossier complet' })).toBeNull());
    expect(screen.getByRole('button', { name: 'A Faire' })).toBeTruthy();
  });
});
