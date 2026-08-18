import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SESSION_HIDDEN_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  STEP_UP_MAX_AGE_MS,
  authenticationIsRecent,
  sessionLockReason,
} from '../src/security/sessionSecurity.ts';

test('la session reste ouverte pendant une activité ordinaire', () => {
  const now = 10_000_000;
  assert.equal(sessionLockReason({
    now,
    lastActivityAt: now - SESSION_IDLE_TIMEOUT_MS + 1,
    hiddenAt: null,
  }), null);
});

test('la session se verrouille après 30 minutes sans interaction', () => {
  const now = 10_000_000;
  assert.equal(sessionLockReason({
    now,
    lastActivityAt: now - SESSION_IDLE_TIMEOUT_MS,
    hiddenAt: null,
  }), 'idle');
});

test('un onglet privé laissé en arrière-plan se verrouille après 15 minutes', () => {
  const now = 10_000_000;
  assert.equal(sessionLockReason({
    now,
    lastActivityAt: now - 60_000,
    hiddenAt: now - SESSION_HIDDEN_TIMEOUT_MS,
  }), 'hidden');
});

test('le step-up ne redemande rien pendant les cinq minutes suivant la connexion', () => {
  const now = Date.parse('2026-08-18T20:00:00.000Z');
  assert.equal(authenticationIsRecent('2026-08-18T19:55:00.000Z', now, STEP_UP_MAX_AGE_MS), true);
  assert.equal(authenticationIsRecent('2026-08-18T19:54:59.999Z', now, STEP_UP_MAX_AGE_MS), false);
  assert.equal(authenticationIsRecent(undefined, now, STEP_UP_MAX_AGE_MS), false);
});

test('les actes critiques sont câblés sans imposer le step-up aux sélections locales W/R/C', async () => {
  const [firebaseSource, auditSource, transferSource, appSource] = await Promise.all([
    readFile('src/firebase.ts', 'utf8'),
    readFile('src/components/AuditPanel.tsx', 'utf8'),
    readFile('src/components/CartularyTransferPanel.tsx', 'utf8'),
    readFile('src/App.tsx', 'utf8'),
  ]);
  assert.match(firebaseSource, /installSessionLock\(auth\)/);
  assert.match(auditSource, /runWithStepUp\('cloud_delete'/);
  assert.match(auditSource, /runWithStepUp\('secret_export'/);
  assert.match(transferSource, /'transfer_propose'/);
  assert.match(transferSource, /'transfer_accept'/);
  assert.match(transferSource, /'transfer_reject'/);
  assert.doesNotMatch(appSource, /runWithStepUp\([^)]*publication/);
});
