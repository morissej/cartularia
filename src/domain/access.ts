import type { FirestoreTimestampValue } from './foundations.ts';

export type RegistryAccessKind = 'invitation' | 'mandate' | 'shared_link';
export type RegistryAccessSourceStatus = 'pending' | 'active' | 'expired' | 'revoked';
export type RegistryAccessRecipientKind = 'person' | 'organization' | 'link';
export type RegistryAccessScope = 'registry' | 'collection' | 'cartulary';

export interface RegistryAccessProjection {
  id: string;
  organizationId: string;
  registryId: string;
  cartularyId: string | null;
  collectionId?: string | null;
  scopeType?: RegistryAccessScope;
  scopeId?: string;
  permissions?: Array<'read' | 'comment'>;
  displayTitle: string;
  recipientLabel: string;
  recipientKind: RegistryAccessRecipientKind;
  accessKind: RegistryAccessKind;
  sourceStatus: RegistryAccessSourceStatus;
  issuedAt: string | FirestoreTimestampValue;
  expiresAt: string | FirestoreTimestampValue | null;
  revokedAt: string | FirestoreTimestampValue | null;
  lastConsultedAt: string | FirestoreTimestampValue | null;
  consultationCount: number;
  sourceRevision: number;
  projectionStatus: 'active' | 'withdrawn';
  contentHash: string;
  generatedAt?: FirestoreTimestampValue;
  updatedAt?: FirestoreTimestampValue;
}

export interface RegistryAccessInput {
  recipientLabel: string;
  recipientKind: RegistryAccessRecipientKind;
  accessKind: RegistryAccessKind;
  scopeType: RegistryAccessScope;
  scopeId: string;
  displayTitle: string;
  cartularyId: string | null;
  collectionId: string | null;
  expiresAt: string | null;
  permissions: Array<'read' | 'comment'>;
}
