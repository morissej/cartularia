import { useCallback, useEffect, useRef, useState } from 'react';
import {
  mergeCartularyFollowUpTodos,
  type CartularyFollowUpTodo,
  type FollowUpCategory,
} from '../../../domain/followUp.ts';
import { persistCartulariaJson, readCartulariaStorage } from '../../../persistence/localVault.ts';
import {
  createCartularyFollowUpTodo,
  deleteCartularyFollowUpTodo,
  observeCartularyFollowUpTodos,
  updateCartularyFollowUpTodo,
} from '../../../services/followUp.ts';
import { removeItemById, restoreItemAtIndex, type RemovedItem } from '../../../utils/undoableDeletion.ts';

const TODO_STORAGE_KEY = 'cartularia-todos';
const TODO_REMOTE_MIGRATION_KEY = 'cartularia-todos-remote-migrated-v1';
const TODO_PENDING_STORAGE_KEY = 'cartularia-todos-pending-v1';

const normalizeTodos = (value: unknown): CartularyFollowUpTodo[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => (
      typeof item === 'object'
      && item !== null
      && typeof (item as CartularyFollowUpTodo).id === 'string'
      && typeof (item as CartularyFollowUpTodo).text === 'string'
      && (item as CartularyFollowUpTodo).text.trim().length > 0
  )).map((item) => {
      const candidate = item as Partial<CartularyFollowUpTodo> & { id: string; text: string };
      return {
        id: candidate.id,
        text: candidate.text,
        dueAt: typeof candidate.dueAt === 'string' ? candidate.dueAt : '',
        category: ['insurance', 'visual_evidence', 'maintenance', 'custom'].includes(candidate.category || '') ? candidate.category as FollowUpCategory : 'custom',
        status: ['planned', 'active', 'completed', 'dismissed'].includes(candidate.status || '') ? candidate.status as CartularyFollowUpTodo['status'] : 'planned',
      };
  });
};

const readStoredTodos = (): CartularyFollowUpTodo[] => {
  try {
    const stored = readCartulariaStorage(TODO_STORAGE_KEY);
    return stored ? normalizeTodos(JSON.parse(stored) as unknown) : [];
  } catch {
    return [];
  }
};

const readStoredPendingTodos = (): { upserts: CartularyFollowUpTodo[]; deletes: string[] } => {
  try {
    const stored = readCartulariaStorage(TODO_PENDING_STORAGE_KEY);
    if (!stored) return { upserts: [], deletes: [] };
    const parsed = JSON.parse(stored) as { upserts?: unknown; deletes?: unknown };
    return {
      upserts: normalizeTodos(parsed.upserts),
      deletes: Array.isArray(parsed.deletes) ? parsed.deletes.filter((id): id is string => typeof id === 'string') : [],
    };
  } catch {
    return { upserts: [], deletes: [] };
  }
};

