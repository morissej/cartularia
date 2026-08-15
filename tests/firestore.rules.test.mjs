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
  setDoc,
  where,
} from 'firebase/firestore';

const projectId = 'cartularia-wave1-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);

const ownerUid = 'owner-a';
const outsiderUid = 'owner-b';
const payerUid = 'payer-a';
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
          ['organization.read', 'membership.read', 'registry.read', 'cartulary.read'],
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
        defaultVisibility: 'secret',
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
