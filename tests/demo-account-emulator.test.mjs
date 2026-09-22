import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, orderBy, query, setDoc } from 'firebase/firestore';
import { DEMO_ACCOUNT, DEMO_CARTULARIES, DEMO_SUBMARINER_CARTULARY_ID } from '../src/data/demoCartularies.ts';
import { buildDemoAccessDocuments, buildDemoReminderDocuments } from '../src/data/demoCartularyDocuments.ts';

const hostAndPort = (value, fallbackPort) => {
  const [host = '127.0.0.1', port = String(fallbackPort)] = String(value || '').split(':');
  return { host, port: Number(port) };
};

test('le compte Firebase démo lit cinq Cartulaires « Complet », leurs rappels et accès fictifs, et ne peut pas écrire', async () => {
  const projectId = process.env.GCLOUD_PROJECT || 'cartularia-demo-test';
  const app = initializeApp({ apiKey: 'demo-api-key', projectId }, `demo-${Date.now()}`);
  const auth = getAuth(app);
  const firestore = getFirestore(app);
  const authEmulator = hostAndPort(process.env.FIREBASE_AUTH_EMULATOR_HOST, 19099);
  const firestoreEmulator = hostAndPort(process.env.FIRESTORE_EMULATOR_HOST, 18087);
  connectAuthEmulator(auth, `http://${authEmulator.host}:${authEmulator.port}`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, firestoreEmulator.host, firestoreEmulator.port);

  try {
    const email = `${createHash('sha256')
      .update(`registry-alias\u0000${DEMO_ACCOUNT.userName.toLocaleLowerCase('fr')}`)
      .digest('hex')}@registry.cartularia.invalid`;
    await signInWithEmailAndPassword(auth, email, DEMO_ACCOUNT.password);

    const items = await getDocs(collection(firestore, 'registries', DEMO_ACCOUNT.registryId, 'items'));
    assert.equal(items.size, DEMO_CARTULARIES.length);
    assert.deepEqual(
      new Set(items.docs.map((entry) => entry.data().makerName)),
      new Set(DEMO_CARTULARIES.map(({ brand }) => brand)),
    );

    const submariner = await getDoc(doc(firestore, 'cartularies', DEMO_SUBMARINER_CARTULARY_ID));
    assert.equal(submariner.data()?.referenceCode, '124060');
    const sections = await getDocs(collection(firestore, 'cartularies', DEMO_SUBMARINER_CARTULARY_ID, 'sections'));
    assert.ok(sections.size >= 9);

    await assert.rejects(
      setDoc(doc(firestore, 'cartularies', DEMO_SUBMARINER_CARTULARY_ID, 'reminders', 'demo_write_forbidden'), {
        id: 'demo_write_forbidden',
        cartularyId: DEMO_SUBMARINER_CARTULARY_ID,
        organizationId: DEMO_ACCOUNT.organizationId,
        title: 'Cette écriture doit être refusée',
        dueAt: '2026-12-01T00:00:00.000Z',
        category: 'custom',
        reminderStatus: 'active',
        visibility: 'secret',
        source: 'registry',
        createdBy: auth.currentUser?.uid,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      /permission-denied|Missing or insufficient permissions/,
    );
    // Enrichissement v2 : dossiers « Complet », rappels de Suivi et projections d'Accès lisibles par la démo.
    assert.ok(items.docs.every((entry) => entry.data().completenessLevel === 'complete'), 'aucune carte « Données à vérifier »');
    const expectedReminderIds = DEMO_CARTULARIES.flatMap((cartulary) => buildDemoReminderDocuments(cartulary).map(({ id }) => id)).sort();
    const reminderIds = [];
    for (const cartulary of DEMO_CARTULARIES) {
      const reminders = await getDocs(collection(firestore, 'cartularies', cartulary.id, 'reminders'));
      reminderIds.push(...reminders.docs.map((entry) => entry.id));
      assert.ok(reminders.docs.every((entry) => entry.data().visibility === 'secret' && entry.data().cartularyId === cartulary.id && entry.data().createdBy === auth.currentUser?.uid));
    }
    assert.deepEqual(reminderIds.sort(), expectedReminderIds);
    assert.ok(expectedReminderIds.some((id) => id.includes('rolex-submariner')), 'la Submariner porte au moins un rappel');
    assert.equal(reminderIds.length, 6);

    const accesses = await getDocs(query(collection(firestore, 'registries', DEMO_ACCOUNT.registryId, 'accesses'), orderBy('updatedAt', 'desc')));
    assert.deepEqual(accesses.docs.map((entry) => entry.id).sort(), buildDemoAccessDocuments().map(({ id }) => id).sort());
    assert.ok(accesses.docs.every((entry) => entry.data().projectionStatus === 'active' && entry.data().registryId === DEMO_ACCOUNT.registryId));
    assert.ok(accesses.docs.every((entry) => !/^[^\s@*]+@[^\s@]+$/.test(entry.data().recipientLabel)), 'aucune adresse réelle projetée');
    await assert.rejects(getDoc(doc(firestore, 'registryInvitations', 'acc_demo_invitation_expert')), /permission-denied|Missing or insufficient permissions/);
    await assert.rejects(
      setDoc(doc(firestore, 'registries', DEMO_ACCOUNT.registryId, 'accesses', 'demo_access_forbidden'), { ...buildDemoAccessDocuments()[0], id: 'demo_access_forbidden', contentHash: 'sha256:forbidden' }),
      /permission-denied|Missing or insufficient permissions/,
    );

    await assert.rejects(
      setDoc(doc(firestore, 'privateDrafts', auth.currentUser.uid, 'cartularies', DEMO_SUBMARINER_CARTULARY_ID), {
        ownerUid: auth.currentUser.uid,
        cartularyId: DEMO_SUBMARINER_CARTULARY_ID,
        status: 'active',
        retentionPolicyVersion: 'inactive-plus-2y-v1',
      }),
      /permission-denied|Missing or insufficient permissions/,
    );
  } finally {
    await deleteApp(app);
  }
});
