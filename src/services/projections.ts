import { collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
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

/** Les règles refusent la lecture d'une publication absente ou révoquée : même issue qu'une absence. */
const isPermissionDenied = (error: unknown) => (error as { code?: string } | null)?.code === 'permission-denied';

export const loadPublicProjection = async (publicCode: string): Promise<LoadedPublicProjection | null> => {
  const publicationRef = doc(db, 'publications', publicCode);
  let publicationSnapshot: Awaited<ReturnType<typeof getDoc>>;
  try {
    publicationSnapshot = await getDoc(publicationRef);
  } catch (error) {
    if (isPermissionDenied(error)) return null;
    throw error;
  }
  if (!publicationSnapshot.exists()) return null;

  const publication = publicationSnapshot.data() as PublicPublicationProjection;
  if (publication.status !== 'published') return null;

  const [blockSnapshots, sealSnapshot] = await Promise.all([
    getDocs(collection(publicationRef, 'blocks')),
    getDoc(doc(db, 'seals', publicCode)),
  ]);
  const rawBlocks = blockSnapshots.docs.map((snapshot) => snapshot.data() as PublicBlockProjection);
  // Text and navigation must not wait for images, videos, or files on other pages.
  // Media resolve on visibility/user action through Storage Rules, never bearer URLs.
  const blocks: PublicBlockProjection[] = rawBlocks.map((block) => ({ ...block, assets: (block.assets || []).map((asset) => ({ ...asset, downloadUrl: null })) }));

  const orderedBlocks = publication.blockIds
    .map((blockId) => blocks.find((block) => block.blockId === blockId))
    .filter((block): block is PublicBlockProjection => Boolean(block));
  return {
    publication,
    blocks: orderedBlocks,
    seal: sealSnapshot.exists() ? (sealSnapshot.data() as PublicSealProjection) : null,
  };
};

export interface PublicPublicationSummary {
  published: boolean;
  /** Blocs réellement en ligne (`publications/{code}.blockIds`) ; vide si non publié. */
  blockIds: string[];
}

/**
 * État constaté d'une publication : statut et blocs réellement en ligne. Une publication absente,
 * révoquée ou refusée par les règles (permission-denied) vaut « non publiée » ; jamais de faux « publié ».
 */
export const loadPublicPublicationSummaries = async (codes: string[]): Promise<Record<string, PublicPublicationSummary>> => {
  const entries = await Promise.all([...new Set(codes.filter(Boolean))].map(async (code) => {
    try {
      const snapshot = await getDoc(doc(db, 'publications', code));
      const data = snapshot.exists() ? (snapshot.data() as Partial<PublicPublicationProjection>) : null;
      const published = data?.status === 'published';
      const blockIds = published && Array.isArray(data?.blockIds)
        ? data.blockIds.filter((blockId): blockId is string => typeof blockId === 'string')
        : [];
      return [code, { published, blockIds }] as const;
    } catch (error) {
      if (isPermissionDenied(error)) return [code, { published: false, blockIds: [] }] as const;
      throw error;
    }
  }));
  return Object.fromEntries(entries);
};

/** Lightweight link eligibility; inaccessible publications are never advertised. */
export const loadPublicPublicationStatuses = async (codes: string[]): Promise<Record<string, boolean>> => Object.fromEntries(
  Object.entries(await loadPublicPublicationSummaries(codes)).map(([code, summary]) => [code, summary.published]),
);

export const loadReportProjection = async (
  cartularyId: string,
  reportId: string,
): Promise<ReportProjection | null> => {
  const snapshot = await getDoc(doc(db, 'cartularies', cartularyId, 'reportProjections', reportId));
  return snapshot.exists() ? (snapshot.data() as ReportProjection) : null;
};
