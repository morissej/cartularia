import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { purgeAccountPrivateDrafts } from '../scripts/lib/retention-command.mjs';

const projectId = process.env.GCLOUD_PROJECT || 'cartularia-retention-test';
let app;
let firestore;

before(async () => {
  app = getApps().find((candidate) => candidate.name === 'retention-command-test')
    || initializeApp({ projectId }, 'retention-command-test');
  firestore = getFirestore(app);
  const uid = 'inactive-owner';
  await firestore.doc(`users/${uid}`).set({
    uid,
    status: 'inactive',
    inactiveAt: Timestamp.fromDate(new Date('2024-01-01T00:00:00Z')),
    purgeAfter: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
  });
  const root = firestore.doc(`privateDrafts/${uid}/cartularies/cart-retained`);
  await root.set({ ownerUid: uid, cartularyId: 'cart-retained', status: 'active' });
  await root.collection('state').doc('cartularia-owner-fields').set({ value: 'secret' });
  await root.collection('binaries').doc('binary-retained').set({
    storagePath: `private-drafts/${uid}/cart-retained/binary-retained/${'a'.repeat(64)}/original`,
  });
});

after(async () => {
  if (app) await deleteApp(app);
});

test('la tâche fait un dry-run puis supprime récursivement un brouillon privé arrivé à échéance', async () => {
  const uid = 'inactive-owner';
  const root = firestore.doc(`privateDrafts/${uid}/cartularies/cart-retained`);
  const dryRun = await purgeAccountPrivateDrafts({
    firestore,
    uid,
    now: new Date('2026-01-01T00:00:00Z'),
    dryRun: true,
  });
  assert.equal(dryRun.eligible, true);
  assert.deepEqual(dryRun.cartularies, ['cart-retained']);
  assert.equal((await root.get()).exists, true);

  const executed = await purgeAccountPrivateDrafts({
    firestore,
    uid,
    now: new Date('2026-01-01T00:00:00Z'),
    dryRun: false,
  });
  assert.equal(executed.dryRun, false);
  assert.equal((await root.get()).exists, false);
  assert.equal((await firestore.doc(`users/${uid}`).get()).data().privateDataStatus, 'purged');
});
