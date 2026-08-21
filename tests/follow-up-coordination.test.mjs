import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mergeCartularyFollowUpTodos } from '../src/domain/followUp.ts';

const headerSource = readFileSync(new URL('../src/components/BarreDossier.tsx', import.meta.url), 'utf8');
const boardSource = readFileSync(new URL('../src/components/CartularyTodoBoard.tsx', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('../src/features/cartulary/state/useCartularyFollowUp.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

const todo = (id, text, overrides = {}) => ({
  id,
  text,
  dueAt: '2027-03-08',
  category: 'maintenance',
  status: 'planned',
  ...overrides,
});

test('les rappels Firestore absents du carnet local apparaissent dans le A Faire du Cartulaire', () => {
  const merged = mergeCartularyFollowUpTodos([
    todo('water-check', "Contrôle d'étanchéité"),
    todo('insurance', 'Renouvellement assurance', { category: 'insurance' }),
  ], []);
  assert.deepEqual(merged.map((entry) => entry.id), ['water-check', 'insurance']);
});

test('une modification locale non encore synchronisée reste prioritaire sans masquer les autres rappels serveur', () => {
  const merged = mergeCartularyFollowUpTodos([
    todo('water-check', "Contrôle d'étanchéité"),
    todo('insurance', 'Renouvellement assurance', { category: 'insurance' }),
  ], [
    todo('water-check', "Contrôle d'étanchéité replanifié", { dueAt: '2027-04-01' }),
    todo('local-note', 'Photographier le fond', { category: 'visual_evidence' }),
  ]);
  assert.equal(merged.find((entry) => entry.id === 'water-check')?.dueAt, '2027-04-01');
  assert.deepEqual(merged.map((entry) => entry.id), ['water-check', 'insurance', 'local-note']);
});

test('le cache local historique n’est migré qu’une fois afin de ne pas ressusciter une tâche supprimée', () => {
  assert.match(controllerSource, /cartularia-todos-remote-migrated-v1/);
  assert.match(controllerSource, /if \(!shouldMigrateLocalTodos\) \{\s*const pendingUpserts/);
  assert.match(controllerSource, /pendingUpsertsRef\.current\.set/);
});

test('la page Accueil et le bouton A Faire partagent un contrôleur unique et les mêmes opérations', () => {
  assert.match(headerSource, />\{isFrench \? 'A Faire' : 'To do'\}</);
  assert.match(appSource, /const followUp = useCartularyFollowUp/);
  assert.match(appSource, /<BarreDossier[\s\S]+followUp=\{followUp\}/);
  assert.match(appSource, /<CartularyTodoBoard followUp=\{followUp\}/);
  assert.match(boardSource, /addTodo\(\{ text: newText/);
  assert.match(boardSource, /updateTodo\(editingId, \{ text: editingText \}\)/);
  assert.match(boardSource, /removeTodo\(todo\.id\)/);
});
