import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type NextOrObserver,
  type User,
} from 'firebase/auth';
import {
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  AccountOrganizationContext,
  MembershipDocument,
  OrganizationDocument,
  RegistryDocument,
} from '../domain/foundations';

const loadRegistry = async (registryId: string): Promise<RegistryDocument | null> => {
  const snapshot = await getDoc(doc(db, 'registries', registryId));
  return snapshot.exists() ? (snapshot.data() as RegistryDocument) : null;
};

export const signInToCartularia = async (email: string, password: string): Promise<User> => {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
};

export const signOutOfCartularia = () => signOut(auth);

export const observeCartulariaSession = (observer: NextOrObserver<User>) => onAuthStateChanged(auth, observer);

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
