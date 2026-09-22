import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { REVIEW_SIGNAL_EXPLANATION } from '../src/features/registry/registryPresentation.ts';

const source = readFileSync(new URL('../src/features/registry/RegistryOverview.tsx', import.meta.url), 'utf8');
const itemsSource = readFileSync(new URL('../src/features/registry/RegistryItems.tsx', import.meta.url), 'utf8');
const todoBoardSource = readFileSync(new URL('../src/features/registry/RegistryTodoBoard.tsx', import.meta.url), 'utf8');
const followUpSource = readFileSync(new URL('../src/features/registry/RegistryFollowUp.tsx', import.meta.url), 'utf8');

test('la synthèse distingue statut, niveau documentaire et alertes actionnables', () => {
  assert.match(source, /État des Cartulaires/);
  assert.match(source, /Niveau documentaire/);
  assert.match(source, /Alertes à traiter/);
  assert.doesNotMatch(source, /<h2>Cycle de vie<\/h2>/);
  assert.doesNotMatch(source, /<h2>Complétude documentaire<\/h2>/);
  assert.doesNotMatch(source, /<h2>Points d’attention<\/h2>/);
});

test('le tableau de bord résume les tâches et conduit au centre de suivi qui modifie leur Cartulaire source', () => {
  assert.match(source, /buildRegistryFollowUpSummary\(followUps\)/);
  assert.match(source, /href=\{registrySectionHref\(registry.id, 'follow-up'\)\}>Gérer toutes les tâches/);
  assert.match(followUpSource, /<RegistryTodoBoard/);
  assert.match(todoBoardSource, /<h2 id="registry-todo-board-title">À faire<\/h2>/);
  assert.match(todoBoardSource, /dans ce Registre/);
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

test('la carte À revoir conduit au catalogue filtré et explique le signal (P-C5, lot A)', () => {
  assert.match(source, /items'\)\}\?review=1/, 'la carte est navigable vers `?review=1`');
  assert.match(source, /Voir les Cartulaires à revoir/);
  assert.match(source, /Aucun signal de revue/);
  assert.doesNotMatch(source, /Statut ou import à vérifier/, 'le sous-titre ambigu disparaît');
  // La note d'explication dépend d'un agrégat, jamais du mode démonstration (ADR-026).
  assert.match(source, /summary\.needsReviewCount > 0 && <p className="registry-dashboard-note">\{REVIEW_SIGNAL_EXPLANATION\}<\/p>/);
  assert.doesNotMatch(source, /isDemoCartulary|cart_demo_/);
});

test('l’explication du signal est unique, dit comment le lever depuis le lot B, et reste partagée avec le catalogue', () => {
  assert.match(REVIEW_SIGNAL_EXPLANATION, /posés à la création/);
  // B11 : la garde d'honnêteté du lot A (« ne lève ce signal pour l’instant ») est remplacée par l'action réelle,
  // nommée comme le bouton de la page Accueil (CartularyReviewStatus) ; jamais « vérifié » : la revue n'est pas un sceau.
  assert.match(REVIEW_SIGNAL_EXPLANATION, /Le propriétaire éditeur le lève depuis la page Accueil de son Cartulaire \(« Marquer comme revu »\)/);
  assert.doesNotMatch(REVIEW_SIGNAL_EXPLANATION, /pour l’instant|Aucune action/);
  assert.match(REVIEW_SIGNAL_EXPLANATION, /ni la consultation, ni l’édition, ni la publication, ni la cession/);
  assert.doesNotMatch(REVIEW_SIGNAL_EXPLANATION, /vérifié par/);
  const reviewStatus = readFileSync(new URL('../src/features/cartulary/components/CartularyReviewStatus.tsx', import.meta.url), 'utf8');
  assert.match(reviewStatus, /'Marquer comme revu'/, 'le libellé cité par l’explication est celui du bouton');
  assert.match(itemsSource, /needsReview && <p className="registry-dashboard-note" role="note">\{REVIEW_SIGNAL_EXPLANATION\}<\/p>/);
  assert.match(itemsSource, /readInitialParameter\('review', ''\) === '1'/);
  assert.match(itemsSource, /params\.set\('review', '1'\)/, 'le filtre survit au retour depuis un Cartulaire (returnTo)');
  assert.match(itemsSource, /Cartulaires à revoir/);
  assert.equal((source.match(/REVIEW_SIGNAL_EXPLANATION/g) ?? []).length + (itemsSource.match(/REVIEW_SIGNAL_EXPLANATION/g) ?? []).length, 4, 'import + usage dans chaque composant, aucun texte recopié');
});
