import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

const projectId = 'cartularia-wave1-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);

const ownerUid = 'owner-a';
const outsiderUid = 'owner-b';
const payerUid = 'payer-a';
const registryReaderUid = 'reader-a';
const ownerOrganizationId = 'org-a';
const outsiderOrganizationId = 'org-b';
const ownerRegistryId = 'reg-a';
const outsiderRegistryId = 'reg-b';

let testEnvironment;

const membership = (uid, organizationId, registryId, permissions, roles) => ({
  uid,
  organizationId,
  roles,
  status: 'active',
  scopes: { registryIds: [registryId] },
  permissions,
  createdAt: new Date('2026-08-14T08:00:00.000Z'),
  revokedAt: null,
});

before(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      host,
      port,
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  });
});

after(async () => {
  await testEnvironment.cleanup();
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, 'users', ownerUid), { uid: ownerUid, status: 'active' }),
      setDoc(doc(firestore, 'users', outsiderUid), { uid: outsiderUid, status: 'active' }),
      setDoc(doc(firestore, 'users', registryReaderUid), { uid: registryReaderUid, status: 'active' }),
      setDoc(doc(firestore, 'organizations', ownerOrganizationId), {
        id: ownerOrganizationId,
        name: 'Organisation A',
        status: 'active',
      }),
      setDoc(doc(firestore, 'organizations', outsiderOrganizationId), {
        id: outsiderOrganizationId,
        name: 'Organisation B',
        status: 'active',
      }),
      setDoc(
        doc(firestore, 'organizations', ownerOrganizationId, 'memberships', ownerUid),
        membership(
          ownerUid,
          ownerOrganizationId,
          ownerRegistryId,
          ['organization.read', 'membership.read', 'registry.read', 'access.read', 'cartulary.read', 'cartulary.edit'],
          ['account_holder', 'legal_owner'],
        ),
      ),
      setDoc(
        doc(firestore, 'organizations', outsiderOrganizationId, 'memberships', outsiderUid),
        membership(
          outsiderUid,
          outsiderOrganizationId,
          outsiderRegistryId,
          ['organization.read', 'membership.read', 'registry.read'],
          ['account_holder'],
        ),
      ),
      setDoc(
        doc(firestore, 'organizations', ownerOrganizationId, 'memberships', payerUid),
        membership(payerUid, ownerOrganizationId, ownerRegistryId, ['billing.read'], ['payer']),
      ),
      setDoc(
        doc(firestore, 'organizations', ownerOrganizationId, 'memberships', registryReaderUid),
        membership(registryReaderUid, ownerOrganizationId, ownerRegistryId, ['organization.read', 'registry.read'], ['manager']),
      ),
      setDoc(doc(firestore, 'registries', ownerRegistryId), {
        id: ownerRegistryId,
        organizationId: ownerOrganizationId,
        name: 'Registre A',
        status: 'active',
        visibility: 'secret',
      }),
      setDoc(doc(firestore, 'registries', outsiderRegistryId), {
        id: outsiderRegistryId,
        organizationId: outsiderOrganizationId,
        name: 'Registre B',
        status: 'active',
        visibility: 'secret',
      }),
      setDoc(doc(firestore, 'schemaCatalog', 'watch'), {
        assetType: 'watch',
        latestVersion: '1.3.0',
        status: 'active',
      }),
      setDoc(doc(firestore, 'cartularies', 'cart-a'), {
        organizationId: ownerOrganizationId,
        registryId: ownerRegistryId,
        accountHolderId: ownerUid,
        defaultVisibility: 'secret',
      }),
      setDoc(doc(firestore, 'cartularies', 'cart-a', 'reminders', 'rem-a'), {
        id: 'rem-a',
        cartularyId: 'cart-a',
        organizationId: ownerOrganizationId,
        title: 'Échéance privée',
        dueAt: '2026-09-01T00:00:00.000Z',
        reminderStatus: 'planned',
        visibility: 'secret',
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId, 'accesses', 'access-a'), {
        id: 'access-a',
        organizationId: ownerOrganizationId,
        registryId: ownerRegistryId,
        cartularyId: 'cart-a',
        displayTitle: 'Cartulaire privé',
        recipientLabel: 'e***@example.test',
        recipientKind: 'person',
        accessKind: 'invitation',
        sourceStatus: 'active',
        issuedAt: '2026-08-14T08:00:00.000Z',
        expiresAt: '2026-09-14T08:00:00.000Z',
        revokedAt: null,
        lastConsultedAt: null,
        consultationCount: 0,
        sourceRevision: 1,
        projectionStatus: 'active',
        contentHash: 'sha256:test',
        updatedAt: new Date('2026-08-14T08:00:00.000Z'),
      }),
    ]);
  });
});

