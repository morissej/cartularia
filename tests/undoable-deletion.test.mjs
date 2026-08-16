import assert from 'node:assert/strict';
import test from 'node:test';

import { removeItemById, restoreItemAtIndex } from '../src/utils/undoableDeletion.ts';

test('une suppression conserve la valeur et sa position pour permettre l’annulation', () => {
  const source = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const removed = removeItemById(source, 'b');
  assert.ok(removed);
  assert.equal(removed.index, 1);
  assert.deepEqual(removed.remaining.map((item) => item.id), ['a', 'c']);
  assert.deepEqual(restoreItemAtIndex(removed.remaining, removed.item, removed.index).map((item) => item.id), ['a', 'b', 'c']);
});

test('un identifiant absent ne modifie jamais la collection', () => {
  const source = [{ id: 'a' }];
  assert.equal(removeItemById(source, 'missing'), null);
});

test('une annulation rejouée reste idempotente', () => {
  const source = [{ id: 'a' }, { id: 'b' }];
  assert.equal(restoreItemAtIndex(source, { id: 'b' }, 0), source);
});
