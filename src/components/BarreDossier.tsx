import React, { useEffect, useRef, useState } from 'react';
import { Check, ListTodo, Pencil, Plus, Trash2, X } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { persistCartulariaJson } from '../persistence/localVault';
import { useDialogFocus } from '../hooks/useDialogFocus';
import { removeItemById, restoreItemAtIndex, type RemovedItem } from '../utils/undoableDeletion';

interface TodoItem {
  id: string;
  text: string;
}

const TODO_STORAGE_KEY = 'cartularia-todos';

const readStoredTodos = (): TodoItem[] => {
  try {
    const stored = window.localStorage.getItem(TODO_STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is TodoItem => (
      typeof item === 'object'
      && item !== null
      && typeof (item as TodoItem).id === 'string'
      && typeof (item as TodoItem).text === 'string'
      && (item as TodoItem).text.trim().length > 0
    ));
  } catch {
    return [];
  }
};

const createTodoId = () => `todo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface BarreDossierProps {
  publicCode: string;
  brand: string;
  model: string;
  language: 'FR' | 'EN';
  setLanguage: (lang: 'FR' | 'EN') => void;
}

export const BarreDossier: React.FC<BarreDossierProps> = ({
  publicCode,
  brand,
  model,
  language,
  setLanguage
}) => {
  const [todos, setTodos] = useState<TodoItem[]>(readStoredTodos);
  const [isTodoOpen, setIsTodoOpen] = useState(false);
  const [newTodo, setNewTodo] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [pendingTodoDeletion, setPendingTodoDeletion] = useState<TodoItem | null>(null);
  const [deletedTodo, setDeletedTodo] = useState<RemovedItem<TodoItem> | null>(null);
  const todoContainerRef = useRef<HTMLDivElement>(null);
  const newTodoInputRef = useRef<HTMLInputElement>(null);
  const todoDeletionDialogRef = useRef<HTMLDivElement>(null);

  const isFrench = language === 'FR';

  useDialogFocus(Boolean(pendingTodoDeletion), todoDeletionDialogRef, () => setPendingTodoDeletion(null));

  useEffect(() => {
    void persistCartulariaJson(TODO_STORAGE_KEY, todos).catch((error: unknown) => console.error('Persistance des tâches impossible', error));
  }, [todos]);

  useEffect(() => {
    if (!isTodoOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!todoContainerRef.current?.contains(event.target as Node)) {
        setIsTodoOpen(false);
        setEditingId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTodoOpen(false);
        setEditingId(null);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnEscape);
    const focusFrame = window.requestAnimationFrame(() => newTodoInputRef.current?.focus());

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnEscape);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [isTodoOpen]);

  useEffect(() => {
    if (!deletedTodo) return;
    const timeout = window.setTimeout(() => setDeletedTodo(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [deletedTodo]);

  const addTodo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = newTodo.trim();
    if (!text) return;

    setTodos((current) => [...current, { id: createTodoId(), text }]);
    setNewTodo('');
    newTodoInputRef.current?.focus();
  };

  const startEditing = (todo: TodoItem) => {
    setEditingId(todo.id);
    setEditingText(todo.text);
  };

  const saveTodo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = editingText.trim();
    if (!editingId || !text) return;

    setTodos((current) => current.map((todo) => todo.id === editingId ? { ...todo, text } : todo));
    setEditingId(null);
    setEditingText('');
  };

  const confirmTodoDeletion = () => {
    if (!pendingTodoDeletion) return;
    const removed = removeItemById(todos, pendingTodoDeletion.id);
    if (!removed) {
      setPendingTodoDeletion(null);
      return;
    }
    setTodos(removed.remaining);
    setDeletedTodo(removed);
    if (editingId === pendingTodoDeletion.id) {
      setEditingId(null);
      setEditingText('');
    }
    setPendingTodoDeletion(null);
  };

  const undoTodoDeletion = () => {
    if (!deletedTodo) return;
    setTodos((current) => restoreItemAtIndex(current, deletedTodo.item, deletedTodo.index));
    setDeletedTodo(null);
  };

  return (
    <header className="dossier-bar no-print" style={{
      backgroundColor: 'var(--sheet)',
      borderBottom: '1px solid var(--rule)',
      width: '100%',
      padding: 'var(--s3) var(--s5)',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      <div className="dossier-bar__inner" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        maxWidth: '1200px',
        margin: '0 auto',
        width: '100%'
      }}>
        {/* Logo / Nom du Service */}
        <div className="dossier-bar__logo">
          <BrandLogo />
        </div>

        {/* Info Montre (Centrée) */}
        <div className="header-watch-info" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s2)',
          fontSize: '13px',
          color: 'var(--ink)'
        }}>
          <span style={{ fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
            {brand} {model}
          </span>
          <span style={{ color: 'var(--muted)' }}>·</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 500, color: 'var(--muted)' }}>
            {publicCode}
          </span>
        </div>

        {/* Contrôles (Droite) */}
        <div className="dossier-bar__controls" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s4)'
        }}>
          <div className="dossier-bar__todo" ref={todoContainerRef}>
            <button
              type="button"
              className={`todo-trigger${isTodoOpen ? ' is-active' : ''}`}
              onClick={() => setIsTodoOpen((current) => !current)}
              aria-expanded={isTodoOpen}
              aria-controls="cartularia-todo-panel"
            >
              <ListTodo size={16} />
              <span>{isFrench ? 'À faire' : 'To do'}</span>
              {todos.length > 0 && <strong aria-label={`${todos.length} ${isFrench ? 'tâche(s)' : 'task(s)'}`}>{todos.length}</strong>}
            </button>

            {isTodoOpen && (
              <section id="cartularia-todo-panel" className="todo-popover" aria-label={isFrench ? 'Liste des choses à faire' : 'To-do list'}>
                <div className="todo-popover__header">
                  <div>
                    <span className="eyebrow">{isFrench ? 'Organisation' : 'Organization'}</span>
                    <h2>{isFrench ? 'À faire' : 'To do'}</h2>
                  </div>
                  <button
                    type="button"
                    className="todo-action"
                    onClick={() => {
                      setIsTodoOpen(false);
                      setEditingId(null);
                    }}
                    aria-label={isFrench ? 'Fermer la liste' : 'Close the list'}
                  >
                    <X size={16} />
                  </button>
                </div>

                <form className="todo-add-form" onSubmit={addTodo}>
                  <input
                    ref={newTodoInputRef}
                    type="text"
                    value={newTodo}
                    onChange={(event) => setNewTodo(event.target.value)}
                    placeholder={isFrench ? 'Ajouter une chose à faire…' : 'Add a task…'}
                    aria-label={isFrench ? 'Nouvelle chose à faire' : 'New task'}
                  />
                  <button type="submit" disabled={!newTodo.trim()} aria-label={isFrench ? 'Ajouter' : 'Add'}>
                    <Plus size={17} />
                  </button>
                </form>

                {todos.length > 0 ? (
                  <ul className="todo-list">
                    {todos.map((todo) => (
                      <li key={todo.id}>
                        {editingId === todo.id ? (
                          <form className="todo-edit-form" onSubmit={saveTodo}>
                            <input
                              type="text"
                              value={editingText}
                              onChange={(event) => setEditingText(event.target.value)}
                              aria-label={isFrench ? 'Modifier la tâche' : 'Edit task'}
                              autoFocus
                            />
                            <button type="submit" disabled={!editingText.trim()} aria-label={isFrench ? 'Enregistrer' : 'Save'}><Check size={15} /></button>
                            <button type="button" onClick={() => setEditingId(null)} aria-label={isFrench ? 'Annuler' : 'Cancel'}><X size={15} /></button>
                          </form>
                        ) : (
                          <>
                            <span>{todo.text}</span>
                            <div className="todo-list__actions">
                              <button type="button" onClick={() => startEditing(todo)} aria-label={`${isFrench ? 'Modifier' : 'Edit'} : ${todo.text}`}><Pencil size={14} /></button>
                              <button type="button" onClick={() => setPendingTodoDeletion(todo)} aria-label={`${isFrench ? 'Supprimer' : 'Delete'} : ${todo.text}`}><Trash2 size={14} /></button>
                            </div>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="todo-empty">{isFrench ? 'Aucune chose à faire pour le moment.' : 'Nothing to do for now.'}</p>
                )}

                {pendingTodoDeletion && (
                  <div ref={todoDeletionDialogRef} className="todo-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="todo-delete-title" data-focus-layer="true" tabIndex={-1}>
                    <span className="eyebrow">{isFrench ? 'Action destructive' : 'Destructive action'}</span>
                    <h3 id="todo-delete-title">{isFrench ? 'Supprimer cette tâche ?' : 'Delete this task?'}</h3>
                    <p>{pendingTodoDeletion.text}</p>
                    <div>
                      <button type="button" onClick={() => setPendingTodoDeletion(null)}>{isFrench ? 'Conserver' : 'Keep'}</button>
                      <button type="button" className="is-danger" onClick={confirmTodoDeletion}>{isFrench ? 'Supprimer' : 'Delete'}</button>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Langue FR / EN */}
          <div className="dossier-bar__languages" style={{ display: 'flex', gap: '6px' }}>
            {(['FR', 'EN'] as const).map((lang) => (
              <button
                type="button"
                key={lang}
                className={`language-toggle${language === lang ? ' is-active' : ''}`}
                onClick={() => setLanguage(lang)}
                aria-label={lang === 'FR' ? 'Afficher l’interface en français' : 'Display the interface in English'}
                aria-pressed={language === lang}
              >
                {lang}
              </button>
            ))}
          </div>
        </div>
      </div>
      {deletedTodo && (
        <div className="undo-toast no-print" role="status" aria-live="assertive" aria-atomic="true">
          <p>{isFrench ? `« ${deletedTodo.item.text} » a été supprimée.` : `“${deletedTodo.item.text}” was deleted.`}</p>
          <button type="button" onClick={undoTodoDeletion}>{isFrench ? 'Annuler la suppression' : 'Undo deletion'}</button>
          <button type="button" className="undo-toast__dismiss" onClick={() => setDeletedTodo(null)} aria-label={isFrench ? 'Fermer la notification' : 'Dismiss notification'}><X size={15} /></button>
        </div>
      )}
      <style>{`
        @media (max-width: 767px) {
          .header-watch-info {
            display: none !important;
          }
        }
      `}</style>
    </header>
  );
};
