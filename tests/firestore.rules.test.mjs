import assert from 'node:assert/strict';
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
  deleteField,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  query,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { requireEmulatorEndpoint } from './helpers/require-emulator.mjs';

const projectId = 'cartularia-wave1-test';
const { host, port } = requireEmulatorEndpoint('FIRESTORE_EMULATOR_HOST');

const ownerUid = 'owner-a';
const outsiderUid = 'owner-b';
const payerUid = 'payer-a';
const registryReaderUid = 'reader-a';
const invitedUid = 'invited-a';
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
      setDoc(doc(firestore, 'users', payerUid), { uid: payerUid, status: 'active' }),
      setDoc(doc(firestore, 'users', registryReaderUid), { uid: registryReaderUid, status: 'active' }),
      setDoc(doc(firestore, 'users', invitedUid), { uid: invitedUid, status: 'active' }),
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
          ['organization.read', 'membership.read', 'registry.read', 'valuation.read', 'access.read', 'cartulary.read', 'cartulary.edit'],
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
      setDoc(doc(firestore, 'organizations', ownerOrganizationId, 'memberships', invitedUid), {
        ...membership(invitedUid, ownerOrganizationId, ownerRegistryId, ['organization.read', 'registry.read', 'valuation.read', 'cartulary.read'], ['guest']),
        invitationManaged: true,
        invitationGrants: {
          [ownerRegistryId]: { registry: false, collectionIds: [], cartularyIds: ['cart-a'] },
        },
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId), {
        id: ownerRegistryId,
        organizationId: ownerOrganizationId,
        name: 'Registre A',
        status: 'active',
        visibility: 'secret',
        referenceCurrency: 'EUR',
      }),
      setDoc(doc(firestore, 'registries', outsiderRegistryId), {
        id: outsiderRegistryId,
        organizationId: outsiderOrganizationId,
        name: 'Registre B',
        status: 'active',
        visibility: 'secret',
        referenceCurrency: 'EUR',
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
      setDoc(doc(firestore, 'cartularies', 'cart-b'), {
        organizationId: ownerOrganizationId,
        registryId: ownerRegistryId,
        accountHolderId: ownerUid,
        defaultVisibility: 'secret',
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId, 'items', 'cart-a'), {
        cartularyId: 'cart-a', registryId: ownerRegistryId, organizationId: ownerOrganizationId, collectionId: 'col-a',
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId, 'items', 'cart-b'), {
        cartularyId: 'cart-b', registryId: ownerRegistryId, organizationId: ownerOrganizationId, collectionId: 'col-b',
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId, 'valuationItems', 'cart-a'), {
        schemaVersion: 'registry-valuation@1.0.0', cartularyId: 'cart-a', registryId: ownerRegistryId,
        organizationId: ownerOrganizationId, collectionId: 'col-a', collectionIds: ['col-a'],
        projectionStatus: 'active', visibility: 'secret', marketValue: { amount: 1000, currency: 'EUR' },
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId, 'valuationItems', 'cart-b'), {
        schemaVersion: 'registry-valuation@1.0.0', cartularyId: 'cart-b', registryId: ownerRegistryId,
        organizationId: ownerOrganizationId, collectionId: 'col-b', collectionIds: ['col-b'],
        projectionStatus: 'active', visibility: 'secret', marketValue: { amount: 2000, currency: 'EUR' },
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId, 'documentationItems', 'cart-a'), {
        schemaVersion: 'documentation-assessment@1.0.0', cartularyId: 'cart-a', registryId: ownerRegistryId,
        organizationId: ownerOrganizationId, collectionId: 'col-a', collectionIds: ['col-a'],
        assessmentStatus: 'evaluated', documentationTier: 'P2', projectionStatus: 'active', visibility: 'secret',
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId, 'documentationItems', 'cart-b'), {
        schemaVersion: 'documentation-assessment@1.0.0', cartularyId: 'cart-b', registryId: ownerRegistryId,
        organizationId: ownerOrganizationId, collectionId: 'col-b', collectionIds: ['col-b'],
        assessmentStatus: 'evaluated', documentationTier: 'P1', projectionStatus: 'active', visibility: 'secret',
      }),
      setDoc(doc(firestore, 'cartularies', 'cart-a', 'documentationAssessments', 'current'), {
        schemaVersion: 'documentation-assessment@1.0.0', cartularyId: 'cart-a', assessmentStatus: 'evaluated',
        documentationTier: 'P2', visibility: 'secret',
      }),
      setDoc(doc(firestore, 'registries', ownerRegistryId, 'valuationSnapshots', 'statement-a'), {
        schemaVersion: 'registry-valuation-snapshot@1.0.0', snapshotId: 'statement-a', registryId: ownerRegistryId,
        organizationId: ownerOrganizationId, scopeType: 'registry', scopeId: ownerRegistryId,
        visibility: 'secret', immutable: true, totalMarketValue: 3000,
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

test('les valeurs exigent valuation.read et restent bornées au mandat', async () => {
  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const reader = testEnvironment.authenticatedContext(registryReaderUid).firestore();
  const invited = testEnvironment.authenticatedContext(invitedUid).firestore();
  const itemA = ['registries', ownerRegistryId, 'valuationItems', 'cart-a'];
  const itemB = ['registries', ownerRegistryId, 'valuationItems', 'cart-b'];
  const statement = ['registries', ownerRegistryId, 'valuationSnapshots', 'statement-a'];
  await assertSucceeds(getDoc(doc(owner, ...itemA)));
  await assertSucceeds(getDocs(collection(owner, 'registries', ownerRegistryId, 'valuationItems')));
  await assertSucceeds(getDoc(doc(owner, ...statement)));
  await assertSucceeds(getDocs(collection(owner, 'registries', ownerRegistryId, 'valuationSnapshots')));
  await assertFails(getDoc(doc(reader, ...itemA)));
  await assertFails(getDoc(doc(reader, ...statement)));
  await assertSucceeds(getDoc(doc(invited, ...itemA)));
  await assertFails(getDoc(doc(invited, ...itemB)));
  await assertFails(getDoc(doc(invited, ...statement)));
  await assertFails(getDocs(collection(invited, 'registries', ownerRegistryId, 'valuationSnapshots')));
  await assertFails(updateDoc(doc(owner, ...itemA), { 'marketValue.amount': 9999 }));
  await assertFails(deleteDoc(doc(owner, ...statement)));
});

test('les paliers documentaires Secrets exigent les droits de valeur, respectent le mandat et restent non modifiables', async () => {
  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const reader = testEnvironment.authenticatedContext(registryReaderUid).firestore();
  const invited = testEnvironment.authenticatedContext(invitedUid).firestore();
  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  const itemA = ['registries', ownerRegistryId, 'documentationItems', 'cart-a'];
  const itemB = ['registries', ownerRegistryId, 'documentationItems', 'cart-b'];
  const assessmentA = ['cartularies', 'cart-a', 'documentationAssessments', 'current'];
  await assertSucceeds(getDoc(doc(owner, ...itemA)));
  await assertSucceeds(getDocs(collection(owner, 'registries', ownerRegistryId, 'documentationItems')));
  await assertFails(getDoc(doc(reader, ...itemA)));
  await assertSucceeds(getDoc(doc(invited, ...itemA)));
  await assertFails(getDoc(doc(invited, ...itemB)));
  await assertSucceeds(getDoc(doc(invited, ...assessmentA)));
  await assertFails(getDoc(doc(anonymous, ...itemA)));
  await assertFails(getDoc(doc(anonymous, ...assessmentA)));
  await assertFails(updateDoc(doc(owner, ...itemA), { documentationTier: 'P4' }));
  await assertFails(setDoc(doc(owner, ...assessmentA), { documentationTier: 'P4' }, { merge: true }));
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

test('un éditeur coordonne les tâches du Registre avec le Cartulaire, un lecteur ne peut pas les modifier', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const invitedFirestore = testEnvironment.authenticatedContext(invitedUid).firestore();
  const reminderPath = ['cartularies', 'cart-a', 'reminders', 'todo-registry'];
  await assertSucceeds(setDoc(doc(ownerFirestore, ...reminderPath), {
    id: 'todo-registry',
    cartularyId: 'cart-a',
    organizationId: ownerOrganizationId,
    title: 'Contrôler la police d’assurance',
    dueAt: '2026-10-15',
    category: 'insurance',
    reminderStatus: 'planned',
    visibility: 'secret',
    source: 'registry',
    createdBy: ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  await assertSucceeds(updateDoc(doc(ownerFirestore, ...reminderPath), {
    reminderStatus: 'completed',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(updateDoc(doc(invitedFirestore, ...reminderPath), {
    reminderStatus: 'dismissed',
    updatedAt: serverTimestamp(),
  }));
  await assertFails(deleteDoc(doc(invitedFirestore, ...reminderPath)));
  await assertSucceeds(deleteDoc(doc(ownerFirestore, ...reminderPath)));
});

test("une invitation Cartulaire n’ouvre aucun autre objet du même Registre", async () => {
  const firestore = testEnvironment.authenticatedContext(invitedUid).firestore();
  await assertSucceeds(getDoc(doc(firestore, 'registries', ownerRegistryId)));
  await assertSucceeds(getDoc(doc(firestore, 'registries', ownerRegistryId, 'items', 'cart-a')));
  await assertSucceeds(getDoc(doc(firestore, 'cartularies', 'cart-a')));
  await assertSucceeds(getDoc(doc(firestore, 'cartularies', 'cart-a', 'reminders', 'rem-a')));
  await assertFails(getDoc(doc(firestore, 'registries', ownerRegistryId, 'items', 'cart-b')));
  await assertFails(getDoc(doc(firestore, 'cartularies', 'cart-b')));
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
  await assertFails(setDoc(doc(ownerFirestore, ...accessPath), {
    sourceStatus: 'revoked',
    revokedAt: '2026-08-19T10:00:00.000Z',
    updatedAt: serverTimestamp(),
  }, { merge: true }));
  await assertFails(setDoc(doc(readerFirestore, ...accessPath), { sourceStatus: 'revoked' }, { merge: true }));
});

test('N-R01 : aucune écriture directe de Collection ne contourne la commande versionnée', async () => {
  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const reader = testEnvironment.authenticatedContext(registryReaderUid).firestore();
  const path = ['registries', ownerRegistryId, 'collections', 'col_art'];
  const value = { id: 'col_art', organizationId: ownerOrganizationId, registryId: ownerRegistryId, name: 'Art', description: '', websiteTitle: 'Art', websiteSlug: 'art', status: 'draft', visibility: 'secret', publicationConsent: false, publishedCartularyIds: [], versionToken: 'version-1' };
  await assertFails(setDoc(doc(owner, ...path), value));
  await testEnvironment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), ...path), value));
  await assertSucceeds(getDoc(doc(reader, ...path)));
  await assertFails(updateDoc(doc(owner, ...path), { name: 'Ancienne saisie', versionToken: 'version-1' }));
  await assertFails(updateDoc(doc(reader, ...path), { name: 'Altéré' }));
  await assertFails(deleteDoc(doc(owner, ...path)));
});

test('N-R01 : seule une projection serveur est publique, les clients ne peuvent ni publier ni ressusciter', async () => {
  const owner = testEnvironment.authenticatedContext(ownerUid).firestore();
  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  const publicationPath = ['collectionPublications', 'reg-a--col-a'];
  const itemPath = [...publicationPath, 'items', 'cart-a'];
  const publication = { publicationId: 'reg-a--col-a', organizationId: ownerOrganizationId, registryId: ownerRegistryId, collectionId: 'col-a', websiteTitle: 'Collection A', websiteSlug: 'collection-a', description: 'Sélection', status: 'published', itemCount: 1 };
  const item = { cartularyId: 'cart-a', collectionId: 'col-a', assetType: 'watch', displayTitle: 'Montre', makerName: 'Maison', modelName: 'Modèle', referenceCode: 'REF-1', manufactureYear: 1969, publicCode: 'PUB-1' };
  await assertFails(setDoc(doc(owner, ...publicationPath), publication));
  await assertFails(setDoc(doc(owner, ...itemPath), item));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), ...publicationPath), publication);
    await setDoc(doc(context.firestore(), ...itemPath), item);
  });
  await assertSucceeds(getDoc(doc(anonymous, ...publicationPath)));
  await assertSucceeds(getDocs(collection(anonymous, ...publicationPath, 'items')));
  await assertFails(getDoc(doc(anonymous, 'registries', ownerRegistryId, 'items', 'cart-a')));
  await assertFails(updateDoc(doc(owner, ...publicationPath), { status: 'revoked' }));
  await assertFails(updateDoc(doc(owner, ...itemPath), { displayTitle: 'Altéré' }));
  await assertFails(deleteDoc(doc(owner, ...publicationPath)));
  await assertFails(deleteDoc(doc(owner, ...itemPath)));
  await testEnvironment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), ...publicationPath), { status: 'revoked' }));
  await assertFails(getDoc(doc(anonymous, ...publicationPath)));
  await assertFails(getDoc(doc(anonymous, ...itemPath)));
  await assertFails(setDoc(doc(owner, ...publicationPath), publication));
});

