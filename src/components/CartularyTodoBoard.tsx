import React, { useEffect, useState } from 'react';
import { Check, Circle, Pencil, Plus, Trash2, Undo2, X } from 'lucide-react';
import type { CartularyFollowUpTodo, FollowUpCategory } from '../domain/followUp';
import type { CartularyFollowUpController } from '../features/cartulary/state/useCartularyFollowUp';
import type { RemovedItem } from '../utils/undoableDeletion';

interface CartularyTodoBoardProps {
  followUp: CartularyFollowUpController;
  language: 'FR' | 'EN';
  /** Lecture (V5 point 1) : chaque ligne en texte pur, aucun formulaire, aucun message de synchronisation. */
  readOnly?: boolean;
  /** Texte seul (ADR-026) : la lecture est nommée « démonstration » ou simple « lecture seule ». */
  demonstration?: boolean;
}

const categoryOptions: Array<{ value: FollowUpCategory; fr: string; en: string }> = [
  { value: 'custom', fr: 'Action', en: 'Action' },
  { value: 'insurance', fr: 'Assurance', en: 'Insurance' },
  { value: 'visual_evidence', fr: 'Preuves visuelles', en: 'Visual evidence' },
  { value: 'maintenance', fr: 'Entretien', en: 'Maintenance' },
];

