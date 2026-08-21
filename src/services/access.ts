import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { RegistryAccessInput, RegistryAccessProjection } from '../domain/access.ts';
import { db, functions } from '../firebase.ts';

export const loadRegistryAccesses = async (registryId: string): Promise<RegistryAccessProjection[]> => {
  const snapshot = await getDocs(query(
    collection(db, 'registries', registryId, 'accesses'),
    orderBy('updatedAt', 'desc'),
  ));
  return snapshot.docs.flatMap((accessSnapshot) => {
    const access = accessSnapshot.data() as RegistryAccessProjection;
    if (access.registryId !== registryId || access.projectionStatus !== 'active') return [];
    return [{ ...access, id: access.id || accessSnapshot.id }];
  });
};

export const createRegistryAccess = async ({
  registryId,
  input,
}: {
  registryId: string;
  organizationId: string;
  input: RegistryAccessInput;
}) => {
  const callable = httpsCallable<{
    registryId: string;
    recipientEmail: string;
    scopeType: RegistryAccessInput['scopeType'];
    scopeId: string;
    displayTitle: string;
    expiresAt: string | null;
    continueUrl: string;
  }, { invitationId: string; expiresAt: string; emulatorSignInLink?: string }>(functions, 'createRegistryInvitation');
  const result = await callable({
    registryId,
    recipientEmail: input.recipientLabel,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    displayTitle: input.displayTitle,
    expiresAt: input.expiresAt,
    continueUrl: `${window.location.origin}/invitation/accept`,
  });
  return result.data;
};

export const revokeRegistryAccess = async (registryId: string, accessId: string) => {
  const callable = httpsCallable<{ registryId: string; invitationId: string }, { replayed: boolean }>(
    functions,
    'revokeRegistryInvitationLink',
  );
  await callable({ registryId, invitationId: accessId });
};

export const acceptRegistryAccess = async (invitationId: string, token: string) => {
  const callable = httpsCallable<{
    invitationId: string;
    token: string;
  }, { registryId: string; scopeType: RegistryAccessInput['scopeType']; scopeId: string; replayed: boolean }>(
    functions,
    'acceptRegistryInvitationLink',
  );
  const result = await callable({ invitationId, token });
  return result.data;
};