test('N-R05 : une invitation Collection secondaire ouvre uniquement ses objets et ferme au retrait', async () => {
  const guest = testEnvironment.authenticatedContext(invitedUid).firestore();
  const memberPath = ['organizations', ownerOrganizationId, 'memberships', invitedUid];
  const rootPath = ['cartularies', 'cart-a'];
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const admin = context.firestore();
    await updateDoc(doc(admin, ...memberPath), { invitationGrants: { [ownerRegistryId]: { registry: false, collectionIds: ['col-secondary'], cartularyIds: [] } } });
    await updateDoc(doc(admin, ...rootPath), { collectionId: 'col-a', collectionIds: ['col-a', 'col-secondary'] });
    await updateDoc(doc(admin, 'registries', ownerRegistryId, 'items', 'cart-a'), { collectionIds: ['col-a', 'col-secondary'] });
    await setDoc(doc(admin, ...rootPath, 'sections', 'identity'), { title: 'Déclaration privée' });
  });
  await assertSucceeds(getDoc(doc(guest, ...rootPath)));
  await assertSucceeds(getDocs(collection(guest, ...rootPath, 'sections')));
  await assertSucceeds(getDocs(collection(guest, ...rootPath, 'reminders')));
  await assertSucceeds(getDoc(doc(guest, 'registries', ownerRegistryId, 'items', 'cart-a')));
  await assertFails(getDoc(doc(guest, 'cartularies', 'cart-b')));
  await assertFails(updateDoc(doc(guest, ...rootPath), { displayTitle: 'Interdit' }));
  await testEnvironment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), ...rootPath), { collectionIds: ['col-a'] }));
  await assertFails(getDoc(doc(guest, ...rootPath)));
  await assertFails(getDocs(collection(guest, ...rootPath, 'sections')));
  await testEnvironment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'registries', ownerRegistryId, 'items', 'cart-a'), { collectionIds: ['col-a'] }));
  await assertFails(getDoc(doc(guest, 'registries', ownerRegistryId, 'items', 'cart-a')));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), ...rootPath), { collectionIds: ['col-a', 'col-secondary'] });
    await updateDoc(doc(context.firestore(), ...memberPath), { status: 'revoked' });
  });
  await assertFails(getDoc(doc(guest, ...rootPath)));
  await assertFails(getDocs(collection(guest, ...rootPath, 'reminders')));
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
  const statePath = [...rootPath, 'state', 'cartularia-specification-groups'];
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
    key: 'cartularia-specification-groups',
    value: '[{"value":"référence"}]',
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
    key: 'cartularia-specification-groups',
    value: 'vol',
    deleted: false,
    revision: 2,
    clientUpdatedAt: 2,
    updatedAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(ownerFirestore, ...rootPath, 'state', 'cartularia-owner-fields'), {
    ownerUid,
    cartularyId: 'cart-a',
    key: 'cartularia-owner-fields',
    value: '[{"value":"donnée personnelle"}]',
    deleted: false,
    revision: 1,
    clientUpdatedAt: 1,
    updatedAt: serverTimestamp(),
  }));
});

