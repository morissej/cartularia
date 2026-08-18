import assert from 'node:assert/strict';
import test from 'node:test';

import { COLLECTION_ID_PATTERN } from '../src/domain/collectionIdentifiers.ts';
import {
  CARTULARY_CREATION_TIMEOUT_MESSAGE,
  resumeOrCreateCartulary,
} from '../src/domain/cartularyCreation.ts';

test('le pattern HTML de collection reste valide sous le drapeau v et rejette AB!', () => {
  const browserPattern = new RegExp(`^(?:${COLLECTION_ID_PATTERN})$`, 'v');
  assert.equal(browserPattern.test('AB!'), false);
  assert.equal(browserPattern.test('x'), false);
  assert.equal(browserPattern.test('col_divers'), true);
});

test('une reprise réutilise la demande existante sans relancer la création', async () => {
  const pending = {
    cartularyId: 'cart_breitling_navitimer_attempt01',
    requestId: 'create_attempt01',
    publicCode: 'BRE-ATTEMPT01',
    uploadedFileCount: 4,
    uploadedBytes: 1024,
  };
  let createCalls = 0;
  const result = await resumeOrCreateCartulary(pending, async () => {
    createCalls += 1;
    return { ...pending, cartularyId: 'cart_duplicate' };
  });
  assert.equal(result, pending);
  assert.equal(createCalls, 0);
});

test('le délai prévient qu’une création peut encore aboutir avant toute nouvelle tentative', () => {
  assert.match(CARTULARY_CREATION_TIMEOUT_MESSAGE, /peut encore aboutir/);
  assert.match(CARTULARY_CREATION_TIMEOUT_MESSAGE, /Vérifiez le catalogue/);
  assert.match(CARTULARY_CREATION_TIMEOUT_MESSAGE, /même demande sans téléverser à nouveau/);
});