const createTodoId = () => `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export interface CartularyFollowUpController {
  todos: CartularyFollowUpTodo[];
  syncError: string;
  addTodo: (input: Pick<CartularyFollowUpTodo, 'text' | 'dueAt' | 'category'>) => void;
  updateTodo: (id: string, patch: Partial<Pick<CartularyFollowUpTodo, 'text' | 'dueAt' | 'category' | 'status'>>) => void;
  removeTodo: (id: string) => RemovedItem<CartularyFollowUpTodo> | null;
  restoreTodo: (removed: RemovedItem<CartularyFollowUpTodo>) => void;
}

export const useCartularyFollowUp = ({
  cartularyId,
  language,
}: {
  cartularyId: string;
  language: 'FR' | 'EN';
}): CartularyFollowUpController => {
  const [todos, setTodos] = useState<CartularyFollowUpTodo[]>(readStoredTodos);
  const [remoteHydrationComplete, setRemoteHydrationComplete] = useState(false);
  const [syncError, setSyncError] = useState('');
  const pendingUpsertsRef = useRef(new Map<string, CartularyFollowUpTodo>());
  const pendingDeletesRef = useRef(new Set<string>());
  const pendingLoadedRef = useRef(false);
  if (!pendingLoadedRef.current) {
    const pending = readStoredPendingTodos();
    pending.upserts.forEach((todo) => pendingUpsertsRef.current.set(todo.id, todo));
    pending.deletes.forEach((id) => pendingDeletesRef.current.add(id));
    pendingLoadedRef.current = true;
  }
  const isFrench = language === 'FR';

  const persistPendingTodos = useCallback(() => {
    void persistCartulariaJson(TODO_PENDING_STORAGE_KEY, {
      upserts: Array.from(pendingUpsertsRef.current.values()),
      deletes: Array.from(pendingDeletesRef.current.values()),
    }).catch((error: unknown) => console.error('Persistance des suivis en attente impossible', error));
  }, []);

  useEffect(() => {
    let active = true;
    let firstSnapshot = true;
    const localTodosAtStart = readStoredTodos();
    const shouldMigrateLocalTodos = readCartulariaStorage(TODO_REMOTE_MIGRATION_KEY) !== 'true';
    setRemoteHydrationComplete(false);
    setSyncError('');
    const unsubscribe = observeCartularyFollowUpTodos(cartularyId, (remoteTodos) => {
      if (!active) return;
      if (firstSnapshot) {
        firstSnapshot = false;
        if (!shouldMigrateLocalTodos) {
          const pendingUpserts = Array.from(pendingUpsertsRef.current.values());
          setTodos(mergeCartularyFollowUpTodos(remoteTodos, pendingUpserts).filter((todo) => !pendingDeletesRef.current.has(todo.id)));
          setRemoteHydrationComplete(true);
          return;
        }
        const remoteIds = new Set(remoteTodos.map((todo) => todo.id));
        const localTodosToMigrate = localTodosAtStart.filter((candidate) => !remoteIds.has(candidate.id));
        localTodosToMigrate.forEach((todo) => pendingUpsertsRef.current.set(todo.id, todo));
        persistPendingTodos();
        setTodos(mergeCartularyFollowUpTodos(remoteTodos, localTodosAtStart));
        setRemoteHydrationComplete(true);
        void Promise.all(localTodosToMigrate.map((todo) => createCartularyFollowUpTodo(cartularyId, { ...todo, source: 'cartulary' })))
          .then(() => persistCartulariaJson(TODO_REMOTE_MIGRATION_KEY, true))
          .catch(() => { if (active) setSyncError(isFrench ? 'Une tâche locale reste à synchroniser.' : 'A local task still needs syncing.'); });
        return;
      }
      const remoteById = new Map(remoteTodos.map((todo) => [todo.id, todo]));
      pendingUpsertsRef.current.forEach((pending, id) => {
        const remote = remoteById.get(id);
        if (remote && remote.text === pending.text && remote.dueAt === pending.dueAt && remote.category === pending.category && remote.status === pending.status) {
          pendingUpsertsRef.current.delete(id);
        }
      });
      pendingDeletesRef.current.forEach((id) => {
        if (!remoteById.has(id)) pendingDeletesRef.current.delete(id);
      });
      persistPendingTodos();
      const pendingUpserts = Array.from(pendingUpsertsRef.current.values());
      setTodos(mergeCartularyFollowUpTodos(remoteTodos, pendingUpserts).filter((todo) => !pendingDeletesRef.current.has(todo.id)));
      setSyncError('');
    }, () => {
      if (!active) return;
      setRemoteHydrationComplete(true);
      setSyncError(isFrench ? 'Synchronisation momentanément indisponible.' : 'Sync is temporarily unavailable.');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [cartularyId, isFrench, persistPendingTodos]);

  useEffect(() => {
    if (!remoteHydrationComplete) return;
    void persistCartulariaJson(TODO_STORAGE_KEY, todos).catch((error: unknown) => console.error('Persistance des suivis impossible', error));
  }, [remoteHydrationComplete, todos]);

  const addTodo = useCallback((input: Pick<CartularyFollowUpTodo, 'text' | 'dueAt' | 'category'>) => {
    const todo: CartularyFollowUpTodo = { id: createTodoId(), ...input, text: input.text.trim(), status: 'planned' };
    if (!todo.text) return;
    pendingDeletesRef.current.delete(todo.id);
    pendingUpsertsRef.current.set(todo.id, todo);
    persistPendingTodos();
    setTodos((current) => [...current, todo]);
    setSyncError('');
    void createCartularyFollowUpTodo(cartularyId, { ...todo, source: 'cartulary' })
      .catch(() => setSyncError(isFrench ? 'La tâche est conservée localement, mais pas encore synchronisée.' : 'The task is saved locally but not synced yet.'));
  }, [cartularyId, isFrench, persistPendingTodos]);

  const updateTodo = useCallback((id: string, patch: Partial<Pick<CartularyFollowUpTodo, 'text' | 'dueAt' | 'category' | 'status'>>) => {
    const normalizedPatch = patch.text === undefined ? patch : { ...patch, text: patch.text.trim() };
    if (normalizedPatch.text === '') return;
    setTodos((current) => current.map((todo) => {
      if (todo.id !== id) return todo;
      const updated = { ...todo, ...normalizedPatch };
      pendingUpsertsRef.current.set(id, updated);
      persistPendingTodos();
      return updated;
    }));
    setSyncError('');
    void updateCartularyFollowUpTodo(cartularyId, id, normalizedPatch)
      .catch(() => setSyncError(isFrench ? 'La modification reste à synchroniser.' : 'The change still needs syncing.'));
  }, [cartularyId, isFrench, persistPendingTodos]);

  const removeTodo = useCallback((id: string) => {
    const removed = removeItemById(todos, id);
    if (!removed) return null;
    pendingUpsertsRef.current.delete(id);
    pendingDeletesRef.current.add(id);
    persistPendingTodos();
    setTodos(removed.remaining);
    setSyncError('');
    void deleteCartularyFollowUpTodo(cartularyId, id).catch(() => {
      pendingDeletesRef.current.delete(id);
      pendingUpsertsRef.current.set(id, removed.item);
      persistPendingTodos();
      setTodos((current) => restoreItemAtIndex(current, removed.item, removed.index));
      setSyncError(isFrench ? 'Suppression impossible : la tâche a été restaurée.' : 'Unable to delete: the task was restored.');
    });
    return removed;
  }, [cartularyId, isFrench, persistPendingTodos, todos]);

  const restoreTodo = useCallback((removed: RemovedItem<CartularyFollowUpTodo>) => {
    pendingDeletesRef.current.delete(removed.item.id);
    pendingUpsertsRef.current.set(removed.item.id, removed.item);
    persistPendingTodos();
    setTodos((current) => restoreItemAtIndex(current, removed.item, removed.index));
    setSyncError('');
    void createCartularyFollowUpTodo(cartularyId, { ...removed.item, source: 'cartulary' })
      .catch(() => setSyncError(isFrench ? 'La restauration reste à synchroniser.' : 'The restored task still needs syncing.'));
  }, [cartularyId, isFrench, persistPendingTodos]);

  return { todos, syncError, addTodo, updateTodo, removeTodo, restoreTodo };
};