test('le client peut déclarer un fichier en attente sans pouvoir usurper la vérification serveur', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const root = doc(ownerFirestore, 'privateDrafts', ownerUid, 'cartularies', 'cart-a');
  await assertSucceeds(setDoc(root, {
    ownerUid,
    cartularyId: 'cart-a',
    status: 'active',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    updatedAt: serverTimestamp(),
  }));
  const binary = doc(root, 'binaries', 'binary-pending-a1');
  const pendingManifest = {
    ownerUid,
    cartularyId: 'cart-a',
    binaryId: 'binary-pending-a1',
    deleted: false,
    revision: 1,
    fileName: 'preuve.jpg',
    mimeType: 'image/jpeg',
    size: 128,
    sha256: `sha256:${'a'.repeat(64)}`,
    kind: 'media',
    storagePath: `private-drafts/${ownerUid}/cart-a/binary-pending-a1/${'a'.repeat(64)}/original`,
    clientUpdatedAt: 100,
    uploadStatus: 'pending_upload',
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(binary, pendingManifest));
  await assertFails(setDoc(binary, {
    ...pendingManifest,
    uploadStatus: 'ready',
    verificationStatus: 'accepted',
    verificationVersion: 'client-forged',
    publicationEligible: true,
  }));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), binary.path), {
      uploadStatus: 'ready',
      verificationStatus: 'accepted',
      verificationVersion: 'private-upload@1.0.0',
      publicationEligible: true,
    }, { merge: true });
  });
  await assertSucceeds(setDoc(binary, {
    revision: 2,
    clientUpdatedAt: 101,
    uploadStatus: 'ready',
    updatedAt: serverTimestamp(),
  }, { merge: true }));
  await assertFails(setDoc(binary, { publicationEligible: false }, { merge: true }));
});

