import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CartularyFollowUpTodo,
  FollowUpCategory,
} from '../../../domain/followUp.ts';
import { persistCartulariaJson, readCartulariaStorage } from '../../../persistence/localVault.ts';
import {
  deleteCartularyFollowUpTodo,
  observeCartularyFollowUpTodos,
  syncCartularyFollowUpTodo,
} from '../../../services/followUp.ts';
import { removeItemById, restoreItemAtIndex, type RemovedItem } from '../../../utils/undoableDeletion.ts';

const TODO_STORAGE_KEY = 'cartularia-todos';
const TODO_REMOTE_MIGRATION_KEY = 'cartularia-todos-remote-migrated-v1';
const TODO_LEGACY_PENDING_STORAGE_KEY = 'cartularia-todos-pending-v1';
const TODO_OPERATION_STORAGE_KEY = 'cartularia-todos-operations-v2';

type FollowUpOperation = {
  operationId: string;
  cartularyId: string;
  todoId: string;
  kind: 'upsert' | 'delete';
  todo?: CartularyFollowUpTodo;
  queuedAt: number;
};

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

const createOperationId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `follow-up-${crypto.randomUUID()}`;
  }
  return `follow-up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const createTodoId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `todo-${crypto.randomUUID()}`;
  }
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeOperations = (value: unknown, cartularyId: string): FollowUpOperation[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): FollowUpOperation[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const operation = candidate as Partial<FollowUpOperation>;
    if (
      typeof operation.operationId !== 'string'
      || operation.cartularyId !== cartularyId
      || typeof operation.todoId !== 'string'
      || !['upsert', 'delete'].includes(operation.kind || '')
    ) return [];
    if (operation.kind === 'upsert') {
      const [todo] = normalizeTodos([operation.todo]);
      if (!todo || todo.id !== operation.todoId) return [];
      return [{
        operationId: operation.operationId,
        cartularyId,
        todoId: operation.todoId,
        kind: 'upsert',
        todo,
        queuedAt: typeof operation.queuedAt === 'number' ? operation.queuedAt : 0,
      }];
    }
    return [{
      operationId: operation.operationId,
      cartularyId,
      todoId: operation.todoId,
      kind: 'delete',
      queuedAt: typeof operation.queuedAt === 'number' ? operation.queuedAt : 0,
    }];
  });
};

const readStoredOperations = (cartularyId: string): FollowUpOperation[] => {
  try {
    const current = readCartulariaStorage(TODO_OPERATION_STORAGE_KEY);
    if (current !== null) return normalizeOperations(JSON.parse(current) as unknown, cartularyId);
    const legacy = readCartulariaStorage(TODO_LEGACY_PENDING_STORAGE_KEY);
    if (!legacy) return [];
    const parsed = JSON.parse(legacy) as { upserts?: unknown; deletes?: unknown };
    const queuedAt = Date.now();
    const upserts = normalizeTodos(parsed.upserts).map((todo): FollowUpOperation => ({
      operationId: createOperationId(),
      cartularyId,
      todoId: todo.id,
      kind: 'upsert',
      todo,
      queuedAt,
    }));
    const deletes = Array.isArray(parsed.deletes) ? parsed.deletes.flatMap((todoId): FollowUpOperation[] => (
      typeof todoId === 'string' ? [{
        operationId: createOperationId(),
        cartularyId,
        todoId,
        kind: 'delete',
        queuedAt,
      }] : []
    )) : [];
    return [...upserts, ...deletes];
  } catch {
    return [];
  }
};

const applyOperations = (
  remoteTodos: CartularyFollowUpTodo[],
  operations: FollowUpOperation[],
  cartularyId: string,
) => {
  const projected = new Map(remoteTodos.map((todo) => [todo.id, todo]));
  for (const operation of operations) {
    if (operation.cartularyId !== cartularyId) continue;
    if (operation.kind === 'delete') projected.delete(operation.todoId);
    else if (operation.todo) projected.set(operation.todoId, operation.todo);
  }
  return [...projected.values()];
};

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
  readOnlyPreview = false,
}: {
  cartularyId: string;
  language: 'FR' | 'EN';
  readOnlyPreview?: boolean;
}): CartularyFollowUpController => {
  const [todos, setTodos] = useState<CartularyFollowUpTodo[]>(() => readOnlyPreview ? [] : readStoredTodos());
  const [remoteHydrationComplete, setRemoteHydrationComplete] = useState(false);
  const [syncError, setSyncError] = useState('');
  const todosRef = useRef(todos);
  const operationsRef = useRef<FollowUpOperation[] | null>(null);
  const operationsScopeRef = useRef(cartularyId);
  const requestDrainRef = useRef<() => void>(() => undefined);
  if (operationsRef.current === null || operationsScopeRef.current !== cartularyId) {
    operationsScopeRef.current = cartularyId;
    operationsRef.current = readOnlyPreview ? [] : readStoredOperations(cartularyId);
  }
  const isFrench = language === 'FR';

  const replaceTodos = useCallback((nextTodos: CartularyFollowUpTodo[]) => {
    todosRef.current = nextTodos;
    setTodos(nextTodos);
  }, []);

  const persistOperations = useCallback(async (nextOperations: FollowUpOperation[]) => {
    if (readOnlyPreview) return;
    operationsRef.current = nextOperations;
    await persistCartulariaJson(TODO_OPERATION_STORAGE_KEY, nextOperations);
  }, [readOnlyPreview]);

  const queueOperation = useCallback((operation: FollowUpOperation, persistenceError: string) => {
    const nextOperations = [...(operationsRef.current || []), operation];
    operationsRef.current = nextOperations;
    void persistOperations(nextOperations)
      .then(() => requestDrainRef.current())
      .catch((error: unknown) => {
        console.error('Persistance de la file de suivi impossible', error);
        setSyncError(persistenceError);
      });
  }, [persistOperations]);

  useEffect(() => {
    if (readOnlyPreview) {
      replaceTodos([]);
      setSyncError('');
      setRemoteHydrationComplete(false);
      return;
    }
    let active = true;
    let draining = false;
    let firstSnapshot = true;
    let observerFailed = false;
    let latestSnapshotIsAuthoritative = false;
    const localTodosAtStart = readStoredTodos();
    const shouldMigrateLocalTodos = readCartulariaStorage(TODO_REMOTE_MIGRATION_KEY) !== 'true';

    const reportPending = () => {
      setSyncError(isFrench
        ? 'Une modification est conservée localement et reste à synchroniser.'
        : 'A change is saved locally and still needs syncing.');
    };

    const drain = async () => {
      if (!active || draining || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
      draining = true;
      try {
        while (active) {
          const operation = operationsRef.current?.[0];
          if (!operation) {
            if (!observerFailed && latestSnapshotIsAuthoritative) setSyncError('');
            return;
          }
          try {
            if (operation.kind === 'delete') {
              await deleteCartularyFollowUpTodo(operation.cartularyId, operation.todoId);
            } else if (operation.todo) {
              await syncCartularyFollowUpTodo(operation.cartularyId, { ...operation.todo, source: 'cartulary' });
            }
          } catch {
            if (active) reportPending();
            return;
          }
          if (!active) return;
          const currentOperations = operationsRef.current || [];
          if (!currentOperations.some((candidate) => candidate.operationId === operation.operationId)) continue;
          const remaining = currentOperations.filter((candidate) => candidate.operationId !== operation.operationId);
          try {
            await persistOperations(remaining);
          } catch (error) {
            console.error('Acquittement local de la file de suivi impossible', error);
            if (active) reportPending();
            return;
          }
        }
      } finally {
        draining = false;
      }
    };

    const requestDrain = () => { void drain(); };
    requestDrainRef.current = requestDrain;
    window.addEventListener('online', requestDrain);
    setRemoteHydrationComplete(false);
    setSyncError('');

    const unsubscribe = observeCartularyFollowUpTodos(cartularyId, (remoteTodos, metadata = { hasPendingWrites: false, fromCache: false }) => {
      if (!active) return;
      observerFailed = false;
      latestSnapshotIsAuthoritative = !metadata.hasPendingWrites && !metadata.fromCache;
      if (firstSnapshot) {
        firstSnapshot = false;
        if (shouldMigrateLocalTodos) {
          const remoteIds = new Set(remoteTodos.map((todo) => todo.id));
          const alreadyQueuedIds = new Set((operationsRef.current || [])
            .filter((operation) => operation.kind === 'upsert')
            .map((operation) => operation.todoId));
          const migrationOperations = localTodosAtStart
            .filter((candidate) => !remoteIds.has(candidate.id) && !alreadyQueuedIds.has(candidate.id))
            .map((todo): FollowUpOperation => ({
              operationId: createOperationId(),
              cartularyId,
              todoId: todo.id,
              kind: 'upsert',
              todo,
              queuedAt: Date.now(),
            }));
          const nextOperations = [...(operationsRef.current || []), ...migrationOperations];
          operationsRef.current = nextOperations;
          void persistOperations(nextOperations)
            .then(() => persistCartulariaJson(TODO_LEGACY_PENDING_STORAGE_KEY, { upserts: [], deletes: [] }))
            .then(() => persistCartulariaJson(TODO_REMOTE_MIGRATION_KEY, true))
            .then(requestDrain)
            .catch((error: unknown) => {
              console.error('Migration durable des suivis impossible', error);
              if (active) reportPending();
            });
        }
        setRemoteHydrationComplete(true);
      }
      replaceTodos(applyOperations(remoteTodos, operationsRef.current || [], cartularyId));
      if (!metadata.hasPendingWrites && !metadata.fromCache && (operationsRef.current?.length || 0) === 0) {
        setSyncError('');
      }
    }, () => {
      if (!active) return;
      observerFailed = true;
      setRemoteHydrationComplete(true);
      setSyncError(isFrench ? 'Synchronisation momentanément indisponible.' : 'Sync is temporarily unavailable.');
    });
    requestDrain();
    return () => {
      active = false;
      requestDrainRef.current = () => undefined;
      window.removeEventListener('online', requestDrain);
      unsubscribe();
    };
  }, [cartularyId, isFrench, persistOperations, readOnlyPreview, replaceTodos]);

  useEffect(() => {
    if (readOnlyPreview || !remoteHydrationComplete) return;
    void persistCartulariaJson(TODO_STORAGE_KEY, todos).catch((error: unknown) => console.error('Persistance des suivis impossible', error));
  }, [remoteHydrationComplete, todos, readOnlyPreview]);

  const addTodo = useCallback((input: Pick<CartularyFollowUpTodo, 'text' | 'dueAt' | 'category'>) => {
    if (readOnlyPreview) return;
    const todo: CartularyFollowUpTodo = { id: createTodoId(), ...input, text: input.text.trim(), status: 'planned' };
    if (!todo.text) return;
    replaceTodos([...todosRef.current, todo]);
    setSyncError('');
    queueOperation({
      operationId: createOperationId(),
      cartularyId,
      todoId: todo.id,
      kind: 'upsert',
      todo,
      queuedAt: Date.now(),
    }, isFrench ? 'La tâche reste affichée, mais sa sauvegarde locale a échoué.' : 'The task remains visible, but its local save failed.');
  }, [cartularyId, isFrench, queueOperation, readOnlyPreview, replaceTodos]);

  const updateTodo = useCallback((id: string, patch: Partial<Pick<CartularyFollowUpTodo, 'text' | 'dueAt' | 'category' | 'status'>>) => {
    if (readOnlyPreview) return;
    const normalizedPatch = patch.text === undefined ? patch : { ...patch, text: patch.text.trim() };
    if (normalizedPatch.text === '') return;
    const current = todosRef.current.find((todo) => todo.id === id);
    if (!current) return;
    const updated = { ...current, ...normalizedPatch };
    replaceTodos(todosRef.current.map((todo) => todo.id === id ? updated : todo));
    setSyncError('');
    queueOperation({
      operationId: createOperationId(),
      cartularyId,
      todoId: id,
      kind: 'upsert',
      todo: updated,
      queuedAt: Date.now(),
    }, isFrench ? 'La modification reste affichée, mais sa sauvegarde locale a échoué.' : 'The change remains visible, but its local save failed.');
  }, [cartularyId, isFrench, queueOperation, readOnlyPreview, replaceTodos]);

  const removeTodo = useCallback((id: string) => {
    if (readOnlyPreview) return null;
    const removed = removeItemById(todosRef.current, id);
    if (!removed) return null;
    replaceTodos(removed.remaining);
    setSyncError('');
    queueOperation({
      operationId: createOperationId(),
      cartularyId,
      todoId: id,
      kind: 'delete',
      queuedAt: Date.now(),
    }, isFrench ? 'La suppression reste affichée, mais sa sauvegarde locale a échoué.' : 'The deletion remains visible, but its local save failed.');
    return removed;
  }, [cartularyId, isFrench, queueOperation, readOnlyPreview, replaceTodos]);

  const restoreTodo = useCallback((removed: RemovedItem<CartularyFollowUpTodo>) => {
    if (readOnlyPreview) return;
    replaceTodos(restoreItemAtIndex(todosRef.current, removed.item, removed.index));
    setSyncError('');
    queueOperation({
      operationId: createOperationId(),
      cartularyId,
      todoId: removed.item.id,
      kind: 'upsert',
      todo: removed.item,
      queuedAt: Date.now(),
    }, isFrench ? 'La restauration reste affichée, mais sa sauvegarde locale a échoué.' : 'The restoration remains visible, but its local save failed.');
  }, [cartularyId, isFrench, queueOperation, readOnlyPreview, replaceTodos]);

  return { todos, syncError, addTodo, updateTodo, removeTodo, restoreTodo };
};
