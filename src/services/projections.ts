import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { getBlob, ref } from 'firebase/storage';
import { db, storage } from '../firebase';
import type {
  LoadedPublicProjection,
  PublicBlockProjection,
  PublicPublicationProjection,
  PublicSealProjection,
  RegistryItemProjection,
  ReportProjection,
} from '../domain/projections';

export const loadRegistryItems = async (registryId: string): Promise<RegistryItemProjection[]> => {
  const snapshot = await getDocs(query(collection(db, 'registries', registryId, 'items'), orderBy('updatedAt', 'desc')));
  return snapshot.docs.map((item) => item.data() as RegistryItemProjection);
};

export const loadScopedRegistryItems = async (
  registryId: string,
  grant?: { registry: boolean; collectionIds: string[]; cartularyIds: string[] },
): Promise<RegistryItemProjection[]> => {
  if (!grant || grant.registry) return loadRegistryItems(registryId);
  const [cartularies, collections] = await Promise.all([
    Promise.all(grant.cartularyIds.map((cartularyId) => getDoc(doc(db, 'registries', registryId, 'items', cartularyId)))),
    Promise.all(grant.collectionIds.flatMap((collectionId) => [
      getDocs(query(collection(db, 'registries', registryId, 'items'), where('collectionId', '==', collectionId))),
      getDocs(query(collection(db, 'registries', registryId, 'items'), where('collectionIds', 'array-contains', collectionId))),
    ])),
  ]);
  const items = [
    ...cartularies.flatMap((snapshot) => snapshot.exists() ? [snapshot.data() as RegistryItemProjection] : []),
    ...collections.flatMap((snapshot) => snapshot.docs.map((item) => item.data() as RegistryItemProjection)),
  ];
  return [...new Map(items.map((item) => [item.cartularyId, item])).values()];
};

export const observeRegistryItems = (
  registryId: string,
  onItems: (items: RegistryItemProjection[]) => void,
  onError: (error: Error) => void,
) => onSnapshot(
  query(collection(db, 'registries', registryId, 'items'), orderBy('updatedAt', 'desc')),
  (snapshot) => onItems(snapshot.docs.map((item) => item.data() as RegistryItemProjection)),
  (error) => onError(error),
);

export const loadPublicProjection = async (publicCode: string): Promise<LoadedPublicProjection | null> => {
  const publicationRef = doc(db, 'publications', publicCode);
  const publicationSnapshot = await getDoc(publicationRef);
  if (!publicationSnapshot.exists()) return null;

  const publication = publicationSnapshot.data() as PublicPublicationProjection;
  if (publication.status !== 'published') return null;

  const [blockSnapshots, sealSnapshot] = await Promise.all([
    getDocs(collection(publicationRef, 'blocks')),
    getDoc(doc(db, 'seals', publicCode)),
  ]);
  const blocks = await Promise.all(blockSnapshots.docs.map(async (blockSnapshot) => {
    const block = blockSnapshot.data() as PublicBlockProjection;
    const assets = await Promise.all((block.assets || []).map(async (asset) => {
      try {
        const blob = await getBlob(ref(storage, asset.storagePath));
        return { ...asset, downloadUrl: URL.createObjectURL(blob) };
      } catch {
        return { ...asset, downloadUrl: null };
      }
    }));
    return { ...block, assets };
  }));

  const orderedBlocks = publication.blockIds
    .map((blockId) => blocks.find((block) => block.blockId === blockId))
    .filter((block): block is PublicBlockProjection => Boolean(block));
  return {
    publication,
    blocks: orderedBlocks,
    seal: sealSnapshot.exists() ? (sealSnapshot.data() as PublicSealProjection) : null,
  };
};

export const loadReportProjection = async (
  cartularyId: string,
  reportId: string,
): Promise<ReportProjection | null> => {
  const snapshot = await getDoc(doc(db, 'cartularies', cartularyId, 'reportProjections', reportId));
  return snapshot.exists() ? (snapshot.data() as ReportProjection) : null;
};