const privateBinaryManifest = (binaryId = 'binary-identity-a1') => ({
  ownerUid,
  cartularyId: 'cart-a',
  binaryId,
  deleted: false,
  revision: 1,
  fileName: 'preuve.jpg',
  mimeType: 'image/jpeg',
  size: 128,
  sha256: `sha256:${'a'.repeat(64)}`,
  kind: 'media',
  storagePath: `private-drafts/${ownerUid}/cart-a/${binaryId}/${'a'.repeat(64)}/original`,
  clientUpdatedAt: 100,
  uploadStatus: 'pending_upload',
  updatedAt: serverTimestamp(),
});

const privateBinaryIdentity = (manifest) => ({
  schemaVersion: 'private-binary-identity@1.0.0',
  ownerUid: manifest.ownerUid,
  cartularyId: manifest.cartularyId,
  binaryId: manifest.binaryId,
  storagePath: manifest.storagePath,
  sha256: manifest.sha256,
  size: manifest.size,
  bucket: 'cartularia-private-test.firebasestorage.app',
  generation: '123456789',
});

async function createPrivateBinaryFixture(manifest = privateBinaryManifest()) {
  const firestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const root = doc(firestore, 'privateDrafts', ownerUid, 'cartularies', manifest.cartularyId);
  await assertSucceeds(setDoc(root, {
    ownerUid,
    cartularyId: manifest.cartularyId,
    status: 'active',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    updatedAt: serverTimestamp(),
  }));
  const binary = doc(root, 'binaries', manifest.binaryId);
  await assertSucceeds(setDoc(binary, manifest));
  return binary;
}

