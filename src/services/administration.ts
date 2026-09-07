import { getIdTokenResult, type User } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export type AdministrationDatabaseId = 'registry' | 'personal' | 'bridge';
export type AdministrationDatabaseState = 'ready' | 'unconfigured' | 'error';

export interface AdministrationUser {
  uid: string;
  label: string;
  email: string | null;
  disabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  recordPresent: boolean;
  recordStatus: string | null;
  recordUpdatedAt: string | null;
  codedReference: string | null;
}

export interface AdministrationDatabase {
  id: AdministrationDatabaseId;
  label: string;
  state: AdministrationDatabaseState;
  users: AdministrationUser[];
  truncated?: boolean;
  error: string | null;
}

export interface AdministrationOverview {
  generatedAt: string;
  databases: AdministrationDatabase[];
  totals: { users: number; disabled: number; configured: number };
}

export interface AdministrationLinkedDatabase {
  id: AdministrationDatabaseId;
  label: string;
  state: AdministrationDatabaseState;
  account: AdministrationUser | null;
}

export interface AdministrationUserDashboard {
  generatedAt: string;
  selectedDatabase: { id: AdministrationDatabaseId; label: string };
  selectedAccount: AdministrationUser;
  registryUid: string | null;
  profile: { displayName: string; status: string; updatedAt: string | null; lastActiveAt: string | null } | null;
  linkedDatabases: AdministrationLinkedDatabase[];
  organizations: Array<{ id: string; name: string; status: string }>;
  memberships: Array<{ organizationId: string; status: string; roles: string[]; permissions: string[]; registryIds: string[] }>;
  registries: Array<{ id: string; organizationId: string; name: string; description: string; status: string; itemCount: number }>;
  cartularies: Array<{
    id: string;
    displayTitle: string;
    makerName: string;
    modelName: string;
    assetType: string;
    lifecycleStatus: string;
    publicationStatus: string;
    registryId: string;
    collectionId: string;
    publicCode: string | null;
    revision: number | null;
  }>;
  collections: Array<{
    id: string;
    registryId: string;
    name: string;
    description: string;
    status: string;
    visibility: string;
    publicationConsent: boolean;
    publishedItemCount: number;
  }>;
  drafts: Array<{ id: string; status: string; assetType: string; registryId: string }>;
  totals: { organizations: number; registries: number; cartularies: number; collections: number; drafts: number };
  truncated: Partial<Record<'memberships' | 'cartularies' | 'drafts' | 'collections', boolean>>;
}

export const userHasAdministrationRole = async (user: User) => {
  const token = await getIdTokenResult(user, true);
  return token.claims.cartulariaAdmin === true;
};

export const loadAdministrationOverview = async () => {
  const callable = httpsCallable<{ pageSize: number }, AdministrationOverview>(functions, 'getAdministrationOverview');
  return (await callable({ pageSize: 200 })).data;
};

export const loadAdministrationUserDashboard = async ({ database, uid }: {
  database: AdministrationDatabaseId;
  uid: string;
}) => {
  const callable = httpsCallable<
    { database: AdministrationDatabaseId; uid: string },
    AdministrationUserDashboard
  >(functions, 'getAdministrationUserDashboard');
  return (await callable({ database, uid })).data;
};

export const updateAdministrationUserState = async ({
  database,
  uid,
  disabled,
  reason,
}: {
  database: AdministrationDatabaseId;
  uid: string;
  disabled: boolean;
  reason: string;
}) => {
  const callable = httpsCallable<
    { database: AdministrationDatabaseId; uid: string; disabled: boolean; reason: string },
    { database: AdministrationDatabaseId; uid: string; disabled: boolean }
  >(functions, 'setAdministrationUserState');
  return (await callable({ database, uid, disabled, reason })).data;
};