test('un propriétaire lit son compte, son organisation et son Registre', async () => {
  const firestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  await assertSucceeds(getDoc(doc(firestore, 'users', ownerUid)));
  await assertSucceeds(getDoc(doc(firestore, 'organizations', ownerOrganizationId)));
  await assertSucceeds(getDoc(doc(firestore, 'registries', ownerRegistryId)));
});

test('un second compte ne peut ni lire ni découvrir les ressources du premier tenant', async () => {
  const firestore = testEnvironment.authenticatedContext(outsiderUid).firestore();
  await assertFails(getDoc(doc(firestore, 'organizations', ownerOrganizationId)));
  await assertFails(getDoc(doc(firestore, 'registries', ownerRegistryId)));
  await assertFails(getDoc(doc(firestore, 'cartularies', 'cart-a')));
});

test('un payeur sans permission patrimoniale ne lit ni Registre ni Cartulaire', async () => {
  const firestore = testEnvironment.authenticatedContext(payerUid).firestore();
  await assertFails(getDoc(doc(firestore, 'registries', ownerRegistryId)));
  await assertFails(getDoc(doc(firestore, 'cartularies', 'cart-a')));
});

test('les rappels restent lisibles seulement avec le droit de lecture du Cartulaire', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext(outsiderUid).firestore();
  const payerFirestore = testEnvironment.authenticatedContext(payerUid).firestore();
  const reminderPath = ['cartularies', 'cart-a', 'reminders', 'rem-a'];
  await assertSucceeds(getDoc(doc(ownerFirestore, ...reminderPath)));
  await assertSucceeds(getDocs(collection(ownerFirestore, 'cartularies', 'cart-a', 'reminders')));
  await assertFails(getDoc(doc(outsiderFirestore, ...reminderPath)));
  await assertFails(getDoc(doc(payerFirestore, ...reminderPath)));
});

test('le Centre des accès exige la permission dédiée dans le Registre autorisé', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const readerFirestore = testEnvironment.authenticatedContext(registryReaderUid).firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext(outsiderUid).firestore();
  const accessPath = ['registries', ownerRegistryId, 'accesses', 'access-a'];
  await assertSucceeds(getDoc(doc(ownerFirestore, ...accessPath)));
  await assertSucceeds(getDocs(collection(ownerFirestore, 'registries', ownerRegistryId, 'accesses')));
  await assertFails(getDoc(doc(readerFirestore, ...accessPath)));
  await assertFails(getDoc(doc(outsiderFirestore, ...accessPath)));
  await assertFails(setDoc(doc(ownerFirestore, ...accessPath), { sourceStatus: 'revoked' }, { merge: true }));
});

test('la liste des memberships reste bornée à l’organisation et au droit dédié', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext(outsiderUid).firestore();
  const payerFirestore = testEnvironment.authenticatedContext(payerUid).firestore();
  await assertSucceeds(getDocs(collection(ownerFirestore, 'organizations', ownerOrganizationId, 'memberships')));
  await assertFails(getDocs(collection(outsiderFirestore, 'organizations', ownerOrganizationId, 'memberships')));
  await assertFails(getDocs(collection(payerFirestore, 'organizations', ownerOrganizationId, 'memberships')));
  await assertSucceeds(getDoc(doc(payerFirestore, 'organizations', ownerOrganizationId, 'memberships', payerUid)));
});

test('le client ne peut modifier aucune fondation autoritaire', async () => {
  const firestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  await assertFails(setDoc(doc(firestore, 'registries', ownerRegistryId), { name: 'Altéré' }, { merge: true }));
  await assertFails(
    setDoc(doc(firestore, 'organizations', ownerOrganizationId, 'memberships', ownerUid), {
      permissions: ['platform.admin'],
    }, { merge: true }),
  );
  await assertFails(setDoc(doc(firestore, 'schemaCatalog', 'watch'), { latestVersion: '999.0.0' }, { merge: true }));
});

