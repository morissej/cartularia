import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCartularyFollowUp } from '../../src/features/cartulary/state/useCartularyFollowUp';

const mocks = vi.hoisted(() => ({ read: vi.fn(), persist: vi.fn(), observe: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('../../src/persistence/localVault.ts', () => ({ readCartulariaStorage: mocks.read, persistCartulariaJson: mocks.persist }));
vi.mock('../../src/services/followUp.ts', () => ({ observeCartularyFollowUpTodos: mocks.observe, createCartularyFollowUpTodo: mocks.create, updateCartularyFollowUpTodo: mocks.update, deleteCartularyFollowUpTodo: mocks.remove }));

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
});
