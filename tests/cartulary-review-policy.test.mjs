import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildCartularyReviewDecision,
  CARTULARY_REVIEW_LEVELS,
  CartularyReviewError,
  cartularyNeedsReview,
  cartularyReviewRootPatch,
  deriveCartularyReviewState,
  parseCartularyReviewDecision,
  REVIEW_OPERATION_KIND,
  REVIEW_STATE_KEY,
} from '../scripts/lib/cartulary-review-policy.mjs';

test('cartularyNeedsReview reflète les deux conditions posées à la création', () => {
  assert.equal(cartularyNeedsReview({ lifecycleStatus: 'review', completenessLevel: 'imported_unreviewed' }), true, 'état initial');
  assert.equal(cartularyNeedsReview({ lifecycleStatus: 'review', completenessLevel: 'complete' }), true, 'statut seul');
  assert.equal(cartularyNeedsReview({ lifecycleStatus: 'active', completenessLevel: 'imported_unreviewed' }), true, 'objet reçu par cession');
  assert.equal(cartularyNeedsReview({ lifecycleStatus: 'active', completenessLevel: 'complete' }), false);
  assert.equal(cartularyNeedsReview({ lifecycleStatus: 'active', completenessLevel: 'partial' }), false);
  assert.equal(cartularyNeedsReview({ lifecycleStatus: 'suspended', completenessLevel: 'partial' }), false);
});

test('un enregistrement absent ou incomplet ne lève jamais le signal', () => {
  assert.equal(cartularyNeedsReview(null), false);
  assert.equal(cartularyNeedsReview(undefined), false);
  assert.equal(cartularyNeedsReview({}), false);
  assert.equal(cartularyNeedsReview({ lifecycleStatus: null, completenessLevel: null }), false);
});

