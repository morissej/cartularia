export const LOCAL_CHANGE_COALESCE_DELAY_MS = 1_200;
export const AUTHORITATIVE_SYNC_FOLLOW_UP_DELAY_MS = 1_500;
export const CLOUD_SYNC_RETRY_DELAYS_MS = [1_000, 2_500, 5_000, 10_000, 20_000] as const;

export const cloudSyncRetryDelay = (attempt: number): number | null => (
  Number.isInteger(attempt) && attempt >= 0
    ? CLOUD_SYNC_RETRY_DELAYS_MS[attempt] ?? null
    : null
);