test('un ready client antidaté ne crée aucune acceptation ni attestation serveur', async () => {
  const manifest = { ...privateBinaryManifest(), uploadStatus: 'ready', clientUpdatedAt: 0 };
  const binary = await createPrivateBinaryFixture(manifest);
  const stored = (await assertSucceeds(getDoc(binary))).data();
  assert.equal(stored.uploadStatus, 'ready');
  assert.equal(stored.verificationStatus, undefined);
  assert.equal(stored.verificationIdentity, undefined);
  await assertFails(updateDoc(binary, { verificationStatus: 'accepted' }));
  await assertFails(updateDoc(binary, { verificationIdentity: privateBinaryIdentity(manifest) }));
  await assertFails(updateDoc(binary, { verificationAttemptId: 'client-attempt' }));
  const forged = { ...privateBinaryManifest('binary-forged-a1'), uploadStatus: 'ready' };
  await assertFails(setDoc(doc(binary.parent, forged.binaryId), {
    ...forged,
    verificationIdentity: privateBinaryIdentity(forged),
  }));
});

test('le chemin du manifeste désigne exactement son propriétaire, son cartulaire, son binaire et son hash', async () => {
  const manifest = privateBinaryManifest();
  const binary = await createPrivateBinaryFixture(manifest);
  const invalidPaths = [
    manifest.storagePath.replace(ownerUid, outsiderUid),
    manifest.storagePath.replace('cart-a', 'cart-b'),
    manifest.storagePath.replace(manifest.binaryId, 'another-binary'),
    manifest.storagePath.replace('a'.repeat(64), 'b'.repeat(64)),
    manifest.storagePath.replace('a'.repeat(64), manifest.sha256),
    `${manifest.storagePath}/extra`,
    `prefix/${manifest.storagePath}`,
  ];
  for (const storagePath of invalidPaths) await assertFails(updateDoc(binary, { storagePath }));
  const next = privateBinaryManifest('binary-invalid-create');
  await assertFails(setDoc(doc(binary.parent, next.binaryId), { ...next, storagePath: manifest.storagePath }));
  await assertSucceeds(updateDoc(binary, {
    sha256: `sha256:${'b'.repeat(64)}`,
    storagePath: manifest.storagePath.replace('a'.repeat(64), 'b'.repeat(64)),
  }));
});

test('un manifeste non vérifié reste supprimable physiquement par son propriétaire', async () => {
  const binary = await createPrivateBinaryFixture();
  await assertSucceeds(deleteDoc(binary));
  assert.equal((await assertSucceeds(getDoc(binary))).exists(), false);
});

