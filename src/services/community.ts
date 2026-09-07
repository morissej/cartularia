import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  CommunityBlock,
  CommunityComment,
  CommunityPost,
  CommunityProfile,
  CommunityPublication,
  LoadedCommunityPost,
  LoadedCommunityPublication,
} from '../domain/community.ts';

export const loadCommunityCatalog = async (): Promise<LoadedCommunityPublication[]> => {
  await auth.authStateReady();
  if (!auth.currentUser) throw Object.assign(new Error('Connectez-vous pour accéder au Cercle.'), { code: 'community/signed-out' });
  const membership = await getDoc(doc(db, 'communityMemberships', auth.currentUser.uid));
  const rights = membership.data();
  if (!membership.exists() || rights?.uid !== auth.currentUser.uid || rights.status !== 'active' || !rights.permissions?.includes('community.read')) {
    throw Object.assign(new Error('Votre compte ne possède pas d’admission active au Cercle.'), { code: 'community/admission-required' });
  }
  const publicationSnapshots = await getDocs(query(
    collection(db, 'communityPublications'),
    where('status', '==', 'published'),
    where('moderationStatus', '==', 'approved'),
    orderBy('publishedAt', 'desc'),
    limit(100),
  ));
  return Promise.all(publicationSnapshots.docs.map(async (publicationSnapshot) => ({
    publication: publicationSnapshot.data() as CommunityPublication,
    blocks: (await getDocs(collection(publicationSnapshot.ref, 'blocks'))).docs
      .map((block) => block.data() as CommunityBlock)
      .sort((left, right) => left.order - right.order),
  })));
};

export const loadCommunityFeed = async (): Promise<LoadedCommunityPost[]> => {
  const publicationSnapshots = await getDocs(query(
    collection(db, 'communityPublications'),
    where('status', '==', 'published'),
    where('moderationStatus', '==', 'approved'),
    orderBy('publishedAt', 'desc'),
    limit(20),
  ));
  const postSnapshots = (await Promise.all(publicationSnapshots.docs.map((publicationSnapshot) => getDocs(query(
    collection(db, 'communityPosts'),
    where('communityPublicationId', '==', publicationSnapshot.id),
    where('status', '==', 'active'),
    where('moderationStatus', '==', 'visible'),
    orderBy('publishedAt', 'desc'),
    limit(20),
  ))))).flatMap((snapshot) => snapshot.docs);

  const loaded = await Promise.all(postSnapshots.map(async (postSnapshot) => {
    const post = postSnapshot.data() as CommunityPost;
    const publicationRef = doc(db, 'communityPublications', post.communityPublicationId);
    const [publicationSnapshot, profileSnapshot, blockSnapshots, commentSnapshots] = await Promise.all([
      getDoc(publicationRef),
      getDoc(doc(db, 'communityProfiles', post.authorProfileId)),
      getDocs(collection(publicationRef, 'blocks')),
      getDocs(query(
        collection(postSnapshot.ref, 'comments'),
        where('status', '==', 'visible'),
        orderBy('createdAt', 'asc'),
        limit(50),
      )),
    ]);
    if (!publicationSnapshot.exists()) return null;
    return {
      post,
      profile: profileSnapshot.exists() ? profileSnapshot.data() as CommunityProfile : null,
      publication: publicationSnapshot.data() as CommunityPublication,
      blocks: blockSnapshots.docs
        .map((block) => block.data() as CommunityBlock)
        .sort((left, right) => left.order - right.order),
      comments: commentSnapshots.docs.map((comment) => comment.data() as CommunityComment),
    };
  }));

  return loaded.filter((item): item is LoadedCommunityPost => item !== null);
};
