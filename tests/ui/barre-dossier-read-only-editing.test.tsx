import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BarreDossier } from '../../src/components/BarreDossier.tsx';
import { CartularyTodoBoard } from '../../src/components/CartularyTodoBoard.tsx';
import type { CartularyFollowUpController } from '../../src/features/cartulary/state/useCartularyFollowUp.ts';

/**
 * V5 relecture (H5) : l'édition d'une tâche entamée dans le popover À faire se ferme quand `readOnly` bascule
 * à vrai (perte du droit de gérer : session verrouillée, D5 (a)). Aucun champ orphelin, aucune soumission
 * possible hors droit — même comportement que le tableau À faire et que le bloc en édition d'App.tsx.
 */

const followUp = (): CartularyFollowUpController => ({
  todos: [{ id: 'task-1', text: 'Contrôler la garantie', dueAt: '2027-03-08', category: 'maintenance', status: 'planned' }],
  syncError: '',
  addTodo: vi.fn(),
  updateTodo: vi.fn(),
  removeTodo: vi.fn(() => null),
  restoreTodo: vi.fn(),
});

const barProps = (controller: CartularyFollowUpController) => ({
  brand: 'Marque', model: 'Modèle', publicCode: 'OBJ-0001', language: 'FR' as const, followUp: controller, returnHref: '/registry',
});

describe('BarreDossier : édition d’une tâche entamée puis passage en lecture', () => {
  it('ferme le formulaire « Modifier la tâche » dès que readOnly devient vrai', () => {
    const controller = followUp();
    const props = barProps(controller);
    const view = render(<BarreDossier {...props} readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: /A Faire/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier : Contrôler la garantie' }));
    expect(screen.getByLabelText('Modifier la tâche')).toBeTruthy();

    view.rerender(<BarreDossier {...props} readOnly />);

    expect(screen.queryByLabelText('Modifier la tâche')).toBeNull();
    expect(screen.getByText('Lecture seule')).toBeTruthy();
    expect(screen.getByText('Contrôler la garantie')).toBeTruthy();
    expect(controller.updateTodo).not.toHaveBeenCalled();
  });

  it('une saisie en cours n’est pas reprise si le droit revient : l’édition repart du texte', () => {
    const controller = followUp();
    const props = barProps(controller);
    const view = render(<BarreDossier {...props} readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: /A Faire/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier : Contrôler la garantie' }));
    fireEvent.change(screen.getByLabelText('Modifier la tâche'), { target: { value: 'Texte modifié hors droit' } });

    view.rerender(<BarreDossier {...props} readOnly />);
    view.rerender(<BarreDossier {...props} readOnly={false} />);

    expect(screen.queryByLabelText('Modifier la tâche')).toBeNull();
    expect(screen.getByRole('button', { name: 'Modifier : Contrôler la garantie' })).toBeTruthy();
    expect(controller.updateTodo).not.toHaveBeenCalled();
  });

  it('témoin : le tableau À faire ferme lui aussi l’édition en lecture', () => {
    const controller = followUp();
    const view = render(<CartularyTodoBoard followUp={controller} language="FR" readOnly={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier : Contrôler la garantie' }));
    expect(screen.getByLabelText('Modifier la tâche')).toBeTruthy();
    view.rerender(<CartularyTodoBoard followUp={controller} language="FR" readOnly />);
    expect(screen.queryByLabelText('Modifier la tâche')).toBeNull();
  });
});
