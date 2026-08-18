import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateXirr,
  hasMinimumSaleHorizon,
  todayIsoDate,
} from '../src/domain/valuationPerformance.ts';

test('le solveur conserve un TRI cohérent pour une plus-value de 10,3 % sur un an', () => {
  const irr = calculateXirr([
    { date: '2025-06-09', amount: -10_000 },
    { date: '2026-06-09', amount: 11_030 },
  ]);
  assert.ok(irr !== null);
  assert.ok(Math.abs(irr - 0.103) < 0.0002, `TRI inattendu : ${irr}`);
});

test('le TRI est non calculable quand la vente précède l’achat', () => {
  assert.equal(hasMinimumSaleHorizon('2026-06-09', '2026-06-02'), false);
  assert.equal(calculateXirr([
    { date: '2026-06-09', amount: -10_000 },
    { date: '2026-06-02', amount: 11_030 },
  ]), null);
});

test('le TRI est non calculable sous 30 jours et calculable à partir de 30 jours', () => {
  assert.equal(hasMinimumSaleHorizon('2026-06-01', '2026-06-30'), false);
  assert.equal(calculateXirr([
    { date: '2026-06-01', amount: -10_000 },
    { date: '2026-06-30', amount: 11_000 },
  ]), null);
  assert.equal(hasMinimumSaleHorizon('2026-06-01', '2026-07-01'), true);
  assert.notEqual(calculateXirr([
    { date: '2026-06-01', amount: -10_000 },
    { date: '2026-07-01', amount: 11_000 },
  ]), null);
});

test('la date du jour est produite dans le fuseau local sans date codée en dur', () => {
  assert.equal(todayIsoDate(new Date(2026, 7, 17, 12, 0, 0)), '2026-08-17');
});