for (const mode of ['accepted-attested', 'accepted-legacy', 'identity-without-acceptance']) {
  test(`l’identité binaire ${mode} est immuable et sa suppression logique ne réactive pas l’attestation`, async () => {
    const manifest = privateBinaryManifest();
    const binary = await createPrivateBinaryFixture(manifest);
    const attested = mode !== 'accepted-legacy';
    const verification = {
      verificationStatus: mode === 'identity-without-acceptance' ? 'processing' : 'accepted',
      uploadStatus: mode === 'identity-without-acceptance' ? 'pending_upload' : 'ready',
      verificationAttemptId: 'server-attempt',
      ...(attested ? { verificationIdentity: privateBinaryIdentity(manifest) } : {}),
    };
    await testEnvironment.withSecurityRulesDisabled((context) => setDoc(
      doc(context.firestore(), binary.path), verification, { merge: true },
    ));
    const substitutions = [
      { ownerUid: outsiderUid },
      { cartularyId: 'cart-b' },
      { binaryId: 'another-binary' },
      { sha256: `sha256:${'b'.repeat(64)}`, storagePath: manifest.storagePath.replace('a'.repeat(64), 'b'.repeat(64)) },
      { size: 256 },
      { mimeType: 'application/pdf' },
      { kind: 'condition_attachment' },
      { storagePath: manifest.storagePath.replace('a'.repeat(64), 'b'.repeat(64)) },
      { uploadStatus: verification.uploadStatus === 'ready' ? 'pending_upload' : 'ready' },
    ];
    for (const patch of substitutions) await assertFails(updateDoc(binary, patch));
    await assertFails(updateDoc(binary, { verificationStatus: deleteField() }));
    await assertFails(updateDoc(binary, { verificationAttemptId: 'client-attempt' }));
    if (attested) {
      await assertFails(updateDoc(binary, { 'verificationIdentity.generation': '999999999' }));
      await assertFails(updateDoc(binary, { verificationIdentity: deleteField() }));
    }
    await assertFails(deleteDoc(binary));
    await assertFails(setDoc(binary, {
      ...manifest,
      sha256: `sha256:${'b'.repeat(64)}`,
      storagePath: manifest.storagePath.replace('a'.repeat(64), 'b'.repeat(64)),
    }));
    await assertSucceeds(updateDoc(binary, { revision: 2, clientUpdatedAt: 101, fileName: 'renommé.jpg' }));
    await assertSucceeds(updateDoc(binary, { deleted: true, storagePath: null, uploadStatus: 'deleted', revision: 3 }));
    const tombstone = (await assertSucceeds(getDoc(binary))).data();
    assert.equal(tombstone.deleted, true);
    assert.equal(tombstone.sha256, manifest.sha256);
    assert.equal(tombstone.size, manifest.size);
    assert.deepEqual(tombstone.verificationIdentity, verification.verificationIdentity);
    await assertFails(deleteDoc(binary));
    await assertFails(updateDoc(binary, { deleted: false, storagePath: manifest.storagePath, uploadStatus: 'ready' }));
    await assertFails(updateDoc(binary, { sha256: `sha256:${'b'.repeat(64)}` }));
    const clone = privateBinaryManifest('binary-reused-attestation');
    await assertFails(setDoc(doc(binary.parent, clone.binaryId), { ...clone, ...verification }));
  });
}

test('un propriétaire éditeur peut demander une création seulement depuis son brouillon et son Registre', async () => {
  const ownerFirestore = testEnvironment.authenticatedContext(ownerUid).firestore();
  const outsiderFirestore = testEnvironment.authenticatedContext(outsiderUid).firestore();
  const cartularyId = 'cart-new-rolex-0001';
  const rootPath = ['privateDrafts', ownerUid, 'cartularies', cartularyId];
  await assertSucceeds(setDoc(doc(ownerFirestore, ...rootPath), {
    ownerUid,
    cartularyId,
    status: 'active',
    retentionPolicyVersion: 'inactive-plus-2y-v1',
    purgeAfter: null,
    lastActiveAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
  const requestPath = ['cartularyCreateRequests', cartularyId];
  const request = {
    requestDocumentId: cartularyId,
    requestId: 'create_0123456789abcdef0123456789ab',
    ownerUid,
    cartularyId,
    organizationId: ownerOrganizationId,
    registryId: ownerRegistryId,
    publicCode: 'ROL-TEST01',
    status: 'pending',
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(ownerFirestore, ...requestPath), request));
  await assertSucceeds(getDoc(doc(ownerFirestore, ...requestPath)));
  await assertFails(setDoc(doc(ownerFirestore, ...requestPath), {
    ...request,
    requestId: 'create_abcdef0123456789abcdef012345',
  }));
  await assertFails(setDoc(doc(ownerFirestore, ...requestPath), { status: 'processed' }, { merge: true }));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), ...requestPath), {
      ...request,
      status: 'failed',
      errorCode: 'unavailable',
    });
  });
  const retryRequest = {
    ...request,
  };
  await assertFails(setDoc(doc(ownerFirestore, ...requestPath), {
    ...retryRequest,
    requestId: 'create_abcdef0123456789abcdef012345',
  }));
  await assertSucceeds(setDoc(doc(ownerFirestore, ...requestPath), retryRequest));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), ...requestPath), {
      ...retryRequest,
      status: 'failed',
      errorCode: 'unavailable',
    });
  });
  await assertFails(setDoc(doc(ownerFirestore, ...requestPath), {
    ...retryRequest,
    publicCode: 'ROL-MUTATE',
  }));
  await assertFails(getDocs(collection(ownerFirestore, 'cartularyCreateRequests')));
  await assertFails(setDoc(doc(outsiderFirestore, 'cartularyCreateRequests', 'cart-new-outsider-0001'), {
    ...request,
    requestDocumentId: 'cart-new-outsider-0001',
    cartularyId: 'cart-new-outsider-0001',
    ownerUid: outsiderUid,
    organizationId: ownerOrganizationId,
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
  await assertFails(setDoc(doc(ownerFirestore, ...requestPath), {
    ...validRequest,
    requestId: 'sync_m1k2n3p4_abcdef1234567890',
  }));
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), ...requestPath), {
      ...validRequest,
      status: 'processed',
      sourceRevision: 2,
    });
  });
  await assertSucceeds(setDoc(doc(ownerFirestore, ...requestPath), {
    ...validRequest,
    requestId: 'sync_m1k2n3p4_abcdef1234567890',
    reason: 'manual_retry',
  }));
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

