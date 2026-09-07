/** Ordering metadata only: no identity, private content or decryption key. */
export interface CodeSyncRevision { seconds: number; nanoseconds: number }
export interface PersonalVaultSaveReceipt { codeRevision: CodeSyncRevision }

export const validCodeSyncRevision = (value: unknown): value is CodeSyncRevision => {
  const candidate = value as CodeSyncRevision | null;
  return Boolean(candidate && Number.isSafeInteger(candidate.seconds) && candidate.seconds > 0
    && Number.isSafeInteger(candidate.nanoseconds) && candidate.nanoseconds >= 0 && candidate.nanoseconds < 1_000_000_000);
};
export const compareCodeSyncRevision = (left: CodeSyncRevision, right: CodeSyncRevision) =>
  left.seconds === right.seconds ? Math.sign(left.nanoseconds - right.nanoseconds) : Math.sign(left.seconds - right.seconds);

export const assertNewCodeSyncRevision = (next: CodeSyncRevision, current: unknown) => {
  if (!validCodeSyncRevision(next) || (current !== undefined && (!validCodeSyncRevision(current) || compareCodeSyncRevision(next, current) <= 0))) {
    throw Object.assign(new Error('Une génération de codes plus récente est déjà publiée. Rouvrez la dernière version du Coffre avant de réessayer.'), { code: 'code-sync-stale' });
  }
};
