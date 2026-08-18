import type { RegistryItemProjection } from './projections.ts';

export interface RegistryAuditEvent {
  eventId: string;
  cartularyId: string;
  sequence: number;
  occurredAtIso: string;
  actor: Record<string, unknown>;
  action: string;
  resource: Record<string, unknown>;
  beforeDigest: string | null;
  afterDigest: string;
  previousEventHash: string;
  canonicalizationVersion: string;
  requestId: string;
  hash: string;
}

export interface RegistryAuditVerification {
  valid: boolean;
  eventCount: number;
  computedHead: string;
  errors: string[];
}

export interface RegistryIntegrityEntry {
  item: RegistryItemProjection;
  sourceRevision: number;
  integrityHead: string;
  integritySequence: number;
  events: RegistryAuditEvent[];
  verification: RegistryAuditVerification;
  publicAnchoringStatus: 'not_requested' | 'processing' | 'pending_confirmation' | 'anchored' | 'failed';
  publicAnchorBlockHeight: number | null;
  publicAnchorConfirmedAtIso: string | null;
  ownershipTransferCount: number;
  inheritedHead: string | null;
}
