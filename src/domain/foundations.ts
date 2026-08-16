export const FOUNDATION_MODEL_VERSION = '1.0.0';

export type AccountStatus = 'active' | 'inactive' | 'suspended' | 'closed';
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'revoked';
export type MembershipRole =
  | 'account_holder'
  | 'legal_owner'
  | 'manager'
  | 'payer'
  | 'prescriber'
  | 'beneficiary'
  | 'community_member'
  | 'guest'
  | 'expert'
  | 'support_delegate';

export type FoundationPermission =
  | 'organization.read'
  | 'membership.read'
  | 'registry.read'
  | 'access.read'
  | 'cartulary.read'
  | 'cartulary.edit'
  | 'cartulary.export'
  | 'integrity.batch'
  | 'publication.manage'
  | 'billing.read';

export interface FirestoreTimestampValue {
  seconds: number;
  nanoseconds: number;
}

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  status: AccountStatus;
  modelVersion: typeof FOUNDATION_MODEL_VERSION;
  createdAt: FirestoreTimestampValue;
  updatedAt: FirestoreTimestampValue;
  lastActiveAt?: FirestoreTimestampValue;
  inactiveAt?: FirestoreTimestampValue | null;
  purgeAfter?: FirestoreTimestampValue | null;
}

export interface OrganizationDocument {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  modelVersion: typeof FOUNDATION_MODEL_VERSION;
  createdAt: FirestoreTimestampValue;
  updatedAt: FirestoreTimestampValue;
}

export interface MembershipScopes {
  registryIds: string[];
}

export interface MembershipDocument {
  uid: string;
  organizationId: string;
  roles: MembershipRole[];
  status: MembershipStatus;
  scopes: MembershipScopes;
  permissions: FoundationPermission[];
  createdAt: FirestoreTimestampValue;
  revokedAt: FirestoreTimestampValue | null;
}

export interface RegistryDocument {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  status: 'active' | 'archived';
  visibility: 'secret';
  itemCount: number;
  modelVersion: typeof FOUNDATION_MODEL_VERSION;
  createdAt: FirestoreTimestampValue;
  updatedAt: FirestoreTimestampValue;
}

export interface AccountOrganizationContext {
  organization: OrganizationDocument;
  membership: MembershipDocument;
  registries: RegistryDocument[];
}
