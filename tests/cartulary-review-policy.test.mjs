import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cartularyNeedsReview } from '../scripts/lib/cartulary-review-policy.mjs';

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
