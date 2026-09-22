import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCartularyFollowUp } from '../../src/features/cartulary/state/useCartularyFollowUp';
import { BarreDossier } from '../../src/components/BarreDossier';
import { CartularyTodoBoard } from '../../src/components/CartularyTodoBoard';

const mocks = vi.hoisted(() => ({ read: vi.fn(), persist: vi.fn(), observe: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('../../src/persistence/localVault.ts', () => ({ readCartulariaStorage: mocks.read, persistCartulariaJson: mocks.persist }));
vi.mock('../../src/services/followUp.ts', () => ({ observeCartularyFollowUpTodos: mocks.observe, syncCartularyFollowUpTodo: mocks.create, deleteCartularyFollowUpTodo: mocks.remove }));

describe('Suivi de la démonstration anonyme', () => {
  it('ne lit aucun suivi privé, ne synchronise rien et ne montre pas une fausse panne', () => {
    const { result } = renderHook(() => useCartularyFollowUp({ cartularyId: 'demo-object', language: 'FR', readOnlyPreview: true }));
    expect(result.current.todos).toEqual([]);
    expect(result.current.syncError).toBe('');
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.observe).not.toHaveBeenCalled();
    act(() => {
      result.current.addTodo({ text: 'Interdit', dueAt: '', category: 'custom' });
      result.current.updateTodo('private-todo', { text: 'Interdit' });
      result.current.removeTodo('private-todo');
      result.current.restoreTodo({ item: { id: 'private-todo', text: 'Privé', dueAt: '', category: 'custom', status: 'planned' }, index: 0, remaining: [] });
    });
    expect(result.current.todos).toEqual([]);
    for (const fn of [mocks.persist, mocks.create, mocks.update, mocks.remove]) expect(fn).not.toHaveBeenCalled();
  });

  it('n’affiche aucun état de synchronisation sur l’Accueil démo, seulement la mention de lecture seule', () => {
    const { result } = renderHook(() => useCartularyFollowUp({ cartularyId: 'demo-object', language: 'FR', readOnlyPreview: true }));
    // V5 point 1 (2/2) : la lecture suit le droit de gérer ; la démo ne fournit que le texte (prop demonstration).
    const { container } = render(<CartularyTodoBoard followUp={result.current} language="FR" readOnly demonstration />);
    expect(container.querySelector('.todo-sync-error')).toBeNull();
    expect(screen.queryByText(/Synchronisation/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Démonstration en lecture seule')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// V5 point 1 (2/2, M1) : un lecteur non gérant ou hors session reçoit ses tâches en texte pur, sans le mot « démonstration »,
// et jamais l'état de synchronisation du hook (un lecteur ne synchronise rien).
describe('Suivi en lecture seule hors démonstration', () => {
  const task = { id: 'task-1', text: 'Contrôler la garantie', dueAt: '2027-03-08', category: 'maintenance', status: 'planned' as const };
  const doneTask = { id: 'task-2', text: 'Photographier le fond', dueAt: '', category: 'visual_evidence', status: 'completed' as const };

  const renderReadOnlyController = () => {
    mocks.read.mockReturnValue(null);
    mocks.persist.mockImplementation(() => Promise.resolve());
    mocks.observe.mockImplementation((_cartularyId: string, onData: (todos: unknown[]) => void, onError: (error: unknown) => void) => {
      onData([task, doneTask]);
      onError(new Error('permission-denied'));
      return () => undefined;
    });
    return renderHook(() => useCartularyFollowUp({ cartularyId: 'cart_owner', language: 'FR' }));
  };

  it('rend le tableau de l’Accueil en texte, sans contrôle ni message de synchronisation, malgré un hook en erreur', () => {
    const { result } = renderReadOnlyController();
    expect(result.current.syncError).toBe('Synchronisation momentanément indisponible.');
    expect(result.current.todos.map((todo) => todo.id)).toEqual(['task-1', 'task-2']);

    const { container } = render(<CartularyTodoBoard followUp={result.current} language="FR" readOnly />);
    expect(container.querySelector('.todo-sync-error')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Synchronisation/)).toBeNull();
    expect(screen.getByText('Lecture seule')).toBeTruthy();
    expect(screen.queryByText(/Démonstration|demonstration/)).toBeNull();
    expect(container.querySelector('button, input, select, textarea, form')).toBeNull();
    expect(screen.getByText('Contrôler la garantie')).toBeTruthy();
    expect(screen.getByText('Photographier le fond')).toBeTruthy();
    // Échéance et nature en texte ; état porté par un texte pour le lecteur d'écran.
    const rows = container.querySelectorAll('.cover-todo-board__list > li');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('2027-03-08').tagName).toBe('TIME');
    expect(within(rows[0] as HTMLElement).getByText('Entretien')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Planifiée').className).toBe('sr-only');
    expect(within(rows[1] as HTMLElement).getByText('Sans échéance')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Preuves visuelles')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Terminée').className).toBe('sr-only');
    expect((rows[1] as HTMLElement).className).toBe('is-completed');
    expect(container.querySelector('[aria-label]')).toBeNull();
  });

  it('rend le popover de la barre en texte : pastilles sans bouton, aucun message de synchronisation', () => {
    const { result } = renderReadOnlyController();
    render(<BarreDossier publicCode="TEST-1" brand="Objet" model="Test" language="FR" followUp={result.current} readOnly />);
    fireEvent.click(screen.getByRole('button', { name: /A Faire.*2 tâche/ }));
    const panel = screen.getByLabelText('À Faire du Cartulaire');
    expect(panel.querySelector('.todo-sync-error')).toBeNull();
    expect(within(panel).queryByRole('status')).toBeNull();
    expect(within(panel).getByText('Lecture seule')).toBeTruthy();
    expect(within(panel).queryByText(/Démonstration/)).toBeNull();
    expect(panel.querySelector('form, input, select')).toBeNull();
    // Seul bouton du popover : sa fermeture ; aucun geste sur les tâches.
    expect(within(panel).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Fermer la liste']);
    expect(within(panel).getByText('Contrôler la garantie')).toBeTruthy();
    expect(within(panel).getByText('Planifiée').className).toBe('sr-only');
    expect(within(panel).getByText('Terminée').className).toBe('sr-only');
    expect(panel.querySelectorAll('.todo-list__status')).toHaveLength(2);
    expect(panel.querySelector('button.todo-list__status')).toBeNull();
  });

  it('montre l’état de synchronisation à l’éditeur seulement', () => {
    const { result } = renderReadOnlyController();
    const { container } = render(<CartularyTodoBoard followUp={result.current} language="FR" />);
    expect(container.querySelector('.todo-sync-error')?.textContent).toBe('Synchronisation momentanément indisponible.');
    expect(screen.getByRole('button', { name: 'Terminer : Contrôler la garantie' })).toBeTruthy();
  });
});
