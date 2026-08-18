import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  type Timestamp,
} from 'firebase/firestore';
import type { RegistryAuditEvent, RegistryAuditVerification } from '../domain/integrity.ts';
import { db } from '../firebase.ts';
import { verifyRegistryAuditChain } from '../utils/auditChain.ts';

export interface AuthoritativeCartularyIntegrity {
  cartularyId: string;
  sourceRevision: number;
  integrityHead: string;
  integritySequence: number;
  events: RegistryAuditEvent[];
  verification: RegistryAuditVerification;
  batchId: string | null;
  timestampStatus: string | null;
  timestampReceiptId: string | null;
  publicAnchoringStatus: 'not_requested' | 'processing' | 'pending_confirmation' | 'anchored' | 'failed';
  publicAnchorBlockHeight: number | null;
  publicAnchorConfirmedAtIso: string | null;
}

const timestampToIso = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value && typeof (value as Timestamp).toDate === 'function') return (value as Timestamp).toDate().toISOString();
  return '';
};

const toAuditEvent = (id: string, data: Record<string, unknown>): RegistryAuditEvent => ({
  eventId: String(data.eventId || id),
  cartularyId: String(data.cartularyId || ''),
  sequence: Number(data.sequence || 0),
  occurredAtIso: String(data.occurredAtIso || timestampToIso(data.occurredAt)),
  actor: data.actor && typeof data.actor === 'object' ? data.actor as Record<string, unknown> : {},
  action: String(data.action || 'unknown'),
  resource: data.resource && typeof data.resource === 'object' ? data.resource as Record<string, unknown> : {},
  beforeDigest: typeof data.beforeDigest === 'string' ? data.beforeDigest : null,
  afterDigest: String(data.afterDigest || ''),
  previousEventHash: String(data.previousEventHash || ''),
  canonicalizationVersion: String(data.canonicalizationVersion || ''),
  requestId: String(data.requestId || ''),
  hash: String(data.hash || ''),
});

export const loadAuthoritativeCartularyIntegrity = async (
  cartularyId: string,
): Promise<AuthoritativeCartularyIntegrity> => {
  const rootRef = doc(db, 'cartularies', cartularyId);
  const [rootSnapshot, eventsSnapshot, projectionSnapshot] = await Promise.all([
    getDoc(rootRef),
    getDocs(query(collection(rootRef, 'auditEvents'), orderBy('sequence', 'asc'))),
    getDoc(doc(db, 'integrityProjections', cartularyId)),
  ]);
  if (!rootSnapshot.exists()) throw new Error(`Cartulaire ${cartularyId} introuvable.`);
  const root = rootSnapshot.data();
  const projection = projectionSnapshot.exists() ? projectionSnapshot.data() : {};
  const batchId = typeof projection.batchId === 'string' ? projection.batchId : null;
  const batchSnapshot = batchId ? await getDoc(doc(db, 'integrityBatches', batchId)) : null;
  const batch = batchSnapshot?.exists() ? batchSnapshot.data() : {};
  const events = eventsSnapshot.docs.map((event) => toAuditEvent(event.id, event.data()));
  const integrityHead = String(root.integrityHead || '');
  const integritySequence = Number(root.integritySequence || 0);
  const rawAnchoringStatus = String(projection.publicAnchoringStatus || batch.publicAnchoringStatus || 'not_requested');
  const publicAnchoringStatus = (
    ['processing', 'pending_confirmation', 'anchored', 'failed'].includes(rawAnchoringStatus)
      ? rawAnchoringStatus
      : 'not_requested'
  ) as AuthoritativeCartularyIntegrity['publicAnchoringStatus'];
  return {
    cartularyId,
    sourceRevision: Number(root.revision || 0),
    integrityHead,
    integritySequence,
    events,
    verification: await verifyRegistryAuditChain(events, integrityHead, integritySequence),
    batchId,
    timestampStatus: typeof batch.timestampStatus === 'string' ? batch.timestampStatus : null,
    timestampReceiptId: typeof batch.timestampReceiptId === 'string' ? batch.timestampReceiptId : null,
    publicAnchoringStatus,
    publicAnchorBlockHeight: Number.isInteger(projection.publicAnchorBlockHeight)
      ? Number(projection.publicAnchorBlockHeight)
      : null,
    publicAnchorConfirmedAtIso: typeof projection.publicAnchorConfirmedAtIso === 'string'
      ? projection.publicAnchorConfirmedAtIso
      : null,
  };
};

export const observeAuthoritativeCartularyIntegrity = (
  cartularyId: string,
  onState: (state: AuthoritativeCartularyIntegrity) => void,
  onError: (error: Error) => void,
) => {
  let generation = 0;
  let stopped = false;
  const refresh = () => {
    const currentGeneration = ++generation;
    void loadAuthoritativeCartularyIntegrity(cartularyId).then((state) => {
      if (!stopped && currentGeneration === generation) onState(state);
    }).catch((error: unknown) => {
      if (!stopped && currentGeneration === generation) {
        onError(error instanceof Error ? error : new Error('Preuve serveur indisponible.'));
      }
    });
  };
  const unsubscribers = [
    onSnapshot(doc(db, 'cartularies', cartularyId), refresh, onError),
    onSnapshot(doc(db, 'integrityProjections', cartularyId), refresh, onError),
  ];
  return () => {
    stopped = true;
    generation += 1;
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
};
