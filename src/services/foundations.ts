import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { auth, db, functions } from '../firebase';
import { normalizeUserAlias } from '../domain/personalDataBoundary';
import type {
  AccountOrganizationContext,
  MembershipDocument,
  OrganizationDocument,
  RegistryDocument,
} from '../domain/foundations';

export const loadOrganizationMemberships = async (
  organizationId: string,
): Promise<MembershipDocument[]> => {
  const snapshot = await getDocs(collection(db, 'organizations', organizationId, 'memberships'));
  return snapshot.docs.map((membership) => membership.data() as MembershipDocument);
};

const loadRegistry = async (registryId: string): Promise<RegistryDocument | null> => {
  const snapshot = await getDoc(doc(db, 'registries', registryId));
  return snapshot.exists() ? (snapshot.data() as RegistryDocument) : null;
};

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const registryAuthenticationEmail = async (identifier: string) => {
  const normalized = normalizeUserAlias(identifier);
  if (normalized.includes('@')) return normalized.toLocaleLowerCase('en-US');
  return `${await sha256Hex(`registry-alias\u0000${normalized.toLocaleLowerCase('fr')}`)}@registry.cartularia.invalid`;
};

export const signInToCartularia = async (identifier: string, password: string): Promise<User> => {
  const credential = await signInWithEmailAndPassword(auth, await registryAuthenticationEmail(identifier), password);
  return credential.user;
};

export const createCartulariaAccount = async (userName: string, password: string): Promise<User> => {
  const normalized = normalizeUserAlias(userName);
  if (normalized.length < 3) throw new Error('invalid_user_name');
  if (password.length < 12) throw new Error('weak_password');
  const credential = await createUserWithEmailAndPassword(auth, await registryAuthenticationEmail(normalized), password);
  await updateProfile(credential.user, { displayName: normalized });
  const activate = httpsCallable<{ userName: string }, { registryId: string }>(functions, 'activateRegistryAccount');
  await activate({ userName: normalized });
  return credential.user;
};

export const signOutOfCartularia = () => signOut(auth);

export const observeCartulariaSession = (observer: (user: User | null) => void) => onAuthStateChanged(auth, observer);

export const loadAccountOrganizations = async (user: User): Promise<AccountOrganizationContext[]> => {
  const membershipsQuery = query(
    collectionGroup(db, 'memberships'),
    where('uid', '==', user.uid),
    where('status', '==', 'active'),
  );
  const membershipSnapshots = await getDocs(membershipsQuery);

  return Promise.all(
    membershipSnapshots.docs.map(async (membershipSnapshot) => {
      const membership = membershipSnapshot.data() as MembershipDocument;
      const organizationSnapshot = await getDoc(doc(db, 'organizations', membership.organizationId));

      if (!organizationSnapshot.exists()) {
        throw new Error(`Organisation introuvable pour le membership ${membershipSnapshot.ref.path}.`);
      }

      const registryIds = [...new Set(membership.scopes.registryIds)];
      const registries = (await Promise.all(registryIds.map(loadRegistry))).filter(
        (registry): registry is RegistryDocument => registry !== null,
      );

      return {
        organization: organizationSnapshot.data() as OrganizationDocument,
        membership,
        registries,
      };
    }),
  );
};

export const loadOwnMembershipByPath = async (
  organizationId: string,
  uid: string,
): Promise<MembershipDocument | null> => {
  const membershipQuery = query(
    collectionGroup(db, 'memberships'),
    where(documentId(), '==', `organizations/${organizationId}/memberships/${uid}`),
  );
  const snapshot = await getDocs(membershipQuery);
  return snapshot.empty ? null : (snapshot.docs[0].data() as MembershipDocument);
};
