import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCartularyFollowUp } from '../../src/features/cartulary/state/useCartularyFollowUp.ts';

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  callbacks: [] as Array<(todos: any[], metadata?: { hasPendingWrites: boolean; fromCache: boolean }) => void>,
  remote: [] as any[],
  sync: vi.fn(),
  remove: vi.fn(),
  persist: vi.fn(async (key: string, value: unknown) => {
    mocks.storage.set(key, JSON.stringify(value));
  }),
}));

vi.mock('../../src/persistence/localVault.ts', () => ({
  readCartulariaStorage: (key: string) => mocks.storage.get(key) ?? null,
  persistCartulariaJson: (key: string, value: unknown) => mocks.persist(key, value),
}));

vi.mock('../../src/services/followUp.ts', () => ({
  syncCartularyFollowUpTodo: (...args: unknown[]) => mocks.sync(...args),
  deleteCartularyFollowUpTodo: (...args: unknown[]) => mocks.remove(...args),
  observeCartularyFollowUpTodos: (_cartularyId: string, onData: (todos: any[], metadata?: { hasPendingWrites: boolean; fromCache: boolean }) => void) => {
    mocks.callbacks.push(onData);
    onData(mocks.remote, { hasPendingWrites: false, fromCache: false });
    return () => undefined;
  },
}));

const CARTULARY_ID = 'cart_test';
const OPERATIONS_KEY = 'cartularia-todos-operations-v2';
const existingTodo = {
  id: 'todo-existing',
  text: 'Contrôler le dossier',
  dueAt: '2027-03-08',
  category: 'maintenance',
  status: 'planned',
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};

const pendingOperations = () => JSON.parse(mocks.storage.get(OPERATIONS_KEY) || '[]') as Array<{
  operationId: string;
  todoId: string;
  kind: string;
  todo?: typeof existingTodo;
}>;

function Harness() {
  const followUp = useCartularyFollowUp({ cartularyId: CARTULARY_ID, language: 'FR' });
  const first = followUp.todos[0];
  return <div>
    <button type="button" onClick={() => followUp.addTodo({ text: 'Nouvelle tâche', dueAt: '2027-04-02', category: 'custom' })}>Ajouter</button>
    <button type="button" disabled={!first} onClick={() => first && followUp.updateTodo(first.id, { text: 'Version modifiée' })}>Modifier</button>
    <button type="button" disabled={!first} onClick={() => first && followUp.updateTodo(first.id, { text: 'Version finale' })}>Modifier encore</button>
    <button type="button" disabled={!first} onClick={() => first && followUp.removeTodo(first.id)}>Supprimer</button>
    <output>{followUp.todos.map((todo) => todo.text).join('|')}</output>
    {followUp.syncError && <p role="alert">{followUp.syncError}</p>}
  </div>;
}

beforeEach(() => {
  mocks.storage.clear();
  mocks.storage.set('cartularia-todos-remote-migrated-v1', 'true');
  mocks.callbacks.length = 0;
  mocks.remote = [];
  mocks.sync.mockReset();
  mocks.remove.mockReset();
  mocks.persist.mockClear();
});

describe('file durable des tâches du Cartulaire', () => {
  it('n’acquitte pas un écho local et rejoue l’opération après fermeture puis réouverture', async () => {
    const interrupted = deferred();
    mocks.sync.mockImplementationOnce(() => interrupted.promise).mockResolvedValueOnce(undefined);
    const firstOpening = render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    const [operation] = pendingOperations();
    expect(operation.kind).toBe('upsert');

    mocks.callbacks[0]([operation.todo], { hasPendingWrites: true, fromCache: true });
    expect(pendingOperations().map((item) => item.operationId)).toEqual([operation.operationId]);

    firstOpening.unmount();
    render(<Harness />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pendingOperations()).toEqual([]));
    expect(screen.getByText('Nouvelle tâche')).toBeTruthy();

    interrupted.resolve();
  });

  it('rejoue aussi une suppression interrompue sans faire réapparaître la tâche', async () => {
    mocks.remote = [existingTodo];
    const interrupted = deferred();
    mocks.remove.mockImplementationOnce(() => interrupted.promise).mockResolvedValueOnce(undefined);
    const firstOpening = render(<Harness />);
    await screen.findByText('Contrôler le dossier');

    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    expect(pendingOperations()[0]?.kind).toBe('delete');
    expect(screen.queryByText('Contrôler le dossier')).toBeNull();

    firstOpening.unmount();
    render(<Harness />);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pendingOperations()).toEqual([]));
    expect(screen.queryByText('Contrôler le dossier')).toBeNull();
    interrupted.resolve();
  });

  it('conserve l’opération et l’état optimiste après un refus de permission', async () => {
    mocks.sync.mockRejectedValue(new Error('permission-denied'));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));

    expect(await screen.findByText('Nouvelle tâche')).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain('reste à synchroniser');
    expect(pendingOperations()).toHaveLength(1);
  });

  it('reprend la file au retour du réseau', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mocks.sync.mockResolvedValue(undefined);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
    await waitFor(() => expect(pendingOperations()).toHaveLength(1));
    expect(mocks.sync).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pendingOperations()).toEqual([]));
  });

  it('préserve une édition plus récente pendant le rejeu et attend l’acquittement exact précédent', async () => {
    mocks.remote = [existingTodo];
    const firstResponse = deferred();
    mocks.sync.mockImplementationOnce(() => firstResponse.promise).mockResolvedValueOnce(undefined);
    render(<Harness />);
    await screen.findByText('Contrôler le dossier');

    fireEvent.click(screen.getByRole('button', { name: 'Modifier encore' }));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
    expect(pendingOperations()).toHaveLength(2);
    expect(mocks.sync).toHaveBeenCalledTimes(1);

    const secondOperationId = pendingOperations()[1].operationId;
    firstResponse.resolve();
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pendingOperations()).toEqual([]));
    const persistedQueues = mocks.persist.mock.calls
      .filter(([key]) => key === OPERATIONS_KEY)
      .map(([, value]) => value as Array<{ operationId: string }>);
    expect(persistedQueues.some((queue) => queue.length === 1 && queue[0].operationId === secondOperationId)).toBe(true);
  });
});
