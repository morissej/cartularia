import { readFileSync } from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  buildIwcImportBundle,
  IWC_CARTULARY_ID,
  IWC_IMPORT_ACTOR_ID,
  IWC_IMPORT_DATE,
  IWC_IMPORT_REQUEST_ID,
} from '../src/migrations/iwcImport.ts';
import { importCartularyBundle } from '../scripts/lib/import-cartulary-command.mjs';
import {
  addCommunityComment,
  admitCommunityMember,
  createCommunityPost,
  moderateCommunityPublication,
  publishCommunityBlocks,
  setCommunityReaction,
  updateCommunityProfile,
} from '../scripts/lib/community-command.mjs';

const projectId = 'cartularia-wave5-test';
const [host = '127.0.0.1', portValue = '8080'] = (process.env.FIRESTORE_EMULATOR_HOST || '').split(':');
const port = Number(portValue);
const ownerUid = 'wave1-owner';
const readerUid = 'community-reader';
const outsiderUid = 'community-outsider';
const publicationId = 'community_iwc_test_20260814';
const postId = 'post_iwc_test_20260814';
const IWC_WATCH_SCHEMA = JSON.parse(
  readFileSync(new URL('../firebase/schema-catalog/watch/1.3.0.json', import.meta.url), 'utf8'),
);

let adminApp;
let adminFirestore;
let testEnvironment;

const communityMembership = (uid, moderator = false) => ({
  uid,
  roles: moderator ? ['member', 'moderator'] : ['member'],
  permissions: [
    'community.read',
    'community.post',
    'community.comment',
    'community.react',
    ...(moderator ? ['community.moderate'] : []),
  ],
  status: 'active',
  revokedAt: null,
});

const seedFoundations = async () => {
  const now = new Date('2026-08-14T14:00:00.000Z');
  await Promise.all([
    adminFirestore.doc('users/wave1-owner').set({ uid: ownerUid, status: 'active' }),
    adminFirestore.doc('users/wave1-owner/private/profile').set({
      email: 'owner.private@example.test',
      legalName: 'Identité privée de test',
    }),
    adminFirestore.doc('organizations/org_demo').set({ id: 'org_demo', status: 'active', createdAt: now }),
    adminFirestore.doc('registries/reg_collection_privee').set({
      id: 'reg_collection_privee',
      organizationId: 'org_demo',
      status: 'active',
      visibility: 'secret',
    }),
    adminFirestore.doc('organizations/org_demo/memberships/wave1-owner').set({
      uid: ownerUid,
      organizationId: 'org_demo',
      roles: ['account_holder', 'legal_owner'],
      status: 'active',
      scopes: { registryIds: ['reg_collection_privee'] },
      permissions: ['cartulary.read', 'cartulary.edit', 'publication.manage'],
    }),
    adminFirestore.doc(`communityMemberships/${ownerUid}`).set(communityMembership(ownerUid, true)),
    adminFirestore.doc(`communityMemberships/${readerUid}`).set(communityMembership(readerUid)),
    adminFirestore.doc(`communityProfiles/${ownerUid}`).set({
      uid: ownerUid,
      pseudonym: 'HorlogerPilote',
      bio: 'Profil de test.',
      avatarAssetId: null,
      status: 'active',
      visibility: 'community',
    }),
    adminFirestore.doc(`communityProfiles/${readerUid}`).set({
      uid: readerUid,
      pseudonym: 'LecteurCercle',
      bio: '',
      avatarAssetId: null,
      status: 'active',
      visibility: 'community',
    }),
    adminFirestore.doc('schemaCatalog/watch/versions/1.3.0').set({
      schemaId: 'watch', assetType: 'watch', version: '1.3.0', status: 'baseline',
    }),
  ]);
};

const importIwc = () => importCartularyBundle({
  firestore: adminFirestore,
  bundle: buildIwcImportBundle(),
  requestId: IWC_IMPORT_REQUEST_ID,
  actorId: IWC_IMPORT_ACTOR_ID,
  expectedRevision: 0,
  occurredAt: IWC_IMPORT_DATE,
});

const safeBlocks = () => [
  {
    id: 'community-cover-test',
    title: 'Identité partagée',
    fields: {
      'cover.asset.type': 'Montre',
      'cover.watch.brand': 'IWC Schaffhausen',
      'cover.watch.model': 'Flieger UTC',
      'cover.watch.reference': 'IW3251-001',
    },
  },
  {
    id: 'community-condition-test',
    title: 'État communautaire',
    fields: {
      'condition.summary.paragraphs[]': ['Donnée communautaire de démonstration.'],
      'condition.summary.conclusion': 'Revue humaine requise.',
    },
  },
];