test('la politique reste pure : aucun import, définition unique du signal côté client', () => {
  const policy = readFileSync(new URL('../scripts/lib/cartulary-review-policy.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(policy, /^\s*import\s/m, 'le module de politique ne dépend de rien');
  for (const path of ['../src/features/registry/registryAggregates.ts', '../src/features/registry/registryCatalog.ts']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /cartulary-review-policy\.mjs/, `${path} importe la politique partagée`);
    assert.doesNotMatch(source, /'imported_unreviewed'/, `${path} ne redéfinit pas le signal`);
  }
});

/* ------------------------------------------------------------------------------------------ */
/* Lot B (§ 5.6) : décision de revue, patch racine, état dérivé                               */
/* ------------------------------------------------------------------------------------------ */

const OCCURRED_AT = '2026-09-15T10:00:00.000Z';
const rejectsReview = (fn, code, label) => assert.throws(fn, (error) => error instanceof CartularyReviewError && error.name === 'CartularyReviewError' && error.code === code, label);

test('le vocabulaire de la revue est figé : clé de brouillon admise par les règles, genre d’opération, deux paliers', () => {
  assert.equal(REVIEW_STATE_KEY, 'cartularia-review');
  assert.match(REVIEW_STATE_KEY, /^cartularia-[A-Za-z0-9:_-]+$/, 'motif des clés de brouillon (firestore.rules)');
  assert.equal(REVIEW_OPERATION_KIND, 'review');
  assert.deepEqual([...CARTULARY_REVIEW_LEVELS], ['partial', 'complete']);
  assert.ok(Object.isFrozen(CARTULARY_REVIEW_LEVELS));
});

test('la décision construite se relit à l’identique et ne porte aucune date client', () => {
  const decision = buildCartularyReviewDecision({ baseRevision: 3, level: 'partial' });
  assert.deepEqual(decision, { version: 1, baseRevision: 3, level: 'partial', decisionSource: 'human_confirmed' });
  assert.deepEqual(parseCartularyReviewDecision(decision), decision);
  assert.deepEqual(parseCartularyReviewDecision(JSON.parse(JSON.stringify(buildCartularyReviewDecision({ baseRevision: 0, level: 'complete' })))), { version: 1, baseRevision: 0, level: 'complete', decisionSource: 'human_confirmed' });
  assert.equal(Object.keys(decision).some((key) => /at$/i.test(key)), false, 'aucune date dans la décision');
});

test('toute décision hors contrat est refusée avec le code invalid_review', () => {
  const valid = buildCartularyReviewDecision({ baseRevision: 3, level: 'partial' });
  for (const [label, value] of [
    ['version 2', { ...valid, version: 2 }],
    ['palier inconnu', { ...valid, level: 'total' }],
    ['source non humaine', { ...valid, decisionSource: 'client' }],
    ['clé étrangère', { ...valid, reviewedAt: OCCURRED_AT }],
    ['baseRevision en texte', { ...valid, baseRevision: '3' }],
    ['baseRevision décimale', { ...valid, baseRevision: 3.5 }],
    ['clé absente', { version: 1, baseRevision: 3, level: 'partial' }],
    ['tableau', [valid]],
    ['texte', 'review'],
    ['nul', null],
    ['indéfini', undefined],
  ]) rejectsReview(() => parseCartularyReviewDecision(value), 'invalid_review', label);
});

test('le patch racine lève le signal : review → active, palier choisi, date serveur ; active stable ; draft → active', () => {
  const decision = buildCartularyReviewDecision({ baseRevision: 3, level: 'partial' });
  assert.deepEqual(
    cartularyReviewRootPatch({ root: { revision: 3, lifecycleStatus: 'review', completenessLevel: 'imported_unreviewed' }, decision, occurredAt: OCCURRED_AT }),
    { lifecycleStatus: 'active', completenessLevel: 'partial', lastVerifiedAt: OCCURRED_AT },
  );
  assert.deepEqual(
    cartularyReviewRootPatch({ root: { revision: 3, lifecycleStatus: 'active', completenessLevel: 'partial', lastVerifiedAt: '2026-09-01T00:00:00.000Z' }, decision: buildCartularyReviewDecision({ baseRevision: 3, level: 'complete' }), occurredAt: OCCURRED_AT }),
    { lifecycleStatus: 'active', completenessLevel: 'complete', lastVerifiedAt: OCCURRED_AT },
    'rejouer met à jour date et palier, le statut reste actif',
  );
  assert.equal(cartularyReviewRootPatch({ root: { revision: 3, lifecycleStatus: 'draft' }, decision, occurredAt: OCCURRED_AT }).lifecycleStatus, 'active');
  const patch = cartularyReviewRootPatch({ root: { revision: 3, lifecycleStatus: 'review' }, decision, occurredAt: OCCURRED_AT });
  assert.deepEqual(Object.keys(patch).sort(), ['completenessLevel', 'lastVerifiedAt', 'lifecycleStatus'], 'ni proofStatus, ni sceau, ni publication');
});

test('le patch racine refuse un cycle inactif (review_not_allowed) et une révision périmée (revision_conflict)', () => {
  const decision = buildCartularyReviewDecision({ baseRevision: 3, level: 'partial' });
  for (const lifecycleStatus of ['suspended', 'transferred', 'archived']) {
    rejectsReview(() => cartularyReviewRootPatch({ root: { revision: 3, lifecycleStatus }, decision, occurredAt: OCCURRED_AT }), 'review_not_allowed', lifecycleStatus);
  }
  rejectsReview(() => cartularyReviewRootPatch({ root: { revision: 4, lifecycleStatus: 'review' }, decision, occurredAt: OCCURRED_AT }), 'revision_conflict');
  rejectsReview(() => cartularyReviewRootPatch({ root: { revision: 4, lifecycleStatus: 'suspended' }, decision, occurredAt: OCCURRED_AT }), 'revision_conflict', 'la révision est contrôlée avant le cycle de vie');
  rejectsReview(() => cartularyReviewRootPatch({ root: null, decision, occurredAt: OCCURRED_AT }), 'revision_conflict');
});

test('deriveCartularyReviewState : pending tant que le signal est levé, reviewed avec date et palier, actionable selon le cycle', () => {
  assert.deepEqual(deriveCartularyReviewState({ lifecycleStatus: 'review', completenessLevel: 'imported_unreviewed', lastVerifiedAt: null }), { kind: 'pending', actionable: true });
  assert.deepEqual(deriveCartularyReviewState({ lifecycleStatus: 'active', completenessLevel: 'imported_unreviewed', lastVerifiedAt: null }), { kind: 'pending', actionable: true }, 'objet reçu par cession');
  assert.deepEqual(deriveCartularyReviewState({ lifecycleStatus: 'active', completenessLevel: 'partial', lastVerifiedAt: OCCURRED_AT }), { kind: 'reviewed', reviewedAt: OCCURRED_AT, level: 'partial', actionable: true });
  assert.deepEqual(deriveCartularyReviewState({ lifecycleStatus: 'active', completenessLevel: 'complete' }), { kind: 'reviewed', reviewedAt: null, level: 'complete', actionable: true }, 'date absente → null');
  for (const lifecycleStatus of ['suspended', 'transferred', 'archived']) {
    assert.equal(deriveCartularyReviewState({ lifecycleStatus, completenessLevel: 'imported_unreviewed' }).actionable, false, lifecycleStatus);
    assert.equal(deriveCartularyReviewState({ lifecycleStatus, completenessLevel: 'complete', lastVerifiedAt: OCCURRED_AT }).actionable, false, lifecycleStatus);
  }
  assert.equal(deriveCartularyReviewState({ lifecycleStatus: 'suspended', completenessLevel: 'imported_unreviewed' }).kind, 'pending', 'le signal reste visible même si l’action est fermée');
});

test('la revue et le signal partagent la même définition : un patch appliqué éteint le signal', () => {
  const root = { revision: 5, lifecycleStatus: 'review', completenessLevel: 'imported_unreviewed', lastVerifiedAt: null };
  assert.equal(cartularyNeedsReview(root), true);
  const patched = { ...root, ...cartularyReviewRootPatch({ root, decision: buildCartularyReviewDecision({ baseRevision: 5, level: 'partial' }), occurredAt: OCCURRED_AT }) };
  assert.equal(cartularyNeedsReview(patched), false);
  assert.equal(deriveCartularyReviewState(patched).kind, 'reviewed');
});
