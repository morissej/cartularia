import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RegistryTodoBoard } from '../../src/features/registry/RegistryTodoBoard.tsx';
vi.mock('../../src/services/followUp.ts', () => ({ createCartularyFollowUpTodo: vi.fn(), deleteCartularyFollowUpTodo: vi.fn(), updateCartularyFollowUpTodo: vi.fn() }));
const items = [{ cartularyId: 'rolex', displayTitle: 'Rolex', projectionStatus: 'active' }, { cartularyId: 'iwc', displayTitle: 'IWC', projectionStatus: 'active' }] as any;
const todos = [{ id: 'i', cartularyId: 'iwc', displayTitle: 'IWC', title: 'Réviser IWC', dueAt: '2027-01-01', reminderStatus: 'planned', category: 'maintenance', assetType: 'watch' }, { id: 'r', cartularyId: 'rolex', displayTitle: 'Rolex', title: 'Documenter Rolex', dueAt: '2027-02-01', reminderStatus: 'planned', category: 'custom', assetType: 'watch' }] as any;
describe('Jam 30 : sélection du Cartulaire et liste des tâches', () => {
  it('filtre sans changer le dossier des tâches et permet de revenir à la liste globale', () => {
    render(<RegistryTodoBoard registryId="reg" items={items} todos={todos} canManage />);
    expect(screen.getByText('Réviser IWC')).toBeTruthy();
    expect(screen.getByText('Documenter Rolex')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Cartulaire' }), { target: { value: 'rolex' } });
    expect(screen.queryByText('Réviser IWC')).toBeNull();
    expect(screen.getByText('Documenter Rolex')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Cartulaire' }), { target: { value: '' } });
    expect(screen.getByText('Réviser IWC')).toBeTruthy();
    expect((screen.getByRole('button', { name: /Ajouter/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