test('le propriétaire peut mettre à jour uniquement son activité de compte', async () => {
  const firestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  await assertSucceeds(setDoc(doc(firestore, 'users', ownerUid), {
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
  await assertFails(setDoc(doc(firestore, 'users', ownerUid), {
    status: 'closed',
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
  const outsiderFirestore = testEnvironment.authenticatedContext(outsiderUid).firestore();
  await assertFails(setDoc(doc(outsiderFirestore, 'users', ownerUid), {
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true }));
});

test('un brouillon cloud privé est modifiable uniquement par son compte propriétaire', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext(outsiderUid).firestore();
  const rootPath = ['privateDrafts', ownerUid, 'cartularies', 'cart-a'];
  const statePath = [...rootPath, 'state', 'cartularia-owner-fields'];
  await assertSucceeds(setDoc(doc(ownerFirestore, ...rootPath), {
    ownerUid,
    cartularyId: 'cart-a',
    status: 'active',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    purgeAfter: null,
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(doc(ownerFirestore, ...statePath), {
    ownerUid,
    cartularyId: 'cart-a',
    key: 'cartularia-owner-fields',
    value: '[{"value":"secret"}]',
    deleted: false,
    revision: 1,
    clientUpdatedAt: 1,
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(getDoc(doc(ownerFirestore, ...statePath)));
  await assertFails(getDoc(doc(outsiderFirestore, ...statePath)));
  await assertFails(setDoc(doc(outsiderFirestore, ...statePath), {
    ownerUid,
    cartularyId: 'cart-a',
    key: 'cartularia-owner-fields',
    value: 'vol',
    deleted: false,
    revision: 2,
    clientUpdatedAt: 2,
    updatedAt: serverTimestamp(),
  }));
});

test('le propriétaire peut demander une synchronisation autoritaire sans écrire directement le Cartulaire', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext(outsiderUid).firestore();
  const requestPath = ['cartularySyncRequests', 'cart-a'];
  const validRequest = {
    requestDocumentId: 'cart-a',
    requestId: 'sync_m1k2n3p4_1234567890abcdef',
    ownerUid,
    cartularyId: 'cart-a',
    reason: 'private_draft_synchronized',
    status: 'pending',
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(ownerFirestore, ...requestPath), validRequest));
  await assertSucceeds(getDoc(doc(ownerFirestore, ...requestPath)));
  await assertFails(setDoc(doc(outsiderFirestore, ...requestPath), { ...validRequest, ownerUid: outsiderUid }));
  await assertFails(setDoc(doc(ownerFirestore, ...requestPath), {
    ...validRequest,
    status: 'processed',
    result: { revision: 99 },
  }));
  await assertFails(setDoc(doc(ownerFirestore, 'cartularies', 'cart-a'), { makerName: 'Altéré' }, { merge: true }));
});

test('un brouillon supprimé ne peut pas être ressuscité par le navigateur', async () => {
  const firestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const root = doc(firestore, 'privateDrafts', ownerUid, 'cartularies', 'cart-a');
  await assertSucceeds(setDoc(root, {
    ownerUid,
    cartularyId: 'cart-a',
    status: 'active',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    purgeAfter: null,
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(setDoc(root, {
    ownerUid,
    cartularyId: 'cart-a',
    status: 'deleted',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    deletedAt: serverTimestamp(),
    purgeAfter: null,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(root, {
    ownerUid,
    cartularyId: 'cart-a',
    status: 'active',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    purgeAfter: null,
    updatedAt: serverTimestamp(),
  }));
});

test('un compte passé inactif ne peut plus synchroniser son brouillon privé', async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users', ownerUid), { uid: ownerUid, status: 'inactive' });
  });
  const firestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  await assertFails(setDoc(doc(firestore, 'privateDrafts', ownerUid, 'cartularies', 'cart-inactive'), {
    ownerUid,
    cartularyId: 'cart-inactive',
    status: 'active',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    purgeAfter: null,
    updatedAt: serverTimestamp(),
  }));
});

test('la découverte des memberships est bornée au uid authentifié', async () => {
  const firestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const ownMemberships = query(
    collectionGroup(firestore, 'memberships'),
    where('uid', '==', ownerUid),
    where('status', '==', 'active'),
  );
  const foreignMemberships = query(collectionGroup(firestore, 'memberships'), where('uid', '==', outsiderUid));
  await assertSucceeds(getDocs(ownMemberships));
  await assertFails(getDocs(foreignMemberships));
});

test('une requête Registre non bornée échoue en entier', async () => {
  const firestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  await assertFails(getDocs(collection(firestore, 'registries')));
});

test('le schéma watch est lisible par un compte authentifié mais pas anonymement', async () => {
  const authenticatedFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const anonymousFirestore = testEnvironment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(authenticatedFirestore, 'schemaCatalog', 'watch')));
  await assertFails(getDoc(doc(anonymousFirestore, 'schemaCatalog', 'watch')));
});
