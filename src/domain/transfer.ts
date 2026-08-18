export type CartularyTransferStatus = 'proposed' | 'accepted' | 'completed' | 'rejected' | 'expired';

export interface CartularyTransferDecision {
  status: 'pending' | 'accepted' | 'rejected';
  actorUid?: string;
  decisionSource: 'human_confirmed' | null;
  decidedAtIso?: string;
  digest?: string;
}

export interface CartularyTransferDocument {
  transferId: string;
  cartularyId: string;
  sellerUid: string;
  buyerUid: string;
  participantUids: string[];
  status: CartularyTransferStatus;
  sourceRevision: number;
  proposalHead: string;
  acceptedRevision?: number;
  acceptedHead?: string;
  effectiveRevision?: number;
  effectiveHead?: string;
  sellerDecision: CartularyTransferDecision;
  buyerDecision: CartularyTransferDecision;
  expiresAtIso: string;
  completedAtIso?: string;
  sealing?: {
    status: 'timestamped';
    batchId: string;
    merkleRoot: string;
    timestampReceiptId: string;
    publicAnchoringStatus: 'pending_confirmation' | 'anchored';
    publicAnchorBlockHeight: number | null;
    acceptedHead: string;
  };
}

export interface CartularyTransferAuditEvent {
  eventId: string;
  action: string;
  sequence: number;
  occurredAtIso: string;
  hash: string;
  previousEventHash: string;
  resource: Record<string, unknown>;
}

export interface CartularyTransferState {
  revision: number;
  currentOwnerUid: string;
  transferCount: number;
  transfers: CartularyTransferDocument[];
  events: CartularyTransferAuditEvent[];
}