const setAccountAccess = (value, uid = ownerUid) => testEnvironment.withSecurityRulesDisabled((context) => (
  setDoc(doc(context.firestore(), 'accountAccess', uid), value)
));

const seedRevocationSurfaces = async () => {
  let paths = [];
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const records = {
      [`users/${ownerUid}/private/profile`]: { privateNote: 'confidentiel' },
      [`privateDrafts/${ownerUid}/cartularies/cart-a`]: { ownerUid, cartularyId: 'cart-a', status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1' },
      [`privateDrafts/${ownerUid}/cartularies/cart-a/state/cartularia-test`]: { value: 'private' },
      [`privateDrafts/${ownerUid}/cartularies/cart-a/binaries/binary-a`]: { fileName: 'private.pdf' },
      'cartularySyncRequests/request-a': { ownerUid },
      'cartularyCreateRequests/request-a': { ownerUid },
      'timestampRequests/request-a': { ownerUid },
      'cartularyTransferRequests/request-a': { ownerUid },
      'cartularyTransfers/transfer-a': { participantUids: [ownerUid] },
      'transferPrivateArchives/transfer-a': { sellerUid: ownerUid },
      'integrityBatches/batch-a': { readerUids: [ownerUid] },
      [`communityMemberships/${ownerUid}`]: { uid: ownerUid, status: 'active', permissions: ['community.read'] },
      'communityPublications/community-a': { status: 'published', moderationStatus: 'approved' },
      [`vaultUsers/${ownerUid}/vault/profile`]: { ownerUid, ciphertext: 'opaque' },
      [`codeAccounts/${ownerUid}/account/profile`]: { ownerUid, primaryClientNumber: 'CLI-ABCDEF12' },
    };
    await Promise.all(Object.entries(records).map(([path, value]) => setDoc(doc(firestore, path), value)));
    paths = Object.keys(records);
  });
  return paths;
};

test('F02 : la suspension serveur ferme toutes les lectures privées et écritures d’une session déjà ouverte', async () => {
  const paths = await seedRevocationSurfaces();
  const firestore = testEnvironment.authenticatedContext(ownerUid, { firebase: { sign_in_provider: 'password' }, auth_time: 1_000 }).firestore();
  const reads = [
    ...paths, `organizations/${ownerOrganizationId}/memberships/${ownerUid}`,
    `registries/${ownerRegistryId}`, 'cartularies/cart-a', 'schemaCatalog/watch',
  ];
  for (const path of reads) await assertSucceeds(getDocFromServer(doc(firestore, path)));
  await setAccountAccess({ status: 'suspended', validAfter: 1_000 });
  for (const path of reads) await assertFails(getDocFromServer(doc(firestore, path)));
  await assertSucceeds(getDocFromServer(doc(firestore, 'users', ownerUid)));
  await assertFails(getDocs(query(collectionGroup(firestore, 'memberships'), where('uid', '==', ownerUid))));
  await assertFails(updateDoc(doc(firestore, 'cartularies/cart-a/reminders/rem-a'), { title: 'Refusé', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(firestore, 'users', ownerUid), { lastActiveAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  for (const path of paths.filter((path) => path.startsWith('privateDrafts/'))) await assertFails(deleteDoc(doc(firestore, path)));
});

test('F02 : une écoute déjà admise ne reçoit pas de nouvelles données après suspension', { timeout: 10_000 }, async () => {
  await setAccountAccess({ status: 'active', validAfter: 0 });
  const firestore = testEnvironment.authenticatedContext(ownerUid, { firebase: { sign_in_provider: 'password' }, auth_time: 1_000 }).firestore();
  let firstSnapshot;
  const admitted = new Promise((resolve) => { firstSnapshot = resolve; });
  let deny;
  const rejected = new Promise((resolve) => { deny = resolve; });
  const unsubscribe = onSnapshot(doc(firestore, 'cartularies/cart-a'), () => firstSnapshot(), (error) => deny(error));
  try {
    await admitted;
    await setAccountAccess({ status: 'suspended', validAfter: 1_000 });
    // The emulator re-evaluates a live listener on a resource event, not on guard changes alone.
    await testEnvironment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'cartularies/cart-a'), { revision: 2 }));
    const error = await rejected;
    if (error.code !== 'permission-denied') throw error;
  } finally { unsubscribe(); }
});

test('F02 : réactiver ne réadmet ni le vieux jeton ni son renouvellement, seule une auth_time strictement ultérieure passe', async () => {
  const old = testEnvironment.authenticatedContext(ownerUid, { firebase: { sign_in_provider: 'password' }, auth_time: 1_000 }).firestore();
  const refreshed = testEnvironment.authenticatedContext(ownerUid, { firebase: { sign_in_provider: 'password' }, auth_time: 1_000, iat: 2_000 }).firestore();
  const fresh = testEnvironment.authenticatedContext(ownerUid, { firebase: { sign_in_provider: 'password' }, auth_time: 1_001 }).firestore();
  await setAccountAccess({ status: 'suspended', validAfter: 1_000 });
  await assertFails(getDocFromServer(doc(fresh, 'cartularies/cart-a')));
  await setAccountAccess({ status: 'active', validAfter: 1_000 });
  await assertFails(getDocFromServer(doc(old, 'cartularies/cart-a')));
  await assertFails(getDocFromServer(doc(refreshed, 'cartularies/cart-a')));
  await assertSucceeds(getDocFromServer(doc(fresh, 'cartularies/cart-a')));
  await assertSucceeds(updateDoc(doc(fresh, 'cartularies/cart-a/reminders/rem-a'), { title: 'Session fraîche', updatedAt: serverTimestamp() }));
  await testEnvironment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'users', ownerUid), { status: 'suspended' }));
  await assertFails(getDocFromServer(doc(fresh, 'cartularies/cart-a')));
});