const publishCommunity = (overrides = {}) => publishCommunityBlocks({
  firestore: adminFirestore,
  schema: IWC_WATCH_SCHEMA,
  cartularyId: IWC_CARTULARY_ID,
  publicationId,
  blocks: safeBlocks(),
  actorId: ownerUid,
  requestId: 'wave5-publish-community-test',
  expectedRevision: 1,
  occurredAt: '2026-08-14T15:00:00.000Z',
  ...overrides,
});

const createPost = () => createCommunityPost({
  firestore: adminFirestore,
  postId,
  publicationId,
  actorId: ownerUid,
  body: 'Post pilote sans accès au dossier maître.',
  requestId: 'wave5-create-post-test',
  occurredAt: '2026-08-14T15:05:00.000Z',
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
  adminApp = getApps().find((app) => app.name === 'wave5-test-admin') || initializeApp({ projectId }, 'wave5-test-admin');
  adminFirestore = getFirestore(adminApp);
});

after(async () => {
  await testEnvironment.cleanup();
  await deleteApp(adminApp);
});

beforeEach(async () => {
  await testEnvironment.clearFirestore();
  await seedFoundations();
  await importIwc();
});

test('membership et profil pseudonyme restent séparés du compte privé', async () => {
  const first = await admitCommunityMember({
    firestore: adminFirestore,
    actorId: ownerUid,
    targetUid: 'community-new-member',
    pseudonym: 'NouveauCercle',
    requestId: 'wave5-admit-new-member-test',
  });
  const replay = await admitCommunityMember({
    firestore: adminFirestore,
    actorId: ownerUid,
    targetUid: 'community-new-member',
    pseudonym: 'NouveauCercle',
    requestId: 'wave5-admit-new-member-test',
  });
  await updateCommunityProfile({
    firestore: adminFirestore,
    actorId: 'community-new-member',
    pseudonym: 'NouveauCercle',
    bio: 'Profil volontaire sans identité légale.',
    requestId: 'wave5-update-profile-test',
  });
  const reader = testEnvironment.authenticatedContext(readerUid).firestore();
  const profile = await assertSucceeds(getDoc(doc(reader, 'communityProfiles', ownerUid)));
  await assertFails(getDoc(doc(reader, 'users', ownerUid, 'private', 'profile')));
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(JSON.stringify(profile.data()).includes('owner.private@example.test'), false);
  assert.equal('legalName' in profile.data(), false);
});

test('la projection communautaire est lisible uniquement par le cercle admis', async () => {
  const first = await publishCommunity();
  const replay = await publishCommunity();
  const member = testEnvironment.authenticatedContext(readerUid).firestore();
  const outsider = testEnvironment.authenticatedContext(outsiderUid).firestore();
  const anonymous = testEnvironment.unauthenticatedContext().firestore();
  const publication = await assertSucceeds(getDoc(doc(member, 'communityPublications', publicationId)));
  const blocks = await assertSucceeds(getDocs(collection(member, 'communityPublications', publicationId, 'blocks')));
  await assertFails(getDoc(doc(outsider, 'communityPublications', publicationId)));
  await assertFails(getDoc(doc(anonymous, 'communityPublications', publicationId)));
  const text = JSON.stringify({ publication: publication.data(), blocks: blocks.docs.map((item) => item.data()) });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(blocks.size, 2);
  assert.equal(text.includes(IWC_CARTULARY_ID), false);
  assert.equal(text.includes('accountHolderId'), false);
  assert.equal(text.includes('value.purchase.price'), false);
});

test('T-19 — un champ Secret est refusé et reste physiquement absent', async () => {
  await assert.rejects(
    () => publishCommunity({
      publicationId: 'community_secret_attempt',
      requestId: 'wave5-secret-attempt-test',
      blocks: [{
        id: 'community-secret-test',
        title: 'Bloc interdit',
        fields: { 'value.purchase.price': { amount: 12500, currency: 'EUR' } },
      }],
    }),
    (error) => error.code === 'secret_field_detected',
  );
  assert.equal((await adminFirestore.doc('communityPublications/community_secret_attempt').get()).exists, false);
  assert.equal((await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get()).data().revision, 1);
});

