import assert from 'node:assert/strict';
import test from 'node:test';
import { addCalendarYears, evaluatePrivateRetention } from '../scripts/lib/retention-command.mjs';

test('la conservation privée expire deux années calendaires après le passage inactif', () => {
  assert.equal(addCalendarYears(new Date('2026-08-15T10:00:00Z')).toISOString(), '2028-08-15T10:00:00.000Z');
  assert.deepEqual(evaluatePrivateRetention({
    status: 'inactive',
    inactiveAt: new Date('2026-08-15T10:00:00Z'),
    now: new Date('2028-08-15T09:59:59Z'),
  }).eligible, false);
  assert.deepEqual(evaluatePrivateRetention({
    status: 'inactive',
    inactiveAt: new Date('2026-08-15T10:00:00Z'),
    now: new Date('2028-08-15T10:00:00Z'),
  }).eligible, true);
});

test('une année bissextile aboutit au dernier jour de février', () => {
  assert.equal(addCalendarYears(new Date('2024-02-29T12:00:00Z')).toISOString(), '2026-02-28T12:00:00.000Z');
});

test('un compte actif ou sans date inactive ne peut jamais être purgé par la tâche', () => {
  assert.equal(evaluatePrivateRetention({ status: 'active', inactiveAt: new Date('2020-01-01'), now: new Date('2030-01-01') }).eligible, false);
  assert.equal(evaluatePrivateRetention({ status: 'inactive', inactiveAt: null, now: new Date('2030-01-01') }).eligible, false);
});