export const CartularyTodoBoard: React.FC<CartularyTodoBoardProps> = ({ followUp, language, readOnly = false, demonstration = false }) => {
  const { todos, syncError, addTodo, updateTodo, removeTodo, restoreTodo } = followUp;
  const [newText, setNewText] = useState('');
  const [newDueAt, setNewDueAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [newCategory, setNewCategory] = useState<FollowUpCategory>('custom');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [deletedTodo, setDeletedTodo] = useState<RemovedItem<CartularyFollowUpTodo> | null>(null);
  const isFrench = language === 'FR';
  const categoryLabel = (category: FollowUpCategory) => {
    const option = categoryOptions.find((entry) => entry.value === category) ?? categoryOptions[0];
    return isFrench ? option.fr : option.en;
  };

  useEffect(() => {
    if (!deletedTodo) return;
    const timeout = window.setTimeout(() => setDeletedTodo(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [deletedTodo]);

  const submitNewTodo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newText.trim()) return;
    addTodo({ text: newText, dueAt: newDueAt, category: newCategory });
    setNewText('');
  };

  const saveTodo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingId || !editingText.trim()) return;
    updateTodo(editingId, { text: editingText });
    setEditingId(null);
    setEditingText('');
  };

  const deleteTodo = (todo: CartularyFollowUpTodo) => {
    const removed = removeTodo(todo.id);
    if (!removed) return;
    setDeletedTodo(removed);
    if (editingId === todo.id) {
      setEditingId(null);
      setEditingText('');
    }
  };

  return (
    <section className="cover-todo-board publishable-block" aria-labelledby="cover-todo-title" data-publication-block="cover.todos">
      <header className="cover-todo-board__header">
        <div>
          <span className="eyebrow">{isFrench ? 'Tâches et rappels' : 'Tasks and reminders'}</span>
          <h2 id="cover-todo-title">{isFrench ? 'À Faire' : 'To do'}</h2>
        </div>
        <span className="cover-todo-board__count">{todos.length} {isFrench ? 'élément(s)' : 'item(s)'}</span>
      </header>

      {!readOnly && <form className="cover-todo-board__add" onSubmit={submitNewTodo}>
        <label>
          <span>{isFrench ? 'Nouvelle tâche ou rappel' : 'New task or reminder'}</span>
          <input
            type="text"
            value={newText}
            onChange={(event) => setNewText(event.target.value)}
            placeholder={isFrench ? 'Ajouter une chose à faire…' : 'Add a task…'}
          />
        </label>
        <label>
          <span>{isFrench ? 'Échéance' : 'Due date'}</span>
          <input type="date" value={newDueAt} onChange={(event) => setNewDueAt(event.target.value)} />
        </label>
        <label>
          <span>{isFrench ? 'Nature' : 'Category'}</span>
          <select value={newCategory} onChange={(event) => setNewCategory(event.target.value as FollowUpCategory)}>
            {categoryOptions.map((option) => <option key={option.value} value={option.value}>{isFrench ? option.fr : option.en}</option>)}
          </select>
        </label>
        <button type="submit" disabled={!newText.trim()}><Plus size={16} />{isFrench ? 'Ajouter' : 'Add'}</button>
      </form>}

      {readOnly && <p className="demo-read-only-hint">{demonstration ? (isFrench ? 'Démonstration en lecture seule' : 'Read-only demonstration') : (isFrench ? 'Lecture seule' : 'Read-only')}</p>}

      {/* Un lecteur ne synchronise rien : l'état de synchronisation n'est montré qu'à l'éditeur (V5 M1). */}
      {!readOnly && syncError && <p className="todo-sync-error" role="status">{syncError}</p>}

      {todos.length > 0 ? (
        <ul className="cover-todo-board__list">
          {todos.map((todo) => readOnly ? (
            // Lecture : la ligne est du texte (état lu par le lecteur d'écran, échéance datée, nature), sans aucun contrôle.
            <li key={todo.id} className={todo.status === 'completed' ? 'is-completed' : undefined}>
              <span className="cover-todo-board__status cover-todo-board__status--static">
                <span aria-hidden="true">{todo.status === 'completed' ? <Check size={16} /> : <Circle size={16} />}</span>
                <span className="sr-only">{todo.status === 'completed' ? (isFrench ? 'Terminée' : 'Completed') : (isFrench ? 'Planifiée' : 'Planned')}</span>
              </span>
              <strong>{todo.text}</strong>
              <time dateTime={todo.dueAt || undefined}>{todo.dueAt || (isFrench ? 'Sans échéance' : 'No due date')}</time>
              <span className="cover-todo-board__category">{categoryLabel(todo.category)}</span>
            </li>
          ) : (
            <li key={todo.id} className={todo.status === 'completed' ? 'is-completed' : undefined}>
              <button
                type="button"
                className="cover-todo-board__status"
                onClick={() => updateTodo(todo.id, { status: todo.status === 'completed' ? 'planned' : 'completed' })}
                aria-label={todo.status === 'completed' ? (isFrench ? `Rouvrir : ${todo.text}` : `Reopen: ${todo.text}`) : (isFrench ? `Terminer : ${todo.text}` : `Complete: ${todo.text}`)}
              >
                {todo.status === 'completed' ? <Check size={16} /> : <Circle size={16} />}
              </button>

              {editingId === todo.id ? (
                <form className="cover-todo-board__edit" onSubmit={saveTodo}>
                  <input autoFocus value={editingText} onChange={(event) => setEditingText(event.target.value)} aria-label={isFrench ? 'Modifier la tâche' : 'Edit task'} />
                  <button type="submit" disabled={!editingText.trim()} aria-label={isFrench ? 'Enregistrer' : 'Save'}><Check size={15} /></button>
                  <button type="button" onClick={() => setEditingId(null)} aria-label={isFrench ? 'Annuler' : 'Cancel'}><X size={15} /></button>
                </form>
              ) : (
                <strong>{todo.text}</strong>
              )}

              <input
                type="date"
                value={todo.dueAt}
                onChange={(event) => updateTodo(todo.id, { dueAt: event.target.value })}
                aria-label={isFrench ? `Échéance de ${todo.text}` : `Due date for ${todo.text}`}
              />
              <select
                value={todo.category}
                onChange={(event) => updateTodo(todo.id, { category: event.target.value as FollowUpCategory })}
                aria-label={isFrench ? `Nature de ${todo.text}` : `Category for ${todo.text}`}
              >
                {categoryOptions.map((option) => <option key={option.value} value={option.value}>{isFrench ? option.fr : option.en}</option>)}
              </select>
              <div className="cover-todo-board__actions">
                <button type="button" onClick={() => { setEditingId(todo.id); setEditingText(todo.text); }} aria-label={`${isFrench ? 'Modifier' : 'Edit'} : ${todo.text}`}><Pencil size={15} /></button>
                <button type="button" onClick={() => deleteTodo(todo)} aria-label={`${isFrench ? 'Supprimer' : 'Delete'} : ${todo.text}`}><Trash2 size={15} /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cover-todo-board__empty">{isFrench ? 'Aucune tâche ni aucun rappel pour le moment.' : 'No task or reminder for now.'}</p>
      )}

      {!readOnly && deletedTodo && (
        <div className="cover-todo-board__undo" role="status">
          <span>{isFrench ? `« ${deletedTodo.item.text} » a été supprimée.` : `“${deletedTodo.item.text}” was deleted.`}</span>
          <button type="button" onClick={() => { restoreTodo(deletedTodo); setDeletedTodo(null); }}><Undo2 size={15} />{isFrench ? 'Annuler' : 'Undo'}</button>
          <button type="button" onClick={() => setDeletedTodo(null)} aria-label={isFrench ? 'Fermer' : 'Dismiss'}><X size={15} /></button>
        </div>
      )}
    </section>
  );
};