test('F02 : un guard malformé ferme l’accès et aucun client ne peut lire, créer, modifier ou supprimer le guard', async () => {
  const firestore = testEnvironment.authenticatedContext(ownerUid, { firebase: { sign_in_provider: 'password' }, auth_time: 1_001 }).firestore();
  const guard = doc(firestore, 'accountAccess', ownerUid);
  await assertFails(setDoc(guard, { status: 'active', validAfter: 0 }));
  for (const invalid of [{ status: 'active' }, { status: 'active', validAfter: '1000' }, { status: 'active', validAfter: -1 }, { status: 'unknown', validAfter: 0 }]) {
    await setAccountAccess(invalid);
    await assertFails(getDocFromServer(doc(firestore, 'cartularies/cart-a')));
  }
  await assertFails(getDocFromServer(guard));
  await assertFails(updateDoc(guard, { status: 'active', validAfter: 0 }));
  await assertFails(deleteDoc(guard));
  await assertFails(setDoc(doc(firestore, 'accountAccess', ownerUid, 'memberships', ownerUid), { uid: ownerUid }));
  await assertFails(updateDoc(doc(firestore, 'users', ownerUid), { accountAccess: { status: 'active', validAfter: 0 } }));
});

test('F02 : un compte démo actif conserve les lectures autorisées mais pas les écritures même si son membership est trop large', async () => {
  const firestore = testEnvironment.authenticatedContext(ownerUid, { firebase: { sign_in_provider: 'password' }, auth_time: 1_001 }).firestore();
  await testEnvironment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'users', ownerUid), { accountPurpose: 'public_read_only_demo' }));
  await setAccountAccess({ status: 'active', validAfter: 1_000 });
  await assertSucceeds(getDocFromServer(doc(firestore, 'registries', ownerRegistryId)));
  await assertSucceeds(getDocFromServer(doc(firestore, 'cartularies/cart-a')));
  await assertFails(updateDoc(doc(firestore, 'cartularies/cart-a/reminders/rem-a'), { title: 'Démo interdite', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(firestore, 'users', ownerUid), { lastActiveAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(firestore, 'privateDrafts', ownerUid, 'cartularies', 'cart-demo'), { ownerUid, cartularyId: 'cart-demo', status: 'active', retentionPolicyVersion: 'inactive-plus-2y-v1' }));
  await setAccountAccess({ status: 'suspended', validAfter: 1_001 });
  await assertFails(getDocFromServer(doc(firestore, 'cartularies/cart-a')));
});

test('F02 : un custom token émis avant le cutoff reste refusé même échangé après la réactivation', async () => {
  await setAccountAccess({ status: 'active', validAfter: 1_000 });
  for (const issuedAt of [undefined, 999, 1_000, '1001']) {
    const db = testEnvironment.authenticatedContext(ownerUid, {
      firebase: { sign_in_provider: 'custom' }, auth_time: 1_005,
      ...(issuedAt === undefined ? {} : { cartulariaRecoveryIssuedAt: issuedAt }),
    }).firestore();
    await assertFails(getDocFromServer(doc(db, 'cartularies/cart-a')));
  }
  const fresh = testEnvironment.authenticatedContext(ownerUid, {
    firebase: { sign_in_provider: 'custom' }, auth_time: 1_005, cartulariaRecoveryIssuedAt: 1_001,
  }).firestore();
  await assertSucceeds(getDocFromServer(doc(fresh, 'cartularies/cart-a')));
});
