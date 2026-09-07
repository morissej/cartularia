import type { PersonalVaultPayload } from './types';

/** Pending state and personal content share the same encrypted, CAS-protected save. */
export async function saveVaultAndCodes<Receipt>(
  payload: PersonalVaultPayload,
  persist: (value: PersonalVaultPayload) => Promise<Receipt>,
  synchronize: (value: PersonalVaultPayload, receipt: Receipt) => Promise<void>,
  onSynchronizationError?: (error: unknown) => void,
) {
  const pending = { ...payload, codeSyncPending: true };
  const receipt = await persist(pending);
  try {
    await synchronize(pending, receipt);
    const complete = { ...pending, codeSyncPending: false };
    // An interrupted acknowledgement leaves the encrypted pending marker in place.
    await persist(complete);
    return complete;
  } catch (error) { onSynchronizationError?.(error); return pending; }
}
