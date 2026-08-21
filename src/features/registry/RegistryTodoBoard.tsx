import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, ExternalLink, ListTodo, Plus, Trash2, X } from 'lucide-react';
import type { FollowUpCategory, RegistryFollowUpItem } from '../../domain/followUp.ts';
import type { RegistryItemProjection } from '../../domain/projections.ts';
import {
  createCartularyFollowUpTodo,
  deleteCartularyFollowUpTodo,
  updateCartularyFollowUpTodo,
} from '../../services/followUp.ts';
import { buildCartularyHref } from './registryCatalog.ts';
import { followUpDate } from './registryFollowUp.ts';

const CATEGORY_LABELS: Record<FollowUpCategory, string> = {
  custom: 'Action',
  insurance: 'Assurance',
  visual_evidence: 'Preuves visuelles',
  maintenance: 'Entretien',
};

const createTodoId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `todo-${crypto.randomUUID()}`;
  }
  return `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const formatDate = (item: RegistryFollowUpItem) => {
  const date = followUpDate(item);
  if (Number.isNaN(date.getTime())) return 'Sans échéance';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

export function RegistryTodoBoard({
  registryId,
  items,
  todos,
  canManage,
}: {
  registryId: string;
  items: RegistryItemProjection[];
  todos: RegistryFollowUpItem[];
  canManage: boolean;
}) {
  const activeItems = useMemo(
    () => items.filter((item) => item.projectionStatus === 'active'),
    [items],
  );
  const sortedTodos = useMemo(() => [...todos].sort((left, right) => {
    const leftDone = ['completed', 'dismissed'].includes(left.reminderStatus);
    const rightDone = ['completed', 'dismissed'].includes(right.reminderStatus);
    const leftDate = followUpDate(left).getTime();
    const rightDate = followUpDate(right).getTime();
    return Number(leftDone) - Number(rightDone)
      || (Number.isNaN(leftDate) ? Number.POSITIVE_INFINITY : leftDate)
        - (Number.isNaN(rightDate) ? Number.POSITIVE_INFINITY : rightDate)
      || left.title.localeCompare(right.title, 'fr', { sensitivity: 'base' });
  }), [todos]);
  const [cartularyId, setCartularyId] = useState('');
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<FollowUpCategory>('custom');
  const [pendingDeletion, setPendingDeletion] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!activeItems.some((item) => item.cartularyId === cartularyId)) {
      setCartularyId(activeItems[0]?.cartularyId || '');
    }
  }, [activeItems, cartularyId]);

  const addTodo = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!cartularyId || !normalizedTitle || !dueAt) return;
    setBusyKey('create');
    setMessage('');
    try {
      await createCartularyFollowUpTodo(cartularyId, {
        id: createTodoId(),
        text: normalizedTitle,
        dueAt,
        category,
        status: 'planned',
        source: 'registry',
      });
      setTitle('');
      setMessage('Tâche ajoutée au Cartulaire et au Registre.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Ajout impossible.');
    } finally {
      setBusyKey('');
    }
  };

  const toggleTodo = async (todo: RegistryFollowUpItem) => {
    const key = `${todo.cartularyId}:${todo.id}`;
    const status = todo.reminderStatus === 'completed' ? 'planned' : 'completed';
    setBusyKey(key);
    setMessage('');
    try {
      await updateCartularyFollowUpTodo(todo.cartularyId, todo.id, { status });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Mise à jour impossible.');
    } finally {
      setBusyKey('');
    }
  };

  const deleteTodo = async (todo: RegistryFollowUpItem) => {
    const key = `${todo.cartularyId}:${todo.id}`;
    setBusyKey(key);
    setMessage('');
    try {
      await deleteCartularyFollowUpTodo(todo.cartularyId, todo.id);
      setPendingDeletion(null);
      setMessage('Tâche supprimée du Registre et du Cartulaire.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Suppression impossible.');
    } finally {
      setBusyKey('');
    }
  };

  const returnTo = `/registry/${encodeURIComponent(registryId)}/overview`;

  return (
    <section className="registry-todo-board" aria-labelledby="registry-todo-board-title">
      <header>
        <div>
          <span className="registry-step">Suivi coordonné</span>
          <h2 id="registry-todo-board-title">Toutes les tâches des Cartulaires</h2>
          <p>{sortedTodos.length} tâche{sortedTodos.length === 1 ? '' : 's'} réunie{sortedTodos.length === 1 ? '' : 's'} dans ce Registre.</p>
        </div>
        <ListTodo aria-hidden="true" />
      </header>

      {canManage && activeItems.length > 0 && (
        <form className="registry-todo-board__form" onSubmit={(event) => void addTodo(event)}>
          <label>
            <span>Cartulaire</span>
            <select value={cartularyId} onChange={(event) => setCartularyId(event.target.value)} required>
              {activeItems.map((item) => <option value={item.cartularyId} key={item.cartularyId}>{item.displayTitle}</option>)}
            </select>
          </label>
          <label className="registry-todo-board__title-field">
            <span>Tâche</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ajouter une action…" maxLength={200} required />
          </label>
          <label>
            <span>Échéance</span>
            <input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} required />
          </label>
          <label>
            <span>Nature</span>
            <select value={category} onChange={(event) => setCategory(event.target.value as FollowUpCategory)}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busyKey === 'create' || !title.trim()}><Plus aria-hidden="true" /> Ajouter</button>
        </form>
      )}

      {message && <p className="registry-todo-board__message" role="status">{message}</p>}

      {sortedTodos.length === 0 ? (
        <div className="registry-todo-board__empty"><Circle aria-hidden="true" /><span>Aucune tâche à traiter.</span></div>
      ) : (
        <ul className="registry-todo-board__list">
          {sortedTodos.map((todo) => {
            const key = `${todo.cartularyId}:${todo.id}`;
            const completed = ['completed', 'dismissed'].includes(todo.reminderStatus);
            return (
              <li key={key} className={completed ? 'is-completed' : undefined}>
                <button
                  type="button"
                  className="registry-todo-board__toggle"
                  onClick={() => void toggleTodo(todo)}
                  disabled={!canManage || busyKey === key}
                  aria-label={completed ? `Rouvrir : ${todo.title}` : `Terminer : ${todo.title}`}
                >
                  {completed ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                </button>
                <div className="registry-todo-board__task">
                  <strong>{todo.title}</strong>
                  <span>{todo.displayTitle} · {CATEGORY_LABELS[todo.category]}</span>
                </div>
                <time dateTime={typeof todo.dueAt === 'string' ? todo.dueAt : undefined}>{formatDate(todo)}</time>
                <a href={buildCartularyHref(todo.cartularyId, returnTo, todo.assetType)} aria-label={`Ouvrir le Cartulaire ${todo.displayTitle}`}><ExternalLink aria-hidden="true" /></a>
                {canManage && (pendingDeletion === key ? (
                  <div className="registry-todo-board__confirm" role="group" aria-label={`Confirmer la suppression de ${todo.title}`}>
                    <button type="button" onClick={() => setPendingDeletion(null)}><X aria-hidden="true" /> Conserver</button>
                    <button type="button" className="is-danger" onClick={() => void deleteTodo(todo)} disabled={busyKey === key}><Trash2 aria-hidden="true" /> Confirmer</button>
                  </div>
                ) : (
                  <button type="button" className="registry-todo-board__delete" onClick={() => setPendingDeletion(key)} aria-label={`Supprimer : ${todo.title}`}><Trash2 aria-hidden="true" /></button>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