test('T-18 — un commentaire n’altère ni révision ni journal du Cartulaire', async () => {
  await publishCommunity();
  await createPost();
  const rootBefore = await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  const auditBefore = await rootBefore.ref.collection('auditEvents').get();
  const first = await addCommunityComment({
    firestore: adminFirestore,
    postId,
    commentId: 'comment_community_test_001',
    actorId: readerUid,
    body: 'Suggestion communautaire, sans valeur de preuve.',
    requestId: 'wave5-comment-test',
    occurredAt: '2026-08-14T15:06:00.000Z',
  });
  const replay = await addCommunityComment({
    firestore: adminFirestore,
    postId,
    commentId: 'comment_community_test_001',
    actorId: readerUid,
    body: 'Suggestion communautaire, sans valeur de preuve.',
    requestId: 'wave5-comment-test',
    occurredAt: '2026-08-14T15:06:00.000Z',
  });
  const [rootAfter, auditAfter, post, comment] = await Promise.all([
    adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get(),
    rootBefore.ref.collection('auditEvents').get(),
    adminFirestore.doc(`communityPosts/${postId}`).get(),
    adminFirestore.doc(`communityPosts/${postId}/comments/comment_community_test_001`).get(),
  ]);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(rootAfter.data().revision, rootBefore.data().revision);
  assert.equal(rootAfter.data().integrityHead, rootBefore.data().integrityHead);
  assert.equal(auditAfter.size, auditBefore.size);
  assert.equal(post.data().commentCount, 1);
  assert.equal(comment.data().proofStatus, 'not_cartulary_evidence');
  assert.equal(JSON.stringify(comment.data()).includes(IWC_CARTULARY_ID), false);
});

test('les réactions restent en sous-collection et seul le compteur agrégé est exposé', async () => {
  await publishCommunity();
  await createPost();
  const first = await setCommunityReaction({
    firestore: adminFirestore,
    postId,
    actorId: readerUid,
    reaction: 'useful',
    requestId: 'wave5-reaction-test',
  });
  const replay = await setCommunityReaction({
    firestore: adminFirestore,
    postId,
    actorId: readerUid,
    reaction: 'useful',
    requestId: 'wave5-reaction-test',
  });
  const post = await adminFirestore.doc(`communityPosts/${postId}`).get();
  const member = testEnvironment.authenticatedContext(ownerUid).firestore();
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(post.data().reactionCount, 1);
  assert.equal('reactions' in post.data(), false);
  assert.equal((await post.ref.collection('reactions').get()).size, 1);
  await assertFails(getDoc(doc(member, 'communityPosts', postId, 'reactions', readerUid)));
});

test('la modération suspend publication, post et commentaires sans modifier le maître', async () => {
  await publishCommunity();
  await createPost();
  await addCommunityComment({
    firestore: adminFirestore,
    postId,
    commentId: 'comment_to_suspend',
    actorId: readerUid,
    body: 'Commentaire qui suivra la suspension de sa projection.',
    requestId: 'wave5-comment-before-moderation',
  });
  const rootBefore = await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  const first = await moderateCommunityPublication({
    firestore: adminFirestore,
    publicationId,
    actorId: ownerUid,
    reasonCode: 'fixture_moderation',
    requestId: 'wave5-moderate-test',
  });
  const replay = await moderateCommunityPublication({
    firestore: adminFirestore,
    publicationId,
    actorId: ownerUid,
    reasonCode: 'fixture_moderation',
    requestId: 'wave5-moderate-test',
  });
  const member = testEnvironment.authenticatedContext(readerUid).firestore();
  await assertFails(getDoc(doc(member, 'communityPublications', publicationId)));
  await assertFails(getDoc(doc(member, 'communityPosts', postId)));
  await assertFails(getDoc(doc(member, 'communityPosts', postId, 'comments', 'comment_to_suspend')));
  const rootAfter = await adminFirestore.doc(`cartularies/${IWC_CARTULARY_ID}`).get();
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(rootAfter.data().revision, rootBefore.data().revision);
  assert.equal(rootAfter.data().integrityHead, rootBefore.data().integrityHead);
});

test('la requête du feed est bornée et toutes les écritures client restent refusées', async () => {
  await publishCommunity();
  await createPost();
  const member = testEnvironment.authenticatedContext(readerUid).firestore();
  const publications = await assertSucceeds(getDocs(query(
    collection(member, 'communityPublications'),
    where('status', '==', 'published'),
    where('moderationStatus', '==', 'approved'),
    orderBy('publishedAt', 'desc'),
  )));
  const feed = await assertSucceeds(getDocs(query(
    collection(member, 'communityPosts'),
    where('communityPublicationId', '==', publicationId),
    where('status', '==', 'active'),
    where('moderationStatus', '==', 'visible'),
    orderBy('publishedAt', 'desc'),
  )));
  assert.deepEqual(publications.docs.map((item) => item.id), [publicationId]);
  assert.deepEqual(feed.docs.map((item) => item.id), [postId]);
  await assertFails(setDoc(doc(member, 'communityProfiles', readerUid), { pseudonym: 'Écriture directe' }, { merge: true }));
  await assertFails(setDoc(doc(member, 'communityPosts', 'client_post_forbidden'), { body: 'Interdit' }));
  await assertFails(setDoc(doc(member, 'communityPublications', 'client_pub_forbidden'), { status: 'published' }));
  await assertFails(setDoc(doc(member, 'communityPosts', postId, 'comments', 'client_comment_forbidden'), { body: 'Interdit' }));
});
