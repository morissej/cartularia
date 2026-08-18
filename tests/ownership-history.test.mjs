import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeOwnershipHistory,
  ownershipHistorySummary,
  ownershipValuationAssessment,
} from '../src/domain/ownershipHistory.ts';

test('la normalisation conserve un seul premier propriétaire', () => {
  const entries = normalizeOwnershipHistory([
    { id: 'one', fromYear: '1969', toYear: '1980', description: 'Origine', firstOwner: true },
    { id: 'two', fromYear: '1980', toYear: '2002', description: 'Deuxième période', firstOwner: true },
  ]);
  assert.equal(entries.filter((entry) => entry.firstOwner).length, 1);
  assert.equal(entries[0].firstOwner, true);
  assert.equal(entries[1].firstOwner, false);
});

test('les résumés signalent les lacunes de provenance', () => {
  assert.match(ownershipHistorySummary([]), /non renseigné/);
  assert.match(ownershipValuationAssessment([]), /réserve explicite/);
  assert.match(ownershipValuationAssessment([
    { id: 'one', fromYear: '1969', toYear: '1980', description: '', firstOwner: false },
  ]), /premier propriétaire n’est pas identifié/);
});

test('le premier propriétaire devient un critère explicite d’évaluation', () => {
  const entries = [{ id: 'one', fromYear: '1969', toYear: '1980', description: 'Dossier documenté.', firstOwner: true }];
  const summary = ownershipHistorySummary(entries);
  assert.match(summary, /premier propriétaire/);
  assert.doesNotMatch(summary, /\.\.|\. ;/);
  assert.match(ownershipValuationAssessment(entries), /facteur d’évaluation important/);
});
