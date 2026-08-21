import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/features/registry/RegistryOverview.tsx', import.meta.url), 'utf8');
const todoBoardSource = readFileSync(new URL('../src/features/registry/RegistryTodoBoard.tsx', import.meta.url), 'utf8');

test('la synthèse distingue statut, niveau documentaire et alertes actionnables', () => {
  assert.match(source, /État des Cartulaires/);
  assert.match(source, /Niveau documentaire/);
  assert.match(source, /Alertes à traiter/);
  assert.doesNotMatch(source, /<h2>Cycle de vie<\/h2>/);
  assert.doesNotMatch(source, /<h2>Complétude documentaire<\/h2>/);
  assert.doesNotMatch(source, /<h2>Points d’attention<\/h2>/);
});

test('le tableau de bord agrège les tâches et les modifie dans leur Cartulaire source', () => {
  assert.match(source, /<RegistryTodoBoard/);
  assert.match(todoBoardSource, /Toutes les tâches des Cartulaires/);
  assert.match(todoBoardSource, /createCartularyFollowUpTodo/);
  assert.match(todoBoardSource, /updateCartularyFollowUpTodo/);
  assert.match(todoBoardSource, /deleteCartularyFollowUpTodo/);
  assert.match(todoBoardSource, /buildCartularyHref/);
});

test('l’en-tête ne duplique plus le lien du catalogue et qualifie le statut du Registre', () => {
  assert.doesNotMatch(source, /Voir le catalogue/);
  assert.match(source, /Registre actif/);
  assert.match(source, /Registre archivé/);
});
