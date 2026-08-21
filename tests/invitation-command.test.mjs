import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  acceptRegistryInvitation,
  InvitationCommandError,
  issueRegistryInvitation,
  revokeRegistryInvitation,
} from '../scripts/lib/invitation-command.mjs';

const app = initializeApp({ projectId: 'cartularia-invitation-test' }, 'invitation-command-test');
const firestore = getFirestore(app);
const registryId = 'reg_invitation_test';
const organizationId = 'org_invitation_test';
const actorUid = 'owner_invitation_test';
const guestUid = 'guest_invitation_test';
const cartularyId = 'cart_invitation_test';
const recipientEmail = 'invitee@example.test';
const fakeAuth = {
  generateSignInWithEmailLink: async (_email, settings) => `https://auth.example.test/action?continueUrl=${encodeURIComponent(settings.url)}`,
};

before(async () => {
  await Promise.all([
    firestore.doc(`registries/${registryId}`).set({ id: registryId, organizationId, name: 'Registre invitation' }),
    firestore.doc(`registries/${registryId}/items/${cartularyId}`).set({
      cartularyId,
      registryId,
      organizationId,
      collectionId: 'col_invitation_test',
    }),
    firestore.doc(`organizations/${organizationId}/memberships/${actorUid}`).set({
      uid: actorUid,
      organizationId,
      roles: ['legal_owner'],
      status: 'active',
      scopes: { registryIds: [registryId] },
      permissions: ['registry.read', 'cartulary.read', 'cartulary.edit', 'access.read'],
    }),
  ]);
});

after(async () => {
  await firestore.recursiveDelete(firestore.doc(`registries/${registryId}`));
  await firestore.recursiveDelete(firestore.doc(`organizations/${organizationId}`));
  await Promise.all([
    firestore.doc(`users/${guestUid}`).delete(),
    ...((await firestore.collection('registryInvitations').get()).docs.map((doc) => doc.ref.delete())),
    ...((await firestore.collection('mail').get()).docs.map((doc) => doc.ref.delete())),
  ]);
  await deleteApp(app);
});

test('émission, acceptation vérifiée et révocation ferment le parcours', async () => {
  process.env.FUNCTIONS_EMULATOR = 'true';
  const issued = await issueRegistryInvitation({
    firestore,
    auth: fakeAuth,
    actorUid,
    registryId,
    recipientEmail,
    scopeType: 'cartulary',
    scopeId: cartularyId,
    displayTitle: 'Objet invité',
    continueUrl: 'http://127.0.0.1:5174/invitation/accept',
    now: new Date('2026-08-19T10:00:00.000Z'),
  });
  const continuation = new URL(new URL(issued.signInLink).searchParams.get('continueUrl'));
  const token = continuation.searchParams.get('token');
  const privateInvitation = (await firestore.doc(`registryInvitations/${issued.invitationId}`).get()).data();
  const access = (await firestore.doc(`registries/${registryId}/accesses/${issued.invitationId}`).get()).data();
  assert.equal(privateInvitation.tokenHash.includes(token), false);
  assert.equal(JSON.stringify(privateInvitation).includes(recipientEmail), false);
  assert.match(access.recipientLabel, /\*{3,}@/);
  assert.equal((await firestore.doc(`mail/${issued.invitationId}`).get()).exists, true);

  await assert.rejects(
    acceptRegistryInvitation({
      firestore,
      actorUid: guestUid,
      actorEmail: 'wrong@example.test',
      invitationId: issued.invitationId,
      token,
      now: new Date('2026-08-19T10:01:00.000Z'),
    }),
    (error) => error instanceof InvitationCommandError && error.code === 'permission_denied',
  );

  const accepted = await acceptRegistryInvitation({
    firestore,
    actorUid: guestUid,
    actorEmail: recipientEmail,
    invitationId: issued.invitationId,
    token,
    now: new Date('2026-08-19T10:01:00.000Z'),
  });
  assert.equal(accepted.scopeId, cartularyId);
  const membershipRef = firestore.doc(`organizations/${organizationId}/memberships/${guestUid}`);
  assert.deepEqual((await membershipRef.get()).data().invitationGrants[registryId].cartularyIds, [cartularyId]);

  await revokeRegistryInvitation({ firestore, actorUid, registryId, invitationId: issued.invitationId });
  const revokedMembership = (await membershipRef.get()).data();
  assert.equal(revokedMembership.status, 'revoked');
  assert.deepEqual(revokedMembership.invitationGrants, {});
  assert.equal((await firestore.doc(`registries/${registryId}/accesses/${issued.invitationId}`).get()).data().sourceStatus, 'revoked');
});
